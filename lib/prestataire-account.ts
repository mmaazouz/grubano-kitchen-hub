import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { addRoleToOperator } from '@/lib/operator-roles'
import type { BusinessVerificationResult } from '@/lib/business-verification'
import type { PrestataireVetVerdict } from '@/lib/prestataire-vetting'

// ── Prestataire (SERVICES marketplace) onboarding — P1 foundation (Agent 74) ──
//
// A 1:1 CLONE of lib/supplier-account for the new 'prestataire' role (a company that
// SELLS A SERVICE to restaurants), adapted to services. The whole role is gated by
// PRESTATAIRE_ENABLED (default OFF) — when OFF, the register/admin/dashboard routes are
// inaccessible and no Operator can ever gain the 'prestataire' role, so the role is
// byte-identical to "does not exist". POSTURE = the supplier's CONSERVATIVE one (a
// declared name ≠ the registry name on a confirmed company → human-review 'pending',
// NOT the courier's auto-activation): a prestataire has quotes/missions/payment
// downstream, so a name mismatch is confirmed by a human first. NO money here.

/** Kill-switch — default OFF. Only the exact string 'true' opens the prestataire role.
 *  Distinct from any payment/Connect flag (none is wired in P1). */
export function isPrestataireEnabled(): boolean {
  return process.env.PRESTATAIRE_ENABLED === 'true'
}

// ── Name-tolerant verdict → prestataire profile state (clone of decideSupplierOutcome) ─
//
// verifyBusiness() rejects in three cases: SIREN not found, company ceased, OR a clear
// declared-vs-official NAME mismatch. The first two return officialName=null (the
// registry never confirmed the company); the third returns a NON-null officialName (the
// registry DID confirm existence + active state — only the LLM name match failed). A
// commercial / trading name differing from the legal name is COMMON (enseigne, auto-
// entrepreneur « NOM Prénom », holding) → it must NEVER auto-reject a legitimate
// prestataire. CONSERVATIVE (like the supplier, NOT the courier): a name-only mismatch
// on a confirmed company is routed to human-review 'pending', never auto-activated.
// Only a genuine registry rejection (officialName=null) stays a definitive 'rejected'.
// FAIL-SAFE 'review' (registry unreachable/ambiguous OR LLM down) → 'pending'.
// Pure + deterministic → unit-tested. verifyBusiness itself is UNCHANGED.
export type PrestataireVettingStatus = 'active' | 'pending' | 'rejected'

export interface PrestataireDecision {
  status:             PrestataireVettingStatus
  verificationStatus: 'verified' | 'review' | 'rejected'
  reason:             string
}

export function decidePrestataireOutcome(v: BusinessVerificationResult): PrestataireDecision {
  if (v.outcome === 'verified') {
    return { status: 'active', verificationStatus: 'verified', reason: v.reason }
  }
  if (v.outcome === 'rejected') {
    // NAME-TOLERANT but CONSERVATIVE: officialName present ⟺ the registry CONFIRMED the
    // company is real + active and only the declared NAME mismatched → human review, NOT
    // reject and NOT auto-activate (the prestataire goes live only after a human links the
    // trading name ↔ legal name).
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

// ── Fold the LLM trust-&-safety verdict into the registry decision (clone of S2) ──
//
// DEFENCE IN DEPTH, ADDITIVE, CONSERVATIVE. The vetPrestataire verdict can ONLY HARDEN
// the registry decision — it can NEVER auto-approve a company the registry refused, and
// NEVER auto-reject a company the registry confirmed. ZERO money effect.
//   - 'legit'  → the registry decision stands (verified→active, name-mismatch→pending…).
//   - 'doubt'  → (also the fail-safe when the LLM is unavailable) an auto-ACTIVATION is
//                routed to human-review 'pending'; a 'pending'/'rejected' registry outcome
//                is left unchanged. It NEVER blocks the registration.
//   - 'bad'    → a DEFINITIVE registry rejection (officialName=null) stays 'rejected';
//                otherwise (registry-confirmed company) it routes to human-review 'pending'
//                — never auto-activate a 'bad', never auto-reject a confirmed company on
//                the LLM signal alone.
// verificationStatus stays the REGISTRY identity verdict (the vetting is a separate
// signal, recorded as vettingVerdict). Pure + deterministic → unit-tested.
export function combineVettingDecision(
  registry: PrestataireDecision,
  verdict: PrestataireVetVerdict,
  vettingReason: string,
): PrestataireDecision {
  if (verdict === 'legit') return registry
  if (verdict === 'doubt') {
    if (registry.status !== 'active') return registry
    return { status: 'pending', verificationStatus: registry.verificationStatus, reason: vettingReason }
  }
  // 'bad' — strong abuse signal. Keep a definitive registry rejection; otherwise human review.
  if (registry.status === 'rejected') return registry
  return { status: 'pending', verificationStatus: registry.verificationStatus, reason: vettingReason }
}

// ── Session-scoped prestataire resolver (clone of callerSupplierProfile) ──────────
// The ONE place prestataire routes resolve "who am I" → their own PrestataireProfile,
// from the SESSION email only (never a client-supplied id). Returns null when the caller
// is not a prestataire, so a route can never touch another prestataire's data.
export async function callerPrestataireProfile(): Promise<{ id: string; status: string } | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.prestataireProfile
    .findUnique({ where: { email }, select: { id: true, status: true } })
    .catch(() => null)
}

// ── Prestataire auth bridge (clone of ensureSupplierOperator) ─────────────────────
//
// Bridges the PrestataireProfile to an Operator (the login account) so an APPROVED
// prestataire can sign in (magic-link) and reach /prestataire/dashboard.
//   - No Operator for the email          → create a PASSWORDLESS Operator(role=
//     'prestataire') (status pending, or active on approval).
//   - Operator exists, role='prestataire'→ activate on approval; never downgrade.
//   - Operator exists, ANOTHER role      → multi-role cumul: ADD the 'prestataire' role
//     to its role SET (OperatorRole) on approval, WITHOUT touching its primary `role`
//     column or password.
// The 'prestataire' role enters the SET only at APPROVAL (`activate`). addRoleToOperator
// is idempotent + tolerant. Best-effort: a bridge failure never breaks registration.

export type PrestataireOperatorResult =
  | { ok: true; created: boolean; activated: boolean; roleAdded: boolean }
  | { ok: false; reason: 'error' }

export async function ensurePrestataireOperator(
  email: string,
  name: string,
  opts: { activate: boolean },
): Promise<PrestataireOperatorResult> {
  try {
    const existing = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, role: true, status: true },
    })

    let operatorId: string
    let created = false
    let activated = false

    if (!existing) {
      // Fresh email: a passwordless prestataire login.
      const op = await prisma.operator.create({
        data: {
          name,
          email,
          role:   'prestataire',
          status: opts.activate ? 'active' : 'pending',
          // no password — sign-in is passwordless (magic-link)
        },
      })
      operatorId = op.id
      created    = true
      activated  = opts.activate
    } else {
      operatorId = existing.id
      // Existing PRIMARY prestataire: activate on approval, never downgrade. An existing
      // OTHER-role account keeps its primary role + password untouched — it just GAINS the
      // prestataire role in the SET below (multi-role cumul).
      if (existing.role === 'prestataire' && opts.activate && existing.status !== 'active') {
        await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
        activated = true
      }
    }

    // Record the 'prestataire' role in the SET — only on APPROVAL. Idempotent + tolerant.
    const roleAdded = opts.activate ? await addRoleToOperator(operatorId, 'prestataire') : false

    return { ok: true, created, activated, roleAdded }
  } catch (err) {
    console.error('[ensurePrestataireOperator] non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
