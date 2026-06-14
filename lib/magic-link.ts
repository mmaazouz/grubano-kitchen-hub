import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sha256, safeEqualHex, parseVerificationToken } from '@/lib/partner-verification'

// ── Passwordless magic-link tokens (Phase 0 auth bridge, Agent 14) ────────────
//
// SAME token shape as the partner email-verification token (`${operatorId}.${secret}`,
// only the SHA-256 of the secret is persisted) — we reuse sha256 / safeEqualHex /
// parseVerificationToken from lib/partner-verification — but a SHORT TTL and a
// SEPARATE column pair on Operator (magicLinkTokenHash / magicLinkTokenExpiry) so
// it never collides with the partner verifyToken*. Single-use: the token is
// consumed (cleared) on a successful sign-in.
//
// This powers a PASSWORDLESS sign-in that lives ALONGSIDE the existing password
// CredentialsProvider — it adds a path, it replaces nothing.

const MAGIC_TTL_MS = 15 * 60 * 1000 // 15 minutes — short-lived by design
const SECRET_BYTES = 32             // 256 bits of entropy

/** Mint a fresh magic-link token: the clear token to email, the hash to store, the expiry. */
export function createMagicLinkToken(operatorId: string): { token: string; hash: string; expiry: Date } {
  const secret = crypto.randomBytes(SECRET_BYTES).toString('hex')
  return {
    token:  `${operatorId}.${secret}`,
    hash:   sha256(secret),
    expiry: new Date(Date.now() + MAGIC_TTL_MS),
  }
}

export type MagicAuthorizedUser = { id: string; name: string; email: string; role: string }

/**
 * Validate a magic-link token and, on success, CONSUME it and return the user
 * for NextAuth. Returns null on ANY failure — malformed, unknown operator,
 * expired, wrong secret, already used, or an account not allowed to sign in
 * (status pending/suspended, same gate as the password path). Never throws: a
 * DB error or an unmigrated column degrades to a clean "no sign-in".
 */
export async function authorizeMagicLink(token: string): Promise<MagicAuthorizedUser | null> {
  try {
    const parsed = parseVerificationToken(token)
    if (!parsed) return null

    const operator = await prisma.operator.findUnique({
      where:  { id: parsed.operatorId },
      select: {
        id: true, name: true, email: true, role: true, status: true,
        magicLinkTokenHash: true, magicLinkTokenExpiry: true,
      },
    })
    if (!operator) return null
    // Same status gate as lib/auth.ts password path: pending / suspended cannot sign in.
    if (operator.status === 'pending' || operator.status === 'suspended') return null
    if (!operator.magicLinkTokenHash || !operator.magicLinkTokenExpiry) return null      // none / already used
    if (operator.magicLinkTokenExpiry.getTime() < Date.now()) return null                // expired
    if (!safeEqualHex(sha256(parsed.secret), operator.magicLinkTokenHash)) return null    // wrong secret

    // Single-use, RACE-SAFE consume: a CONDITIONAL update that still matches the
    // exact (unconsumed, unexpired) token. Under concurrent use of the same link
    // only ONE caller gets count===1; the loser sees 0 and is rejected — so a
    // token can never authenticate twice (closes the read-check-write race).
    const consumed = await prisma.operator.updateMany({
      where: {
        id:                   operator.id,
        magicLinkTokenHash:   operator.magicLinkTokenHash,
        magicLinkTokenExpiry: { gt: new Date() },
      },
      data: { magicLinkTokenHash: null, magicLinkTokenExpiry: null },
    })
    if (consumed.count !== 1) return null

    return { id: operator.id, name: operator.name, email: operator.email, role: operator.role }
  } catch {
    return null
  }
}
