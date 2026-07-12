/**
 * YouTube Data API v3 helper — server-side only.
 *
 * Backs the creator "subscriber count" enrichment. Reads the API key from
 *   process.env.YOUTUBE_API_KEY
 * (never hard-coded). The key is restricted to the YouTube Data API in GCP.
 *
 * Every function is BEST-EFFORT and returns `null` on any failure — a missing
 * key, an unreachable API, a malformed response, a hidden subscriber count, or
 * an unknown channel. NOTHING here ever throws, so callers can treat `null` as
 * a clean "no data" and degrade gracefully.
 *
 * Docs: https://developers.google.com/youtube/v3/docs/channels/list
 */

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

// ── Minimal response shapes (only the fields we read) ─────────────────────────
interface ChannelIdResponse {
  items?: Array<{ id?: string }>
}

interface ChannelStatsResponse {
  items?: Array<{
    snippet?: { title?: string; description?: string }
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean }
    topicDetails?: { topicCategories?: string[] }
  }>
}

interface UploadsPlaylistResponse {
  items?: Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } }
  }>
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: { title?: string }
  }>
}

// search?type=channel returns the id under id.channelId (not a bare id).
interface SearchResponse {
  items?: Array<{ id?: { channelId?: string } }>
}

export interface YouTubeChannelStats {
  subscriberCount: number
  title:           string
  description:     string
  // Wikipedia topic categories, reduced to their last readable URL segment
  // (e.g. "Food", "Video_game_culture"). [] when YouTube returns no topics.
  topicCategories: string[]
}

/** GET helper with a hard timeout. Returns parsed JSON or null on any failure. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 8_000)
    const res     = await fetch(url, {
      signal:  ctrl.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timeout))
    if (!res.ok) return null
    return (await res.json().catch(() => null)) as T | null
  } catch {
    return null
  }
}

/** True when a YouTube Data API key is configured server-side. Lets callers
 *  distinguish a CONFIG/ENV problem (no key) from a genuine unresolved link. */
export function hasYouTubeKey(): boolean {
  return !!process.env.YOUTUBE_API_KEY
}

/** channels?forHandle=@handle → channel id, or null. (1 quota unit.) */
async function lookupByHandle(handle: string, key: string): Promise<string | null> {
  const h   = handle.startsWith('@') ? handle : '@' + handle
  const url =
    `${YT_BASE}/channels?part=id` +
    `&forHandle=${encodeURIComponent(h)}` +
    `&key=${encodeURIComponent(key)}`
  const json = await getJson<ChannelIdResponse>(url)
  const id   = json?.items?.[0]?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** channels?forUsername=Legacy → channel id, or null. (1 quota unit.) */
async function lookupByUsername(username: string, key: string): Promise<string | null> {
  const url =
    `${YT_BASE}/channels?part=id` +
    `&forUsername=${encodeURIComponent(username)}` +
    `&key=${encodeURIComponent(key)}`
  const json = await getJson<ChannelIdResponse>(url)
  const id   = json?.items?.[0]?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** search?type=channel&q=… → best channel id, or null. Last-resort fallback for
 *  legacy /c/ vanity names that forHandle/forUsername can't resolve. (100 units.) */
async function searchChannelId(query: string, key: string): Promise<string | null> {
  const url =
    `${YT_BASE}/search?part=id&type=channel&maxResults=1` +
    `&q=${encodeURIComponent(query)}` +
    `&key=${encodeURIComponent(key)}`
  const json = await getJson<SearchResponse>(url)
  const id   = json?.items?.[0]?.id?.channelId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Resolve a YouTube channel id (UC…) from ANY normal channel reference:
 *   - raw channel id        "UCxxxxxxxxxxxxxxxxxxxxxx"
 *   - /channel/UC… URL      "https://youtube.com/channel/UCxxxx…"   (no API call)
 *   - /@handle URL          "https://www.youtube.com/@marco.food"   (forHandle)
 *   - bare handle           "@marco.food"  OR  "marco.food"         (forHandle → search)
 *   - /c/Vanity URL         "https://youtube.com/c/MarcoCuisine"    (forHandle → search)
 *   - /user/Legacy URL      "https://youtube.com/user/MarcoFood"    (forUsername → search)
 * Tolerates a missing scheme, www./m. hosts, and trailing slashes / ?query / #hash.
 *
 * Direct ids and /channel/ URLs need NO key. Everything else calls the YouTube
 * Data API and needs YOUTUBE_API_KEY (use hasYouTubeKey() to surface a config
 * error distinctly). Returns { channelId, viaSearch } or null if it can't be
 * resolved (no key, unknown channel, network/parse error). Never throws.
 *
 * `viaSearch` flags a LOW-CONFIDENCE match: the id came from the fuzzy search
 * fallback (a bare/ambiguous token or a legacy /c/ vanity), which returns
 * YouTube's TOP channel for the query — possibly a STRANGER's. The caller treats
 * a missing ownership code on a searched channel as "wrong link" (→ re-paste an
 * exact link), not "code not added yet" (→ retry forever on the wrong channel).
 * Precise matches (raw id, /channel/, forHandle, forUsername) are viaSearch=false.
 */
export interface ResolvedChannel {
  channelId: string
  viaSearch: boolean
}

export async function resolveChannelId(input: string): Promise<ResolvedChannel | null> {
  try {
    const raw = (input ?? '').trim()
    if (!raw) return null

    // 1) A bare channel id (UC + 22 url-safe chars) — no API call.
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return { channelId: raw, viaSearch: false }

    // If a youtube.com URL was pasted (with/without scheme, www./m.), isolate the
    // path; otherwise treat the whole string as a bare token. Strip ?query/#hash
    // and any trailing slash so "/@x/videos?si=1" and "/@x/" both normalise.
    const urlMatch    = raw.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(.+)$/i)
    const pathOrToken = (urlMatch ? urlMatch[1] : raw).replace(/[?#].*$/, '').replace(/\/+$/, '')

    // 2) /channel/UC… → id is in the path, no API call required.
    const channelMatch = pathOrToken.match(/(?:^|\/)channel\/(UC[A-Za-z0-9_-]{20,})/i)
    if (channelMatch) return { channelId: channelMatch[1], viaSearch: false }

    const key = process.env.YOUTUBE_API_KEY
    if (!key) return null

    // 3) /user/Legacy → forUsername (precise), with a search fallback (fuzzy).
    const userMatch = pathOrToken.match(/(?:^|\/)user\/([^/]+)/i)
    if (userMatch) {
      const u = decodeURIComponent(userMatch[1])
      const byUser = await lookupByUsername(u, key)
      if (byUser) return { channelId: byUser, viaSearch: false }
      const found = await searchChannelId(u, key)
      return found ? { channelId: found, viaSearch: true } : null
    }

    // 4) Pick a handle / vanity token:
    //    "/@name" or "@name" → handle ; "/c/Vanity" → vanity ; a lone token → either.
    let token: string | null = null
    const atMatch = pathOrToken.match(/(?:^|\/)@([^/]+)/)
    if (atMatch)              token = decodeURIComponent(atMatch[1])
    else if (raw.startsWith('@')) token = raw.slice(1)
    else {
      const cMatch = pathOrToken.match(/(?:^|\/)c\/([^/]+)/i)
      if (cMatch)                                          token = decodeURIComponent(cMatch[1])
      else if (!urlMatch && /^[A-Za-z0-9._-]+$/.test(pathOrToken)) token = pathOrToken // bare handle/vanity
    }
    if (!token) return null

    // forHandle (precise) covers @handles and most modern vanity (vanity ==
    // handle today); a channel search (fuzzy) catches legacy /c/ vanity names.
    const byHandle = await lookupByHandle(token, key)
    if (byHandle) return { channelId: byHandle, viaSearch: false }
    const found = await searchChannelId(token, key)
    return found ? { channelId: found, viaSearch: true } : null
  } catch {
    return null
  }
}

/**
 * Fetch a channel's public stats by id.
 *
 * Returns { subscriberCount, title, description } or null when:
 *   - YOUTUBE_API_KEY is missing
 *   - the channel is unknown
 *   - the subscriber count is HIDDEN by the channel owner
 *   - the API is unreachable / the response is malformed
 *
 * Never throws.
 */
export async function getChannelStats(
  channelId: string,
): Promise<YouTubeChannelStats | null> {
  try {
    const id  = (channelId ?? '').trim()
    if (!id) return null
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return null

    const url =
      `${YT_BASE}/channels?part=snippet,statistics,topicDetails` +
      `&id=${encodeURIComponent(id)}` +
      `&key=${encodeURIComponent(key)}`

    const json = await getJson<ChannelStatsResponse>(url)
    const item = json?.items?.[0]
    if (!item) return null

    const stats = item.statistics
    // Owner hid the subscriber count → treat as "no data".
    if (!stats || stats.hiddenSubscriberCount === true) return null

    const subscriberCount = Number.parseInt(stats.subscriberCount ?? '', 10)
    if (!Number.isFinite(subscriberCount)) return null

    // Reduce each Wikipedia topic URL to its last readable path segment.
    const topicCategories = (item.topicDetails?.topicCategories ?? [])
      .map((u) => {
        if (typeof u !== 'string') return ''
        const seg = u.split('/').filter(Boolean).pop() ?? ''
        return decodeURIComponent(seg)
      })
      .filter((s) => s.length > 0)

    return {
      subscriberCount,
      title:       item.snippet?.title       ?? '',
      description: item.snippet?.description  ?? '',
      topicCategories,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the titles of a channel's most recent uploads (best signal for what the
 * channel is ACTUALLY about, vs. a self-declared bio).
 *
 * Two calls: channels?part=contentDetails → the "uploads" playlist id, then
 * playlistItems?part=snippet → the latest video titles.
 *
 * Returns up to `max` titles, or [] on any failure (no key, unknown channel,
 * empty playlist, network/parse error). Never throws.
 */
export async function getRecentVideoTitles(channelId: string, max = 10): Promise<string[]> {
  try {
    const id = (channelId ?? '').trim()
    if (!id) return []
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return []

    const limit = Math.max(1, Math.min(50, Math.trunc(max) || 10))

    // 1) Resolve the channel's "uploads" playlist.
    const channelUrl =
      `${YT_BASE}/channels?part=contentDetails` +
      `&id=${encodeURIComponent(id)}` +
      `&key=${encodeURIComponent(key)}`

    const channelJson = await getJson<UploadsPlaylistResponse>(channelUrl)
    const uploads     = channelJson?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
    if (typeof uploads !== 'string' || uploads.length === 0) return []

    // 2) Pull the latest video titles from that playlist.
    const playlistUrl =
      `${YT_BASE}/playlistItems?part=snippet` +
      `&playlistId=${encodeURIComponent(uploads)}` +
      `&maxResults=${limit}` +
      `&key=${encodeURIComponent(key)}`

    const playlistJson = await getJson<PlaylistItemsResponse>(playlistUrl)
    const items        = playlistJson?.items ?? []

    return items
      .map((it) => (typeof it.snippet?.title === 'string' ? it.snippet.title.trim() : ''))
      .filter((t) => t.length > 0)
  } catch {
    return []
  }
}
