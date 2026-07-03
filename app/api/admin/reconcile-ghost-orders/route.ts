import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendAdminReconcileDigest } from '@/lib/admin-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/reconcile-ghost-orders (WP-OPS-01 bonus) ────────────────────
// READ-ONLY reconciliation sweep. Lists orders that need a human money decision:
// an order lazily EXPIRED (status 'expired') that was nonetheless captured —
// paymentStatus 'paid' (the WP-MONEY-01 mid-reconcile crash-window residual) OR
// 'reconcile_manual' (explicitly flagged, REFUNDS off). NO money action whatsoever:
// a findMany + a best-effort admin digest. Auth mirrors the cron routes:
// X-Internal-Token === INTERNAL_CRON_TOKEN, OR an admin session. Idempotent.
export async function GET(req: Request) {
  const internalToken    = req.headers.get('x-internal-token')
  const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  const isInternal =
    internalExpected.length > 0 &&
    typeof internalToken === 'string' &&
    internalToken === internalExpected

  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { role: true },
    })
    if (!operator || operator.role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  }

  try {
    const orders = await prisma.order.findMany({
      where:   { status: 'expired', paymentStatus: { in: ['paid', 'reconcile_manual'] } },
      select:  { id: true, paymentStatus: true, total: true, restaurantId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    200,
    })

    if (orders.length > 0) {
      // Best-effort daily digest — never blocks the read (no money action here).
      await sendAdminReconcileDigest({
        count:          orders.length,
        sampleOrderIds: orders.slice(0, 10).map((o) => o.id),
        dayKey:         new Date().toISOString().slice(0, 10),
      }).catch(() => { /* best-effort */ })
    }

    return NextResponse.json({ ok: true, count: orders.length, orders })
  } catch (err) {
    console.error('[reconcile-ghost-orders]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
