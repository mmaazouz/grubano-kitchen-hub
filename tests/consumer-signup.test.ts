import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── ensureConsumerByEmail — provisioning safety (Agent 132, brick 2c) ──────────
// Auth-only account-at-payment: provision a PASSWORDLESS 'consumer' Operator. The
// security contract: role is ALWAYS 'consumer' (never elevated), existing accounts are
// reused with NO write (no clobber), race-safe + idempotent, best-effort (never throws).

const { findUnique, create } = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { operator: { findUnique, create } } }))

import { ensureConsumerByEmail } from '@/lib/consumer-signup'

beforeEach(() => { vi.clearAllMocks() })

describe('ensureConsumerByEmail', () => {
  it('creates a PASSWORDLESS, ACTIVE consumer for a fresh email (normalized)', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockResolvedValueOnce({ id: 'op1' })
    const res = await ensureConsumerByEmail('  New@Email.com ')
    expect(res).toEqual({ ok: true })
    expect(create).toHaveBeenCalledTimes(1)
    const data = create.mock.calls[0][0].data
    expect(data.role).toBe('consumer')
    expect(data.status).toBe('active')
    expect(data.email).toBe('new@email.com')
    expect('password' in data).toBe(false) // passwordless — no password ever set
  })

  it('NEVER provisions an elevated role — the created role is ONLY consumer', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockResolvedValueOnce({ id: 'op2' })
    await ensureConsumerByEmail('x@y.com')
    const data = create.mock.calls[0][0].data
    expect(['consumer']).toContain(data.role)
    expect(data.role).not.toMatch(/admin|restaurant|franchise|supplier|logistics|affiliate|prestataire|creator/)
    expect(data.status).not.toBe('pending') // never lands a pending/blocked state either
  })

  it('REUSES an existing account WITHOUT any write (no clobber of password/status/roles)', async () => {
    findUnique.mockResolvedValueOnce({ id: 'existing' })
    const res = await ensureConsumerByEmail('partner@grubano.com')
    expect(res).toEqual({ ok: true })
    expect(create).not.toHaveBeenCalled() // never creates a 2nd Operator, never updates → zero mutation
  })

  it('is race-safe: a unique-collision on create re-resolves to ok', async () => {
    findUnique.mockResolvedValueOnce(null) // first check: absent
    create.mockRejectedValueOnce(new Error('Unique constraint failed on the fields: (`email`)'))
    findUnique.mockResolvedValueOnce({ id: 'raced' }) // concurrent creator won → re-find succeeds
    const res = await ensureConsumerByEmail('race@y.com')
    expect(res).toEqual({ ok: true })
  })

  it('degrades to { ok:false } on a hard error (caller stays generic)', async () => {
    findUnique.mockResolvedValueOnce(null)
    create.mockRejectedValueOnce(new Error('db down'))
    findUnique.mockResolvedValueOnce(null) // re-find finds nothing either
    const res = await ensureConsumerByEmail('err@y.com')
    expect(res).toEqual({ ok: false, reason: 'error' })
  })

  it('rejects an empty email without hitting the DB', async () => {
    const res = await ensureConsumerByEmail('   ')
    expect(res).toEqual({ ok: false, reason: 'error' })
    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
