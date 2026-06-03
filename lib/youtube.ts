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
  }>
}

export interface YouTubeChannelStats {
  subscriberCount: number
  title:           string
  description:     string
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
      `${YT_BASE}/channels?part=snippet,statistics` +
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

    return {
      subscriberCount,
      title:       item.snippet?.title       ?? '',
      description: item.snippet?.description  ?? '',
    }
  } catch {
    return null
  }
}
