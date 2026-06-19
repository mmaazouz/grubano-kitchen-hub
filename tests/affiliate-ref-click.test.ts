import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/ref/[code] — affiliate click (Brique C) + cookie loop (Brique B2) ────────
// Brique C added best-effort, flag-gated, privacy-safe affiliate CLICK recording.
// Brique B2 (Agent 61) CLOSES THE ATTRIBUTION LOOP: an AFFILIATE code now drops the
// SAME first-touch grubano_ref cookie the order path (5B) reads to credit the affiliate.
// These tests pin the critical safety contract:
//  - the CREATOR rail + the UNKNOWN-code path stay byte-identical (behaviour unchanged);
//  - the affiliate branch is gated by AFFILIATE_ENABLED (OFF → no cookie, byte-identical);
//  - first-touch is preserved for BOTH rails (an existing cookie is never overwritten);
//  - the click recording stays intact + best-effort (a failure never breaks the redirect).

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
import { GET } from '@/app/api/ref/[code]/route'

const req = (code: string, cookie?: string) =>
  new NextRequest(`https://grubano.com/api/ref/${code}`, cookie ? { headers: { cookie } } : undefined)
const call = (code: string, cookie?: string) => GET(req(code, cookie), { params: { code } })

beforeEach(() => {
  vi.clearAllMocks()
  enabledMock.mockReturnValue(true)
  recordMock.mockResolvedValue(true)
  // Default: the code is a CREATOR code (the affiliate lookup returns nothing).
  db.creator.findFirst.mockResolvedValue({ id: 'cr1', referralCode: 'DEMO20', referralLinkSlug: 'demo20' })
  db.affiliate.findFirst.mockResolvedValue(null)
  db.referralConfig.findFirst.mockResolvedValue({ durationDays: 90 })
  rolesMock.mockResolvedValue({ isInfluencer: true })
})

describe('click tracking (Brique C) preserved', () => {
  it('records the affiliate click with the UPPER-cased code when the flag is ON', async () => {
    await call('demo20')
    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith('DEMO20')
  })

  it('best-effort: a click-recording failure never breaks the redirect/cookie', async () => {
    recordMock.mockRejectedValue(new Error('db down'))
    const res = await call('DEMO20')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
  })
})

describe('creator rail — byte-identical (B2 leaves it untouched)', () => {
  it('creator code + flag ON: drops the creator cookie, redirects /eat, NEVER queries affiliate', async () => {
    const res = await call('DEMO20')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
    // creator-first determinism: a creator code must not even look at the affiliate table.
    expect(db.affiliate.findFirst).not.toHaveBeenCalled()
  })

  it('creator code + flag OFF: cookie + redirect unchanged', async () => {
    enabledMock.mockReturnValue(false)
    const res = await call('DEMO20')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
  })
})

describe('affiliate rail — cookie loop CLOSED (Brique B2)', () => {
  beforeEach(() => {
    // Not a creator; it's an affiliate. (codes are unique cross-table → one referrer)
    db.creator.findFirst.mockResolvedValue(null)
    db.affiliate.findFirst.mockResolvedValue({ referralCode: 'NABIL30' })
  })

  it('end-to-end CAPTURE: affiliate code + flag ON drops grubano_ref = the canonical code', async () => {
    const res = await call('NABIL30')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    // The cookie carries the canonical referralCode — EXACTLY the value the 5B order
    // block uppercases + looks up to credit the affiliate (proven by
    // tests/orders-affiliate-attribution.test.ts). Loop is now closed end-to-end.
    expect(res.cookies.get('grubano_ref')?.value).toBe('NABIL30')
  })

  it('vanity slug URL resolves the affiliate and still stores the CANONICAL code', async () => {
    const res = await call('nabil30')
    expect(res.cookies.get('grubano_ref')?.value).toBe('NABIL30')
    // resolution mirrors recordAffiliateClick exactly (referralCode upper / slug lower).
    expect(db.affiliate.findFirst).toHaveBeenCalledWith({
      where:  { OR: [{ referralCode: 'NABIL30' }, { referralLinkSlug: 'nabil30' }] },
      select: { referralCode: true },
    })
  })

  it('flag OFF + affiliate code: NO cookie, redirect unchanged, affiliate NEVER queried', async () => {
    enabledMock.mockReturnValue(false)
    const res = await call('NABIL30')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
    expect(db.affiliate.findFirst).not.toHaveBeenCalled()
  })

  it('affiliate lookup failure → best-effort: no cookie, still redirects (never 500)', async () => {
    db.affiliate.findFirst.mockRejectedValue(new Error('db down'))
    const res = await call('NABIL30')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
  })
})

describe('first-touch preserved (both rails — the first referrer wins)', () => {
  it('affiliate code + existing cookie → NOT overwritten', async () => {
    db.creator.findFirst.mockResolvedValue(null)
    db.affiliate.findFirst.mockResolvedValue({ referralCode: 'NABIL30' })
    const res = await call('NABIL30', 'grubano_ref=FIRST10')
    expect(res.status).toBe(307)
    // No Set-Cookie on the response → the pre-existing FIRST10 attribution stands.
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
  })

  it('creator code + existing cookie → NOT overwritten (unchanged behaviour)', async () => {
    const res = await call('DEMO20', 'grubano_ref=FIRST10')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
  })
})

describe('unknown code — byte-identical (no cookie, just redirect)', () => {
  it('flag ON: not a creator, not an affiliate → no cookie', async () => {
    db.creator.findFirst.mockResolvedValue(null)
    db.affiliate.findFirst.mockResolvedValue(null)
    const res = await call('GHOST99')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
  })

  it('flag OFF: unknown code → no cookie, affiliate never queried', async () => {
    enabledMock.mockReturnValue(false)
    db.creator.findFirst.mockResolvedValue(null)
    const res = await call('GHOST99')
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')).toBeUndefined()
    expect(db.affiliate.findFirst).not.toHaveBeenCalled()
  })
})
