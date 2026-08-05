import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { safeEqual } from '@/lib/safe-compare'
import { isClaimsEnabled } from '@/lib/claims'
import { sendAdminStaleClaimAlert } from '@/lib/admin-alerts'

// ── GET /api/admin/claims/stale-alerts — P0-39 (vague 3) ───────────────────────
// READ-ONLY sweep (patron exact de /api/admin/reconcile-ghost-orders) : liste les
// réclamations encore en 'restaurant_review' dont responseDeadlineAt est dépassé,
// et lève UNE alerte admin idempotente PAR réclamation (sendOnce admin_stale_claim
// / claim:<id> — rejouable chaque jour sans rappel en boucle). AUCUNE action
// automatique, AUCUNE transition, AUCUN argent (Q3). Auth : X-Internal-Token
// (cron `daily`) OU session ADMIN.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const limited = rateLimit(req, 'admin_claims_stale', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  if (!isClaimsEnabled()) return NextResponse.json({ enabled: false })

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

    const now = new Date()
    // Index [status, responseDeadlineAt] — la même forme de WHERE que le sweep
    // auto-approve retiré, mais en LECTURE + alerte, jamais en décision.
    const overdue = await prisma.claim.findMany({
      where:   { status: 'restaurant_review', responseDeadlineAt: { lt: now } },
      select:  { id: true, orderId: true, requestedAmountCents: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take:    200,
    })

    let alerted = 0
    for (const claim of overdue) {
      const ageHours = (now.getTime() - claim.createdAt.getTime()) / 3_600_000
      const r = await sendAdminStaleClaimAlert({
        claimId:              claim.id,
        orderId:              claim.orderId,
        requestedAmountCents: claim.requestedAmountCents,
        ageHours,
      })
      if (r.status === 'sent') alerted++
    }

    console.log('[claims stale-alerts] [P0-39]', JSON.stringify({ overdue: overdue.length, alerted }))
    return NextResponse.json({ ok: true, overdue: overdue.length, alerted })
  } catch (err) {
    console.error('[GET /api/admin/claims/stale-alerts]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
