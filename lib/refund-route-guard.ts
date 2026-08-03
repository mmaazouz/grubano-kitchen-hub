import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { recordAdminAudit } from '@/lib/admin-audit'

// ── P0-03 (vague 1) — ADMIN-only gate for the owner refund routes ─────────────────
// Q3 (fondateur) : « aucun remboursement automatique ; toute demande passe par une
// validation ADMIN GRUBANO ». The three live refund routes (orders/[id]/refund,
// tickets/[id]/refund, reservations/[id]/refund-deposit) used to be OWNER-scoped
// (restaurateur) — they now require an ADMIN GRUBANO session. EVERY attempt, accepted
// or refused, is written to the audit journal (lib/admin-audit → AdminAuditLog,
// itself flag-gated by ADMIN_AUDIT_ENABLED — best-effort, never blocks the route):
//   • refused  → action 'refund.denied'  (metadata.reason: unauthenticated | not_admin)
//   • accepted → the ROUTE writes 'refund.run' AFTER the Stripe refund succeeded.
// The admin check accepts the primary role OR the multi-role set (same gate as the
// other privileged routes: admin/claims, admin/restaurants/approve).

export type RefundAdminGate =
  | { ok: true; actorId: string; actorEmail: string | null }
  | { ok: false; res: NextResponse }

export async function requireRefundAdmin(
  req: Request,
  audit: { route: string; targetType: string; targetId: string },
): Promise<RefundAdminGate> {
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; email?: string; role?: string; roles?: string[] } | undefined

  if (!user?.id) {
    await recordAdminAudit({
      actorId:    'anonymous',
      actorEmail: null,
      action:     'refund.denied',
      targetType: audit.targetType,
      targetId:   audit.targetId,
      metadata:   { route: audit.route, reason: 'unauthenticated' },
      req,
    })
    return { ok: false, res: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }

  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin) {
    await recordAdminAudit({
      actorId:    user.id,
      actorEmail: user.email ?? null,
      action:     'refund.denied',
      targetType: audit.targetType,
      targetId:   audit.targetId,
      metadata:   { route: audit.route, reason: 'not_admin', role: user.role ?? null },
      req,
    })
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Remboursement réservé à un administrateur Grubano.' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, actorId: user.id, actorEmail: user.email ?? null }
}
