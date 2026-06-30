// Ledger writes (rail financier A3). APPEND-ONLY: this module exposes ONLY an
// insert — never an update or delete. Any correction is a NEW compensating line
// (type 'adjustment'). All amounts in integer CENTS.
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type LedgerEntryInput = {
  // 'partner_transfer' (rail A3 / payout trace) is an OUTBOUND disbursement to a
  // creator/affiliate — additive, convention-only (the DB `type` is a free String,
  // no migration). Its `restaurantId` carries the BENEFICIARY partner id, NOT a
  // restaurant (see recordPartnerTransferLedgerEntry); every restaurantId-scoped
  // reader keys on a real Restaurant.id, so these lines never join one.
  // 'courier_tip' (P2-TIP) is the ACCRUAL obligation for a courier tip held in the
  // charge's application_fee — additive, convention-only (free String, no migration).
  // It is NOT Grubano revenue (applicationFeeAmount 0) and NOT a restaurant line
  // (restaurantId carries a non-Restaurant marker — see recordCourierTipLedgerEntry).
  type:                  'payment' | 'deposit_capture' | 'refund' | 'adjustment' | 'partner_transfer' | 'courier_tip'
  restaurantId:          string
  ticketId?:             string | null
  reservationId?:        string | null
  stripePaymentIntentId?: string | null
  stripeChargeId?:       string | null
  stripeTransferId?:     string | null
  grossAmount:           number // cents
  applicationFeeAmount:  number // cents
  stripeFeeAmount?:      number | null
  netToRestaurant:       number // cents
  routed:                boolean
  destinationAccountId?: string | null
  currency?:             string
  // C1 passthrough: dinein | pickup | delivery | reservation (from the PI's
  // metadata.grubano_channel). Nullable for historical lines until backfilled.
  channel?:              string | null
  sourceEventId:         string // deterministic (PI id for payment/deposit_capture)
  createdAt?:            Date   // backfill sets the PI's real date
}

export type LedgerWriteResult =
  | { ok: true; id: string; duplicate: false }
  | { ok: true; id: null; duplicate: true }   // unique [sourceEventId, type] hit — already recorded
  | { ok: false; error: string }

/** Record ONE compensating NEGATIVE 'refund' ledger line (rail A5 / P4.5-A).
 *  APPEND-ONLY (a new line, never a rewrite). The golden equation holds with
 *  negatives by construction: net = gross − fee ⇒ gross = fee + net. The dedupe
 *  key is the Stripe refund id (sourceEventId), so this is SAFE to call from
 *  lib/refund's executeRefund alongside the byte-identical charge.refunded webhook
 *  — @@unique([sourceEventId,'refund']) means whichever runs first wins and the
 *  other is a silent idempotent duplicate (never two lines for one give-back).
 *  stripeFeeAmount = 0: Stripe keeps its processing fee on a refund — a zero fee
 *  MOVEMENT, affirmed (same convention as the webhook). amounts in integer CENTS. */
export async function recordRefundLedgerEntry(input: {
  refundId:                  string  // re_… — the deterministic dedupe key (sourceEventId)
  restaurantId:              string
  refundedCents:             number  // POSITIVE amount returned to the customer
  applicationFeeRefundCents: number  // POSITIVE fee given back (commission + held-back royalty)
  stripePaymentIntentId?:    string | null
  stripeChargeId?:           string | null
  stripeTransferId?:         string | null
  routed:                    boolean
  destinationAccountId?:     string | null
  channel?:                  string | null
  currency?:                 string
  createdAt?:                Date
}): Promise<LedgerWriteResult> {
  return recordLedgerEntry({
    type:                  'refund',
    restaurantId:          input.restaurantId,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    stripeChargeId:        input.stripeChargeId ?? null,
    stripeTransferId:      input.stripeTransferId ?? null,
    grossAmount:           -input.refundedCents,
    applicationFeeAmount:  -input.applicationFeeRefundCents,
    stripeFeeAmount:       0,
    netToRestaurant:       -input.refundedCents + input.applicationFeeRefundCents, // gross − fee
    routed:                input.routed,
    destinationAccountId:  input.destinationAccountId ?? null,
    currency:              input.currency ?? 'eur',
    channel:               input.channel ?? null,
    sourceEventId:         input.refundId,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  })
}

/** Record ONE 'partner_transfer' ledger line for a SUCCESSFUL partner payout (a
 *  disbursement to a creator/affiliate's Connect account — rail A3 / P4 payout trace).
 *  APPEND-ONLY + IDEMPOTENT: the dedupe key is the internal Payout id (sourceEventId),
 *  so @@unique([sourceEventId,'partner_transfer']) makes a replay (or the payout's
 *  triple-idempotence resume re-driving the same row) a silent duplicate — never a
 *  2nd line for one disbursement.
 *
 *  FIELD MAPPING — chosen to be PROVABLY NEUTRAL to every existing ledger reader:
 *    • restaurantId = the BENEFICIARY partner id (Creator.id | Operator.id). It is a
 *      bare scalar (no FK) and is NEVER a Restaurant.id, so every restaurantId-scoped
 *      reader (partner-balance.restaurantEarnedCents, dac7, invoice generate/detail,
 *      finance summary/operations) keys on a real Restaurant.id and never fetches it;
 *      it lands in its OWN groupBy bucket, never mixing into a restaurant's totals.
 *    • applicationFeeAmount = 0  → a payout earns Grubano NO commission (literally
 *      true), AND the monthly invoice generator (groupBy restaurantId, Σ fee, then
 *      `if ttc<=0 continue`) therefore SKIPS this bucket → no spurious invoice.
 *    • netToRestaurant = amountCents  → forced by the golden equation gross = fee + net
 *      (= amount = 0 + amount), so the admin ledger-check passes line-by-line and in
 *      aggregate. (Repurposed counterweight for this type; never summed for a real
 *      restaurant because restaurantId is a partner id.)
 *    • grossAmount = amountCents (the human-readable disbursed amount), routed = true,
 *      destinationAccountId = the partner's Connect account, stripeTransferId = the
 *      Stripe transfer. The Stripe-reconciliation + refund branches of the check route
 *      filter by type ∈ {payment,deposit_capture,refund} → this line is invisible there.
 *  All amounts in integer CENTS. */
export async function recordPartnerTransferLedgerEntry(input: {
  payoutId:             string  // internal Payout id — the deterministic dedupe key (sourceEventId)
  role:                 string  // creator | affiliate (audit/log only; not a column)
  beneficiaryId:        string  // the paid partner id (Creator.id | Operator.id) → restaurantId scalar
  amountCents:          number  // POSITIVE disbursed amount
  currency?:            string
  stripeTransferId:     string  // tr_… the Stripe transfer reference
  destinationAccountId: string  // acct_… the partner's connected account
  createdAt?:           Date
}): Promise<LedgerWriteResult> {
  return recordLedgerEntry({
    type:                 'partner_transfer',
    restaurantId:         input.beneficiaryId,
    stripeTransferId:     input.stripeTransferId,
    grossAmount:          input.amountCents,
    applicationFeeAmount: 0,
    stripeFeeAmount:      null,
    netToRestaurant:      input.amountCents, // gross − fee (fee 0) ⇒ golden equation holds
    routed:               true,
    destinationAccountId: input.destinationAccountId,
    currency:             input.currency ?? 'eur',
    channel:              null,
    sourceEventId:        input.payoutId,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  })
}

/** Record ONE 'courier_tip' ledger line for the COURIER tip held in an order's
 *  charge (P2-TIP). APPEND-ONLY + IDEMPOTENT: the dedupe key is the order's
 *  PaymentIntent id (sourceEventId), so @@unique([sourceEventId,'courier_tip'])
 *  makes a retried /pay (PI reuse / a recreated PI carrying the same tip) a silent
 *  duplicate — never two accrual lines for one held tip.
 *
 *  WHAT IT EARMARKS: the tip is added to BOTH the charge amount AND the
 *  application_fee at /pay, so the platform HOLDS it (the resto's net = amount −
 *  fee is unchanged — the +tip in amount and the +tip in fee cancel). This line
 *  RECORDS that obligation. It is NOT Grubano revenue and awaits the courier
 *  payout rail (TIP_PAYOUT_ENABLED, inert — lib/tips).
 *
 *  FIELD MAPPING — PROVABLY NEUTRAL to every existing ledger reader (same approach
 *  as recordPartnerTransferLedgerEntry):
 *    • restaurantId = the non-Restaurant marker 'courier_tip:<orderId>' → it is
 *      NEVER a real Restaurant.id, so every restaurantId-scoped reader (finance
 *      summary, invoice generate/detail, dac7, partner-balance) keys on a real
 *      Restaurant.id and never fetches it → no spurious invoice / revenue.
 *    • applicationFeeAmount = 0 → a tip earns Grubano NO commission (literally true).
 *    • netToRestaurant = grossAmount = tipCents → forced by the golden equation
 *      gross = fee + net (= tip = 0 + tip), so the admin ledger-check passes line by
 *      line and in aggregate. (Never summed for a real restaurant — restaurantId is
 *      a marker.) The Stripe-reconciliation + refund branches of the check route
 *      filter by type ∈ {payment,deposit_capture,refund} → this line is invisible
 *      there: the held tip is already inside the 'payment' line's gross+fee, so it
 *      must not be double-counted on the Stripe side.
 *  All amounts in integer CENTS. */
export async function recordCourierTipLedgerEntry(input: {
  orderId:                string  // the order whose charge holds the tip
  stripePaymentIntentId:  string  // pi_… — the deterministic dedupe key (sourceEventId)
  tipCents:               number  // POSITIVE held tip
  channel?:               string | null
  currency?:              string
  createdAt?:             Date
}): Promise<LedgerWriteResult> {
  return recordLedgerEntry({
    type:                  'courier_tip',
    restaurantId:          `courier_tip:${input.orderId}`, // marker, NEVER a Restaurant.id
    stripePaymentIntentId: input.stripePaymentIntentId,
    grossAmount:           input.tipCents,
    applicationFeeAmount:  0,
    stripeFeeAmount:       null,
    netToRestaurant:       input.tipCents, // gross − fee (fee 0) ⇒ golden equation holds
    routed:                true,
    channel:               input.channel ?? null,
    currency:              input.currency ?? 'eur',
    sourceEventId:         input.stripePaymentIntentId,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  })
}

/** Insert ONE ledger line. NEVER throws: a duplicate (replayed event / backfill
 *  overlap) is SUCCESS (idempotent); any real failure returns ok:false so the
 *  caller can log the full payload ([LEDGER MISS]) without ever blocking a
 *  payment. */
export async function recordLedgerEntry(entry: LedgerEntryInput): Promise<LedgerWriteResult> {
  try {
    const row = await prisma.ledgerEntry.create({
      data: {
        type:                  entry.type,
        restaurantId:          entry.restaurantId,
        ticketId:              entry.ticketId ?? null,
        reservationId:         entry.reservationId ?? null,
        stripePaymentIntentId: entry.stripePaymentIntentId ?? null,
        stripeChargeId:        entry.stripeChargeId ?? null,
        stripeTransferId:      entry.stripeTransferId ?? null,
        grossAmount:           entry.grossAmount,
        applicationFeeAmount:  entry.applicationFeeAmount,
        stripeFeeAmount:       entry.stripeFeeAmount ?? null,
        netToRestaurant:       entry.netToRestaurant,
        routed:                entry.routed,
        destinationAccountId:  entry.destinationAccountId ?? null,
        currency:              entry.currency ?? 'eur',
        channel:               entry.channel ?? null,
        sourceEventId:         entry.sourceEventId,
        ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
      },
      select: { id: true },
    })
    return { ok: true, id: row.id, duplicate: false }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: true, id: null, duplicate: true } // already recorded — idempotent
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
