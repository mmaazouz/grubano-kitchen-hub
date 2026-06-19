import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/ref/[code] + affiliate click tracking (Brique C, Agent 60) ───────────────
// PROVES the critical safety contract: the affiliate click recording is ADDITIVE,
// flag-gated and BEST-EFFORT — it can NEVER change the cookie drop or the redirect
// (those stay byte-identical to the creator-only behaviour). When AFFILIATE_ENABLED is
// OFF, no click is recorded at all.

const { db } = vi.hoisted(() => ({
  db: {
    creator:        { findFirst: vi.fn() },
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

const req = (code: string) => new NextRequest(`https://grubano.com/api/ref/${code}`)
const call = (code: string) => GET(req(code), { params: { code } })

beforeEach(() => {
  vi.clearAllMocks()
  enabledMock.mockReturnValue(true)
  recordMock.mockResolvedValue(true)
  db.creator.findFirst.mockResolvedValue({ id: 'cr1', referralCode: 'DEMO20', referralLinkSlug: 'demo20' })
  db.referralConfig.findFirst.mockResolvedValue({ durationDays: 90 })
  rolesMock.mockResolvedValue({ isInfluencer: true })
})

describe('byte-identical cookie + redirect', () => {
  it('flag ON: redirects 307 to /eat and drops the canonical attribution cookie', async () => {
    const res = await call('DEMO20')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
  })

  it('records the affiliate click (best-effort) with the UPPER-cased code when the flag is ON', async () => {
    await call('demo20')
    expect(recordMock).toHaveBeenCalledTimes(1)
    expect(recordMock).toHaveBeenCalledWith('DEMO20')
  })
})

describe('flag gate', () => {
  it('flag OFF: no click recorded, but cookie + redirect are unchanged', async () => {
    enabledMock.mockReturnValue(false)
    const res = await call('DEMO20')
    expect(recordMock).not.toHaveBeenCalled()
    expect(res.status).toBe(307)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
  })
})

describe('best-effort / non-blocking', () => {
  it('a click-recording FAILURE never breaks the redirect or the cookie', async () => {
    recordMock.mockRejectedValue(new Error('db down'))
    const res = await call('DEMO20')
    // The handler swallows the click error → identical 307 + cookie.
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toMatch(/\/eat$/)
    expect(res.cookies.get('grubano_ref')?.value).toBe('DEMO20')
  })
})
