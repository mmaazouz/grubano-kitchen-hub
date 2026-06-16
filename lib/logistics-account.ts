import { prisma } from '@/lib/prisma'
import { addRoleToOperator } from '@/lib/operator-roles'
import type { BusinessVerificationResult } from '@/lib/business-verification'

// ── Logistics (courier / delivery partner) onboarding — Slice 1, Agent 15 ─────
//
// The delivery-partner analogue of lib/supplier-account, calqued on it 1:1 so the
// behaviour and guarantees are identical. Two concerns live here:
//   1. decideLogisticsOutcome — maps a verifyBusiness() result to the profile state
//      with NAME-TOLERANT gating (a declared name that differs from the registry is
//      NEVER a rejection; only a not-found / ceased SIREN is).
//   2. ensureLogisticsOperator — bridges the LogisticsProfile to an Operator login
//      and grafts the 'logistics' role onto the role SET (multi-role cumul), exactly
//      like ensureSupplierOperator does for 'supplier'.
//
// NO payment / Stripe / KYB here — that is a later slice, exactly like the supplier
// path. lib/business-verification is REUSED UNMODIFIED.

// ── Name-tolerant verdict → profile state ─────────────────────────────────────
//
// verifyBusiness() rejects in three cases: SIREN not found, company ceased, OR a
// clear declared-vs-official NAME mismatch. The first two return officialName=null
// (the registry never confirmed the company); the third returns a NON-null
// officialName (the registry DID confirm existence + active state — only the name
// failed the LLM match). For couriers the declared name is just a display name, so
// a name-only mismatch must NOT reject: whenever the registry confirmed the company
// (officialName present), we ACTIVATE and show the official name. A genuine registry
// rejection (officialName=null) is the ONLY definitive 'rejected'. FAIL-SAFE 'review'
// (registry unreachable/ambiguous OR LLM down) maps to 'pending' — never auto-reject
// on an incident. Pure + deterministic → unit-tested.
export type LogisticsStatus = 'active' | 'pending' | 'rejected'

export interface LogisticsDecision {
  status:             LogisticsStatus
  verificationStatus: 'verified' | 'review' | 'rejected'
  reason:             string
}

export function decideLogisticsOutcome(v: BusinessVerificationResult): LogisticsDecision {
  if (v.outcome === 'verified') {
    return { status: 'active', verificationStatus: 'verified', reason: v.reason }
  }
  if (v.outcome === 'rejected') {
    // NAME-TOLERANT: officialName present ⟺ the registry confirmed the company is
    // real + active and only the declared NAME mismatched → activate, never reject.
    if (v.officialName) {
      return {
        status:             'active',
        verificationStatus: 'verified',
        reason:             'Entreprise vérifiée au registre officiel (nom d’affichage toléré).',
      }
    }
    // officialName absent ⟺ SIREN introuvable / entreprise cessée → real rejection.
    return { status: 'rejected', verificationStatus: 'rejected', reason: v.reason }
  }
  // 'review' — FAIL-SAFE (registry unreachable/ambiguous OR LLM unavailable).
  return { status: 'pending', verificationStatus: 'review', reason: v.reason }
}

// ── Logistics auth bridge ─────────────────────────────────────────────────────
//
// Mirrors ensureSupplierOperator for the 'logistics' role (same no-clobber contract
// as the creator / supplier bridges):
//   - No Operator for the email        → create a PASSWORDLESS Operator(role=
//     'logistics') (status pending, or active on approval).
//   - Operator exists, role='logistics'→ activate on approval; never downgrade.
//   - Operator exists, ANOTHER role    → multi-role cumul: ADD the 'logistics' role
//     to its role SET on approval, WITHOUT touching its primary `role` column or
//     password. A restaurant/consumer/supplier thus BECOMES ALSO a logistics partner
//     (same account, more roles).
//
// The 'logistics' role enters the SET only at activation so a pending / abandoned
// registration never grants it. addRoleToOperator is idempotent + tolerant. Best-
// effort throughout: a bridge failure must never break registration (the
// LogisticsProfile is the durable artifact).

export type LogisticsOperatorResult =
  | { ok: true; created: boolean; activated: boolean; roleAdded: boolean }
  | { ok: false; reason: 'error' }

export async function ensureLogisticsOperator(
  email: string,
  name: string,
  opts: { activate: boolean },
): Promise<LogisticsOperatorResult> {
  try {
    const existing = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, role: true, status: true },
    })

    let operatorId: string
    let created = false
    let activated = false

    if (!existing) {
      // Fresh email: a passwordless logistics login.
      const op = await prisma.operator.create({
        data: {
          name,
          email,
          role:   'logistics',
          status: opts.activate ? 'active' : 'pending',
          // no password — sign-in is passwordless (magic-link)
        },
      })
      operatorId = op.id
      created    = true
      activated  = opts.activate
    } else {
      operatorId = existing.id
      // Existing PRIMARY logistics: activate on approval, never downgrade. An
      // existing OTHER-role account keeps its primary role + password untouched —
      // it just GAINS the logistics role in the SET below (multi-role cumul).
      if (existing.role === 'logistics' && opts.activate && existing.status !== 'active') {
        await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
        activated = true
      }
    }

    // Record the 'logistics' role in the SET — only on activation. Idempotent +
    // tolerant. For a fresh logistics Operator this is consistency (the primary-role
    // fallback already covers it); for an existing other-role account this is the
    // actual multi-role grant.
    const roleAdded = opts.activate ? await addRoleToOperator(operatorId, 'logistics') : false

    return { ok: true, created, activated, roleAdded }
  } catch (err) {
    console.error('[ensureLogisticsOperator] non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
