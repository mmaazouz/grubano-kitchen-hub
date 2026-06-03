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

/**
 * Resolve a YouTube channel id (UC…) from any of:
 *   - a raw channel id           "UCxxxxxxxxxxxxxxxxxxxxxx"
 *   - a /channel/UC… URL         "https://youtube.com/channel/UCxxxx…"
 *   - a /@handle URL             "https://youtube.com/@marco.food"
 *   - a bare handle              "@marco.food"
 *
 * Direct ids and /channel/ URLs are returned WITHOUT an API call (no key needed).
 * Handle resolution calls channels?forHandle=… and needs YOUTUBE_API_KEY.
 *
 * Returns the channel id, or null if it can't be resolved (no key, unknown
 * handle, network/parse error). Never throws.
 */
export async function resolveChannelId(input: string): Promise<string | null> {
  try {
    const raw = (input ?? '').trim()
    if (!raw) return null

    // 1) A bare channel id (UC + 22 url-safe chars).
    if (/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return raw

    // 2) A /channel/UC… URL → the id is in the path, no API call required.
    const channelMatch = raw.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/)
    if (channelMatch) return channelMatch[1]

    // 3) A handle, either bare ("@name") or inside a "/@name" URL.
    let handle: string | null = null
    if (raw.startsWith('@')) {
      handle = raw.slice(1)
    } else {
      const handleMatch = raw.match(/\/@([A-Za-z0-9._-]+)/)
      if (handleMatch) handle = handleMatch[1]
    }
    if (!handle) return null

    const key = process.env.YOUTUBE_API_KEY
    if (!key) return null

    const url =
      `${YT_BASE}/channels?part=id` +
      `&forHandle=${encodeURIComponent('@' + handle)}` +
      `&key=${encodeURIComponent(key)}`

    const json = await getJson<ChannelIdResponse>(url)
    const id   = json?.items?.[0]?.id
    return typeof id === 'string' && id.length > 0 ? id : null
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
