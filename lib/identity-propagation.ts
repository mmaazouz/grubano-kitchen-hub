import { prisma } from '@/lib/prisma'
import { getOperatorCompanyIdentity, setVerifiedCompanyIdentity } from '@/lib/operator-identity'

// ── "Collect once" — propagate a verified entity identity to the account anchor ──
// (B1.3-B, Agent 31)
//
// When an ENTITY (SupplierProfile / LogisticsProfile) is ALREADY verified, copy its
// verified company identity to the SHARED account anchor (the B1.1 Operator columns)
// via lib/operator-identity, mirroring the franchise approval (B1.3-A). This is the
// "put away" half of collect-once: identity is read ONCE per entity verification and
// stored at the account so later flows (B1.3-C reuse) need not re-ask.
//
// It READS the already-stored verification result only — it NEVER calls or changes
// verifyBusiness / decide*Outcome, never touches the silos' own verificationStatus /
// gating, never touches finance. FORWARD ONLY: no backfill of pre-existing rows.
//
// RULES:
//  - STATUS: write kybStatus='verified' ONLY when the entity is genuinely verified
//    (verificationStatus === 'verified'). A pending/review/rejected entity never
//    elevates the account to 'verified'.
//  - ANTI-OVERWRITE (1 human / 2 companies): if the anchor is ALREADY verified and
//    carries a siren, never overwrite it with a different — or missing — siren; keep
//    the first (flagged via a warn log). Same siren → idempotent no-op.
//  - BEST-EFFORT: fully wrapped; it NEVER throws, so it can never break the
//    approval/activation flow it is grafted into (mirror of B1.3-A).
//  - Write goes ONLY through setVerifiedCompanyIdentity (server-only, whitelisted to
//    the 5 identity columns) — no role/status/email/password escalation possible.

const VERIFIED_VERIFICATION_STATUSES = new Set(['verified'])

export interface VerifiedEntityIdentity {
  /** Email that links the entity to its Operator (the bridge uses the same key). */
  email:              string
  /** SIREN already stored on the verified entity (9 digits). */
  siren:              string | null
  /** Official registry name already stored on the verified entity. */
  officialName:       string | null
  /** Optional legal form, if a future entity ever carries one (none today). */
  legalForm?:         string | null
  /** The entity silo's own verificationStatus ('verified' | 'review' | 'rejected'). */
  verificationStatus: string | null
}

export type PropagationResult =
  | { propagated: true }
  | { propagated: false; reason: 'not_verified' | 'no_operator' | 'siren_conflict' | 'noop_same' | 'error' }

export async function propagateVerifiedCompanyIdentity(
  entity: VerifiedEntityIdentity,
): Promise<PropagationResult> {
  try {
    const email = entity.email?.trim().toLowerCase()
    if (!email) return { propagated: false, reason: 'error' }

    // STATUS rule — never mark the account verified without a real entity verification.
    if (!entity.verificationStatus || !VERIFIED_VERIFICATION_STATUSES.has(entity.verificationStatus)) {
      return { propagated: false, reason: 'not_verified' }
    }

    const operator = await prisma.operator.findUnique({ where: { email }, select: { id: true } })
    if (!operator) return { propagated: false, reason: 'no_operator' }

    const anchor = await getOperatorCompanyIdentity(operator.id)
    const incomingSiren = entity.siren?.trim() || null

    // ANTI-OVERWRITE — protect a verified anchor that already carries a siren.
    if (anchor?.kybStatus === 'verified' && anchor.siren) {
      if (incomingSiren && incomingSiren === anchor.siren) {
        return { propagated: false, reason: 'noop_same' } // idempotent
      }
      // Different or missing incoming siren → keep the first (1 human / 2 companies).
      console.warn(
        '[identity-propagation] anchor already verified with a different siren — kept first (1 human / 2 companies):',
        operator.id,
      )
      return { propagated: false, reason: 'siren_conflict' }
    }

    // Anchor empty / not verified / verified-without-siren → store the verified identity.
    await setVerifiedCompanyIdentity(operator.id, {
      siren:         incomingSiren,
      officialName:  entity.officialName ?? null,
      ...(entity.legalForm !== undefined ? { legalForm: entity.legalForm } : {}),
      kybStatus:     'verified',
      kybVerifiedAt: new Date(),
    })
    return { propagated: true }
  } catch (err) {
    // Best-effort: never break the approval/activation flow this is grafted into.
    console.error('[identity-propagation] non-fatal:', entity.email, err instanceof Error ? err.message : err)
    return { propagated: false, reason: 'error' }
  }
}
