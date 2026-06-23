import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled, ensureAffiliateOperator, type EnsureAffiliateResult } from '@/lib/affiliate-account'

// ── Affiliate PRE-LOGIN signup bridge (Agent 118 — unification "recommander" incr. 1/3) ──
//
// Closes the gap surfaced by Agent 117: today an Affiliate can be created ONLY via the
// session-only POST /api/affiliate/join → ensureAffiliateOperator(operatorId), so a visitor
// who is NOT yet logged in has no way to join. This bridge mirrors the CREATOR pre-login
// pattern (ensureCreatorOperator: provision a passwordless Operator BY EMAIL) and then REUSES
// the existing, idempotent ensureAffiliateOperator — it is NOT forked, and the affiliate money
// mechanics (earning / payout / ledger / attribution / the 40% audienceVerified tier) are
// untouched here.
//
// WHY status='active' (vs the creator's 'pending'): the affiliate has NO vetting step — the
// doctrine is "lien de parrainage instantané" (affiliate-account.ts header). A 'pending' Operator
// could never sign in (authorizeMagicLink + the magic-link sender both gate on status==='active'),
// so the user would be stranded. SECURITY: an active passwordless affiliate Operator carries NO
// money access — it only lets the owner share a referral link (earning needs real /ref orders;
// withdrawal needs KYC/Connect, both unchanged). Sign-in still requires the magic-link emailed to
// THAT address (no takeover). Abuse is bounded by AFFILIATE_ENABLED (default OFF), the route's
// honeypot + per-IP rate-limit, and idempotence (Operator unique by email, Affiliate.operatorId
// @unique). audienceVerified stays false (the 40% tier is a SEPARATE admin-only path, untouched).
//
// IDEMPOTENT: an existing email (any role) is REUSED (never a 2nd Operator), and
// ensureAffiliateOperator never mints a 2nd Affiliate/code. Best-effort: a provisioning failure
// degrades to { ok:false } (the caller stays neutral) and never throws.

/**
 * Provision (if absent) a passwordless Operator for `email`, then grant the affiliate role +
 * create the Affiliate entity via the EXISTING idempotent ensureAffiliateOperator. Gated by
 * AFFILIATE_ENABLED (→ { ok:false, reason:'disabled' } when OFF). Owner-agnostic: the caller is
 * a PUBLIC pre-login route, so `email` is the identity (no session needed).
 */
export async function ensureAffiliateApplicant(email: string, name: string): Promise<EnsureAffiliateResult> {
  if (!isAffiliateEnabled()) return { ok: false, reason: 'disabled' }

  let operatorId: string
  try {
    const existing = await prisma.operator.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      // Existing account (consumer / restaurant / …): REUSE it. ensureAffiliateOperator below
      // ADDS the 'affiliate' role to its SET without touching its primary role / status / password.
      operatorId = existing.id
    } else {
      // Fresh email → a PASSWORDLESS affiliate login. ACTIVE (instant doctrine, see header).
      const op = await prisma.operator.create({
        data: {
          name,
          email,
          role:   'affiliate',
          status: 'active',
          // no password — sign-in is passwordless (magic-link)
        },
        select: { id: true },
      })
      operatorId = op.id
    }
  } catch (err) {
    console.error('[ensureAffiliateApplicant] provisioning non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }

  // REUSE the existing creation (grants 'affiliate' role + mints the Affiliate entity/code,
  // idempotent). This never touches the earning / payout / ledger / attribution mechanics.
  return ensureAffiliateOperator(operatorId)
}
