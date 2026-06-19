// ── P4.4-C — DAC7 platform-operator reporting (Agent 56) ─────────────────────────
//
// Collects seller identity (additive Operator fields), AGGREGATES seller revenue per
// calendar quarter from the ledger (READ-ONLY — no money is moved or recomputed), and
// feeds an ADMIN-ONLY structured export (CSV/JSON). NOT the official DGFiP XML (follow-up).
//
// ⚠️ LEGAL RULES ARE NOT HARDCODED. The activity classification (goods vs personal
// service — restauration-via-platform), WHICH sellers are reportable, the de-minimis
// thresholds, and the official format are CONFIGURABLE + marked « À VALIDER COMPTABLE ».
// This module computes the MECHANICS only; the figures are documented and the legal
// switches are isolated in DAC7_CONFIG.

import { prisma } from '@/lib/prisma'
import { LEGAL_INFO } from '@/lib/legal-info'

// ── Configurable legal rules — À VALIDER COMPTABLE / JURISTE (no hardcoded decision) ──
export const DAC7_CONFIG = {
  // Platform roles counted as reportable SELLERS. Restaurants first; extend to
  // creators / franchisors when they actually earn. À VALIDER COMPTABLE.
  reportableRoles: ['restaurant'] as string[],
  // Activity classification (goods vs personal service). Restauration-via-platform is
  // UNDECIDED → a LABEL only; NOTHING keys off it. À VALIDER COMPTABLE.
  activityClassification: 'TO_VALIDATE' as string,
  // De-minimis exemption (DAC7 Annex V exempts small sellers under BOTH a count AND an
  // amount). DISABLED by default → report every seller with revenue (never wrongly
  // omit one). À VALIDER COMPTABLE.
  minimis: { enabled: false, maxTransactions: 30, maxConsiderationCents: 200000 },
  // Which monetary figure is the DAC7 « consideration ». The report carries BOTH gross
  // and net + fees, so the accountant decides; NOTHING keys off this. À VALIDER COMPTABLE.
  considerationBasis: 'gross' as 'gross' | 'net',
} as const

export type Dac7Quarter = {
  grossConsiderationCents: number   // Σ ledger gross (signed: refunds/adjustments reduce)
  platformFeesCents: number         // Σ applicationFee withheld by Grubano (signed)
  netCreditedCents: number          // Σ net credited to the seller (signed)
  numberOfTransactions: number      // count of relevant-activity lines (payment/deposit_capture)
}
export type Dac7Seller = {
  operatorId: string
  name: string
  email: string
  sellerType: string                // entity | individual | unknown
  identity: {
    officialName: string | null
    legalForm: string | null
    siren: string | null
    vatNumber: string | null
    taxId: string | null
    taxIdCountry: string | null
    country: string | null
    registeredAddress: string | null
    dateOfBirth: string | null      // ISO yyyy-mm-dd (individuals)
    financialAccountRefs: string[]  // Connect acct ids (REFERENCE — the real IBAN is at Stripe)
  }
  missingFields: string[]           // DAC7 fields still to collect (does NOT block aggregation)
  totalGrossConsiderationCents: number
  totalPlatformFeesCents: number
  totalNetCreditedCents: number
  totalTransactions: number
  quarters: { Q1: Dac7Quarter; Q2: Dac7Quarter; Q3: Dac7Quarter; Q4: Dac7Quarter }
}
export type Dac7Report = {
  year: number
  generatedNote: string
  config: typeof DAC7_CONFIG
  platform: { name: string; siren: string; vat: string; country: string }
  sellerCount: number
  sellers: Dac7Seller[]
}

const emptyQuarter = (): Dac7Quarter => ({ grossConsiderationCents: 0, platformFeesCents: 0, netCreditedCents: 0, numberOfTransactions: 0 })
const quarterKey = (d: Date): 'Q1' | 'Q2' | 'Q3' | 'Q4' => (['Q1', 'Q2', 'Q3', 'Q4'][Math.floor(d.getUTCMonth() / 3)] as 'Q1' | 'Q2' | 'Q3' | 'Q4')

/** Heuristic seller type when not explicitly declared — derived from the legal form.
 *  À VALIDER COMPTABLE (the legal forms list is indicative). */
function deriveSellerType(sellerType: string | null, legalForm: string | null): string {
  if (sellerType === 'individual' || sellerType === 'entity') return sellerType
  const lf = (legalForm ?? '').toLowerCase()
  if (!lf) return 'unknown'
  if (/(auto.?entrepreneur|micro|individual|individuel|\bei\b|personne physique)/.test(lf)) return 'individual'
  return 'entity'
}

/** Grubano = the declaring platform operator (from lib/legal-info, the single source). */
export function dac7Platform(): Dac7Report['platform'] {
  const e = LEGAL_INFO.editor
  return { name: e.raisonSociale, siren: e.siren, vat: e.tvaIntra, country: 'FR' }
}

/**
 * Aggregate the DAC7 report for a calendar year. READ-ONLY: it only reads operators,
 * restaurants and the ledger. The SELLER is the legal entity (operator); a seller's
 * revenue is summed across all its restaurants. Each ledger line is bucketed by ITS
 * own quarter (createdAt); refund/adjustment lines carry their signed amounts (so a
 * refund reduces the quarter it lands in — no double-counting). « numberOfTransactions »
 * counts payment/deposit_capture lines (relevant activities), not refunds.
 */
export async function aggregateDac7Year(year: number): Promise<Dac7Report> {
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1))

  const operators = await prisma.operator.findMany({
    where:  { role: { in: [...DAC7_CONFIG.reportableRoles] } },
    select: {
      id: true, name: true, email: true, officialName: true, legalForm: true, siren: true,
      vatNumber: true, country: true, registeredAddress: true, taxId: true, taxIdCountry: true,
      dateOfBirth: true, sellerType: true,
    },
  })
  const opById = new Map(operators.map((o) => [o.id, o]))

  const restaurants = await prisma.restaurant.findMany({ select: { id: true, operatorId: true, stripeAccountId: true } })
  const restToOp = new Map<string, string>()
  const acctsByOp = new Map<string, string[]>()
  const inScopeRestaurantIds: string[] = []
  for (const r of restaurants) {
    if (!opById.has(r.operatorId)) continue
    restToOp.set(r.id, r.operatorId)
    inScopeRestaurantIds.push(r.id)
    if (r.stripeAccountId) {
      const a = acctsByOp.get(r.operatorId) ?? []
      a.push(r.stripeAccountId)
      acctsByOp.set(r.operatorId, a)
    }
  }

  const lines = inScopeRestaurantIds.length
    ? await prisma.ledgerEntry.findMany({
        where:  { restaurantId: { in: inScopeRestaurantIds }, createdAt: { gte: yearStart, lt: yearEnd } },
        select: { restaurantId: true, type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, createdAt: true },
      })
    : []

  const agg = new Map<string, Dac7Seller['quarters']>()
  const ensure = (opId: string) => {
    let q = agg.get(opId)
    if (!q) { q = { Q1: emptyQuarter(), Q2: emptyQuarter(), Q3: emptyQuarter(), Q4: emptyQuarter() }; agg.set(opId, q) }
    return q
  }
  for (const l of lines) {
    const opId = restToOp.get(l.restaurantId)
    if (!opId) continue
    const q = ensure(opId)[quarterKey(l.createdAt)]
    q.grossConsiderationCents += l.grossAmount
    q.platformFeesCents += l.applicationFeeAmount
    q.netCreditedCents += l.netToRestaurant
    if (l.type === 'payment' || l.type === 'deposit_capture') q.numberOfTransactions += 1
  }

  const sellers: Dac7Seller[] = []
  for (const [opId, q] of Array.from(agg.entries())) {
    const o = opById.get(opId)
    if (!o) continue
    const qs = [q.Q1, q.Q2, q.Q3, q.Q4]
    const totalGross = qs.reduce((s, x) => s + x.grossConsiderationCents, 0)
    const totalTx = qs.reduce((s, x) => s + x.numberOfTransactions, 0)
    // Perimeter: a seller with no relevant activity AND no consideration is not reported.
    if (totalTx === 0 && totalGross === 0) continue
    // Optional de-minimis (disabled by default — À VALIDER COMPTABLE).
    if (DAC7_CONFIG.minimis.enabled &&
        totalTx <= DAC7_CONFIG.minimis.maxTransactions &&
        totalGross <= DAC7_CONFIG.minimis.maxConsiderationCents) continue

    const sellerType = deriveSellerType(o.sellerType, o.legalForm)
    const missingFields: string[] = []
    if (!o.officialName) missingFields.push('officialName')
    if (!o.registeredAddress) missingFields.push('registeredAddress')
    if (!o.taxId) missingFields.push('taxId')
    if (!o.taxIdCountry) missingFields.push('taxIdCountry')
    if (!o.siren && !o.vatNumber) missingFields.push('siren/vatNumber')
    if (sellerType === 'individual' && !o.dateOfBirth) missingFields.push('dateOfBirth')

    sellers.push({
      operatorId: opId, name: o.name, email: o.email, sellerType,
      identity: {
        officialName: o.officialName, legalForm: o.legalForm, siren: o.siren, vatNumber: o.vatNumber,
        taxId: o.taxId, taxIdCountry: o.taxIdCountry, country: o.country, registeredAddress: o.registeredAddress,
        dateOfBirth: o.dateOfBirth ? o.dateOfBirth.toISOString().slice(0, 10) : null,
        financialAccountRefs: acctsByOp.get(opId) ?? [],
      },
      missingFields,
      totalGrossConsiderationCents: totalGross,
      totalPlatformFeesCents: qs.reduce((s, x) => s + x.platformFeesCents, 0),
      totalNetCreditedCents: qs.reduce((s, x) => s + x.netCreditedCents, 0),
      totalTransactions: totalTx,
      quarters: q,
    })
  }
  sellers.sort((a, b) => b.totalGrossConsiderationCents - a.totalGrossConsiderationCents)

  return {
    year,
    generatedNote: 'Mécanique DAC7 uniquement — classification d\'activité, vendeurs déclarables, seuils de minimis et format officiel (XML DGFiP) À VALIDER PAR LE COMPTABLE/JURISTE.',
    config: DAC7_CONFIG,
    platform: dac7Platform(),
    sellerCount: sellers.length,
    sellers,
  }
}

// ── CSV serialization (admin export) ──────────────────────────────────────────────
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toDac7Csv(report: Dac7Report): string {
  const header = [
    'operatorId', 'sellerType', 'officialName', 'legalForm', 'siren', 'vatNumber',
    'taxId', 'taxIdCountry', 'country', 'registeredAddress', 'dateOfBirth',
    'financialAccountRefs', 'missingFields',
    'Q1_grossCents', 'Q1_feesCents', 'Q1_netCents', 'Q1_transactions',
    'Q2_grossCents', 'Q2_feesCents', 'Q2_netCents', 'Q2_transactions',
    'Q3_grossCents', 'Q3_feesCents', 'Q3_netCents', 'Q3_transactions',
    'Q4_grossCents', 'Q4_feesCents', 'Q4_netCents', 'Q4_transactions',
    'total_grossCents', 'total_feesCents', 'total_netCents', 'total_transactions',
  ]
  const rows = report.sellers.map((s) => {
    const q = (k: 'Q1' | 'Q2' | 'Q3' | 'Q4') => {
      const x = s.quarters[k]
      return [x.grossConsiderationCents, x.platformFeesCents, x.netCreditedCents, x.numberOfTransactions]
    }
    return [
      s.operatorId, s.sellerType, s.identity.officialName, s.identity.legalForm, s.identity.siren, s.identity.vatNumber,
      s.identity.taxId, s.identity.taxIdCountry, s.identity.country, s.identity.registeredAddress, s.identity.dateOfBirth,
      s.identity.financialAccountRefs.join('|'), s.missingFields.join('|'),
      ...q('Q1'), ...q('Q2'), ...q('Q3'), ...q('Q4'),
      s.totalGrossConsiderationCents, s.totalPlatformFeesCents, s.totalNetCreditedCents, s.totalTransactions,
    ].map(csvCell).join(',')
  })
  // A leading comment line keeps the « à valider » note + platform context with the file.
  const note = `# DAC7 ${report.year} — ${report.platform.name} (SIREN ${report.platform.siren}) — ${report.generatedNote}`
  return [note, header.join(','), ...rows].join('\n') + '\n'
}
