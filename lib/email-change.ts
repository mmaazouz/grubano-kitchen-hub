import crypto from 'crypto'
import { promises as dns } from 'dns'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sha256, safeEqualHex, parseVerificationToken } from '@/lib/partner-verification'

// ── Account email change (Agent 147) ───────────────────────────────────────────
//
// Mutating the LOGIN IDENTIFIER (Operator.email @unique) is a high-risk action: a bad
// design = account takeover or lockout. This module owns the SAFE state machine and is
// FLAG-GATED by AUTH_EMAIL_CHANGE_ENABLED (default OFF → every route 404s, byte-identical).
//
// Defence in depth, all enforced by the routes that call this module:
//   1. PROOF OF CURRENT IDENTITY — a fresh single-use email OTP (purpose 'stepup:email_change')
//      sent to the CURRENT address, verified DIRECTLY via lib/email-otp.verifyEmailOtp (NOT via
//      requireStepUp, which is INERT when AUTH_MONEY_STEPUP_ENABLED is OFF). Defends against a
//      hijacked session: the attacker can't read the code sent to the victim's current inbox.
//   2. PROOF OF NEW-ADDRESS POSSESSION — a single-use, 15-min confirmation LINK (token
//      `${operatorId}.${secret}`, only sha256(secret) persisted — SAME shape as lib/magic-link)
//      sent to the NEW address; clicking it both proves possession and triggers the mutation.
//   3. UNIQUENESS — pre-checked anti-enum at request, BACKSTOPPED by the @unique constraint at
//      mutation (P2002 → clean abort, current email kept).
//   4. SCOPE — v1 excludes accounts whose partner profile is keyed by the shared email
//      (supplier/logistics/prestataire → orphan risk) and OAuth-linked accounts.
//
// ⭐ The CURRENT email is ALWAYS read from the DB (by operator id), NEVER from the JWT
//    (token.email can be stale after a prior change). Login keys on operator.email, which is
//    UNCHANGED until the link is confirmed → an abandoned change never locks anyone out.

const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000 // 15 minutes — short-lived by design
const SECRET_BYTES = 32

/** Kill-switch — default OFF. Only the exact string 'true' enables the feature. */
export function isEmailChangeEnabled(): boolean {
  return process.env.AUTH_EMAIL_CHANGE_ENABLED === 'true'
}

export const normEmail = (e: string): string => (e ?? '').trim().toLowerCase()

// Roles whose business profile is linked to the Operator BY THE SHARED EMAIL (not by FK):
// SupplierProfile/LogisticsProfile/PrestataireProfile.email @unique. Changing Operator.email
// alone would orphan them → EXCLUDED from v1 (a v2 would sync those rows in one transaction).
const EMAIL_KEYED_ROLES = new Set(['supplier', 'logistics', 'prestataire'])

export type EligibilityResult =
  | { ok: true; email: string; role: string }
  | { ok: false; reason: 'not_found' | 'unsupported_account' }

/**
 * Read the operator (CURRENT email from DB) and decide whether email change is allowed.
 * Excludes email-keyed partner roles/profiles (orphan risk) and OAuth-linked accounts
 * (the provider owns the email). Returns the DB email so callers never trust the JWT.
 */
export async function checkEmailChangeEligibility(operatorId: string): Promise<EligibilityResult> {
  const op = await prisma.operator.findUnique({
    where:  { id: operatorId },
    select: { id: true, email: true, role: true },
  })
  if (!op) return { ok: false, reason: 'not_found' }
  if (EMAIL_KEYED_ROLES.has(op.role)) return { ok: false, reason: 'unsupported_account' }

  // Belt-and-braces: a multi-role account that ALSO owns an email-keyed profile, or any
  // OAuth-linked account (an Account row exists — CredentialsProvider creates none).
  const [sup, log, pre, oauth] = await Promise.all([
    prisma.supplierProfile.findUnique({ where: { email: op.email }, select: { id: true } }).catch(() => null),
    prisma.logisticsProfile.findUnique({ where: { email: op.email }, select: { id: true } }).catch(() => null),
    prisma.prestataireProfile.findUnique({ where: { email: op.email }, select: { id: true } }).catch(() => null),
    prisma.account.findFirst({ where: { userId: op.id }, select: { id: true } }).catch(() => null),
  ])
  if (sup || log || pre || oauth) return { ok: false, reason: 'unsupported_account' }
  return { ok: true, email: op.email, role: op.role }
}

/**
 * Park a NEW pending email + mint a fresh single-use confirmation token. SUPERSEDES any prior
 * pending change (overwrite → last request wins). Returns the CLEAR token for the email link
 * (only its sha256 is stored). The caller MUST have already proven current identity + uniqueness.
 */
export async function setPendingEmail(operatorId: string, newEmailRaw: string): Promise<{ token: string }> {
  const newEmail = normEmail(newEmailRaw)
  const secret = crypto.randomBytes(SECRET_BYTES).toString('hex')
  await prisma.operator.update({
    where: { id: operatorId },
    data:  {
      pendingEmail:            newEmail,
      pendingEmailTokenHash:   sha256(secret),
      pendingEmailTokenExpiry: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
    },
  })
  return { token: `${operatorId}.${secret}` }
}

export type ConsumeResult =
  | { ok: true; oldEmail: string; newEmail: string }
  | { ok: false; reason: 'invalid' | 'collision' }

/**
 * Validate a confirmation token and, on success, ATOMICALLY mutate operator.email := pendingEmail
 * and clear the pending fields — single-use + race-safe (a CONDITIONAL updateMany still matching the
 * exact unconsumed/unexpired token; only ONE concurrent caller gets count===1). Uniqueness is
 * backstopped by the @unique(email) constraint: if the new email was claimed between request and
 * confirm, the update throws P2002 → clean 'collision' abort (current email kept). Never throws.
 */
export async function consumeEmailChange(token: string): Promise<ConsumeResult> {
  try {
    const parsed = parseVerificationToken(token)
    if (!parsed) return { ok: false, reason: 'invalid' }

    const op = await prisma.operator.findUnique({
      where:  { id: parsed.operatorId },
      select: { id: true, email: true, pendingEmail: true, pendingEmailTokenHash: true, pendingEmailTokenExpiry: true },
    })
    if (!op || !op.pendingEmail || !op.pendingEmailTokenHash || !op.pendingEmailTokenExpiry) return { ok: false, reason: 'invalid' }
    if (op.pendingEmailTokenExpiry.getTime() < Date.now()) return { ok: false, reason: 'invalid' }              // expired
    if (!safeEqualHex(sha256(parsed.secret), op.pendingEmailTokenHash)) return { ok: false, reason: 'invalid' } // wrong secret

    // ⭐ RE-ENFORCE SCOPE at confirm — close the request→confirm TOCTOU: if the account became
    // email-keyed (a supplier/logistics/prestataire profile appeared) or OAuth-linked while the
    // link was outstanding, REFUSE the mutation so we never orphan a profile. Best-effort drop the
    // now-unfulfillable pending (email kept). Same guard as request-code/request.
    const elig = await checkEmailChangeEligibility(parsed.operatorId)
    if (!elig.ok) {
      try {
        await prisma.operator.updateMany({
          where: { id: op.id, pendingEmailTokenHash: op.pendingEmailTokenHash },
          data:  { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null },
        })
      } catch { /* non-fatal */ }
      return { ok: false, reason: 'invalid' }
    }

    const oldEmail = op.email
    const newEmail = op.pendingEmail
    try {
      const consumed = await prisma.operator.updateMany({
        where: {
          id:                      op.id,
          pendingEmailTokenHash:   op.pendingEmailTokenHash,
          pendingEmailTokenExpiry: { gt: new Date() },
        },
        data: { email: newEmail, pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null },
      })
      if (consumed.count !== 1) return { ok: false, reason: 'invalid' } // lost the race / already consumed
    } catch (e) {
      // @unique(email) backstop — the new email was taken between request and confirm.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Best-effort: drop the now-unfulfillable pending so it doesn't linger (email kept).
        try {
          await prisma.operator.updateMany({
            where: { id: op.id, pendingEmailTokenHash: op.pendingEmailTokenHash },
            data:  { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null },
          })
        } catch { /* non-fatal */ }
        return { ok: false, reason: 'collision' }
      }
      return { ok: false, reason: 'invalid' }
    }
    return { ok: true, oldEmail, newEmail }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/**
 * Domain MX (typo / throwaway guard) — calque of the partner-register check. RFC 5321 implicit MX:
 * a domain with only an A/AAAA record can still receive mail. Best-effort; false on any failure.
 */
export async function domainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]
  if (!domain) return false
  try {
    const mx = await dns.resolveMx(domain)
    if (Array.isArray(mx) && mx.length > 0) return true
  } catch { /* fall through to A/AAAA */ }
  try {
    const a = await dns.resolve(domain)
    return Array.isArray(a) && a.length > 0
  } catch {
    return false
  }
}
