import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B1.1 — account-level company identity helper (Agent 29) ──────────────────
// Prisma mocked (same style as the route tests). These tests lock the two
// guarantees that matter: (1) get/set touch ONLY the five identity columns, and
// (2) set can NEVER escalate (extra keys like role/status/email are dropped).

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getOperatorCompanyIdentity, setVerifiedCompanyIdentity } from '@/lib/operator-identity'

const FULL = { siren: '123456789', officialName: 'ACME SARL', legalForm: 'sarl', kybStatus: 'verified', kybVerifiedAt: new Date(0) }
const IDENTITY_KEYS = ['kybStatus', 'kybVerifiedAt', 'legalForm', 'officialName', 'siren']

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getOperatorCompanyIdentity', () => {
  it('returns the identity, scoped by id, selecting only the identity columns', async () => {
    db.operator.findUnique.mockResolvedValue(FULL)
    const r = await getOperatorCompanyIdentity('op1')
    expect(r).toEqual(FULL)
    const arg = db.operator.findUnique.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'op1' })
    expect(Object.keys(arg.select).sort()).toEqual(IDENTITY_KEYS)
  })

  it('absent columns come back as null', async () => {
    db.operator.findUnique.mockResolvedValue({ siren: null, officialName: null, legalForm: null, kybStatus: null, kybVerifiedAt: null })
    expect(await getOperatorCompanyIdentity('op1')).toEqual({
      siren: null, officialName: null, legalForm: null, kybStatus: null, kybVerifiedAt: null,
    })
  })

  it('unknown operator → null', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    expect(await getOperatorCompanyIdentity('nope')).toBeNull()
  })

  it('empty id → null without querying', async () => {
    expect(await getOperatorCompanyIdentity('')).toBeNull()
    expect(db.operator.findUnique).not.toHaveBeenCalled()
  })
})

describe('setVerifiedCompanyIdentity', () => {
  beforeEach(() => {
    db.operator.update.mockResolvedValue(FULL)
  })

  it('writes exactly the whitelisted identity fields (scoped by id)', async () => {
    await setVerifiedCompanyIdentity('op1', { ...FULL })
    const arg = db.operator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'op1' })
    expect(Object.keys(arg.data).sort()).toEqual(IDENTITY_KEYS)
    expect(Object.keys(arg.select).sort()).toEqual(IDENTITY_KEYS)
  })

  it('does NOT escalate: forbidden keys (role/status/email/password) are dropped', async () => {
    // A hostile/buggy caller passing privileged keys — cast past the typed input
    // on purpose to prove the runtime whitelist, not just the compile-time type.
    await setVerifiedCompanyIdentity('op1', {
      siren: '1', role: 'admin', status: 'active', email: 'x@y.z', password: 'hash', isActive: true,
    } as unknown as Parameters<typeof setVerifiedCompanyIdentity>[1])
    const data = db.operator.update.mock.calls[0][0].data
    expect(data).toEqual({ siren: '1' })
    for (const k of ['role', 'status', 'email', 'password', 'isActive']) {
      expect(data).not.toHaveProperty(k)
    }
  })

  it('partial update writes only the provided field', async () => {
    await setVerifiedCompanyIdentity('op1', { kybStatus: 'pending' })
    expect(db.operator.update.mock.calls[0][0].data).toEqual({ kybStatus: 'pending' })
  })

  it('empty id → throws, no write', async () => {
    await expect(setVerifiedCompanyIdentity('', { siren: '1' })).rejects.toThrow()
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})
