import { verifyEmailOtp, isMoneyStepUpEnabled, type OtpPurpose } from '@/lib/email-otp'

// ── Money step-up guard (Phase 3 auth hardening — Agent 88) ───────────────────────
//
// A re-authentication GATE placed at the TOP of a sensitive money action (change bank /
// IBAN, trigger a withdrawal, change the account email). It does NOT change the action's
// logic (amount, destination, …) — it only BLOCKS the action until a fresh, single-use
// email code for (email, purpose) is provided. Gated by AUTH_MONEY_STEPUP_ENABLED:
//   • OFF → ALWAYS { ok:true } → the action runs EXACTLY as before (byte-identical).
//   • ON  → a missing code is stepup_required; a wrong/expired code is stepup_invalid;
//           a valid code is consumed (single-use) and the action proceeds once.
// The code is purpose-bound (a 'login' code can never satisfy 'stepup:withdraw') and
// email-bound (verifyEmailOtp). The action's money mechanics (payPartner, Stripe, …)
// stay untouched behind the guard.

export type StepUpReason = 'stepup_required' | 'stepup_invalid'
export type StepUpResult = { ok: true } | { ok: false; status: 401; reason: StepUpReason }

export type StepUpPurpose = Extract<OtpPurpose, `stepup:${string}`>

export async function requireStepUp(
  email: string,
  purpose: StepUpPurpose,
  code: string | null | undefined,
): Promise<StepUpResult> {
  if (!isMoneyStepUpEnabled()) return { ok: true }       // OFF → guard inert (byte-identical)
  if (!code) return { ok: false, status: 401, reason: 'stepup_required' }
  const ok = await verifyEmailOtp(email, purpose, code)  // single-use, constant-time, attempt-capped
  return ok ? { ok: true } : { ok: false, status: 401, reason: 'stepup_invalid' }
}
