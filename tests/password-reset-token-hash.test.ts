import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Password-reset token HASHED at rest — Lot 7 closed beta (P1 sécurité) ────────
// /api/auth/forgot-password used to store the reset token IN CLEAR in
// VerificationToken and /api/auth/reset-password compared it in clear — unlike the
// magic-link (SHA-256). These tests pin the fix:
//   • the stored token is sha256(raw) — NEVER the raw token the email carries;
//   • the emailed URL still carries the RAW token;
//   • verify accepts the right raw token (lookup by its hash) and refuses a wrong one
//     with the same generic error (anti-enumeration untouched).

const { db, tx } = vi.hoisted(() => ({
  db: {
    operator:          { findUnique: vi.fn(), update: vi.fn() },
    verificationToken: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  },
  tx: { sendPasswordResetEmail: vi.fn(), sendPasswordChangedEmail: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/transactional-emails', () => tx)

import { sha256 } from '@/lib/partner-verification'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'

const EMAIL = 'reset@x.fr'
const post = (path: string, body: unknown) =>
  new Request(`https://grubano.com${path}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'Rita', email: EMAIL, password: '$2a$12$hash' })
  db.operator.update.mockResolvedValue({})
  db.verificationToken.deleteMany.mockResolvedValue({ count: 0 })
  db.verificationToken.create.mockResolvedValue({})
  db.verificationToken.findFirst.mockResolvedValue(null)
  tx.sendPasswordResetEmail.mockResolvedValue(undefined)
  tx.sendPasswordChangedEmail.mockResolvedValue(undefined)
})

describe('forgot-password — the stored token is the SHA-256, never the clear token', () => {
  it('stores sha256(raw) while the emailed URL carries the raw token', async () => {
    const res = await forgotPassword(post('/api/auth/forgot-password', { email: EMAIL }) as never)
    expect(res.status).toBe(200)

    // The emailed URL carries the RAW token…
    expect(tx.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    const { resetUrl } = tx.sendPasswordResetEmail.mock.calls[0][0] as { resetUrl: string }
    const raw = new URL(resetUrl).searchParams.get('token') as string
    expect(raw).toMatch(/^[0-9a-f]{64}$/)

    // …while the DB row holds ONLY its hash.
    expect(db.verificationToken.create).toHaveBeenCalledTimes(1)
    const stored = (db.verificationToken.create.mock.calls[0][0] as {
      data: { identifier: string; token: string }
    }).data
    expect(stored.identifier).toBe(`pwreset:${EMAIL}`)
    expect(stored.token).not.toBe(raw)
    expect(stored.token).toBe(sha256(raw))
    expect(stored.token).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('reset-password — verify by hash: right token accepted, wrong token refused', () => {
  const RAW = 'ab'.repeat(32) // 64 hex chars, like the minted token

  beforeEach(() => {
    // The DB row holds the HASH: only a lookup by sha256(RAW) finds it.
    db.verificationToken.findFirst.mockImplementation(
      async (args: { where: { identifier: string; token: string } }) =>
        args.where.token === sha256(RAW)
          ? { identifier: args.where.identifier, token: sha256(RAW), expires: new Date(Date.now() + 60_000) }
          : null,
    )
  })

  it('accepts the RIGHT raw token (200) — the lookup uses its hash, not the clear value', async () => {
    const res = await resetPassword(
      post('/api/auth/reset-password', { email: EMAIL, token: RAW, password: 'newpassword1' }) as never,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const where = (db.verificationToken.findFirst.mock.calls[0][0] as {
      where: { token: string }
    }).where
    expect(where.token).toBe(sha256(RAW))
    expect(where.token).not.toBe(RAW)
    expect(db.operator.update).toHaveBeenCalledTimes(1)
  })

  it('refuses a WRONG token with the same generic 400 (no oracle)', async () => {
    const res = await resetPassword(
      post('/api/auth/reset-password', { email: EMAIL, token: 'cd'.repeat(32), password: 'newpassword1' }) as never,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Lien invalide ou expiré')
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('refuses the CLEAR-STORED legacy shape: a pre-hash row can no longer match', async () => {
    // Legacy row = the raw token stored in clear → the hashed lookup finds nothing.
    db.verificationToken.findFirst.mockImplementation(
      async (args: { where: { token: string } }) =>
        args.where.token === RAW
          ? { token: RAW, expires: new Date(Date.now() + 60_000) }
          : null,
    )
    const res = await resetPassword(
      post('/api/auth/reset-password', { email: EMAIL, token: RAW, password: 'newpassword1' }) as never,
    )
    expect(res.status).toBe(400) // dies by natural TTL — deliberate retro-compat
  })
})
