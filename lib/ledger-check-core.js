'use strict'
/* ─────────────────────────────────────────────────────────────────────────────
   lib/ledger-check-core.js — THE ledger reconciliation (rail A3 / A5), PURE of any
   HTTP concern. Plain CommonJS on purpose: it is the SINGLE implementation used by
     • the HTTP route  app/api/admin/ledger/check/route.ts  (auth wrapper + dates → this),
     • the server-side READ-ONLY operator  scripts/server/phase2-preflight.js  (direct
       reconciliation against the staging DB + Stripe TEST when the HTTP wrapper's
       auth layer is the only thing standing between us and the financial proof).
   Shipped to the server by the deploy (deploy-temp/lib/). No auth, no env read, no
   write of any kind: it only READS prisma + stripe and returns the verdict object.

   Semantics are the route's, unchanged (extracted 2026-09-05, Phase 2 final preflight):
     (a) INTERNAL  — golden equation per line AND in aggregate over the window:
                     grossAmount = applicationFeeAmount + netToRestaurant
     (b) STRIPE    — ledger money lines ('payment' + 'deposit_capture') vs the REAL
                     succeeded PaymentIntents created in the window (count + gross sum);
                     a succeeded PI with NO ledger line ANYWHERE = missing_in_ledger;
                     a window money line whose PI is not in the window's Stripe list =
                     not_in_stripe_window (surfaced, tolerated for reconciliationOk).
     (c) REFUNDS   — negative 'refund' lines vs the REAL succeeded Stripe refunds of the
                     window (sum compared on -Σ; a succeeded refund without a 'refund'
                     line keyed by its id = missing_refund_in_ledger). Listing failure →
                     checked:false (surfaced, not fatal — A6).
     ok = internalOk && no ecart && ledgerCount === stripeCount && ledgerSum === stripeSum && refundsOk
   ───────────────────────────────────────────────────────────────────────────── */

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const STRIPE_PAGE_CAP = 1000 // hard cap on Stripe objects fetched per check (test volumes)

const sum = (xs) => xs.reduce((a, b) => a + b, 0)

/** Resolve the window from optional ISO strings. Returns { from, to } or { error }. */
function resolveWindow(fromParam, toParam, now) {
  const to = toParam ? new Date(toParam) : (now || new Date())
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - DEFAULT_WINDOW_MS)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return { error: 'Période invalide (from/to ISO, from < to)' }
  }
  return { from, to }
}

/**
 * Run the reconciliation. READ-ONLY.
 * @param {{ prisma: any, stripe: any, from: Date, to: Date, warn?: (msg: string) => void }} p
 */
async function reconcileLedger(p) {
  const { prisma, stripe, from, to } = p
  const warn = p.warn || ((m) => console.warn(m))
  const ecarts = []

  // ── (a) INTERNAL — golden equation over ALL lines of the period ────────────
  const lines = await prisma.ledgerEntry.findMany({
    where: { createdAt: { gte: from, lte: to } },
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
  const aggGross = sum(lines.map((l) => l.grossAmount))
  const aggFee = sum(lines.map((l) => l.applicationFeeAmount))
  const aggNet = sum(lines.map((l) => l.netToRestaurant))
  const internalOk = ecarts.length === 0 && aggGross === aggFee + aggNet

  // ── (b) STRIPE RECONCILIATION — money lines vs real succeeded PIs ──────────
  const moneyLines = lines.filter((l) => l.type === 'payment' || l.type === 'deposit_capture')
  const stripePIs = await stripe.paymentIntents
    .list({
      created: { gte: Math.floor(from.getTime() / 1000), lte: Math.ceil(to.getTime() / 1000) },
      limit: 100,
    })
    .autoPagingToArray({ limit: STRIPE_PAGE_CAP })
  const succeeded = stripePIs.filter((pi) => pi.status === 'succeeded')

  const ledgerCount = moneyLines.length
  const stripeCount = succeeded.length
  const ledgerSum = sum(moneyLines.map((l) => l.grossAmount))
  const stripeSum = sum(succeeded.map((pi) => pi.amount_received ?? 0))

  const piIds = succeeded.map((pi) => pi.id)
  const knownLines = piIds.length
    ? await prisma.ledgerEntry.findMany({
        where: { stripePaymentIntentId: { in: piIds } },
        select: { stripePaymentIntentId: true },
      })
    : []
  const known = new Set(knownLines.map((l) => l.stripePaymentIntentId))
  for (const pi of succeeded) {
    if (!known.has(pi.id)) {
      ecarts.push({ kind: 'missing_in_ledger', stripePaymentIntentId: pi.id, amount: pi.amount_received ?? 0 })
    }
  }
  const stripeIdSet = new Set(piIds)
  for (const l of moneyLines) {
    if (l.stripePaymentIntentId && !stripeIdSet.has(l.stripePaymentIntentId)) {
      ecarts.push({ kind: 'not_in_stripe_window', ledgerId: l.id, stripePaymentIntentId: l.stripePaymentIntentId })
    }
  }

  const reconciliationOk = ecarts.every((e) => e.kind === 'not_in_stripe_window') &&
    ledgerCount >= stripeCount && internalOk

  // ── (c) REFUNDS reconciliation (A5) ────────────────────────────────────────
  const refundLines = lines.filter((l) => l.type === 'refund')
  let refunds = {
    ledgerCount: refundLines.length, stripeCount: 0,
    ledgerSum: sum(refundLines.map((l) => l.grossAmount)), stripeSum: 0, checked: false,
  }
  try {
    const stripeRefunds = await stripe.refunds
      .list({
        created: { gte: Math.floor(from.getTime() / 1000), lte: Math.ceil(to.getTime() / 1000) },
        limit: 100,
      })
      .autoPagingToArray({ limit: STRIPE_PAGE_CAP })
    const succeededRefunds = stripeRefunds.filter((r) => r.status === 'succeeded')
    refunds = {
      ...refunds,
      stripeCount: succeededRefunds.length,
      // Ledger refund gross is NEGATIVE; Stripe amounts are positive → compare on -sum.
      stripeSum: -sum(succeededRefunds.map((r) => r.amount)),
      checked: true,
    }
    const refundIds = succeededRefunds.map((r) => r.id)
    const knownRefunds = refundIds.length
      ? await prisma.ledgerEntry.findMany({
          where: { sourceEventId: { in: refundIds }, type: 'refund' },
          select: { sourceEventId: true },
        })
      : []
    const knownRefundIds = new Set(knownRefunds.map((l) => l.sourceEventId))
    for (const r of succeededRefunds) {
      if (!knownRefundIds.has(r.id)) {
        ecarts.push({ kind: 'missing_refund_in_ledger', stripeRefundId: r.id, amount: r.amount })
      }
    }
  } catch (e) {
    // Refunds listing unavailable → surfaced, not fatal (noted for A6).
    warn('[ledger check] refunds reconciliation unavailable: ' + (e instanceof Error ? e.message : String(e)))
  }

  const refundsOk = !refunds.checked ||
    (refunds.ledgerSum === refunds.stripeSum && !ecarts.some((e) => e.kind === 'missing_refund_in_ledger'))

  return {
    ok: internalOk && ecarts.length === 0 && ledgerCount === stripeCount && ledgerSum === stripeSum && refundsOk,
    internalOk,
    reconciliationOk,
    refundsOk,
    from: from.toISOString(), to: to.toISOString(),
    ledgerCount, stripeCount, ledgerSum, stripeSum,
    refunds,
    aggregates: { gross: aggGross, applicationFee: aggFee, netToRestaurant: aggNet },
    ecarts,
  }
}

module.exports = { reconcileLedger, resolveWindow, DEFAULT_WINDOW_MS, STRIPE_PAGE_CAP }
