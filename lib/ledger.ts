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
  sourceEventId:         string // deterministic (PI id for payment/deposit_capture)
  createdAt?:            Date   // backfill sets the PI's real date
}

export type LedgerWriteResult =
  | { ok: true; id: string; duplicate: false }
  | { ok: true; id: null; duplicate: true }   // unique [sourceEventId, type] hit — already recorded
  | { ok: false; error: string }

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
