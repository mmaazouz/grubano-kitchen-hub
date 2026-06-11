// Commission invoices (rail financier A4). Totals are COMPUTED FROM the ledger
// (∑ applicationFeeAmount over the period) — never from the rates. A0-bis: the
// levied commission is TTC; HT/TVA are split FROM it. All amounts integer CENTS.
import { prisma } from '@/lib/prisma'

export const VAT_RATE = 0.20 // French standard rate on services (A0-bis default)

/** Split a TTC amount into HT + TVA, cent-exact by construction:
 *  HT = round(ttc / 1.2), TVA = ttc − HT → HT + TVA always re-adds to ttc. */
export function splitTtc(ttcCents: number): { htCents: number; tvaCents: number } {
  const htCents = Math.round(ttcCents / (1 + VAT_RATE))
  return { htCents, tvaCents: ttcCents - htCents }
}

/** "2026-06" → [periodStart inclusive, periodEnd exclusive] (UTC month bounds). */
export function monthBounds(month: string): { periodStart: Date; periodEnd: Date } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const [y, m] = month.split('-').map(Number)
  return {
    periodStart: new Date(Date.UTC(y, m - 1, 1)),
    periodEnd:   new Date(Date.UTC(y, m, 1)),
  }
}

export type IssuedInvoice = {
  id: string; restaurantId: string; number: string
  periodStart: Date; periodEnd: Date
  totalTtc: number; totalHt: number; totalTva: number
  entriesCount: number; status: string; issuedAt: Date
  alreadyExisted: boolean
}

/** Issue ONE invoice for [restaurantId, period] — IDEMPOTENT and gapless.
 *  Everything happens in ONE transaction:
 *    1. an existing invoice for the same [restaurant, periodStart] is returned
 *       as-is (no duplicate, no number burned);
 *    2. otherwise the year counter is atomically incremented (row lock — never
 *       a naive MAX+1 race) and the invoice is created with that number.
 *  A failure anywhere rolls back BOTH the counter and the invoice → the legal
 *  sequence stays continuous, without holes. */
export async function issueInvoice(opts: {
  restaurantId: string
  periodStart:  Date
  periodEnd:    Date
  totalTtc:     number
  entriesCount: number
}): Promise<IssuedInvoice> {
  const { htCents, tvaCents } = splitTtc(opts.totalTtc)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { restaurantId_periodStart: { restaurantId: opts.restaurantId, periodStart: opts.periodStart } },
    })
    if (existing) return { ...existing, alreadyExisted: true }

    // Legal numbering: by ISSUANCE year (chronologically continuous sequence).
    const year = new Date().getFullYear()
    await tx.invoiceCounter.upsert({ where: { year }, create: { year, seq: 0 }, update: {} })
    const counter = await tx.invoiceCounter.update({
      where: { year },
      data:  { seq: { increment: 1 } },
    })
    const number = `GRB-${year}-${String(counter.seq).padStart(5, '0')}`

    const created = await tx.invoice.create({
      data: {
        restaurantId: opts.restaurantId,
        periodStart:  opts.periodStart,
        periodEnd:    opts.periodEnd,
        number,
        totalTtc:     opts.totalTtc,
        totalHt:      htCents,
        totalTva:     tvaCents,
        entriesCount: opts.entriesCount,
        status:       'issued',
      },
    })
    return { ...created, alreadyExisted: false }
  })
}

/** Grubano's legal identity on invoices — env-configured, with EXPLICIT
 *  placeholders so a missing value is impossible to mistake for a real one. */
export function issuerIdentity() {
  return {
    name:    process.env.GRUBANO_LEGAL_NAME    ?? '[Raison sociale Grubano — à configurer]',
    address: process.env.GRUBANO_LEGAL_ADDRESS ?? '[Adresse du siège — à configurer]',
    siren:   process.env.GRUBANO_SIREN         ?? '[SIREN — à configurer]',
    vat:     process.env.GRUBANO_VAT_NUMBER    ?? '[N° TVA intracommunautaire — à configurer]',
  }
}
