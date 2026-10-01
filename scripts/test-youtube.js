// scripts/test-youtube.js
// Smoke-test the YouTube Data API v3 helper (lib/youtube.ts) end-to-end.
//
// Usage (locally OR on the o2switch server, once YOUTUBE_API_KEY is set):
//   node scripts/test-youtube.js @marco.food
//   node scripts/test-youtube.js https://www.youtube.com/@MrBeast
//   node scripts/test-youtube.js https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA
//   node scripts/test-youtube.js UCX6OQ3DkcsbYNE6H8uQQuVA
//
// The script loads YOUTUBE_API_KEY from .env.local automatically so a plain
// `node` invocation works in cPanel Terminal too. The fetch logic is inlined
// (mirrors lib/youtube.ts) so the script has zero TypeScript dependency — same
// pattern as scripts/geocode-restaurants.js.

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Load YOUTUBE_API_KEY from .env.local if not already in the environment ───
if (!process.env.YOUTUBE_API_KEY) {
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^YOUTUBE_API_KEY=(.+)$/)
      if (m) {
        process.env.YOUTUBE_API_KEY = m[1].trim().replace(/^["']|["']$/g, '')
        break
      }
    }
  }
}

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

async function getJson(url) {
  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 8000)
    const res     = await fetch(url, {
      signal:  ctrl.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timeout))
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

async function resolveChannelId(input) {
  try {
    const raw = (input || '').trim()
    if (!raw) return null

    if (/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return raw

    const channelMatch = raw.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/)
    if (channelMatch) return channelMatch[1]

    let handle = null
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
      YT_BASE + '/channels?part=id' +
      '&forHandle=' + encodeURIComponent('@' + handle) +
      '&key=' + encodeURIComponent(key)

    const json = await getJson(url)
    const id   = json && json.items && json.items[0] && json.items[0].id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

async function getChannelStats(channelId) {
  try {
    const id = (channelId || '').trim()
    if (!id) return null
    const key = process.env.YOUTUBE_API_KEY
    if (!key) return null

    const url =
      YT_BASE + '/channels?part=snippet,statistics' +
      '&id=' + encodeURIComponent(id) +
      '&key=' + encodeURIComponent(key)

    const json = await getJson(url)
    const item = json && json.items && json.items[0]
    if (!item) return null

    const stats = item.statistics
    if (!stats || stats.hiddenSubscriberCount === true) return null

    const subscriberCount = Number.parseInt(stats.subscriberCount || '', 10)
    if (!Number.isFinite(subscriberCount)) return null

    return {
      subscriberCount,
      title:       (item.snippet && item.snippet.title)       || '',
      description: (item.snippet && item.snippet.description)  || '',
    }
  } catch {
    return null
  }
}

async function main() {
  const input = process.argv[2]
  if (!input) {
    console.error('Usage: node scripts/test-youtube.js <url | @handle | UC… id>')
    process.exit(1)
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.warn('[test-youtube] YOUTUBE_API_KEY not set (checked env + .env.local).')
    console.warn('[test-youtube] Direct ids / /channel/ URLs still resolve; handle + stats need the key.')
  }

  console.log('[test-youtube] input:', input)

  const channelId = await resolveChannelId(input)
  console.log('[test-youtube] resolveChannelId ->', channelId)

  if (!channelId) {
    console.log('[test-youtube] No channel id resolved — stopping.')
    return
  }

  const stats = await getChannelStats(channelId)
  console.log('[test-youtube] getChannelStats ->', stats)
}

main().catch((err) => {
  // Defensive: the helpers never throw, but keep the script crash-proof.
  console.error('[test-youtube] unexpected error:', err)
  process.exit(1)
})
