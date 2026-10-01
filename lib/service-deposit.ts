// lib/service-deposit.ts — SERVICES deposit (acompte) split engine (PURE, P8c, Agent 83).
//
// A prestataire may attach an optional DEPOSIT percentage to a quote. The restaurant then pays
// the deposit at ACCEPTANCE and the BALANCE at completion. This module decides, server-side, how
// the agreed quote splits into (deposit, balance) and how the 5% Grubano commission splits across
// the two destination-charges. It is PURE (no I/O, no Stripe, NO money movement) and re-uses the
// P6 commission engine (lib/service-pricing) read-only — it NEVER recomputes the 5% differently.
//
// ── CARDINAL INVARIANTS (proven by a property test, for ANY quote × ANY pct) ───
//   depositCents + balanceCents     === quoteCents                                  (no cent created/lost)
//   depositFeeCents + balanceFeeCents === computeServiceEconomics(quote).grubanoMarginCents (5% of the WHOLE quote)
// The BALANCE is DERIVED as the remainder (quote − deposit); the BALANCE FEE is DERIVED as
// (totalFee − depositFee) so the two charges' application_fees re-add to the commission on the
// whole quote EXACTLY — the balance absorbs every rounding cent. Both fees are ≥ 0 and ≤ their charge.
//
// ── EQUIVALENCE WITH P8 (no-deposit) ───────────────────────────────────────────
//   depositPct = 0  ⇒  depositCents = 0, balanceCents = quote, depositFee = 0, balanceFee = totalFee.
// So a quote with no deposit charges the FULL quote with the FULL fee at completion — exactly P8.

import { computeServiceEconomics, SERVICE_COMMISSION_RATE } from '@/lib/service-pricing'

export interface DepositSplit {
  quoteCents:      number  // the agreed quote (server, integer cents)
  depositPct:      number  // the deposit percentage, clamped to [0, 100]
  depositCents:    number  // round(quote × pct / 100) — paid at acceptance
  balanceCents:    number  // quote − deposit (DERIVED) — paid at completion
  totalFeeCents:   number  // computeServiceEconomics(quote).grubanoMarginCents — 5% of the WHOLE quote
  depositFeeCents: number  // round(deposit × 5%) — the application_fee on the deposit charge
  balanceFeeCents: number  // totalFee − depositFee (DERIVED) — the application_fee on the balance charge
}

/** Split a quote into a deposit + a balance with their application_fees. PURE; integer cents.
 *  Negative / non-finite inputs collapse to 0; pct is clamped to [0, 100]. The balance and the
 *  balance fee are DERIVED (never recomputed independently) so the invariants hold exactly. */
export function computeDepositSplit(quoteCents: number, depositPct: number): DepositSplit {
  const quote = Math.max(0, Math.round(Number.isFinite(quoteCents) ? quoteCents : 0))
  const pct   = Math.min(100, Math.max(0, Math.round(Number.isFinite(depositPct) ? depositPct : 0)))

  const totalFeeCents   = computeServiceEconomics(quote).grubanoMarginCents // 5% of the whole quote (P6)
  const depositCents     = Math.round(quote * pct / 100)
  const balanceCents      = quote - depositCents                            // DERIVED → no cent lost
  const depositFeeCents   = Math.round(depositCents * SERVICE_COMMISSION_RATE)
  const balanceFeeCents   = totalFeeCents - depositFeeCents                  // DERIVED → absorbs rounding

  return { quoteCents: quote, depositPct: pct, depositCents, balanceCents, totalFeeCents, depositFeeCents, balanceFeeCents }
}

/** True iff a deposit applies (pct > 0). A clamped/zero pct means « no deposit » (the P8 path). */
export function hasDeposit(depositPct: number): boolean {
  return Math.min(100, Math.max(0, Math.round(Number.isFinite(depositPct) ? depositPct : 0))) > 0
}
