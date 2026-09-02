import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/loyalty/waiver (Phase 1 — D3 goodwill waiver) ──────────────
// A NEUTRAL Grubano admin waives some/all of a customer's loyalty recovery OFFSET
// (the internal debt left when an earned-point clawback on a refund could not be
// fully recovered because the points were already spent). Forgiving the offset
// REDUCES the debt; it does NOT credit spendable balance. ADMIN-ONLY.
//
// Auditable (D3.7): the decision — actor, reason, amount, timestamp — is written to
// AdminAuditLog; the movement to a signed LoyaltyTransaction (type 'offset_waiver',
// points = offset points forgiven, actorId = the admin). Idempotent (D3.8): the
// caller supplies a stable idempotencyKey; @@unique([sourceEventId,'offset_waiver'])
// makes a replay a no-op (the offset is reduced exactly once).
const bodySchema = z.object({
  // Target by loyalty customer id OR by email (email is the loyalty key).
  customerId:     z.string().min(1).optional(),
  email:          z.string().email().optional(),
  // How many offset points to forgive (clamped to the current offset).
  amountPoints:   z.number().int().positive(),
  reason:         z.string().min(1).max(1000),
  // Stable idempotency key for this waiver operation (caller-supplied).
  idempotencyKey: z.string().min(1).max(200),
}).refine((b) => b.customerId || b.email, { message: 'customerId ou email requis' })

export async function POST(req: Request) {
  // Flag-gated rate limit (no-op when RATE_LIMIT_ENABLED off → byte-identical).
  const limited = rateLimit(req, 'admin_loyalty_waiver', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string; roles?: string[] } | undefined
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin || !user.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  const { customerId, email, amountPoints, reason, idempotencyKey } = parsed.data

  const lc = customerId
    ? await prisma.loyaltyCustomer.findUnique({ where: { id: customerId }, select: { id: true, recoveryOffsetPoints: true } })
    : email
      ? await prisma.loyaltyCustomer.findUnique({ where: { email }, select: { id: true, recoveryOffsetPoints: true } })
      : null
  if (!lc) return NextResponse.json({ error: 'Client fidélité introuvable.' }, { status: 404 })

  let waived = 0
  let alreadyApplied = false
  try {
    await prisma.$transaction(async (tx) => {
      // The keyed row FIRST — a replay (same idempotencyKey) throws P2002 and aborts
      // the whole waiver before the offset is touched → forgiven exactly once.
      const cur = await tx.loyaltyCustomer.findUnique({
        where: { id: lc.id }, select: { recoveryOffsetPoints: true },
      })
      waived = Math.min(Math.max(0, amountPoints), Math.max(0, cur?.recoveryOffsetPoints ?? 0))
      await tx.loyaltyTransaction.create({
        data: {
          customerId: lc.id, orderId: null, type: 'offset_waiver',
          points: waived, sourceEventId: idempotencyKey, actorId: user.id,
        },
      })
      if (waived > 0) {
        await tx.loyaltyCustomer.update({
          where: { id: lc.id }, data: { recoveryOffsetPoints: { decrement: waived } },
        })
      }
    })
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
      alreadyApplied = true // idempotent replay — the offset was already forgiven once
    } else {
      console.error('[loyalty waiver] failed:', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Échec du waiver.' }, { status: 500 })
    }
  }

  if (!alreadyApplied) {
    await recordAdminAudit({
      actorId:    user.id,
      actorEmail: session?.user?.email ?? null,
      action:     'loyalty.waiver',
      targetType: 'loyalty_customer',
      targetId:   lc.id,
      metadata:   { amountPointsRequested: amountPoints, waivedPoints: waived, reason, idempotencyKey },
      req,
    })
  }

  const after = await prisma.loyaltyCustomer.findUnique({
    where: { id: lc.id }, select: { recoveryOffsetPoints: true },
  })
  return NextResponse.json({
    ok: true,
    idempotentReplay: alreadyApplied,
    waivedPoints: alreadyApplied ? 0 : waived,
    remainingOffsetPoints: after?.recoveryOffsetPoints ?? 0,
  })
}
