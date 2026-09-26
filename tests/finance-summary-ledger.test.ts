import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── V3-2 — GET /api/finance/summary lit la commission ESTAMPILLÉE au ledger ──
// L'écran /finance montrait un 10 % forfaitaire (caBrut × constante) alors que
// le prélèvement réel suit la grille par canal (12/8/5/0) + overrides via
// lib/commission, estampillée sur chaque LedgerEntry.applicationFeeAmount.
// Ces tests verrouillent : (1) la commission affichée = Σ des montants
// estampillés, jamais un pourcentage recalculé ; (2) le cas 0 % ; (3) le
// nettage des refunds (lignes négatives) ; (4) le scope de lecture du ledger.

const { db, sessionMock } = vi.hoisted(() => ({
  db: {
    restaurant:  { findMany: vi.fn() },
    order:       { findMany: vi.fn() },
    dishSale:    { aggregate: vi.fn() },
    ledgerEntry: { findMany: vi.fn() },
  },
  sessionMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET } from '@/app/api/finance/summary/route'

const asRestaurateur = () =>
  sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'restaurant' } })

// Une commande simple: 100 € de panier, pas de remise, pas de referral.
const order = (id: string, subtotal = 100) => ({
  id, subtotal, deliveryFee: 0, total: subtotal, referralOrder: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  asRestaurateur()
  db.restaurant.findMany.mockResolvedValue([{ id: 'r1' }])
  db.order.findMany.mockResolvedValue([order('o1')])
  db.dishSale.aggregate.mockResolvedValue({ _sum: { creatorEarning: null } })
  db.ledgerEntry.findMany.mockResolvedValue([])
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L8 / T-46 — THE netResto DOUBLE-COUNT PROOF, IN NUMBERS, AGAINST THE REAL ROUTE
//
// The founder's decision: « netResto doit refléter l'impact économique RÉEL et confirmé côté restaurant »,
// with the stated mechanism « variation netResto = −netReversedCents », and an explicit instruction to STOP
// if the fee refund ALREADY enters netResto separately. It does, and this is the measurement.
//
// THE EXISTING ARCHITECTURE. `commissionGrubano` sums `applicationFeeAmount` over payment + deposit_capture
// + refund lines. A refund line carries a NEGATIVE application fee (−feeReturned when the transfer reversal
// equals the refund), so the commission figure is already refund-NET — the pin spec v2 §7.3 says to keep.
// And because netResto SUBTRACTS the commission, a smaller commission ADDS the returned fee back:
//     netResto = caBrut − (feeCharged − feeReturned) − … = caBrut − feeCharged + feeReturned − …
// The `+ feeReturned` term is the separate re-entry. Subtracting `netReversedCents` (= refund − feeReturned)
// on top of it therefore credits the restaurant with the returned fee TWICE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('T-46 — netResto: the returned fee already enters netResto through the refund-aware commission', () => {
  /** The Mode B reference triple, as lib/ledger.recordRefundLedgerEntry writes it. */
  const REFUND = 500, FEE_RETURNED = 40, REVERSAL = 500
  const refundLine = {
    type: 'refund',
    grossAmount:          -REFUND,
    applicationFeeAmount: -(REFUND - REVERSAL + FEE_RETURNED), // −40
    netToRestaurant:      -(REVERSAL - FEE_RETURNED),          // −460
  }
  const paymentLine = { type: 'payment', applicationFeeAmount: 1200, grossAmount: 10000, netToRestaurant: 8800 }

  it('the writer’s arithmetic is what this test assumes', () => {
    expect(refundLine.applicationFeeAmount).toBe(-40)
    expect(refundLine.netToRestaurant).toBe(-460)
    expect(refundLine.grossAmount).toBe(refundLine.applicationFeeAmount + refundLine.netToRestaurant)
  })

  it('BASE — without the refund: caBrut 100, commission 12,00, netResto 88,00', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([paymentLine])
    const j = await (await GET()).json()
    expect(j.caBrut).toBe(100)
    expect(j.commissionGrubano).toBe(12)
    expect(j.netResto).toBe(88)
  })

  it('THE DEFECT T-46 NAMES, measured: the refund makes netResto go UP by exactly the returned fee', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([paymentLine, refundLine])
    const j = await (await GET()).json()
    // The three measured figures L8 added.
    expect(j.refundedCents).toBe(500)
    expect(j.netReversedCents).toBe(460)
    expect(j.refundsCount).toBe(1)
    // caBrut is unchanged (Σ Order.subtotal never sees a refund) …
    expect(j.caBrut).toBe(100)
    // … while the commission IS refund-aware: 12,00 − 0,40.
    expect(j.commissionGrubano).toBe(11.6)
    // … so netResto moved from 88,00 to 88,40: money left the restaurant and its net went UP by 0,40,
    // which is EXACTLY the returned fee. This is the wrong-direction defect, in numbers.
    expect(j.netResto).toBe(88.4)
    expect(j.netResto - 88).toBeCloseTo(FEE_RETURNED / 100, 10)
  })

  it('DOUBLE-COUNT PROOF — the founder’s TARGET is 83,40, and only −refundedCents reaches it', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([paymentLine, refundLine])
    const j = await (await GET()).json()
    const X = 88 // the base netResto, established above
    // The REAL confirmed impact on the restaurant's own account is `netToRestaurant` = −4,60 (the same
    // integer the per-claim block reports as restaurantNetImpactCents). So the target is:
    const TARGET = X - j.netReversedCents / 100
    expect(TARGET).toBeCloseTo(83.4, 10)
    // (a) the founder's stated MECHANISM, applied to the CURRENT netResto, lands 0,40 above the target —
    //     because the +0,40 is already inside it. This is the double count §2 forbids.
    expect(j.netResto - j.netReversedCents / 100).toBeCloseTo(83.8, 10)
    expect(j.netResto - j.netReversedCents / 100).not.toBeCloseTo(TARGET, 10)
    // (b) subtracting the GROSS refund reaches the target exactly, BECAUSE the commission term already
    //     re-added the returned fee. Same destination as the founder's intent, correct arithmetic.
    expect(j.netResto - j.refundedCents / 100).toBeCloseTo(TARGET, 10)
    // (c) and never « X − 460 + 40 a second time » — the shape the founder ruled out explicitly.
    expect(j.netResto - j.netReversedCents / 100).not.toBeCloseTo(X - 5, 10)
  })

  it('the equivalence holds for ANY fee-returned value — it is algebra, not one lucky fixture', async () => {
    for (const [refund, feeReturned] of [[500, 40], [1000, 80], [250, 0], [999, 1], [10000, 1200]] as const) {
      vi.clearAllMocks(); asRestaurateur()
      db.restaurant.findMany.mockResolvedValue([{ id: 'r1' }])
      db.order.findMany.mockResolvedValue([order('o1')])
      db.dishSale.aggregate.mockResolvedValue({ _sum: { creatorEarning: null } })
      db.ledgerEntry.findMany.mockResolvedValue([
        paymentLine,
        { type: 'refund', grossAmount: -refund, applicationFeeAmount: -feeReturned, netToRestaurant: -(refund - feeReturned) },
      ])
      const j = await (await GET()).json()
      const base = 100 - 1200 / 100 // caBrut − the commission CHARGED
      // netResto today = base + feeReturned/100 (the separate re-entry, measured)
      expect(j.netResto, `${refund}/${feeReturned}`).toBeCloseTo(base + feeReturned / 100, 10)
      // and base − netReversed/100 (the target) = netResto − refunded/100
      expect(j.netResto - j.refundedCents / 100, `${refund}/${feeReturned}`)
        .toBeCloseTo(base - j.netReversedCents / 100, 10)
    }
  })

  it('STOP CONDITION — the route is UNCHANGED: no subtraction term was added to netResto', () => {
    // §2: « Si l'architecture existante fait déjà entrer le fee refund séparément dans netResto : STOP et
    // explique avant toute modification. » It does (measured above), so the formula is left exactly as it
    // was and the decision goes back to the founder with the numbers. This pin is what makes the STOP a
    // fact rather than a claim in a report.
    const src = require('node:fs').readFileSync('app/api/finance/summary/route.ts', 'utf8') as string
    expect(src).toContain('caBrut - commissionGrubano - verseAuxCreateurs - remisesFinancees')
    expect(src).not.toMatch(/netResto\s*-=/)
    expect(src).not.toMatch(/-\s*netReversedCents\s*\/\s*100/)
    expect(src).not.toMatch(/-\s*refundedCents\s*\/\s*100/)
    // …and the commission stays refund-aware (the spec §7.3 pin), which is WHY the re-entry exists.
    expect(src).toContain("type:         { in: ['payment', 'deposit_capture', 'refund'] }")
  })
})

describe('GET /api/finance/summary — commission lue au ledger (V3-2)', () => {
  it('affiche la commission ESTAMPILLÉE (12 % livraison), pas 10 % du CA', async () => {
    // 100 € de CA, ligne ledger estampillée 1200 cents (grille delivery 12 %).
    db.ledgerEntry.findMany.mockResolvedValue([{ applicationFeeAmount: 1200 }])
    const res = await GET()
    const j = await res.json()
    expect(j.caBrut).toBe(100)
    expect(j.commissionGrubano).toBe(12)   // le montant du ledger…
    expect(j.commissionGrubano).not.toBe(10) // …pas l'ancien forfait 10 %
    expect(j.netResto).toBe(88)
  })

  it('cas 0 % (offre fondateurs / réservation) : commission 0, net = brut', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 0 },
      { applicationFeeAmount: 0 },
    ])
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
    expect(j.netResto).toBe(100)
  })

  it('aucune ligne ledger (ex. flux cash) : aucune commission affichée', async () => {
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
  })

  it('nette les refunds (lignes négatives, sémantique A7)', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 1200 },   // payment
      { applicationFeeAmount: -1200 },  // refund total → fee rendue
    ])
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
  })

  it('agrège plusieurs canaux estampillés (12 % + 8 % + 0 %) au centime', async () => {
    db.order.findMany.mockResolvedValue([order('o1'), order('o2'), order('o3')])
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 1200 }, // delivery 12 % de 100 €
      { applicationFeeAmount: 800 },  // pickup 8 % de 100 €
      { applicationFeeAmount: 0 },    // founders 0 %
    ])
    const j = await (await GET()).json()
    expect(j.caBrut).toBe(300)
    expect(j.commissionGrubano).toBe(20)
    expect(j.netResto).toBe(280)
  })

  it('lit le ledger scoppé aux restos de l’opérateur, fenêtre bornée, types payment/deposit_capture/refund', async () => {
    await GET()
    expect(db.ledgerEntry.findMany).toHaveBeenCalledTimes(1)
    const arg = db.ledgerEntry.findMany.mock.calls[0][0]
    expect(arg.where.restaurantId).toEqual({ in: ['r1'] })
    expect(arg.where.type).toEqual({ in: ['payment', 'deposit_capture', 'refund'] })
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date)
    expect(arg.where.createdAt.lte).toBeInstanceOf(Date)
    // D′ L8 (T-46): the SAME query now also reads `type`, `grossAmount` and `netToRestaurant`, so the
    // refund figures the screen was blind to cost no extra round-trip. The commission sum below is
    // unchanged — it still adds `applicationFeeAmount` over payment + deposit_capture + refund.
    expect(arg.select).toEqual({ type: true, applicationFeeAmount: true, grossAmount: true, netToRestaurant: true })
  })

  it('ne recalcule JAMAIS : la source du fichier ne contient plus de taux constant', async () => {
    // Garde anti-régression : aucun 0.10/0.12 forfaitaire ne doit revenir dans
    // la route — la commission vient du ledger, point.
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/api/finance/summary/route.ts', 'utf8')
    expect(src).not.toMatch(/GRUBANO_FEE_PCT/)
    expect(src).not.toMatch(/caBrut\s*\*\s*0\./)
  })
})
