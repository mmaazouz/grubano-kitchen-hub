// lib/claim-financial-effect.ts — D′ L8 (T-46): WHAT A REFUND ACTUALLY DID, FROM LEDGER TRUTH ONLY.
//
// THE DEFECT THIS FILE CLOSES. A restaurant could see that a claim had been "remboursée" and never learn
// what it cost them. The figures that would have been easiest to show are the WRONG ones: `Refund`
// carries `restaurantReverseCents` and `applicationFeeRefundCents`, which are PREDICTIONS made before
// Stripe answered — lib/refund.ts logs `[MONEY REVIEW] [fee_prediction_mismatch]` when they differ from
// what Stripe really did, and it never rewrites them. Showing a restaurateur a predicted give-back as
// their net impact would be inventing money movement on their own P&L.
//
// THE ONE SOURCE. Spec v2 §6.5 / invariant S-19: the block is read from the ledger line of the Stripe
// refund itself — `LedgerEntry { type: 'refund', sourceEventId: <re_…> }`, written from Stripe truth by
// lib/refund.ts (eager, only on exact fee truth) or by the `charge.refunded` webhook (backstop), and
// deduplicated by `@@unique([sourceEventId, type])` so at most ONE line exists per refund. No ledger
// line ⇒ no figures at all (`ledger_line_missing`), never a reconstruction of "what should have
// happened". This module therefore makes no arithmetic of its own beyond reading three stored integers.
//
// THE DERIVATIONS (spec v2 §6.5), and ONE LABEL CORRECTED:
//   customer refund        = −grossAmount            (the line stores the give-back as negative)
//   Grubano FEE returned   = −applicationFeeAmount
//   restaurant net impact  =  netToRestaurant        (negative = borne by the restaurant)
//
// §6.5 calls the middle figure « commission restituée ». IT IS NOT THE COMMISSION, and shipping that word
// would be false on a large class of orders. `application_fee_amount` is COMPOSED at payment time
// (app/api/orders/[id]/pay): the commission from lib/commission, MINUS the loyalty credit Grubano absorbs,
// PLUS the small-order fee, PLUS the franchise royalty held back for the franchisor, PLUS the courier tip,
// PLUS the whole delivery fee when the order is carried by a Grubano courier. A restaurateur reading
// « commission Grubano restituée : 3,40 € » on an order whose fee carried a 2,00 € courier tip would be
// told their commission was four times what it is. So the field is named for what it holds — the whole
// Grubano-side fee give-back — and the user-visible copy says « frais Grubano restitués ». The integer is
// unchanged and still the spec's; only the word that would have been false is.
//
// WHY THERE IS A COHERENCE GUARD, AND WHY IT IS NOT AN ESTIMATE. The three integers above are always
// ledger truth, but a SHAPE they can take is not describable by any honest label. The writer computes
//     applicationFeeAmount = −(refund − reversal + feeBack)
//     netToRestaurant      = −(reversal − feeBack)
// so −applicationFeeAmount is Grubano's whole share of the give-back: the fee it refunded PLUS anything it
// ABSORBED because no transfer reversal pulled the money back from the restaurant. When nothing was
// reversed (the `refund_without_reverse_transfer` case the money rails already alert on),
// −applicationFeeAmount reaches the WHOLE refund while `netToRestaurant` goes POSITIVE — a refund that
// appears to CREDIT the restaurant. No wording rescues that; it is a defect upstream, and the honest
// answer downstream is to report the effect as not confirmed and let the money-review alert do its work.
//
// So a line that cannot support the labels is reported as NOT CONFIRMED with a reason, and nothing is
// shown — which is what spec §8 and case F ask for ("review/unavailable, pas d'estimation"). Failing
// closed here costs a restaurant one line of explanation; failing open tells them a number about their
// own money that is not true.
//
// WHAT THIS MODULE NEVER DOES: no Stripe call, no Prisma access, no pro-rata, no fallback on `Refund`
// fields, no "expected" figure. It is a pure function of integers a caller already read, so the rule
// can be tested exhaustively and cannot acquire a database or a network dependency by accident.

/** Why no confirmed figures are available. Each value is a state of the EVIDENCE, never a guess. */
export type FinancialEffectUnconfirmedReason =
  /** No refund is bound to this claim at all — nothing has moved, so there is nothing to report. */
  | 'no_refund_bound'
  /** A refund row exists but Stripe has not settled it: pending, failed or canceled. */
  | 'refund_not_succeeded'
  /** Settled, but the row carries no `re_…`, so the ledger line cannot be identified. */
  | 'refund_id_unknown'
  /** The `re_…` is known and no ledger line exists for it (spec §6.5 `ledger_line_missing`). */
  | 'ledger_line_missing'
  /**
   * More than one candidate line, or a claim bound to a row another claim also binds: the association
   * is ambiguous, and an ambiguous association is not a number (spec case F).
   */
  | 'ledger_ambiguous'
  /**
   * A line exists but its integers cannot carry the labels — the golden equation fails, a sign is
   * impossible, or the fee it implies exceeds what was ever charged. Reported, never rounded off.
   */
  | 'ledger_inconsistent'
  /**
   * OUR OWN RECORDS say the money truth of this claim is open: `Claim.refundError` is set. That column is
   * where the engine, the webhook and the reconciliation write what they could not establish — a
   * DISOWNED binding (`resume_mismatch`, the engine saying « that row is not this claim's »), a refund
   * REVERTED at Stripe after settlement, a dead engine row, an unbound identity. While it is set the
   * customer reads « vérification manuelle »; the restaurant gets no figures, for the same reason.
   */
  | 'claim_money_state_open'

export type ClaimFinancialEffect =
  | {
      confirmed: true
      /** Cents actually returned to the customer by this refund. */
      customerRefundCents: number
      /**
       * Cents of the GRUBANO-SIDE FEE given back with it — `−applicationFeeAmount`. Not the commission
       * alone: the application fee is composed (commission − loyalty credit + small-order fee + franchise
       * royalty + courier tip + withheld delivery fee), so the copy says « frais », never « commission ».
       */
      grubanoFeeReturnedCents: number
      /** Signed cents on the restaurant's own account: negative = borne by the restaurant. */
      restaurantNetImpactCents: number
      /** The only value this field may ever take. It names the evidence, not the computation. */
      source: 'ledger'
    }
  | { confirmed: false; reason: FinancialEffectUnconfirmedReason }

/** The three integers of a `type:'refund'` ledger line, as stored. */
export interface RefundLedgerFacts {
  grossAmount: number
  applicationFeeAmount: number
  netToRestaurant: number
}

export interface FinancialEffectInput {
  /** The refund row's status, verbatim. Anything but 'succeeded' yields no figures. */
  refundStatus?: string | null
  /** The Stripe refund id on that row. Absent ⇒ the ledger line cannot be identified. */
  stripeRefundId?: string | null
  /** Whether a refund is bound to the claim at all. */
  bound: boolean
  /** True when the bound row is also bound by another claim — ambiguous by construction. */
  ambiguousBinding?: boolean
  /**
   * True when `Claim.refundError` is set: our own records say the money truth is open. The caller passes
   * the FACT, not the text — no marker string ever enters this module, so none can leave it.
   */
  moneyTruthOpen?: boolean
  /**
   * The bound row's `orderId` and the CLAIM's `orderId`. A row on a different order is not this claim's
   * refund, whatever the binding says — the status derivation has always checked this (refundedRowTruth);
   * the figures must too.
   */
  rowOrderId?: string | null
  claimOrderId?: string | null
  /** The matching ledger lines. Zero ⇒ missing; more than one ⇒ ambiguous (the unique key should forbid it). */
  ledgerLines?: RefundLedgerFacts[] | null
  /**
   * Σ `applicationFeeAmount` of the PAYMENT lines of the same charge — the Grubano-side fee ever CHARGED,
   * as a positive integer. A CONSERVATION bound, not an estimate: you cannot give back more fee than you
   * took. It is NOT a bound on the commission (the fee is composite — see the header), and it is what
   * closes the external-refund case §9 G, where a refund with no fee refund and no transfer reversal would
   * otherwise present the entire refund as a fee give-back. Omitted (or null) when those lines could not be
   * read: the bound is then not applied and the structural guards still stand.
   */
  feeChargedCents?: number | null
}

/**
 * Derive the restaurant's confirmed financial effect, or say why there is none.
 *
 * Deliberately total: every input shape returns a value, and the only path to `confirmed: true` is a
 * single ledger line whose integers satisfy every guard. A caller cannot obtain figures by passing
 * partial evidence.
 */
export function deriveFinancialEffect(input: FinancialEffectInput): ClaimFinancialEffect {
  const no = (reason: FinancialEffectUnconfirmedReason): ClaimFinancialEffect => ({ confirmed: false, reason })

  if (!input.bound) return no('no_refund_bound')
  // Our own records first. A set `refundError` means the engine, the webhook or the reconciliation could
  // not establish something about this money — including « that row is not this claim's »
  // (`resume_mismatch`) and « Stripe reversed it after we settled » (`stripe_reverted_after_refund`). The
  // bound row may still read `succeeded` in our base and still have a ledger line, so without this check
  // the block would publish confident figures for a refund that is disowned or undone.
  if (input.moneyTruthOpen) return no('claim_money_state_open')
  if (input.ambiguousBinding) return no('ledger_ambiguous')
  // A row on ANOTHER order is not this claim's refund. Only checked when the caller supplies both ids, so
  // a caller that cannot answer does not silently pass the check.
  if (typeof input.rowOrderId === 'string' && typeof input.claimOrderId === 'string'
    && input.rowOrderId !== input.claimOrderId) {
    return no('ledger_ambiguous')
  }
  // 'succeeded' and nothing else. A pending refund has moved no money the restaurant can be told about,
  // and a failed one has moved none at all — §9 cases C and D.
  if (input.refundStatus !== 'succeeded') return no('refund_not_succeeded')
  if (typeof input.stripeRefundId !== 'string' || input.stripeRefundId === '') return no('refund_id_unknown')

  const lines = input.ledgerLines ?? []
  if (lines.length === 0) return no('ledger_line_missing')
  if (lines.length > 1) return no('ledger_ambiguous')
  const line = lines[0]

  // Every field must be a finite integer before it is read as money.
  for (const v of [line.grossAmount, line.applicationFeeAmount, line.netToRestaurant]) {
    if (!Number.isInteger(v)) return no('ledger_inconsistent')
  }

  // `-0` is an integer, compares equal to 0 and serialises to 0 — but it survives a strict deep compare,
  // so a DTO carrying it makes two identical effects look different to a test or a cache. The ledger
  // writer normalises for the same reason (lib/ledger's own `z`).
  const z = (n: number) => (n === 0 ? 0 : n)
  const customerRefundCents = z(-line.grossAmount)
  const grubanoFeeReturnedCents = z(-line.applicationFeeAmount)
  const restaurantNetImpactCents = z(line.netToRestaurant)

  // (1) The golden equation of every ledger line: gross = fee + net. A line that breaks it is not a
  //     refund line this module understands, whatever it says its type is.
  if (line.grossAmount !== line.applicationFeeAmount + line.netToRestaurant) return no('ledger_inconsistent')
  // (2) A refund returns money, so the gross is strictly negative and the refund strictly positive.
  if (customerRefundCents <= 0) return no('ledger_inconsistent')
  // (3) A fee GIVEN BACK is between nothing and the whole refund. Outside that, the middle figure is not a
  //     fee refund at all — it is Grubano absorbing the refund itself.
  if (grubanoFeeReturnedCents < 0 || grubanoFeeReturnedCents > customerRefundCents) {
    return no('ledger_inconsistent')
  }
  // (4) The restaurant gives back or is untouched; it is never CREDITED by a refund. A positive net is
  //     the `refund_without_reverse_transfer` shape the money rails alert on — never presented as fact.
  if (restaurantNetImpactCents > 0) return no('ledger_inconsistent')
  // (5) CONSERVATION: you cannot give back more fee than you took. When the charge's own fee lines are
  //     readable, this closes the external-Dashboard case (§9 G) — a refund issued with no fee refund and
  //     no transfer reversal would otherwise present the entire refund as a fee give-back.
  if (typeof input.feeChargedCents === 'number' && Number.isFinite(input.feeChargedCents)) {
    if (grubanoFeeReturnedCents > Math.max(0, Math.floor(input.feeChargedCents))) {
      return no('ledger_inconsistent')
    }
  }

  return {
    confirmed: true,
    customerRefundCents,
    grubanoFeeReturnedCents,
    restaurantNetImpactCents,
    source: 'ledger',
  }
}

/**
 * The same evidence, reduced to the ONE question the post-money notification asks: may a restaurant be
 * told, in money, what happened? It may only when the block is confirmed — spec §16: Stripe saying
 * `succeeded` is not enough if the ledger cannot reconstruct the figures, because the alternative is an
 * e-mail with invented numbers in it.
 */
export function financialEffectIsSendable(effect: ClaimFinancialEffect): boolean {
  return effect.confirmed === true
}
