import { prisma } from '@/lib/prisma'

// ── Admin ledger — read-only accounting journal (CD ADM5 🔒). ─────────────────────
// 100% READ-ONLY (count/aggregate/findMany only). Every amount is READ from stored
// LedgerEntry CENTS columns and never recomputed from rates. The decomposition banner
// is an ACCURATE server aggregate over the WHOLE filtered period (NOT summed from the
// capped rows), so the golden equation SUM(gross) = SUM(fee) + SUM(net) holds to the
// cent (it holds per row by construction → holds over any subset). Commission is a
// COLUMN of each entry (gross/fee/net), never a synthetic fee LINE. No « Versements »
// (no Payout rail is live — P4.3) → that type/tab is absent, never fabricated.

const CAP = 200
const LEDGER_TYPES = ['payment', 'deposit_capture', 'refund', 'adjustment']
const PERIOD_DAYS: Record<string, number> = { '7': 7, '30': 30, '90': 90 }

export interface LedgerRow {
  id: string
  type: string
  channel: string | null
  createdAt: string
  ref: string
  party: string | null
  grossCents: number
  feeCents: number
  netCents: number
}

export interface AdminLedger {
  decomp: { grossCents: number; feeCents: number; netCents: number; commissionPct: number | null }
  rows: LedgerRow[]
  capped: boolean
  days: number
}

export async function listAdminLedger(daysKey = '30'): Promise<AdminLedger> {
  const days = PERIOD_DAYS[daysKey] ?? 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const where = { type: { in: LEDGER_TYPES }, createdAt: { gte: since } }

  const [agg, entries, total] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where,
      _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
    }),
    prisma.ledgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    CAP,
      select:  { id: true, type: true, channel: true, createdAt: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, restaurantId: true },
    }),
    prisma.ledgerEntry.count({ where }),
  ])

  // LedgerEntry has restaurantId but no relation field → batch-resolve names.
  const ids = Array.from(new Set(entries.map((e) => e.restaurantId)))
  const restos = ids.length
    ? await prisma.restaurant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).catch(() => [])
    : []
  const nameById = new Map(restos.map((r) => [r.id, r.name]))

  const rows: LedgerRow[] = entries.map((e) => ({
    id: e.id,
    type: e.type,
    channel: e.channel,
    createdAt: e.createdAt.toISOString(),
    ref: '#' + e.id.slice(-6).toUpperCase(),
    party: nameById.get(e.restaurantId) ?? null,
    grossCents: e.grossAmount,
    feeCents: e.applicationFeeAmount,
    netCents: e.netToRestaurant,
  }))

  const grossCents    = agg._sum.grossAmount ?? 0
  const feeCents       = agg._sum.applicationFeeAmount ?? 0
  const netCents       = agg._sum.netToRestaurant ?? 0
  const commissionPct  = grossCents > 0 ? Math.round((feeCents / grossCents) * 100) : null

  return { decomp: { grossCents, feeCents, netCents, commissionPct }, rows, capped: total > CAP, days }
}
