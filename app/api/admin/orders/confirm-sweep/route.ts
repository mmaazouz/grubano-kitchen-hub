import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { safeEqual } from '@/lib/safe-compare'
import { sweepUnconfirmedPaidOrders } from '@/lib/order-email-sweep'

// ── POST /api/admin/orders/confirm-sweep — P0-42 (vague 2) ─────────────────────
// Rattrapage SERVEUR des confirmations de commande (order_confirmation +
// resto_order_received) pour les commandes PAYÉES dont l'onglet client a été
// fermé avant le webhook (les seuls appelants de /confirm sont deux pages qui
// pollent — dépendance navigateur constatée en exécution). Idempotent de bout
// en bout (sendOnce, mêmes triggers + dedupeKey que /confirm) → rejouable sans
// doublon. Le webhook Stripe, lui, n'envoie TOUJOURS aucun email (règle d'or).
// Auth : calque exact de /api/admin/ledger/check (A6) — X-Internal-Token pour
// le cron (groupe `sweep`, toutes les 20 min = délai borné), sinon session
// ADMIN. Fenêtre/lot bornés dans la lib (48 h / 100 par passage).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const limited = rateLimit(req, 'orders_confirm_sweep', { limitDefault: 10, windowDefault: 60 })
  if (limited) return limited

  try {
    const internalToken    = req.headers.get('x-internal-token')
    const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
    const isInternal =
      internalExpected.length > 0 &&
      typeof internalToken === 'string' &&
      safeEqual(internalToken, internalExpected)

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

    const result = await sweepUnconfirmedPaidOrders()
    console.log('[order-email-sweep] [P0-42]', JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[POST /api/admin/orders/confirm-sweep]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
