import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { addRoleToOperator } from '@/lib/operator-roles'

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
