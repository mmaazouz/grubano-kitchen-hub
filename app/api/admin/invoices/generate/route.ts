import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { monthBounds, issueInvoice } from '@/lib/invoice'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit, CRON_ACTOR_ID } from '@/lib/admin-audit'
import { safeEqual } from '@/lib/safe-compare'

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
  // Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_invoices_generate', { limitDefault: 20, windowDefault: 60 })
  if (limited) return limited

  try {
    // ── Auth (A6, ADDITIVE machine access — same shape as /ledger/check) ──────
    // The monthly invoice cron (scripts/cron/monthly-invoices.js) calls this
    // endpoint with a fixed-string X-Internal-Token header. Same security model
    // as /ledger/check: only opens when INTERNAL_CRON_TOKEN is set AND the
    // header matches exactly; otherwise the original operator session gate
    // (admin / restaurant) applies unchanged.
    const internalToken    = req.headers.get('x-internal-token')
    const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
    const isInternal =
      internalExpected.length > 0 &&
      typeof internalToken === 'string' &&
      safeEqual(internalToken, internalExpected) // ADM7: constant-time

    let actorId = CRON_ACTOR_ID
    let actorEmail: string | null = null
    if (!isInternal) {
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
      }
      const operator = await prisma.operator.findUnique({
        where:  { email: session.user.email },
        select: { id: true, role: true },
      })
      // 🔒 SEC: ADMIN ONLY. Generating invoices aggregates PLATFORM-WIDE commission
      // financials (no per-tenant scoping) AND issues gapless legal invoice numbers
      // for every establishment — a non-admin 'restaurant' operator must never read
      // other tenants' money nor mutate their invoice ledger. Matches the admin-only
      // gate of the sibling money endpoints.
      if (!operator || operator.role !== 'admin') {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
      actorId = operator.id
      actorEmail = session.user.email
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

    // P4.4-A — VAT-rate country per establishment (its operator's country, @default 'FR').
    // All FR today → rate 0.20 → byte-identical splits. Batched to avoid N queries.
    const restaurantIds = groups.map((g) => g.restaurantId)
    const restos = restaurantIds.length
      ? await prisma.restaurant.findMany({
          where:  { id: { in: restaurantIds } },
          select: { id: true, operator: { select: { country: true } } },
        })
      : []
    const countryByRestaurant = new Map(restos.map((r) => [r.id, r.operator?.country ?? 'FR']))

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
        country:      countryByRestaurant.get(g.restaurantId) ?? 'FR',
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

    await recordAdminAudit({
      actorId, actorEmail,
      action:     'invoice.generate',
      targetType: 'invoice',
      targetId:   null,
      metadata:   { month: parsed.data.month, generated: invoices.filter(i => !i.alreadyExisted).length },
      req,
    })

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
