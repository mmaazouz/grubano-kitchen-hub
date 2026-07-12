import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── resolveChannelId — robust YouTube channel resolution (Mission 14B-A) ──────
// A real influencer pastes any normal channel reference. The resolver must
// accept ALL of: raw UC id, /channel/UC… (no API call), /@handle, bare @handle,
// bare vanity, /c/Vanity, /user/Legacy — tolerating www/m, missing scheme, and
// trailing slash/query. Direct ids need no key; everything else hits the API
// (mocked here via global fetch). It returns { channelId, viaSearch }: viaSearch
// flags the low-confidence search fallback. hasYouTubeKey() distinguishes a
// config/ENV failure from a genuinely unresolved link.

import { resolveChannelId, hasYouTubeKey } from '@/lib/youtube'

const fetchMock = vi.fn()
const ytOk = (body: unknown) => ({ ok: true, json: async () => body })

let savedKey: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  savedKey = process.env.YOUTUBE_API_KEY
  process.env.YOUTUBE_API_KEY = 'test-key'
  // Default routing: each lookup endpoint resolves to a distinct id.
  fetchMock.mockImplementation((url: string) => {
    const u = String(url)
    if (u.includes('forHandle='))   return Promise.resolve(ytOk({ items: [{ id: 'UC_from_handle' }] }))
    if (u.includes('forUsername=')) return Promise.resolve(ytOk({ items: [{ id: 'UC_from_username' }] }))
    if (u.includes('/search?'))     return Promise.resolve(ytOk({ items: [{ id: { channelId: 'UC_from_search' } }] }))
    return Promise.resolve(ytOk({ items: [] }))
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (savedKey === undefined) delete process.env.YOUTUBE_API_KEY
  else process.env.YOUTUBE_API_KEY = savedKey
})

describe('no API call needed (precise)', () => {
  it('returns a raw UC channel id as-is', async () => {
    const id = 'UCabcdefghijklmnopqrstuv'
    expect(await resolveChannelId(id)).toEqual({ channelId: id, viaSearch: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('extracts the id from a /channel/UC… URL (www + trailing slash)', async () => {
    expect(await resolveChannelId('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/'))
      .toEqual({ channelId: 'UCabcdefghijklmnopqrstuv', viaSearch: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handle / vanity / username — via the API', () => {
  it('resolves a /@handle URL via forHandle (precise)', async () => {
    expect(await resolveChannelId('https://youtube.com/@marco.food')).toEqual({ channelId: 'UC_from_handle', viaSearch: false })
    expect(String(fetchMock.mock.calls[0][0])).toContain('forHandle=%40marco.food')
  })
  it('resolves a bare @handle via forHandle (precise)', async () => {
    expect(await resolveChannelId('@marco.food')).toEqual({ channelId: 'UC_from_handle', viaSearch: false })
  })
  it('resolves a bare vanity name via forHandle (precise when forHandle hits)', async () => {
    expect(await resolveChannelId('MarcoFood')).toEqual({ channelId: 'UC_from_handle', viaSearch: false })
  })
  it('resolves a /user/Legacy URL via forUsername (precise)', async () => {
    expect(await resolveChannelId('youtube.com/user/MarcoFood')).toEqual({ channelId: 'UC_from_username', viaSearch: false })
    expect(String(fetchMock.mock.calls[0][0])).toContain('forUsername=MarcoFood')
  })
  it('resolves a /c/Vanity URL via the search fallback (m. + query) and flags viaSearch', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url)
      if (u.includes('forHandle=')) return Promise.resolve(ytOk({ items: [] }))   // miss
      if (u.includes('/search?'))   return Promise.resolve(ytOk({ items: [{ id: { channelId: 'UC_vanity' } }] }))
      return Promise.resolve(ytOk({ items: [] }))
    })
    expect(await resolveChannelId('https://m.youtube.com/c/MarcoCuisine?si=x')).toEqual({ channelId: 'UC_vanity', viaSearch: true })
  })
  it('tolerates a trailing path + query on a handle URL', async () => {
    await resolveChannelId('https://www.youtube.com/@marco.food/videos?si=abc')
    expect(String(fetchMock.mock.calls[0][0])).toContain('forHandle=%40marco.food')
  })
})

describe('failure modes', () => {
  it('empty input → null (no fetch)', async () => {
    expect(await resolveChannelId('')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('no API key → null for a handle; hasYouTubeKey reports the config gap', async () => {
    delete process.env.YOUTUBE_API_KEY
    expect(await resolveChannelId('@marco.food')).toBeNull()
    expect(hasYouTubeKey()).toBe(false)
  })
  it('unknown handle (every lookup empty) → null', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ytOk({ items: [] })))
    expect(await resolveChannelId('@nobody')).toBeNull()
  })
})

describe('hasYouTubeKey', () => {
  it('reflects the env var', () => {
    process.env.YOUTUBE_API_KEY = 'x'
    expect(hasYouTubeKey()).toBe(true)
    delete process.env.YOUTUBE_API_KEY
    expect(hasYouTubeKey()).toBe(false)
  })
})
