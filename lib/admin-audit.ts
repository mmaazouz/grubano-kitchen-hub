import { prisma } from '@/lib/prisma'

// ── AdminAuditLog writer — flag-gated, best-effort (ADM7 admin-hardening) ─────────
// Appends one immutable row recording a privileged admin action (who did what, to which
// target, when). Two hard guarantees:
//   1. GATED by ADMIN_AUDIT_ENABLED (default OFF) → a STRICT no-op when off. It returns
//      before touching `prisma.adminAuditLog`, so it is byte-identical to no-audit AND
//      safe to deploy BEFORE the additive table is migrated (Mohammed applies the
//      schema on staging, then flips the flag — order-independent from the code).
//   2. BEST-EFFORT: every failure is swallowed. An audit write must NEVER block, delay
//      (beyond the awaited insert) or alter the money/state action it records. Callers
//      should `await` it AFTER the action has fully succeeded, right before returning.
//
// The actor is a BARE Operator id (no FK) — mirrors LedgerEntry.restaurantId. For a
// machine (cron) caller with no session, pass actorId 'system:cron'.

export function isAdminAuditEnabled(): boolean {
  return process.env.ADMIN_AUDIT_ENABLED === 'true'
}

/** Sentinel actor id for machine (internal cron token) callers with no admin session. */
export const CRON_ACTOR_ID = 'system:cron'

export interface AdminAuditInput {
  /** Operator.id of the admin, or CRON_ACTOR_ID for a cron-token caller. */
  actorId: string
  actorEmail?: string | null
  /** dotted verb — e.g. 'refund.run', 'creator_payout.run', 'supplier.status', 'restaurant.approve'. */
  action: string
  /** e.g. 'order' | 'supplier' | 'prestataire' | 'restaurant' | 'claim' | 'franchise' | 'courier' | 'affiliate' | 'invoice'. */
  targetType?: string | null
  targetId?: string | null
  /** action-specific context (status, amountCents, batch size, …). */
  metadata?: Record<string, unknown>
  /** optional request — used only to capture the client IP. */
  req?: Request
}

function clientIp(req?: Request): string | null {
  if (!req) return null
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim() || null
  return req.headers.get('x-real-ip')?.trim() || null
}

export async function recordAdminAudit(input: AdminAuditInput): Promise<void> {
  if (!isAdminAuditEnabled()) return
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId:    input.actorId,
        actorEmail: input.actorEmail ?? null,
        action:     input.action,
        targetType: input.targetType ?? null,
        targetId:   input.targetId ?? null,
        metadata:   (input.metadata ?? {}) as object,
        ip:         clientIp(input.req),
      },
    })
  } catch {
    // best-effort — an audit write must never surface to the caller.
  }
}
