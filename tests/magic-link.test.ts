import { describe, it, expect, beforeEach, vi } from 'vitest'
import bcrypt from 'bcryptjs'

// ── Magic-link auth bridge (Phase 0, Agent 14) ────────────────────────────────
// Token round-trip + single-use consume + status gate, AND the CredentialsProvider
// authorize() proving the PASSWORD path (consumer/restaurant) is untouched while a
// passwordless MAGIC path is added.

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { createMagicLinkToken, authorizeMagicLink } from '@/lib/magic-link'
import { authOptions } from '@/lib/auth'

// The CredentialsProvider is providers[0] (Google/Apple only added when env set).
// next-auth v4 stores the REAL authorize under `.options.authorize` (the
// top-level `.authorize` is a `() => null` stub until request time).
const authorize = (authOptions.providers[0] as unknown as {
  options: { authorize: (c: Record<string, string> | undefined) => Promise<{ id: string; role: string } | null> }
}).options.authorize

const future = () => new Date(Date.now() + 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.update.mockResolvedValue({})
  db.operator.updateMany.mockResolvedValue({ count: 1 }) // default: this caller wins the atomic consume
})

describe('createMagicLinkToken', () => {
  it('mints operatorId.secret + a sha256 hash + a future expiry', () => {
    const { token, hash, expiry } = createMagicLinkToken('op123')
    expect(token.startsWith('op123.')).toBe(true)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(expiry.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('authorizeMagicLink', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'opX', name: 'X', email: 'x@x.fr', role: 'creator', status: 'active', ...over,
  })

  it('valid token on an active account → returns user AND consumes the token', async () => {
    const { token, hash, expiry } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ magicLinkTokenHash: hash, magicLinkTokenExpiry: expiry }))
    const u = await authorizeMagicLink(token)
    expect(u).toMatchObject({ id: 'opX', email: 'x@x.fr', role: 'creator' })
    // Consumed via a CONDITIONAL update that still matches the exact token.
    const arg = db.operator.updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ id: 'opX', magicLinkTokenHash: hash })
    expect(arg.data).toEqual({ magicLinkTokenHash: null, magicLinkTokenExpiry: null })
  })

  it('loses the consume race (updateMany count 0) → null, no double sign-in', async () => {
    const { token, hash, expiry } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ magicLinkTokenHash: hash, magicLinkTokenExpiry: expiry }))
    db.operator.updateMany.mockResolvedValue({ count: 0 }) // a concurrent caller already consumed it
    expect(await authorizeMagicLink(token)).toBeNull()
  })

  it('expired token → null, NOT consumed', async () => {
    const { token, hash } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ magicLinkTokenHash: hash, magicLinkTokenExpiry: new Date(Date.now() - 1_000) }))
    expect(await authorizeMagicLink(token)).toBeNull()
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('wrong secret → null', async () => {
    const { token } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ magicLinkTokenHash: 'ab'.repeat(32), magicLinkTokenExpiry: future() }))
    expect(await authorizeMagicLink(token)).toBeNull()
  })

  it('already consumed (hash null) → null', async () => {
    const { token } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ magicLinkTokenHash: null, magicLinkTokenExpiry: null }))
    expect(await authorizeMagicLink(token)).toBeNull()
  })

  it('pending / suspended account → null (cannot sign in yet)', async () => {
    const { token, hash, expiry } = createMagicLinkToken('opX')
    db.operator.findUnique.mockResolvedValue(row({ status: 'pending', magicLinkTokenHash: hash, magicLinkTokenExpiry: expiry }))
    expect(await authorizeMagicLink(token)).toBeNull()
  })

  it('malformed token / unknown operator → null', async () => {
    expect(await authorizeMagicLink('garbage-no-dot')).toBeNull()
    db.operator.findUnique.mockResolvedValue(null)
    expect(await authorizeMagicLink('opX.secret')).toBeNull()
  })
})

describe('CredentialsProvider authorize — password path intact + magic path added', () => {
  it('PASSWORD path still authenticates (consumer/restaurant login NOT broken)', async () => {
    const password = 'S3cret-passw0rd'
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', name: 'Resto', email: 'resto@x.fr', role: 'restaurant', status: 'active',
      password: await bcrypt.hash(password, 12),
    })
    expect(await authorize({ email: 'resto@x.fr', password })).toMatchObject({ id: 'op1', role: 'restaurant' })
  })

  it('PASSWORD path rejects a wrong password', async () => {
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', name: 'R', email: 'r@x.fr', role: 'restaurant', status: 'active',
      password: await bcrypt.hash('right', 12),
    })
    expect(await authorize({ email: 'r@x.fr', password: 'wrong' })).toBeNull()
  })

  it('MAGIC path signs in with NO password', async () => {
    const { token, hash, expiry } = createMagicLinkToken('opM')
    db.operator.findUnique.mockResolvedValue({
      id: 'opM', name: 'M', email: 'm@x.fr', role: 'creator', status: 'active',
      magicLinkTokenHash: hash, magicLinkTokenExpiry: expiry,
    })
    expect(await authorize({ magicToken: token })).toMatchObject({ id: 'opM', role: 'creator' })
  })

  it('MAGIC path with an invalid token → null', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    expect(await authorize({ magicToken: 'opM.bad' })).toBeNull()
  })
})
