import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/restaurants/logo-prefill/apply — upload confirmed logo (Agent 92) ────────────
// Re-validates the bytes CHEZ NOUS (real magic bytes via the REAL lib/safe-fetch.sniffImageType
// + cap) BEFORE uploading, then reuses the EXISTING Cloudinary path (lib/dish-photo.uploadDishImage,
// MOCKED here to assert it's called with BYTES, never an external URL). Owner-scoped, gated.
// The REAL safe-fetch is used (sniff is pure, no network); only dish-photo + prisma + auth mocked.

const { db, session, upload } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() }, restaurant: { update: vi.fn() } },
  session: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dish-photo', () => ({ uploadDishImage: upload }))

import { POST } from '@/app/api/restaurants/logo-prefill/apply/route'

const post = (body: unknown) => POST(new Request('http://x/api/restaurants/logo-prefill/apply', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

// Real magic-byte buffers.
const PNG_B64  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64')
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]).toString('base64')
const TEXT_B64 = Buffer.from('this is not an image').toString('base64')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED = 'true'
  session.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  upload.mockResolvedValue('https://res.cloudinary.com/grubano/image/upload/c_fill/logo.png')
})
afterEach(() => { delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED })

describe('gating + owner-scoping', () => {
  it('flag OFF → 404, no upload', async () => {
    delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED
    expect((await post({ imageBase64: PNG_B64, mediaType: 'image/png' })).status).toBe(404)
    expect(upload).not.toHaveBeenCalled()
  })
  it('no session → 401; non-restaurant → 403 (no upload)', async () => {
    session.mockResolvedValue(null)
    expect((await post({ imageBase64: PNG_B64, mediaType: 'image/png' })).status).toBe(401)
    session.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'c1', role: 'consumer' })
    expect((await post({ imageBase64: PNG_B64, mediaType: 'image/png' })).status).toBe(403)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('⚠️ magic-byte re-validation CHEZ NOUS before any upload', () => {
  it('rejects a fake image (text) — sniff null → 400, upload never reached', async () => {
    expect((await post({ imageBase64: TEXT_B64, mediaType: 'image/png' })).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })
  it('rejects a content/declared-type MISMATCH (PNG bytes declared jpeg) → 400', async () => {
    expect((await post({ imageBase64: PNG_B64, mediaType: 'image/jpeg' })).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })
  it('rejects a disallowed declared type (svg) at the schema → 400', async () => {
    expect((await post({ imageBase64: PNG_B64, mediaType: 'image/svg+xml' })).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('happy path — reuses the existing Cloudinary uploader with BYTES, returns our URL', () => {
  it('valid PNG → uploadDishImage(base64, type) → {url}; no profile write here', async () => {
    const res = await post({ imageBase64: PNG_B64, mediaType: 'image/png' })
    expect(res.status).toBe(200)
    expect((await res.json()).url).toMatch(/res\.cloudinary\.com/)
    expect(upload).toHaveBeenCalledTimes(1)
    // ⚠️ uploaded the BYTES, never an external URL
    expect(upload).toHaveBeenCalledWith(PNG_B64, 'image/png')
    // the route does NOT write the profile — the client PATCHes the existing route
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })
  it('valid JPEG works too', async () => {
    expect((await post({ imageBase64: JPEG_B64, mediaType: 'image/jpeg' })).status).toBe(200)
    expect(upload).toHaveBeenCalledWith(JPEG_B64, 'image/jpeg')
  })
})
