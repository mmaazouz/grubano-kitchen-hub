// ── Influencer onboarding UPGRADE — pure view logic (Agent 99) ────────────────────────
//
// The influencer tier is an OPTIONAL upgrade of the affiliate onboarding: an affiliate whose
// AUDIENCE is verified (Affiliate.audienceVerified) unlocks the better rate. This module is a
// PURE mapping from the EXISTING verification state (lib/influencer-verification.getVerificationState,
// served owner-scoped by GET /api/affiliate/verify-request) to a small UI "variant". It owns NO
// state, does NO I/O, and NEVER touches the affiliate activation checklist — so a normal affiliate
// who does not pursue the tier keeps a byte-identical 3-step checklist (the upgrade lives OUTSIDE
// the progression). It is also 100% OFF the money path: it carries no rate/amount and never flips
// audienceVerified (admin-only approval is unchanged). Gated by INFLUENCER_ENABLED upstream (the
// verify-request endpoint 404s when OFF → the card self-gates → dashboard byte-identical).

/** The verification state this module reads (subset of VerificationState). */
export interface InfluencerUpgradeInput {
  verified: boolean
  request:  { status: string } | null
}

/**
 * - verified : audience verified by an admin → "best rate unlocked" (the actual rate is shown
 *              by the EXISTING Agent 90 display; we never render the number here).
 * - pending  : a request is awaiting admin review → "verification in progress".
 * - invite   : no request yet, or a previous one was rejected/decided-without-verification →
 *              invite the affiliate to (re)apply (the action lives in the EXISTING
 *              AffiliateVerifyCard; the upgrade strip only points to it).
 */
export type InfluencerUpgradeVariant = 'verified' | 'pending' | 'invite'

/** Map the read-only verification state to the upgrade variant. PURE; never mutates. */
export function deriveInfluencerUpgrade(state: InfluencerUpgradeInput | null | undefined): {
  variant: InfluencerUpgradeVariant
} {
  if (state?.verified) return { variant: 'verified' }
  if (state?.request?.status === 'pending') return { variant: 'pending' }
  return { variant: 'invite' }
}
