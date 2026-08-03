import { prisma } from '@/lib/prisma'
import { addRoleToOperator } from '@/lib/operator-roles'

// ── Franchise auth bridge (B1.3-A, Agent 30) ──────────────────────────────────
//
// MIRROR of lib/supplier-account.ensureSupplierOperator for the 'franchise' role.
// A FranchiseApplication carries no login account; this bridges it to an Operator
// so an APPROVED franchisee can sign in (magic-link) and reach /franchise/dashboard
// (POST_LOGIN_REDIRECTS routes 'franchise' there and middleware gates that space on
// the 'franchise' role — both already in place, untouched).
//
// No-clobber contract (identical to the supplier / creator bridges): never touches
// an existing account's primary `role` column or password. A fresh email becomes a
// passwordless franchise Operator; an existing account simply GAINS 'franchise' in
// its role SET (multi-role cumul).
//
// STRICTER than the supplier bridge on ONE point (mission requirement — no phantom
// approval): the role grant is VERIFIED. addRoleToOperator returns false SILENTLY on
// failure; when the 'franchise' role is reachable ONLY through the OperatorRole SET
// (an existing NON-franchise account gaining franchise), a false result is a real
// failure and we return ok:false so the caller never writes an 'approved' status
// without the role actually granted. For a fresh / primary-franchise account the
// primary-role column already grants the role (readOperatorRoles unions it), so a
// tolerant upsert miss is non-fatal there.

export type FranchiseOperatorResult =
  | { ok: true; operatorId: string; created: boolean; activated: boolean }
  | { ok: false; reason: 'role_grant_failed' | 'error' }

export async function ensureFranchiseOperator(
  email: string,
  name: string,
  opts: { activate: boolean },
): Promise<FranchiseOperatorResult> {
  // Normalize so a case variant can never create a second Operator for one person.
  const normEmail = email.trim().toLowerCase()
  if (!normEmail) return { ok: false, reason: 'error' }

  try {
    const existing = await prisma.operator.findUnique({
      where:  { email: normEmail },
      select: { id: true, role: true, status: true },
    })

    let operatorId: string
    let created = false
    let activated = false
    // True when 'franchise' is the PRIMARY role (fresh create, or an existing
    // primary-franchise account): readOperatorRoles always unions the primary role,
    // so the grant is effective regardless of the OperatorRole upsert result.
    let primaryFranchise = false

    if (!existing) {
      const op = await prisma.operator.create({
        data: {
          name,
          email:  normEmail,
          role:   'franchise',
          status: opts.activate ? 'active' : 'pending',
          // passwordless — sign-in is magic-link
        },
      })
      operatorId = op.id
      created = true
      activated = opts.activate
      primaryFranchise = true
    } else {
      operatorId = existing.id
      primaryFranchise = existing.role === 'franchise'
      // Existing PRIMARY franchise: activate on approval, never downgrade. An
      // existing OTHER-role account keeps its primary role + password untouched and
      // just GAINS 'franchise' in the SET below (multi-role cumul).
      if (existing.role === 'franchise' && opts.activate && existing.status !== 'active') {
        await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
        activated = true
      }
    }

    // Grant 'franchise' in the SET — only on approval. VERIFIED: for an existing
    // non-franchise account this upsert IS the grant, so a false result is a real
    // failure (no phantom approval). Fresh/primary-franchise → primary fallback
    // already grants it, so a tolerant miss is non-fatal.
    if (opts.activate) {
      const roleAdded = await addRoleToOperator(operatorId, 'franchise')
      if (!roleAdded && !primaryFranchise) {
        return { ok: false, reason: 'role_grant_failed' }
      }
    }

    return { ok: true, operatorId, created, activated }
  } catch (err) {
    console.error('[ensureFranchiseOperator] error:', normEmail, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}

// ── P0-06 — role flag (doctrine Q8: masked = UNAVAILABLE server-side) ──────────
// The whole franchise surface (apply/approve — approve reaches verifyBusiness, a
// PAID third-party call —, applications, brands, POS, finances, my-dashboard,
// profile, connect, the franchisee enrolment side + the admin settlement rail) is
// OFF by default. Mirror of isPrestataireEnabled: 404 first line, every verb.
export function isFranchiseEnabled(): boolean {
  return process.env.FRANCHISE_ENABLED === 'true'
}
