// Commission invoices (rail financier A4). Totals are COMPUTED FROM the ledger
// (∑ applicationFeeAmount over the period) — never from the rates. A0-bis: the
// levied commission is TTC; HT/TVA are split FROM it. All amounts integer CENTS.
import { prisma } from '@/lib/prisma'
import { resolveVatRate, DEFAULT_VAT_COUNTRY } from '@/lib/tax'
import { LEGAL_INFO } from '@/lib/legal-info'

/** Split a TTC amount into HT + TVA at the country's VAT rate (P4.4-A), cent-exact by
 *  construction: HT = round(ttc / (1 + rate)), TVA = ttc − HT → HT + TVA always re-adds
 *  to ttc. country defaults to FR (rate 0.20) → IDENTICAL to the former hardcoded split
 *  (HT = round(ttc / 1.2)). Splits the ALREADY-LEVIED commission — never money charged. */
export function splitTtc(ttcCents: number, country: string = DEFAULT_VAT_COUNTRY): { htCents: number; tvaCents: number } {
  const rate = resolveVatRate(country)
  const htCents = Math.round(ttcCents / (1 + rate))
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
  /** VAT-rate country of the partner (P4.4-A). Defaults to FR → 0.20 → byte-identical. */
  country?:     string
}): Promise<IssuedInvoice> {
  const { htCents, tvaCents } = splitTtc(opts.totalTtc, opts.country ?? DEFAULT_VAT_COUNTRY)

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

/** Grubano's legal identity on invoices — sourced from lib/legal-info (the SINGLE
 *  source of company facts, P4.4-A). Values are placeholders until Mohammed fills
 *  legal-info → the invoice shows the SAME placeholder the legal pages do (coherent),
 *  without bypassing the legal-info guard-rail (we only READ the value verbatim). */
export function issuerIdentity() {
  const e = LEGAL_INFO.editor
  return {
    name:    e.raisonSociale,
    address: e.siegeAdresse,
    siren:   e.siren,
    vat:     e.tvaIntra,
  }
}
