import crypto from 'crypto'
import { safeEqualHex, parseVerificationToken } from '@/lib/partner-verification'

// ── Onboarding anti-abandon nudge emails — decision + token core (Agent 95) ───────────
//
// PURE, side-effect-free helpers for the nudge cron: WHICH level (if any) is due for an
// account, the unsubscribe TOKEN (stateless HMAC — unguessable, account-bound, no DB
// minting, works without login), and the email LOCALE resolution. No I/O here → fully
// unit-testable. Sending + persistence live in the cron route; the per-level idempotence
// guard is the OnboardingNudge @@unique([operatorId,level]) (claim-before-send).
//
// SENSITIVE: these emails go to REAL users. Cadence is FIXED (J+1 / J+3 / J+7, max 3) and
// the STOP conditions (complete / unsubscribed / level ≥ 3) are enforced in decideNudgeLevel.

/** Kill-switch — default OFF. Only the exact string 'true' lets the cron send anything. */
export function isOnboardingNudgeEnabled(): boolean {
  return process.env.ONBOARDING_NUDGE_ENABLED === 'true'
}

const DAY_MS = 24 * 60 * 60 * 1000
/** FIXED cadence (Agent 0): nudge N is eligible only once the account is this old. */
export const NUDGE_AGE_MS: Record<1 | 2 | 3, number> = {
  1: 1 * DAY_MS, // ~J+1
  2: 3 * DAY_MS, // ~J+3
  3: 7 * DAY_MS, // ~J+7
}
export const MAX_NUDGE_LEVEL = 3

/**
 * Decide which nudge level (1|2|3) is DUE for an account, or null. PURE. STOP conditions
 * first: never nudge a completed onboarding, an unsubscribed account, or past level 3. Then
 * the next level = the smallest of {1,2,3} not yet sent; it is due ONLY once the account has
 * reached that level's age threshold (cadence). A gap-tolerant, monotonic progression.
 */
export function decideNudgeLevel(input: {
  nowMs:        number
  createdAtMs:  number
  sentLevels:   number[]
  unsubscribed: boolean
  isComplete:   boolean
}): 1 | 2 | 3 | null {
  if (input.unsubscribed || input.isComplete) return null
  const sent = new Set(input.sentLevels)
  let next: 1 | 2 | 3 | null = null
  for (const lvl of [1, 2, 3] as const) {
    if (!sent.has(lvl)) { next = lvl; break }
  }
  if (next === null) return null // all MAX_NUDGE_LEVEL nudges already sent
  if (input.nowMs - input.createdAtMs < NUDGE_AGE_MS[next]) return null // interval not reached yet
  return next
}

// ── Email locale ──────────────────────────────────────────────────────────────────────

export const NUDGE_LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
export type NudgeLocale = (typeof NUDGE_LOCALES)[number]

/** Resolve an operator's email language to a supported locale; unknown / null ⇒ 'fr'. */
export function resolveNudgeLocale(locale: string | null | undefined): NudgeLocale {
  return locale && (NUDGE_LOCALES as readonly string[]).includes(locale) ? (locale as NudgeLocale) : 'fr'
}

// ── Unsubscribe token (stateless HMAC) ──────────────────────────────────────────────────
// token = `${operatorId}.${HMAC_SHA256(NEXTAUTH_SECRET, "unsub:"+operatorId)}`. Unguessable
// (forging needs the server secret), bound to the account (operatorId embedded), stable
// (same link in every email), verifiable WITHOUT login, and immune to enumeration. We reuse
// safeEqualHex + parseVerificationToken from lib/partner-verification (imported, UNCHANGED);
// lib/magic-link is NOT touched.

function unsubSecret(): string {
  return (process.env.NEXTAUTH_SECRET ?? '').trim()
}

export function mintUnsubscribeToken(operatorId: string): string {
  const mac = crypto.createHmac('sha256', unsubSecret()).update(`unsub:${operatorId}`).digest('hex')
  return `${operatorId}.${mac}`
}

/** Validate an unsubscribe token; returns the operatorId on success, else null. Constant-time. */
export function verifyUnsubscribeToken(token: string): string | null {
  const parsed = parseVerificationToken(token)
  if (!parsed) return null
  const secret = unsubSecret()
  if (!secret) return null
  const expected = crypto.createHmac('sha256', secret).update(`unsub:${parsed.operatorId}`).digest('hex')
  if (!safeEqualHex(parsed.secret, expected)) return null
  return parsed.operatorId
}
