import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'

// ── GET /api/admin/ledger/check?from=&to= ─────────────────────────────────────
// THE incoherence detector n°1 (rail A3). Two verifications over a period
// (default: the last 7 days):
//   (a) INTERNAL — the golden equation, per line AND in aggregate:
//         grossAmount = applicationFeeAmount + netToRestaurant
//   (b) STRIPE RECONCILIATION — the count + gross sum of the ledger's money
//       lines ('payment' + 'deposit_capture') versus the REAL succeeded
//       PaymentIntents at Stripe over the same period.
// Response: { ok, internalOk, ledgerCount, stripeCount, ledgerSum, stripeSum,
//             ecarts: [...] } — ok:true only when everything matches.
// Operator-gated (admin or restaurant role): financial data, read-only.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const STRIPE_PAGE_CAP   = 1000 // hard cap on PIs fetched per check (test volumes)

export async function GET(req: Request) {
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

    const { searchParams } = new URL(req.url)
    const toParam   = searchParams.get('to')
    const fromParam = searchParams.get('from')
    const to   = toParam   ? new Date(toParam)   : new Date()
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - DEFAULT_WINDOW_MS)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return NextResponse.json({ error: 'Période invalide (from/to ISO, from < to)' }, { status: 400 })
    }

    const ecarts: Array<Record<string, unknown>> = []

    // ── (a) INTERNAL — golden equation over ALL lines of the period ────────────
    const lines = await prisma.ledgerEntry.findMany({
      where:  { createdAt: { gte: from, lte: to } },
      select: {
        id: true, type: true, grossAmount: true, applicationFeeAmount: true,
        netToRestaurant: true, stripePaymentIntentId: true,
      },
    })
    for (const l of lines) {
      if (l.grossAmount !== l.applicationFeeAmount + l.netToRestaurant) {
        ecarts.push({
          kind: 'internal_equation', ledgerId: l.id, type: l.type,
          gross: l.grossAmount, fee: l.applicationFeeAmount, net: l.netToRestaurant,
        })
      }
    }
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const aggGross = sum(lines.map(l => l.grossAmount))
    const aggFee   = sum(lines.map(l => l.applicationFeeAmount))
    const aggNet   = sum(lines.map(l => l.netToRestaurant))
    const internalOk = ecarts.length === 0 && aggGross === aggFee + aggNet

    // ── (b) STRIPE RECONCILIATION — money lines vs real succeeded PIs ──────────
    const moneyLines = lines.filter(l => l.type === 'payment' || l.type === 'deposit_capture')
    const stripePIs: Stripe.PaymentIntent[] = await getStripe().paymentIntents
      .list({
        created: { gte: Math.floor(from.getTime() / 1000), lte: Math.ceil(to.getTime() / 1000) },
        limit:   100,
      })
      .autoPagingToArray({ limit: STRIPE_PAGE_CAP })
    const succeeded = stripePIs.filter(p => p.status === 'succeeded')

    const ledgerCount = moneyLines.length
    const stripeCount = succeeded.length
    const ledgerSum   = sum(moneyLines.map(l => l.grossAmount))
    const stripeSum   = sum(succeeded.map(p => p.amount_received ?? 0))

    // A succeeded PI with NO ledger line ANYWHERE (not just in range — webhook
    // lag can put the line slightly after the PI's created date) = a real miss.
    const piIds = succeeded.map(p => p.id)
    const knownLines = piIds.length
      ? await prisma.ledgerEntry.findMany({
          where:  { stripePaymentIntentId: { in: piIds } },
          select: { stripePaymentIntentId: true },
        })
      : []
    const known = new Set(knownLines.map(l => l.stripePaymentIntentId))
    for (const p of succeeded) {
      if (!known.has(p.id)) {
        ecarts.push({ kind: 'missing_in_ledger', stripePaymentIntentId: p.id, amount: p.amount_received ?? 0 })
      }
    }
    // A range ledger line whose PI is not in the range's Stripe list: edge
    // effect (PI created just outside the window) or a real anomaly — surfaced.
    const stripeIdSet = new Set(piIds)
    for (const l of moneyLines) {
      if (l.stripePaymentIntentId && !stripeIdSet.has(l.stripePaymentIntentId)) {
        ecarts.push({ kind: 'not_in_stripe_window', ledgerId: l.id, stripePaymentIntentId: l.stripePaymentIntentId })
      }
    }

    const reconciliationOk = ecarts.every(e => e.kind === 'not_in_stripe_window') &&
      ledgerCount >= stripeCount && internalOk

    // ── (c) REFUNDS reconciliation (A5) — negative 'refund' lines vs the REAL
    //     succeeded Stripe refunds of the window. The internal equation already
    //     holds with negatives (gross = fee + net line-by-line above); here we
    //     verify nothing given back at Stripe is missing from the ledger.
    const refundLines = lines.filter(l => l.type === 'refund')
    let refunds: {
      ledgerCount: number; stripeCount: number
      ledgerSum: number; stripeSum: number; checked: boolean
    } = { ledgerCount: refundLines.length, stripeCount: 0, ledgerSum: sum(refundLines.map(l => l.grossAmount)), stripeSum: 0, checked: false }
    try {
      const stripeRefunds = await getStripe().refunds
        .list({
          created: { gte: Math.floor(from.getTime() / 1000), lte: Math.ceil(to.getTime() / 1000) },
          limit:   100,
        })
        .autoPagingToArray({ limit: STRIPE_PAGE_CAP })
      const succeededRefunds = stripeRefunds.filter(r => r.status === 'succeeded')
      refunds = {
        ...refunds,
        stripeCount: succeededRefunds.length,
        // Ledger refund gross is NEGATIVE; Stripe amounts are positive → compare on -sum.
        stripeSum:   -sum(succeededRefunds.map(r => r.amount)),
        checked:     true,
      }
      const refundIds = succeededRefunds.map(r => r.id)
      const knownRefunds = refundIds.length
        ? await prisma.ledgerEntry.findMany({
            where:  { sourceEventId: { in: refundIds }, type: 'refund' },
            select: { sourceEventId: true },
          })
        : []
      const knownRefundIds = new Set(knownRefunds.map(l => l.sourceEventId))
      for (const r of succeededRefunds) {
        if (!knownRefundIds.has(r.id)) {
          ecarts.push({ kind: 'missing_refund_in_ledger', stripeRefundId: r.id, amount: r.amount })
        }
      }
    } catch (e) {
      // Refunds listing unavailable → surfaced, not fatal (noted for A6).
      console.warn('[ledger check] refunds reconciliation unavailable:', e instanceof Error ? e.message : e)
    }

    const refundsOk = !refunds.checked ||
      (refunds.ledgerSum === refunds.stripeSum && !ecarts.some(e => e.kind === 'missing_refund_in_ledger'))

    return NextResponse.json({
      ok: internalOk && ecarts.length === 0 && ledgerCount === stripeCount && ledgerSum === stripeSum && refundsOk,
      internalOk,
      reconciliationOk,
      refundsOk,
      from: from.toISOString(), to: to.toISOString(),
      ledgerCount, stripeCount, ledgerSum, stripeSum,
      refunds,
      aggregates: { gross: aggGross, applicationFee: aggFee, netToRestaurant: aggNet },
      ecarts,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'stripe_not_configured') {
      return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
    }
    console.error('[ledger check]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
