import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { addRoleToOperator } from '@/lib/operator-roles'
import type { BusinessVerificationResult } from '@/lib/business-verification'
import type { SupplierVetVerdict } from '@/lib/supplier-vetting'

// ── Name-tolerant verdict → supplier profile state (P2, Agent 18) ─────────────
//
// verifyBusiness() rejects in three cases: SIREN not found, company ceased, OR a
// clear declared-vs-official NAME mismatch. The first two return officialName=null
// (the registry never confirmed the company); the third returns a NON-null
// officialName (the registry DID confirm existence + active state — only the LLM
// name match failed). A commercial / trading name differing from the legal name is
// COMMON (enseigne, auto-entrepreneur « NOM Prénom », holding) → it must NEVER auto-
// reject a legitimate supplier.
//
// Mirrors decideLogisticsOutcome (lib/logistics-account) but is INTENTIONALLY more
// conservative on the name-mismatch case: logistics AUTO-ACTIVATES; a supplier has
// B2B ordering + payment downstream, so a name-only mismatch is routed to the SAME
// human-review 'pending' path already used for registry/LLM incidents (a human
// confirms the trading-name ↔ legal-name link before the supplier goes live). Only a
// genuine registry rejection (officialName=null) stays a definitive 'rejected'.
// FAIL-SAFE 'review' (registry unreachable/ambiguous OR LLM down) → 'pending'.
// Pure + deterministic → unit-tested. verifyBusiness itself is UNCHANGED.
export type SupplierVettingStatus = 'active' | 'pending' | 'rejected'

export interface SupplierDecision {
  status:             SupplierVettingStatus
  verificationStatus: 'verified' | 'review' | 'rejected'
  reason:             string
}

export function decideSupplierOutcome(v: BusinessVerificationResult): SupplierDecision {
  if (v.outcome === 'verified') {
    return { status: 'active', verificationStatus: 'verified', reason: v.reason }
  }
  if (v.outcome === 'rejected') {
    // NAME-TOLERANT: officialName present ⟺ the registry CONFIRMED the company is
    // real + active and only the declared NAME mismatched → human review, NOT reject.
    if (v.officialName) {
      return {
        status:             'pending',
        verificationStatus: 'review',
        reason:             'Entreprise confirmée au registre officiel ; nom commercial à vérifier manuellement.',
      }
    }
    // officialName absent ⟺ SIREN introuvable / entreprise cessée → real rejection.
    return { status: 'rejected', verificationStatus: 'rejected', reason: v.reason }
  }
  // 'review' — FAIL-SAFE (registry unreachable/ambiguous OR LLM unavailable).
  return { status: 'pending', verificationStatus: 'review', reason: v.reason }
}

// ── Fold the LLM trust-&-safety verdict into the registry decision (S2, Agent 70) ─
//
// DEFENCE IN DEPTH, ADDITIVE, CONSERVATIVE. The vetSupplier verdict (lib/supplier-
// vetting) can ONLY HARDEN the registry decision — it can NEVER auto-approve a company
// the registry refused, and NEVER auto-reject a company the registry confirmed. This
// gates ONBOARDING VISIBILITY only — it has ZERO effect on money (payouts stay
// independently hard-gated by Stripe Connect KYB, payoutStatus==='active').
//   - 'legit'  → the registry decision stands (verified→active, name-mismatch→pending…).
//   - 'doubt'  → (this is ALSO the fail-safe when the LLM is unavailable) an auto-
//                ACTIVATION is routed to human-review 'pending'; a 'pending'/'rejected'
//                registry outcome is left unchanged. It NEVER blocks the registration.
//   - 'bad'    → a DEFINITIVE registry rejection (officialName=null) stays 'rejected';
//                otherwise (registry-confirmed company) it routes to human-review
//                'pending' — never auto-activate a 'bad', never auto-reject a confirmed
//                company on the LLM signal alone (safest reading of the policy).
// verificationStatus stays the REGISTRY identity verdict (the vetting is a separate
// signal, recorded as vettingVerdict). Pure + deterministic → unit-tested.
export function combineVettingDecision(
  registry: SupplierDecision,
  verdict: SupplierVetVerdict,
  vettingReason: string,
): SupplierDecision {
  if (verdict === 'legit') return registry
  if (verdict === 'doubt') {
    // Only an auto-activation is softened to human review; never block, never escalate
    // a pending/rejected. The vetting reason explains why it now needs a human.
    if (registry.status !== 'active') return registry
    return { status: 'pending', verificationStatus: registry.verificationStatus, reason: vettingReason }
  }
  // 'bad' — strong abuse signal. Keep a definitive registry rejection; otherwise human review.
  if (registry.status === 'rejected') return registry
  return { status: 'pending', verificationStatus: registry.verificationStatus, reason: vettingReason }
}

// ── Session-scoped supplier resolver (Slice 1, Agent 14) ──────────────────────
// The ONE place catalogue routes resolve "who am I" → their own SupplierProfile,
// from the SESSION email only (never a client-supplied id). Returns null when the
// caller is not a supplier, so a route can never touch another supplier's data.
export async function callerSupplierProfile(): Promise<{ id: string; status: string } | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.supplierProfile
    .findUnique({ where: { email }, select: { id: true, status: true } })
    .catch(() => null)
}

// ── Supplier auth bridge (B2B marketplace Slice 0, Agent 14) ──────────────────
//
// Mirrors lib/creator-account.ensureCreatorOperator for the 'supplier' role. The
// supplier registration creates only a `SupplierProfile`; this bridges it to an
// `Operator` (the login account) so an APPROVED supplier can sign in (magic-link)
// and reach /supplier/dashboard.
//
// RULES (identical no-clobber contract as the creator bridge):
//   - No Operator for the email        → create a PASSWORDLESS Operator(role=
//     'supplier') (status pending, or active on approval).
//   - Operator exists, role='supplier' → activate on approval; never downgrade.
//   - Operator exists, ANOTHER role    → multi-role cumul: ADD the 'supplier' role
//     to its role SET (OperatorRole) on approval, WITHOUT touching its primary
//     `role` column or password. A restaurant/consumer thus BECOMES ALSO a
//     supplier (same account, two roles).
//
// The 'supplier' role enters the SET only at APPROVAL (`activate`) so a pending /
// abandoned registration never grants it. addRoleToOperator is idempotent +
// tolerant (missing table → no-op; the primary-role fallback still covers a fresh
// supplier Operator). Best-effort throughout: a bridge failure must never break
// registration/approval (the SupplierProfile is the durable artifact).

export type SupplierOperatorResult =
  | { ok: true; created: boolean; activated: boolean; roleAdded: boolean }
  | { ok: false; reason: 'error' }

export async function ensureSupplierOperator(
  email: string,
  name: string,
  opts: { activate: boolean },
): Promise<SupplierOperatorResult> {
  try {
    const existing = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, role: true, status: true },
    })

    let operatorId: string
    let created = false
    let activated = false

    if (!existing) {
      // Fresh email: a passwordless supplier login.
      const op = await prisma.operator.create({
        data: {
          name,
          email,
          role:   'supplier',
          status: opts.activate ? 'active' : 'pending',
          // no password — sign-in is passwordless (magic-link)
        },
      })
      operatorId = op.id
      created    = true
      activated  = opts.activate
    } else {
      operatorId = existing.id
      // Existing PRIMARY supplier: activate on approval, never downgrade. An
      // existing OTHER-role account keeps its primary role + password untouched —
      // it just GAINS the supplier role in the SET below (multi-role cumul).
      if (existing.role === 'supplier' && opts.activate && existing.status !== 'active') {
        await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
        activated = true
      }
    }

    // Record the 'supplier' role in the SET — only on APPROVAL. Idempotent +
    // tolerant. For a fresh supplier Operator this is consistency (the primary-role
    // fallback already covers it); for an existing other-role account this is the
    // actual multi-role grant.
    const roleAdded = opts.activate ? await addRoleToOperator(operatorId, 'supplier') : false

    return { ok: true, created, activated, roleAdded }
  } catch (err) {
    console.error('[ensureSupplierOperator] non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
