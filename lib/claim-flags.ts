// ── lib/claim-flags.ts — the claims gates (D′ lot L1, spec v2 §3) ──────────────────────────────
//
// Reads process.env ONLY and imports nothing: every gate of the claims feature is decided here,
// by the caller, right before the action it governs (H02: a gate is read at use time, never cached).
//
// Two families of flags:
//   • PRODUCT flags (the beta):  CLAIMS_SURFACE_ENABLED — the feature exists (lists, review, decisions,
//                                   withdraw, ceiling, admin console workflow, pre-money e-mails);
//                                CLAIMS_INTAKE_ENABLED  — a customer may FILE a new claim.
//     Exact string 'true' only ('TRUE', '1', '' are OFF). INTAKE without SURFACE is a configuration
//     error (scripts/check-flags.mjs) and opens nothing.
//   • LEGACY lease (rehearsals only — Mode A 2026-09-15→18, Mode B 2026-09-22 `dab754d`, both CLOSED):
//     CLAIMS_ENABLED='true' AND CLAIMS_WINDOW_UNTIL an absolute deadline ≤ 60 min ahead (T-53).
//     When SURFACE is 'true' the lease is INERT; when SURFACE is absent the lease still opens surface
//     AND intake together, exactly as before (S-12: no product flag ⇒ every gate ≡ isClaimsEnabled()).
//
// What NO flag here ever opens (S-13): auto-approve, auto-resolve, the ghost-order refund, the refund
// engine — REFUNDS has its own lease (lib/refund isRefundsEnabled) and nothing couples the two. The
// financial rail (D′ L5) requires isRefundsEnabled() ∧ isClaimsSurfaceEnabled() strictly: the legacy
// lease never opens the rail.
//
// Notification classes (FIN-EMAIL-01, §6): a PRE-MONEY notice (ack, decisions, withdraw, resto (1)(2),
// the « demande transmise » cancellation variant) is skipped when the surface is closed; a POST-MONEY
// notice (Stripe-proven refund) and an explicit terminal CLOSURE are always sendable — hiding a paid
// refund or a closed file behind a feature flag is how money questions go silent.

/** Compiled ceiling of the legacy lease (T-53): a deadline further ahead is refused, never clamped. */
export const CLAIMS_WINDOW_MAX_MS = 60 * 60 * 1000

export type ClaimsGateState =
  | { open: false; reason: 'flag_off' | 'no_lease' | 'lease_unreadable' | 'lease_expired' | 'lease_too_long' }
  | { open: true; expiresAt: Date; remainingMs: number }

/**
 * The LEGACY lease, unchanged logic (T-53): CLAIMS_ENABLED === 'true' ∧ CLAIMS_WINDOW_UNTIL readable,
 * in the future and at most CLAIMS_WINDOW_MAX_MS ahead. The flag alone authorizes nothing; a restart
 * does not extend the deadline (absolute, not a countdown).
 */
export function claimsGateState(nowMs: number = Date.now()): ClaimsGateState {
  if (process.env.CLAIMS_ENABLED !== 'true') return { open: false, reason: 'flag_off' }
  const raw = (process.env.CLAIMS_WINDOW_UNTIL ?? '').trim()
  if (!raw) return { open: false, reason: 'no_lease' }
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return { open: false, reason: 'lease_unreadable' }
  if (t <= nowMs) return { open: false, reason: 'lease_expired' }
  if (t - nowMs > CLAIMS_WINDOW_MAX_MS) return { open: false, reason: 'lease_too_long' }
  return { open: true, expiresAt: new Date(t), remainingMs: t - nowMs }
}

/** Legacy lease open right now (rehearsal-only; inert under CLAIMS_SURFACE_ENABLED='true'). */
export function isClaimsEnabled(): boolean {
  return claimsGateState().open
}

/** Product flag: the claims feature exists. Exact 'true' only. */
export function isClaimsSurfaceEnabled(): boolean {
  return process.env.CLAIMS_SURFACE_ENABLED === 'true'
}

/** Product flag: customers may file a new claim. Exact 'true' only; opens nothing without SURFACE. */
export function isClaimsIntakeEnabled(): boolean {
  return process.env.CLAIMS_INTAKE_ENABLED === 'true'
}

/** The claims SURFACE is open: product flag, or (product flags absent) the legacy lease. */
export function claimsSurfaceOpen(): boolean {
  return isClaimsSurfaceEnabled() || isClaimsEnabled()
}

/**
 * A customer may FILE a claim right now. Under the product surface, INTAKE decides; without it the
 * legacy lease opens surface and intake together (Mode A/B shape).
 */
export function claimsIntakeOpen(): boolean {
  return isClaimsSurfaceEnabled() ? isClaimsIntakeEnabled() : isClaimsEnabled()
}

export type ClaimNoticeClass = 'pre_money' | 'post_money' | 'closure'

/**
 * FIN-EMAIL-01 — the `claimsOpen` value a claim sender receives, by the class of the notice the CALLING
 * FILE sends: pre-money notices follow the surface; post-money notices and explicit closures are always
 * sendable. The senders themselves keep their `claimsOpen: boolean` contract (H02).
 */
export function claimNoticeGate(cls: ClaimNoticeClass): boolean {
  return cls === 'pre_money' ? claimsSurfaceOpen() : true
}

/** Every gate at once, for the census and the operators (read-only, no secret). */
export function claimsFlagsSnapshot(nowMs: number = Date.now()): {
  surfaceFlag: boolean; intakeFlag: boolean; legacy: ClaimsGateState; surfaceOpen: boolean; intakeOpen: boolean
} {
  const legacy = claimsGateState(nowMs)
  const surfaceFlag = isClaimsSurfaceEnabled(), intakeFlag = isClaimsIntakeEnabled()
  return {
    surfaceFlag, intakeFlag, legacy,
    surfaceOpen: surfaceFlag || legacy.open,
    intakeOpen:  surfaceFlag ? intakeFlag : legacy.open,
  }
}
