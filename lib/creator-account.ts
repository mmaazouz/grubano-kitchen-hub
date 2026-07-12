import { prisma } from '@/lib/prisma'
import { addRoleToOperator } from '@/lib/operator-roles'

// ── Creator auth bridge (Phase 0 → Phase 3, Agent 14) ─────────────────────────
//
// The creator apply/verify flow creates only a `Creator` PROFILE. This bridges it
// to an `Operator` (the login account) so a verified creator can sign in (via
// magic-link) and reach /creators/dashboard.
//
// RULES:
//   - No Operator for the email        → create a PASSWORDLESS Operator(role=
//     'creator') (status pending, or active on approval) — Phase 0.
//   - Operator exists, role='creator'  → activate on approval; never downgrade.
//   - Operator exists, ANOTHER role    → Phase 3 (multi-role cumul): ADD the
//     'creator' role to its role SET (OperatorRole) on approval, WITHOUT touching
//     its primary `role` column or password. A consumer/restaurant thus BECOMES
//     ALSO a creator (same account, two roles).
//
// The 'creator' role is recorded in the SET only at APPROVAL (`activate`) so a
// pending/abandoned application never grants it. addRoleToOperator is idempotent +
// tolerant (missing table → no-op; the primary-role fallback still covers a fresh
// creator Operator). Best-effort throughout: a bridge failure must never break
// apply/verify (the Creator is the durable artifact).

export type CreatorOperatorResult =
  | { ok: true; created: boolean; activated: boolean; roleAdded: boolean }
  | { ok: false; reason: 'error' }

export async function ensureCreatorOperator(
  email: string,
  name: string,
  opts: { activate: boolean },
): Promise<CreatorOperatorResult> {
  try {
    const existing = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, role: true, status: true },
    })

    let operatorId: string
    let created = false
    let activated = false

    if (!existing) {
      // Phase 0 — fresh email: a passwordless creator login.
      const op = await prisma.operator.create({
        data: {
          name,
          email,
          role:   'creator',
          status: opts.activate ? 'active' : 'pending',
          // no password — sign-in is passwordless (magic-link)
        },
      })
      operatorId = op.id
      created    = true
      activated  = opts.activate
    } else {
      operatorId = existing.id
      // Existing PRIMARY creator: activate on approval, never downgrade. An
      // existing OTHER-role account keeps its primary role + password untouched —
      // it just GAINS the creator role in the SET below (Phase 3 cumul).
      if (existing.role === 'creator' && opts.activate && existing.status !== 'active') {
        await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
        activated = true
      }
    }

    // Record the 'creator' role in the SET — only on APPROVAL. Idempotent +
    // tolerant. For a fresh creator Operator this is consistency (the primary-role
    // fallback already covers it); for an existing other-role account this is the
    // actual multi-role grant.
    const roleAdded = opts.activate ? await addRoleToOperator(operatorId, 'creator') : false

    return { ok: true, created, activated, roleAdded }
  } catch (err) {
    console.error('[ensureCreatorOperator] non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
