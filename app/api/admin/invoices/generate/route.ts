import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { monthBounds, issueInvoice } from '@/lib/invoice'

// ── POST /api/admin/invoices/generate { month: "2026-06" } ────────────────────
// Rail A4. Issues the month's commission invoice for EVERY establishment whose
// ledger shows a levied commission (∑ applicationFeeAmount > 0) over the period.
// Totals come FROM LedgerEntry — never recomputed from rates. IDEMPOTENT: an
// invoice already issued for [restaurant, month] is returned as-is — no
// duplicate, no legal number burned (the gapless counter only moves inside the
// creation transaction). Same operator gate as /api/admin/ledger/check.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { role: true },
    })
    if (!operator || !['admin', 'restaurant'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'month requis (format YYYY-MM)' }, { status: 400 })
    }
    const bounds = monthBounds(parsed.data.month)
    if (!bounds) {
      return NextResponse.json({ error: 'Mois invalide (format YYYY-MM)' }, { status: 400 })
    }

    // One aggregate per establishment over the month, straight from the ledger.
    const groups = await prisma.ledgerEntry.groupBy({
      by:     ['restaurantId'],
      where:  { createdAt: { gte: bounds.periodStart, lt: bounds.periodEnd } },
      _sum:   { applicationFeeAmount: true },
      _count: { _all: true },
    })

    const invoices = []
    for (const g of groups) {
      const ttc = g._sum.applicationFeeAmount ?? 0
      if (ttc <= 0) continue // no commission levied → no invoice (free months, empreintes only)
      const inv = await issueInvoice({
        restaurantId: g.restaurantId,
        periodStart:  bounds.periodStart,
        periodEnd:    bounds.periodEnd,
        totalTtc:     ttc,
        entriesCount: g._count._all,
      })
      invoices.push({
        invoiceId:      inv.id,
        restaurantId:   inv.restaurantId,
        number:         inv.number,
        totalTtc:       inv.totalTtc,
        totalHt:        inv.totalHt,
        totalTva:       inv.totalTva,
        entriesCount:   inv.entriesCount,
        alreadyExisted: inv.alreadyExisted,
      })
    }

    return NextResponse.json({
      month: parsed.data.month,
      generated: invoices.filter(i => !i.alreadyExisted).length,
      alreadyExisted: invoices.filter(i => i.alreadyExisted).length,
      invoices,
    })
  } catch (err) {
    console.error('[invoices generate]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
