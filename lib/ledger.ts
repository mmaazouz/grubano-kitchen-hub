// Ledger writes (rail financier A3). APPEND-ONLY: this module exposes ONLY an
// insert — never an update or delete. Any correction is a NEW compensating line
// (type 'adjustment'). All amounts in integer CENTS.
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type LedgerEntryInput = {
  type:                  'payment' | 'deposit_capture' | 'refund' | 'adjustment'
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
