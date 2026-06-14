import { prisma } from '@/lib/prisma'

// ── Creator auth bridge (Phase 0, Agent 14) ───────────────────────────────────
//
// Historically the creator apply/verify flow created only a `Creator` PROFILE,
// never an `Operator` (the login account) — so a verified creator could not sign
// in and /creators/dashboard was unreachable. This helper gives a creator a
// PASSWORDLESS `Operator(role='creator')` (sign-in is via magic-link) and
// activates it on approval.
//
// RULES:
//   - No Operator for the email      → create one (status pending, or active on approval).
//   - Operator exists, role='creator' → activate on approval; never downgrade.
//   - Operator exists, OTHER role     → DO NOT clobber it (consumer/restaurant keep
//     their account). Multi-role cumul is Phase 1 — we just report it.
// Best-effort: callers treat it as non-fatal (the application/Creator is the
// durable artifact; a bridge failure must never break apply/verify).

export type CreatorOperatorResult =
  | { ok: true; created: boolean; activated: boolean }
  | { ok: false; reason: 'email_taken_other_role'; role: string }
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

    if (!existing) {
      await prisma.operator.create({
        data: {
          name,
          email,
          role:   'creator',
          status: opts.activate ? 'active' : 'pending',
          // no password — sign-in is passwordless (magic-link)
        },
      })
      return { ok: true, created: true, activated: opts.activate }
    }

    // Email already belongs to a non-creator account → never clobber (cumul = Phase 1).
    if (existing.role !== 'creator') {
      return { ok: false, reason: 'email_taken_other_role', role: existing.role }
    }

    // Existing creator Operator: activate on approval, never downgrade.
    if (opts.activate && existing.status !== 'active') {
      await prisma.operator.update({ where: { id: existing.id }, data: { status: 'active' } })
      return { ok: true, created: false, activated: true }
    }
    return { ok: true, created: false, activated: false }
  } catch (err) {
    console.error('[ensureCreatorOperator] non-fatal:', email, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
