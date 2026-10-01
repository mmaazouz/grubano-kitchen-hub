import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles } from '@/lib/creator-roles'
import { authOptions } from '@/lib/auth'
import { PAYOUT_THRESHOLD_CENTS } from '@/lib/creator-earnings'
import { isCreatorEnabled } from '@/lib/creator-account'

// ── GET /api/creator/earnings?page=N ──────────────────────────────────────────
// B2a — THE contract the creator dashboard (B1, Agent 13) consumes. CREATOR
// session required (same identity pattern as /api/creators/home: the session
// user's email resolves the Creator row). ALL AMOUNTS IN INTEGER CENTS.
//
// Totals aggregate BOTH gain pipes (referral orders + adopted-dish sales) by
// lifecycle status (pending → matured → paid; cancelled shown for honesty).
// progressPct measures matured money against the B0 payout threshold (20 €).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const cents = (eur: number) => Math.round(eur * 100)

export async function GET(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, referralCode: true, referralLinkSlug: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)

    const referralWhere = { referral: { creatorId: creator.id } }
    const dishSaleWhere = { adoption: { creatorDish: { creatorId: creator.id } } }

    const [refOrders, refTotal, refAll, salesAll, salesRecent] = await Promise.all([
      // Paginated referred orders (newest first) for the list.
      prisma.referralOrder.findMany({
        where:   referralWhere,
        orderBy: { createdAt: 'desc' },
        skip:    (page - 1) * PAGE_SIZE,
        take:    PAGE_SIZE,
        select: {
          id: true, createdAt: true, status: true, maturedAt: true,
          grubanoFee: true, creatorEarning: true, newCustomerBonus: true,
          order: {
            select: {
              total: true, createdAt: true,
              restaurant: { select: { name: true } },
            },
          },
        },
      }),
      prisma.referralOrder.count({ where: referralWhere }),
      // Full referral rows for the totals (test volumes — fine; revisit at scale).
      prisma.referralOrder.findMany({
        where:  referralWhere,
        select: { status: true, creatorEarning: true, newCustomerBonus: true },
      }),
      prisma.dishSale.findMany({
        where:  dishSaleWhere,
        select: { status: true, creatorEarning: true },
      }),
      // Recent adoption sale lines for the list.
      prisma.dishSale.findMany({
        where:   dishSaleWhere,
        orderBy: { createdAt: 'desc' },
        take:    PAGE_SIZE,
        select: {
          id: true, createdAt: true, status: true, maturedAt: true,
          amount: true, creatorEarning: true, rateApplied: true,
          adoption: { select: { creatorDish: { select: { name: true } }, brand: { select: { name: true } } } },
        },
      }),
    ])

    // ── Role flags (Mission 2) — tolerant read, both true pre-migration ──────
    const roles = await readCreatorRoles(creator.id)

    // Totals per lifecycle status, ACTIVE pipes only (Mission 2: a disabled
    // role's pipe is excluded from the DISPLAYED totals — its rows stay in DB
    // untouched, B2b pays from rows, never from this aggregate), in cents.
    // With the default-true flags this matches the previous both-pipes sum.
    const totals = { pendingCents: 0, maturedCents: 0, paidCents: 0, cancelledCents: 0 }
    const addTo = (status: string, amountCents: number) => {
      if (status === 'pending')        totals.pendingCents   += amountCents
      else if (status === 'matured')   totals.maturedCents   += amountCents
      else if (status === 'paid')      totals.paidCents      += amountCents
      else if (status === 'cancelled') totals.cancelledCents += amountCents
    }
    if (roles.isInfluencer) for (const r of refAll)   addTo(r.status, cents(r.creatorEarning) + cents(r.newCustomerBonus))
    if (roles.isChef)       for (const s of salesAll) addTo(s.status, cents(s.creatorEarning))

    const progressPct = Math.min(
      100, Math.round((totals.maturedCents / PAYOUT_THRESHOLD_CENTS) * 100),
    )

    return NextResponse.json({
      // Mission 2 — drives the studio's conditional sections + share kits.
      roles,
      code: creator.referralCode,
      // C3-fix (B1-bis report): /ref/<slug> is the REAL tracked-link route — the
      // contract previously fabricated a dead "/r/<slug>" path.
      link: creator.referralLinkSlug ? `/ref/${creator.referralLinkSlug}` : null,
      totals: {
        ...totals,
        thresholdCents: PAYOUT_THRESHOLD_CENTS,
        progressPct,
      },
      orders: refOrders.map(o => ({
        id:                  o.id,
        date:                (o.order?.createdAt ?? o.createdAt).toISOString(),
        restaurant:          o.order?.restaurant?.name ?? null,
        orderTotalCents:     o.order ? cents(o.order.total) : null,
        grubanoFeeCents:     cents(o.grubanoFee),
        creatorEarningCents: cents(o.creatorEarning),
        bonusCents:          cents(o.newCustomerBonus),
        status:              o.status,
        maturedAt:           o.maturedAt?.toISOString() ?? null,
      })),
      ordersPage:     page,
      ordersPageSize: PAGE_SIZE,
      ordersTotal:    refTotal,
      ordersHasMore:  page * PAGE_SIZE < refTotal,
      adoptions: salesRecent.map(s => ({
        id:                  s.id,
        date:                s.createdAt.toISOString(),
        dishName:            s.adoption?.creatorDish?.name ?? null,
        brandName:           s.adoption?.brand?.name ?? null,
        saleAmountCents:     cents(s.amount),
        creatorEarningCents: cents(s.creatorEarning),
        rateApplied:         s.rateApplied,
        status:              s.status,
        maturedAt:           s.maturedAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    console.error('[GET /api/creator/earnings]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
