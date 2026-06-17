import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B1.3-B — "collect once" identity propagation (Agent 31) ──────────────────
// propagateVerifiedCompanyIdentity copies a VERIFIED entity's company identity to
// the shared Operator anchor (B1.1 columns). Prisma + the B1.1 helper are mocked.
// These tests lock the status rule, anti-overwrite, idempotence, and non-fatal
// guarantees.

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { getMock, setMock } = vi.hoisted(() => ({ getMock: vi.fn(), setMock: vi.fn() }))
vi.mock('@/lib/operator-identity', () => ({
  getOperatorCompanyIdentity: getMock,
  setVerifiedCompanyIdentity: setMock,
}))

import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.findUnique.mockResolvedValue({ id: 'op1' })
  getMock.mockResolvedValue(null)   // empty anchor by default
  setMock.mockResolvedValue({})
})

describe('propagateVerifiedCompanyIdentity', () => {
  it('(a) verified supplier + empty anchor → writes the verified identity to the account', async () => {
    const r = await propagateVerifiedCompanyIdentity({
      email: 'S@X.com', siren: '123456789', officialName: 'ACME SARL', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: true })
    expect(db.operator.findUnique).toHaveBeenCalledWith({ where: { email: 's@x.com' }, select: { id: true } })
    expect(setMock).toHaveBeenCalledWith('op1', expect.objectContaining({
      siren: '123456789', officialName: 'ACME SARL', kybStatus: 'verified', kybVerifiedAt: expect.any(Date),
    }))
  })

  it('(b) not-verified entity (review) → account NOT marked verified, no write, no lookup', async () => {
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '123456789', officialName: 'X', verificationStatus: 'review',
    })
    expect(r).toEqual({ propagated: false, reason: 'not_verified' })
    expect(setMock).not.toHaveBeenCalled()
    expect(db.operator.findUnique).not.toHaveBeenCalled()
  })

  it('(c) idempotent: anchor already verified with the SAME siren → no-op', async () => {
    getMock.mockResolvedValue({ kybStatus: 'verified', siren: '123456789', officialName: 'ACME', legalForm: null, kybVerifiedAt: new Date(0) })
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '123456789', officialName: 'ACME', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: false, reason: 'noop_same' })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('(d) anti-overwrite: anchor verified with a DIFFERENT siren → kept, not overwritten', async () => {
    getMock.mockResolvedValue({ kybStatus: 'verified', siren: '111111111', officialName: 'First Co', legalForm: null, kybVerifiedAt: new Date(0) })
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '999999999', officialName: 'Second Co', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: false, reason: 'siren_conflict' })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('(e) verified logistics partner (same shared helper) → writes the identity', async () => {
    const r = await propagateVerifiedCompanyIdentity({
      email: 'courier@x.com', siren: '987654321', officialName: 'LIVRAISON SAS', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: true })
    expect(setMock).toHaveBeenCalledWith('op1', expect.objectContaining({
      siren: '987654321', officialName: 'LIVRAISON SAS', kybStatus: 'verified',
    }))
  })

  it('(f) a write exception is non-fatal → returns error, never throws', async () => {
    setMock.mockRejectedValue(new Error('db down'))
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '123456789', officialName: 'X', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: false, reason: 'error' })
  })

  it('no Operator yet for the email → no_operator, no write', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '123456789', officialName: 'X', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: false, reason: 'no_operator' })
    expect(setMock).not.toHaveBeenCalled()
  })

  it('anchor verified but WITHOUT a siren → enriches it (writes), no conflict', async () => {
    getMock.mockResolvedValue({ kybStatus: 'verified', siren: null, officialName: null, legalForm: null, kybVerifiedAt: null })
    const r = await propagateVerifiedCompanyIdentity({
      email: 's@x.com', siren: '123456789', officialName: 'ACME', verificationStatus: 'verified',
    })
    expect(r).toEqual({ propagated: true })
    expect(setMock).toHaveBeenCalled()
  })
})
