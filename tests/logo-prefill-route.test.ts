import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/restaurants/logo-prefill — detect/preview (Agent 92) ─────────────────────────
// Gated 404 OFF; owner-scoped; the page + image fetches are SSRF-safe (lib/safe-fetch is
// MOCKED — its SSRF matrix lives in safe-fetch.test). The REAL lib/logo-detect parses
// candidates. Each candidate is fetched via the SAME guard (fetchSiteImage); an internal/
// bad candidate is SKIPPED and the next tried. Returns a PREVIEW and writes NOTHING.

const { db, session, sf } = vi.hoisted(() => {
  class SafeFetchError extends Error {
    constructor(public code: string) { super(code); this.name = 'SafeFetchError' }
  }
  return {
    db: { operator: { findUnique: vi.fn() }, restaurant: { update: vi.fn() } },
    session: vi.fn(),
    sf: { fetchSiteText: vi.fn(), fetchSiteImage: vi.fn(), SafeFetchError },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/safe-fetch', () => sf)

import { GET, POST } from '@/app/api/restaurants/logo-prefill/route'

const post = (body: unknown) => POST(new Request('http://x/api/restaurants/logo-prefill', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const URL_OK = 'https://chez-luigi.fr'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED = 'true'
  session.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  sf.fetchSiteText.mockResolvedValue('<meta property="og:image" content="https://cdn.x/logo.png"><link rel="icon" href="/favicon.ico">')
  sf.fetchSiteImage.mockResolvedValue({ bytes: PNG, mediaType: 'image/png' })
})
afterEach(() => { delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED })

describe('GET — flag probe', () => {
  it('reports enabled true/false', async () => {
    expect((await (await GET()).json()).enabled).toBe(true)
    delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED
    expect((await (await GET()).json()).enabled).toBe(false)
  })
})

describe('POST — gating + owner-scoping', () => {
  it('flag OFF → 404, nothing touched', async () => {
    delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED
    expect((await post({ url: URL_OK })).status).toBe(404)
    expect(session).not.toHaveBeenCalled()
    expect(sf.fetchSiteText).not.toHaveBeenCalled()
  })
  it('no session → 401; non-restaurant → 403 (no fetch)', async () => {
    session.mockResolvedValue(null)
    expect((await post({ url: URL_OK })).status).toBe(401)
    session.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'c1', role: 'consumer' })
    expect((await post({ url: URL_OK })).status).toBe(403)
    expect(sf.fetchSiteText).not.toHaveBeenCalled()
  })
  it('invalid body → 400', async () => {
    expect((await post({ nope: 1 })).status).toBe(400)
  })
})

describe('POST — page fetch SSRF failures map to generic codes', () => {
  it('blocked/invalid → 400; too_large → 413; timeout → 504', async () => {
    sf.fetchSiteText.mockRejectedValueOnce(new sf.SafeFetchError('blocked'))
    expect((await post({ url: URL_OK })).status).toBe(400)
    sf.fetchSiteText.mockRejectedValueOnce(new sf.SafeFetchError('too_large'))
    expect((await post({ url: URL_OK })).status).toBe(413)
    sf.fetchSiteText.mockRejectedValueOnce(new sf.SafeFetchError('timeout'))
    expect((await post({ url: URL_OK })).status).toBe(504)
  })
})

describe('POST — candidate loop + preview (zero write)', () => {
  it('returns the first valid raster candidate as an ephemeral preview', async () => {
    const res = await post({ url: URL_OK })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preview.mediaType).toBe('image/png')
    expect(body.preview.imageBase64).toBe(PNG.toString('base64'))
    // every candidate fetch goes through the SSRF guard (fetchSiteImage), never a raw fetch
    expect(sf.fetchSiteImage).toHaveBeenCalled()
    expect(db.restaurant.update).not.toHaveBeenCalled() // ⚠️ nothing applied
  })

  it('⚠️ SKIPS a candidate that the SSRF guard blocks (internal IP) and tries the next', async () => {
    sf.fetchSiteImage
      .mockRejectedValueOnce(new sf.SafeFetchError('blocked')) // 1st candidate → internal → skipped
      .mockResolvedValueOnce({ bytes: PNG, mediaType: 'image/png' }) // 2nd candidate → ok
    const res = await post({ url: URL_OK })
    expect(res.status).toBe(200)
    expect((await res.json()).preview.mediaType).toBe('image/png')
    expect(sf.fetchSiteImage).toHaveBeenCalledTimes(2)
  })

  it('no usable logo → neutral 200 {preview:null} (no oracle, no write)', async () => {
    sf.fetchSiteImage.mockRejectedValue(new sf.SafeFetchError('bad_content'))
    const res = await post({ url: URL_OK })
    expect(res.status).toBe(200)
    expect((await res.json()).preview).toBeNull()
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })
})
