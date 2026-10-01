import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── ATTRIBUTION_COOKIES_ENABLED — Lot 7 closed beta (legal + privacy) ────────────
// Beta rule: a NON-essential tracker is switched OFF rather than shipping a CMP.
// The single flag gates ONLY the Set-Cookie of the two attribution routes:
//   • GET /api/ref/[code]        → grubano_ref  (90 d first-touch, creator/affiliate)
//   • GET /api/chef-visit/[slug] → grubano_chef (24 h last-touch, chef page)
// Flag absent (default) → the response carries NO attribution Set-Cookie while the
// redirect (307 + Location) stays byte-identical. Flag === 'true' → cookie dropped
// exactly as before. The attribution SEMANTICS under the armed flag stay pinned by
// tests/affiliate-ref-click.test.ts.

const { db } = vi.hoisted(() => ({
  db: {
    creator:        { findFirst: vi.fn() },
    affiliate:      { findFirst: vi.fn() },
    referralConfig: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { rolesMock } = vi.hoisted(() => ({ rolesMock: vi.fn() }))
vi.mock('@/lib/creator-roles', () => ({ readCreatorRoles: rolesMock }))

const { enabledMock } = vi.hoisted(() => ({ enabledMock: vi.fn() }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled: enabledMock }))

const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }))
vi.mock('@/lib/affiliate-clicks', () => ({ recordAffiliateClick: recordMock }))

import { NextRequest } from 'next/server'
import { GET as refGet } from '@/app/api/ref/[code]/route'
import { GET as chefGet } from '@/app/api/chef-visit/[slug]/route'

const callRef = (code: string) =>
  refGet(new NextRequest(`https://grubano.com/api/ref/${code}`), { params: { code } })
const callChef = (slug: string) =>
  chefGet(new NextRequest(`https://grubano.com/api/chef-visit/${slug}`), { params: { slug } })

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ATTRIBUTION_COOKIES_ENABLED
  enabledMock.mockReturnValue(false) // affiliate rail OFF — creator path only
  recordMock.mockResolvedValue(true)
  db.creator.findFirst.mockResolvedValue({ id: 'cr1', referralCode: 'DEMO20', referralLinkSlug: 'demo20' })
  db.affiliate.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue({ durationDays: 90 })
  rolesMock.mockResolvedValue({ isInfluencer: true })
})

afterEach(() => {
  // pool 'forks' runs several FILES sequentially in one worker — never leak the flag.
  delete process.env.ATTRIBUTION_COOKIES_ENABLED
})

describe('flag ABSENT (beta default) — no attribution Set-Cookie, redirect byte-identical', () => {
  it('/api/ref/[code]: valid creator code → 307 to /eat, NO grubano_ref cookie', async () => {
    const res = await callRef('DEMO20')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
    expect(res.headers.get('set-cookie') ?? '').not.toContain('grubano_ref')
  })

  it('/api/chef-visit/[slug]: valid slug → 307 to /eat, NO grubano_chef cookie', async () => {
    const res = await callChef('demo20')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    expect(res.cookies.get('grubano_chef')).toBeUndefined()
    expect(res.headers.get('set-cookie') ?? '').not.toContain('grubano_chef')
  })

  it('strict convention: "1" / "TRUE" do NOT arm the flag', async () => {
    process.env.ATTRIBUTION_COOKIES_ENABLED = '1'
    expect((await callRef('DEMO20')).cookies.get('grubano_ref')).toBeUndefined()
    process.env.ATTRIBUTION_COOKIES_ENABLED = 'TRUE'
    expect((await callChef('demo20')).cookies.get('grubano_chef')).toBeUndefined()
  })
})

describe("flag === 'true' — the cookie is dropped exactly as before", () => {
  beforeEach(() => {
    process.env.ATTRIBUTION_COOKIES_ENABLED = 'true'
  })

  it('/api/ref/[code]: drops grubano_ref = canonical code, httpOnly + lax + 90 d', async () => {
    const res = await callRef('DEMO20')
    expect(res.status).toBe(307)
    const c = res.cookies.get('grubano_ref')
    expect(c?.value).toBe('DEMO20')
    expect(c?.httpOnly).toBe(true)
    expect(c?.sameSite).toBe('lax')
    expect(c?.maxAge).toBe(90 * 24 * 60 * 60)
  })

  it('/api/chef-visit/[slug]: drops grubano_chef = canonical slug, httpOnly + lax + 24 h', async () => {
    const res = await callChef('demo20')
    expect(res.status).toBe(307)
    const c = res.cookies.get('grubano_chef')
    expect(c?.value).toBe('demo20')
    expect(c?.httpOnly).toBe(true)
    expect(c?.sameSite).toBe('lax')
    expect(c?.maxAge).toBe(24 * 60 * 60)
  })
})
