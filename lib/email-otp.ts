import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sha256, safeEqualHex } from '@/lib/partner-verification'
import { readOperatorRoles } from '@/lib/operator-roles'

// ── Email one-time codes (Phase 3 auth hardening — Agent 88) ──────────────────────
//
// A SECOND, "always-available" factor delivered by email, used for two things on ONE
// mechanism: (1) a 6-digit LOGIN code sent in the SAME email as the magic link (a
// fallback for the "link opens in the wrong browser" mobile case), and (2) a money
// STEP-UP (purpose 'stepup:*') before sensitive money actions. The magic link is
// UNCHANGED — this is purely additive and gated OFF by default.
//
// SECURITY (non-negotiable):
//   • code = 6 digits, crypto.randomInt (NEVER Math.random) — 10^6 space.
//   • STORED HASHED only: sha256(pepper : purpose : email : code). pepper =
//     NEXTAUTH_SECRET → a DB read alone can't brute-force the 10^6 space offline;
//     binding to email + purpose makes codes NON-INTERCHANGEABLE (a 'login' code can
//     never satisfy a 'stepup:withdraw' check, and a code is tied to one account).
//   • EXPIRY short (10 min). SINGLE-USE: consumedAt set on success (race-safe).
//   • PER-CODE attempt cap (MAX_ATTEMPTS) → the code self-invalidates after N tries.
//   • PER-(email,purpose) request THROTTLE (anti-spam / anti-brute amplification).
//   • CONSTANT-TIME compare (safeEqualHex / timingSafeEqual) — no early-out leak.
//   • Issuing a new code SUPERSEDES prior live codes for the same (email, purpose) so
//     at most ONE code is valid at a time.

export const OTP_TTL_MS              = 10 * 60 * 1000 // 10 minutes
export const OTP_MAX_ATTEMPTS        = 5              // failed tries per code → locked
export const OTP_REQUEST_WINDOW_MS   = 10 * 60 * 1000 // throttle window
export const OTP_MAX_REQUESTS        = 5              // max codes per (email,purpose) / window

export type OtpPurpose = 'login' | 'stepup:withdraw' | 'stepup:bank' | 'stepup:email_change'

/** Login OTP kill-switch — default OFF. Only the exact string 'true' enables it. */
export function isEmailOtpEnabled(): boolean {
  return process.env.AUTH_EMAIL_OTP_ENABLED === 'true'
}
/** Money step-up kill-switch — default OFF. Independent from the login OTP flag. */
export function isMoneyStepUpEnabled(): boolean {
  return process.env.AUTH_MONEY_STEPUP_ENABLED === 'true'
}

const normEmail = (e: string): string => (e ?? '').trim().toLowerCase()

/** Server-side pepper so a leaked codeHash can't be brute-forced offline against the
 *  10^6 code space. NEXTAUTH_SECRET is always set (middleware/JWT depend on it). */
function pepper(): string {
  return process.env.NEXTAUTH_SECRET ?? ''
}

/** Hash a code BOUND to its email + purpose + peppered. Non-interchangeable by design. */
function hashCode(code: string, email: string, purpose: OtpPurpose): string {
  return sha256(`${pepper()}:${purpose}:${normEmail(email)}:${code}`)
}

/** Crypto-secure 6-digit code (000000–999999). crypto.randomInt is uniform + CSPRNG. */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export type IssueResult = { ok: true; code: string } | { ok: false; reason: 'throttled' }

/**
 * Mint + persist a fresh OTP for (email, purpose) and RETURN the clear code so the
 * caller can email it (the clear code is never stored). Throttled per (email,purpose).
 * Supersedes any prior live code for the same (email, purpose) → at most one is valid.
 * Never throws on an unmigrated table → degrades to throttled=false-path caller-side.
 */
export async function issueEmailOtp(emailRaw: string, purpose: OtpPurpose): Promise<IssueResult> {
  const email = normEmail(emailRaw)
  const since = new Date(Date.now() - OTP_REQUEST_WINDOW_MS)
  const recent = await prisma.emailOtp.count({ where: { email, purpose, createdAt: { gte: since } } })
  if (recent >= OTP_MAX_REQUESTS) return { ok: false, reason: 'throttled' }

  // Purge en bande (Lot 7 privacy) — BEST-EFFORT : les lignes de CET email déjà
  // expirées, ou consommées depuis plus de 24 h, sont effacées à l'émission d'un
  // nouveau code, pour que la table ne devienne jamais un journal de connexions
  // par email. Sans effet sur le throttle : TTL == fenêtre, donc toute ligne
  // expirée (createdAt < now − TTL) est déjà hors fenêtre, et une ligne consommée
  // il y a > 24 h l'est a fortiori. try/catch avalé : une purge qui échoue (table
  // non migrée, hiccup DB) ne bloque JAMAIS l'émission.
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await prisma.emailOtp.deleteMany({
      where: { email, OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { lt: dayAgo } }] },
    })
  } catch {
    /* best-effort — jamais bloquant */
  }

  const code = generateCode()
  // Supersede prior live codes (so only the newest is verifiable).
  await prisma.emailOtp.updateMany({
    where: { email, purpose, consumedAt: null },
    data:  { consumedAt: new Date() },
  })
  await prisma.emailOtp.create({
    data: { email, purpose, codeHash: hashCode(code, email, purpose), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  })
  return { ok: true, code }
}

/**
 * Verify a code for (email, purpose). Returns true ONLY when a live (unconsumed,
 * unexpired, under the attempt cap) code matches in CONSTANT TIME and is then
 * CONSUMED (single-use, race-safe). Every failed attempt increments the per-code
 * counter so online guessing is bounded by OTP_MAX_ATTEMPTS. Never throws.
 */
export async function verifyEmailOtp(emailRaw: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const email = normEmail(emailRaw)
  if (!/^\d{6}$/.test(code ?? '')) return false // public shape (no timing leak), avoids a DB hit on garbage
  try {
    const row = await prisma.emailOtp.findFirst({
      where:   { email, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, codeHash: true, attempts: true },
    })
    if (!row) return false
    if (row.attempts >= OTP_MAX_ATTEMPTS) return false // already locked — never compare
    // Count THIS attempt first, so a correct guess past the cap can't slip through.
    await prisma.emailOtp.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    if (!safeEqualHex(hashCode(code, email, purpose), row.codeHash)) return false
    // Match → consume race-safe (only if still unconsumed): single-use guaranteed.
    const consumed = await prisma.emailOtp.updateMany({
      where: { id: row.id, consumedAt: null },
      data:  { consumedAt: new Date() },
    })
    return consumed.count === 1
  } catch {
    return false
  }
}

export type OtpAuthorizedUser = { id: string; name: string; email: string; role: string; roles: string[] }

/**
 * LOGIN via email code: verify a 'login' OTP, then (same status gate as the magic-link
 * + password paths) load an ACTIVE operator and return the NextAuth user shape — so the
 * session created is IDENTICAL to the magic-link path. Returns null on any failure.
 * The code path is GATED at the provider; this is its authorize core.
 */
export async function authorizeEmailOtpLogin(emailRaw: string, code: string): Promise<OtpAuthorizedUser | null> {
  const email = normEmail(emailRaw)
  if (!email) return null
  const ok = await verifyEmailOtp(email, 'login', code)
  if (!ok) return null
  try {
    const operator = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, name: true, email: true, role: true, status: true },
    })
    if (!operator) return null
    if (operator.status === 'pending' || operator.status === 'suspended') return null
    return {
      id: operator.id, name: operator.name, email: operator.email, role: operator.role,
      roles: await readOperatorRoles(operator.id, operator.role),
    }
  } catch {
    return null
  }
}
