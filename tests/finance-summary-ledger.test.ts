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
// D′ L8 (T-46): elle porte désormais son PaymentIntent, parce que c'est par lui que la route relie les
// lignes ledger `refund` à la population de commandes que cet écran compte.
const order = (id: string, subtotal = 100) => ({
  id, subtotal, deliveryFee: 0, total: subtotal, referralOrder: null,
  stripePaymentIntentId: `pi_${id}`,
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
// D′ L8 / T-46 CLOSED — netResto, THE FROZEN CONTRACT AND ITS NUMERIC PROOF
//
// THE DEFECT. `caBrut` is `Σ Order.subtotal` over non-cancelled orders, so a refund NEVER reduces it.
// `commissionGrubano` sums the ledger lines INCLUDING the refund ones, whose applicationFeeAmount is
// negative — so it is refund-NET (the spec v2 §7.3 pin). The two halves of one P&L therefore stopped
// describing the same reality, and netResto moved the WRONG WAY on a refund: the revenue stayed, the
// commission fell, and the restaurateur's net went UP after money left their account.
//
// THE ARBITRATION (founder, 2026-09-26), after the mandatory double-count guard measured that the
// returned fee ALREADY re-enters netResto through the smaller commission:
//     netResto = caBrut − commissionGrubano − verseAuxCreateurs − remisesFinancees − refundedCents/100
// and NEVER − netReversedCents (that would credit the returned fee twice), and the returned fee is never
// added back anywhere else. The total variation is then
//     +(R − V + F)/100 − R/100 = (F − V)/100 = netToRestaurant/100
// i.e. EXACTLY `restaurantNetImpactCents`, the same integer the per-claim block shows the restaurant.
// The identity is ALGEBRAIC — independent of how much was reversed — which the sweep below proves, and
// it is stated on `netToRestaurant` rather than on `−netReversedCents` because the two part company on
// the one shape where the ledger line's net is POSITIVE (see the no-reversal case).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('T-46 — netResto subtracts the GROSS refund, because the returned fee is already back in it', () => {
  /** The founder's fixture, in cents: a 100,00 € basket carrying 12,00 € of Grubano fee. */
  const BASKET_CENTS = 10000, FEE_CHARGED_CENTS = 1200
  /** The certified Mode B triple. */
  const GROSS = 500, FEE_RETURNED = 40, REVERSAL = 500
  const NET_REVERSED = GROSS - FEE_RETURNED // 460
  /** The PaymentIntent of the single in-window order every world below is built on. */
  const PI = 'pi_o1'

  const paymentLine = {
    type: 'payment', applicationFeeAmount: FEE_CHARGED_CENTS,
    grossAmount: BASKET_CENTS, netToRestaurant: BASKET_CENTS - FEE_CHARGED_CENTS,
    stripePaymentIntentId: PI,
  }
  /**
   * A refund line exactly as lib/ledger.recordRefundLedgerEntry writes it from the two Stripe facts:
   * R = refunded, V = amount pulled back off the connected account, F = application fee given back.
   */
  // `z` is the writer's OWN normaliser (lib/ledger): without it `-(0 - 0)` is `-0`, which is a
  // different value from `0` to a deep-equality assertion and would make the no-reversal fixture
  // disagree with the row the rail actually writes.
  const z = (n: number) => (n === 0 ? 0 : n)
  const refundLineOf = (gross: number, reversal: number, feeBack: number, pi: string | null = PI) => ({
    type: 'refund',
    grossAmount:          z(-gross),
    applicationFeeAmount: z(-(gross - reversal + feeBack)),
    netToRestaurant:      z(-(reversal - feeBack)),
    stripePaymentIntentId: pi,
  })
  const modeB = refundLineOf(GROSS, REVERSAL, FEE_RETURNED)

  const world = (lines: unknown[], orders = [order('o1', BASKET_CENTS / 100)]) => {
    vi.clearAllMocks(); asRestaurateur()
    db.restaurant.findMany.mockResolvedValue([{ id: 'r1' }])
    db.order.findMany.mockResolvedValue(orders)
    db.dishSale.aggregate.mockResolvedValue({ _sum: { creatorEarning: null } })
    db.ledgerEntry.findMany.mockResolvedValue(lines)
  }
  const summary = async (lines: unknown[], orders?: unknown[]) => {
    world(lines, orders as never); return (await GET()).json()
  }
  const cents = (eurAmount: number) => Math.round(eurAmount * 100)

  /**
   * THE EQUATION THE /finance SCREEN PRINTS, checked on every world below.
   * The page renders « BRUT − FRAIS = NET » with FRAIS summed CLIENT-SIDE, so a term the API subtracts
   * without exposing makes the screen contradict itself by exactly that term. This is the invariant that
   * keeps the two in step; the page folds `refundedCents/100` into its total for the same reason.
   */
  const equationBalances = (j: Record<string, number>) =>
    expect(
      cents(j.caBrut)
      - cents(j.commissionGrubano) - cents(j.verseAuxCreateurs) - cents(j.remisesFinancees)
      - j.refundedCents,
    ).toBe(cents(j.netResto))

  it('the writer’s own arithmetic is what these fixtures assume — pinned ON lib/ledger, not only locally', () => {
    expect(modeB).toEqual({
      type: 'refund', grossAmount: -500, applicationFeeAmount: -40, netToRestaurant: -460,
      stripePaymentIntentId: PI,
    })
    expect(modeB.grossAmount).toBe(modeB.applicationFeeAmount + modeB.netToRestaurant) // gross = fee + net
    expect(-modeB.netToRestaurant).toBe(NET_REVERSED)
    // `refundLineOf` above is a LOCAL re-implementation, so on its own it pins nothing about the row the
    // rail really writes: dropping the `- reversal` term in lib/ledger would leave this whole file green
    // while every real refund row changed shape. So the writer's three expressions are pinned on the
    // writer's own source. Named by the review that found the gap.
    const ledger = require('node:fs').readFileSync('lib/ledger.ts', 'utf8') as string
    expect(ledger).toContain('const netToRestaurant      = -(reversal - input.applicationFeeRefundCents)')
    expect(ledger).toContain('const applicationFeeAmount = -(input.refundedCents - reversal + input.applicationFeeRefundCents)')
    expect(ledger).toContain('grossAmount:           z(-input.refundedCents)')
    expect(ledger).toContain('const reversal = input.reversalCents ?? input.refundedCents')
  })

  it('WITHOUT a refund: commission 1200 c, netResto 8800 c', async () => {
    const j = await summary([paymentLine])
    expect(cents(j.caBrut)).toBe(BASKET_CENTS)
    expect(cents(j.commissionGrubano)).toBe(FEE_CHARGED_CENTS)
    expect(cents(j.netResto)).toBe(8800)
    expect(j.refundedCents).toBe(0)
    expect(j.netReversedCents).toBe(0)
    expect(j.refundsCount).toBe(0)
    equationBalances(j)
  })

  it('MODE B NUMERIC PROOF — commission 1160 c, netResto 8340 c, delta −460 c', async () => {
    const j = await summary([paymentLine, modeB])
    // the three measured figures, from the ledger refund line
    expect(j.refundedCents).toBe(GROSS)                 // 500
    expect(j.netReversedCents).toBe(NET_REVERSED)       // 460
    expect(j.refundsCount).toBe(1)
    // caBrut untouched: a refund is not a sale that did not happen
    expect(cents(j.caBrut)).toBe(BASKET_CENTS)
    // the commission stays refund-NET: 1200 − 40
    expect(cents(j.commissionGrubano)).toBe(1160)
    // and the net lands on the founder's figure
    expect(cents(j.netResto)).toBe(8340)
    // THE PROPERTY: the variation equals the restaurant's real net impact, to the cent.
    expect(cents(j.netResto) - 8800).toBe(-NET_REVERSED)
    expect(cents(j.netResto) - 8800).toBe(modeB.netToRestaurant)
    equationBalances(j)
  })

  // ── THE THREE NEGATIVE CONTROLS THE ARBITRATION MANDATES ────────────────────────────────────────
  // Each shows the faulty number a wrong variant produces and shows the shipped route does not produce
  // it. B and C are driven by the ROUTE — a world is built in which the wrong number would be the right
  // answer — because a control rebuilt only from local constants proves nothing about the route.
  it('CONTROL A — subtracting only netReversedCents gives 8380 c, and the route does not', async () => {
    const j = await summary([paymentLine, modeB])
    // Built from the route's OWN outputs: every term but the refund one, then the wrong refund term.
    const wrongA = cents(j.caBrut)
      - cents(j.commissionGrubano) - cents(j.verseAuxCreateurs) - cents(j.remisesFinancees)
      - j.netReversedCents
    expect(wrongA).toBe(8380)                                   // ← the double count: +40 kept twice
    expect(cents(j.netResto)).not.toBe(8380)
    expect(cents(j.netResto)).toBe(8340)
  })

  it('CONTROL B — the returned fee enters netResto EXACTLY ONCE (route-measured d/dF = +1)', async () => {
    // The route-driven form of « never add grubanoFeeReturnedCents back ». netResto is
    //     caBrut − (feeCharged − F) − R = 8300 + F
    // so raising the fee returned by δ must raise netResto by δ. If the fee were re-added anywhere it
    // would move by 2δ.
    //   HONEST LIMIT, named by the adversarial review: the per-F LOOP alone is invariant to deleting the
    //   `− refundedCents/100` term — under that revert `base` becomes 8800 and each delta is still F. What
    //   catches the revert is the `expect(base).toBe(8300)` line below (and equationBalances). The loop's
    //   job is narrower and still worth having: it is what distinguishes « the fee enters once » from
    //   « the fee was added a second time », which no single-world assertion can do.
    const base = cents((await summary([paymentLine, refundLineOf(GROSS, REVERSAL, 0)])).netResto)
    expect(base).toBe(8300)
    for (const F of [1, 40, 250, 500]) {
      const j = await summary([paymentLine, refundLineOf(GROSS, REVERSAL, F)])
      expect(cents(j.netResto) - base, `F=${F}`).toBe(F)        // ← +F, never +2F
      expect(cents(j.netResto) - base, `F=${F}`).not.toBe(2 * F)
      equationBalances(j)
    }
    // …and the payload itself never carries the fee as a separate additive field.
    const j = await summary([paymentLine, modeB])
    expect(Object.keys(j)).not.toContain('grubanoFeeReturnedCents')
    expect(Object.keys(j)).not.toContain('feeReturnedCents')
  })

  it('CONTROL C — 8300 c is what the route returns when the fee really did NOT come back', async () => {
    // The wrong variant is « subtract the gross while the commission stays 1200 ». Rather than assert it
    // from constants, build the world in which a 1200 commission IS the truth: Stripe returned no
    // application fee (F = 0), so the commission legitimately stays 1200 and 8300 is correct. The same
    // formula therefore yields 8300 or 8340 depending on a MEASURED fact — it hardcodes neither.
    const noFeeBack = await summary([paymentLine, refundLineOf(GROSS, REVERSAL, 0)])
    expect(cents(noFeeBack.commissionGrubano)).toBe(FEE_CHARGED_CENTS)
    expect(cents(noFeeBack.netResto)).toBe(8300)
    expect(cents(noFeeBack.netResto) - 8800).toBe(-GROSS)       // the whole gross left the restaurant
    equationBalances(noFeeBack)
    // …and on the Mode B world the commission is measured NET, which is why 8300 is wrong there.
    const j = await summary([paymentLine, modeB])
    expect(cents(j.commissionGrubano)).toBe(FEE_CHARGED_CENTS - FEE_RETURNED)
    expect(cents(j.netResto)).not.toBe(8300)
    expect(cents(j.netResto)).toBe(8340)
  })

  // ── THE SWEEP ──────────────────────────────────────────────────────────────────────────────────
  it('SWEEP — for every (gross, feeReturned), delta(netResto) = netToRestaurant of the line', async () => {
    for (const [gross, feeBack] of [[500, 40], [1000, 80], [250, 0], [999, 1], [10000, 1200], [1, 0]] as const) {
      const line = refundLineOf(gross, gross, feeBack) // the normal routed case: reversal = gross
      const j = await summary([paymentLine, line])
      expect(j.refundedCents, `${gross}/${feeBack}`).toBe(gross)
      expect(j.netReversedCents, `${gross}/${feeBack}`).toBe(gross - feeBack)
      expect(cents(j.netResto) - 8800, `${gross}/${feeBack}`).toBe(line.netToRestaurant)
      expect(cents(j.netResto) - 8800, `${gross}/${feeBack}`).toBe(-j.netReversedCents)
      equationBalances(j)
    }
  })

  it('SWEEP — the identity also holds when Grubano ABSORBED part of the refund (reversal < gross)', async () => {
    // Not a special case in the formula: the variation is always netToRestaurant. Here Stripe pulled only
    // 300 c back from the restaurant on a 500 c refund, so the restaurant gave back 300 − 20 = 280.
    const line = refundLineOf(500, 300, 20)
    expect(line.netToRestaurant).toBe(-280)
    const j = await summary([paymentLine, line])
    expect(j.refundedCents).toBe(500)
    expect(j.netReversedCents).toBe(280)
    expect(cents(j.netResto) - 8800).toBe(-280)
    expect(cents(j.netResto) - 8800).toBe(line.netToRestaurant)
    equationBalances(j)
  })

  it('NO TRANSFER REVERSAL AT ALL (V = 0): Grubano bore the refund, the restaurant gave back nothing', async () => {
    // The `refund_without_reverse_transfer` shape, F = 0: the whole 500 c came out of the platform's fee.
    const line = refundLineOf(500, 0, 0)
    expect(line).toMatchObject({ grossAmount: -500, applicationFeeAmount: -500, netToRestaurant: 0 })
    const j = await summary([paymentLine, line])
    expect(j.refundedCents).toBe(500)
    expect(j.netReversedCents).toBe(0)                          // nothing was reversed → nothing counted
    expect(cents(j.commissionGrubano)).toBe(700)                // 1200 − 500: Grubano paid for it
    expect(cents(j.netResto) - 8800).toBe(0)                    // …and the restaurant is untouched
    equationBalances(j)
  })

  it('WHY THE INVARIANT IS netToRestaurant AND NOT −netReversedCents: the POSITIVE-net line', async () => {
    // V = 0 but F = 40: nothing was pulled back from the restaurant AND the fee refund landed on the
    // connected account, so the ledger line's net is POSITIVE — the restaurant is 40 c BETTER off. Here
    // `netReversedCents` is 0 by construction (max(0, …)) while netToRestaurant is +40, and netResto rises
    // by 40. `delta = −netReversedCents` is FALSE on this shape; `delta = netToRestaurant/100` holds.
    const line = refundLineOf(500, 0, 40)
    expect(line.netToRestaurant).toBe(40)
    const j = await summary([paymentLine, line])
    expect(j.netReversedCents).toBe(0)
    expect(cents(j.commissionGrubano)).toBe(660)                // 1200 − 540
    expect(cents(j.netResto) - 8800).toBe(40)
    expect(cents(j.netResto) - 8800).toBe(line.netToRestaurant)
    // AND the old invariant is FALSE here — which is the whole reason this test exists.
    expect(cents(j.netResto) - 8800).not.toBe(-j.netReversedCents)
    equationBalances(j)
  })

  it('SEVERAL refunds in the window accumulate, each by its own net impact', async () => {
    const a = refundLineOf(500, 500, 40), b = refundLineOf(1000, 1000, 80)
    const j = await summary([paymentLine, a, b])
    expect(j.refundsCount).toBe(2)
    expect(j.refundedCents).toBe(1500)
    expect(j.netReversedCents).toBe(460 + 920)
    expect(cents(j.netResto) - 8800).toBe(-(460 + 920))
    equationBalances(j)
  })

  // ── THE POPULATION SCOPE, APPLIED TO THE WHOLE REFUND LINE ──────────────────────────────────────
  // caBrut counts ORDERS only, while the ledger carries every rail (dine-in tickets, captured deposits,
  // orders that have aged out of the window). Subtracting « all refund lines » from an order-only base
  // invents a loss out of money the screen never counted — and scoping only the GROSS invents a GAIN,
  // which is what the first attempt at this fix did and what these tests once pinned as correct.
  //
  // MEASURED on the route before the atomicity fix: an aged-out 500 c refund → netResto 8840 (+40, the
  // T-46 defect verbatim); a 5000 c refund with no transfer reversal → netResto 14400 on a caBrut of
  // 10000 with a commission of −4400; a fully refunded 50 € dine-in bill → +500. A refund line is now
  // either IN (both halves count) or OUT (neither does).
  it('ATOMICITY — an out-of-scope refund moves NEITHER half: not the gross, not the commission', async () => {
    const base = await summary([paymentLine])
    expect(cents(base.commissionGrubano)).toBe(1200)
    expect(cents(base.netResto)).toBe(8800)
    for (const [label, line] of [
      ['aged-out order',    refundLineOf(500, 500, 40, 'pi_old_order')],
      ['no PaymentIntent',  refundLineOf(500, 500, 40, null)],
      ['no reversal, 5000', refundLineOf(5000, 0, 600, 'pi_old_order')],
      ['absorbed, partial', refundLineOf(500, 300, 20, 'pi_other')],
    ] as const) {
      const j = await summary([paymentLine, line])
      expect(j.refundsCount, label).toBe(0)
      expect(j.refundedCents, label).toBe(0)
      expect(j.netReversedCents, label).toBe(0)
      // the commission is NOT netted by it either — this is the half the first attempt left in
      expect(cents(j.commissionGrubano), label).toBe(1200)
      expect(cents(j.netResto), label).toBe(8800)
      equationBalances(j)
    }
    // and the numbers the broken form produced are not produced by this one
    const aged = await summary([paymentLine, refundLineOf(500, 500, 40, 'pi_old_order')])
    expect(cents(aged.netResto)).not.toBe(8840)
    const noRev = await summary([paymentLine, refundLineOf(5000, 0, 600, 'pi_old_order')])
    expect(cents(noRev.netResto)).not.toBe(14400)
    expect(cents(noRev.commissionGrubano)).not.toBe(-4400)
  })

  it('a fully refunded DINE-IN bill is a NON-EVENT: the same figures as the bill alone', async () => {
    // The strongest form of the scope rule, and the comparison is against the SAME world WITHOUT the
    // refund rather than against a constant — the only way to see the asymmetry this test describes.
    const dineIn = {
      type: 'payment', applicationFeeAmount: 500, grossAmount: 5000, netToRestaurant: 4500,
      stripePaymentIntentId: 'pi_ticket_77',
    }
    const billOnly = await summary([paymentLine, dineIn])
    const billPlus = await summary([paymentLine, dineIn, refundLineOf(5000, 5000, 500, 'pi_ticket_77')])
    expect(cents(billPlus.commissionGrubano)).toBe(cents(billOnly.commissionGrubano))
    expect(cents(billPlus.netResto)).toBe(cents(billOnly.netResto))
    expect(billPlus.refundsCount).toBe(0)
    expect(billPlus.refundedCents).toBe(0)
    expect(cents(billPlus.caBrut)).toBe(BASKET_CENTS)
    // neither the −4750 c phantom loss of an unscoped subtraction, nor the +500 c the half-scoped form
    // produced by letting the fee half through
    expect(cents(billPlus.netResto)).not.toBe(8800 - 4500)
    expect(cents(billPlus.netResto)).not.toBe(8800)
    // RECORDED, PRE-EXISTING (POST-BETA-CLAIMS-BACKLOG): the dine-in FEE does sit in commissionGrubano
    // while the dine-in REVENUE is not in caBrut, so both worlds read 8300 rather than 8800. That basis
    // gap predates T-46 and is a spec question, not a defect of this change — pinned here so it stays
    // visible and can never be mistaken for the refund having moved something.
    expect(cents(billOnly.netResto)).toBe(8300)
    equationBalances(billPlus)
  })

  it('an EMPTY window carries the three figures at zero, not a dropped subtraction', async () => {
    const j = await summary([paymentLine, modeB], [])
    expect(j.ordersTotal).toBe(0)
    expect(j.refundedCents).toBe(0)
    expect(j.netReversedCents).toBe(0)
    expect(j.refundsCount).toBe(0)
    expect(j.netResto).toBe(0)
  })

  it('a delivery fee on the order changes neither the base nor the refund arithmetic', async () => {
    // deliveryFee is pass-through to the courier and was never in caBrut. Pinned here so a future change
    // to the base cannot silently alter what a refund does to the net.
    const withFee = [{ ...order('o1', BASKET_CENTS / 100), deliveryFee: 5, total: BASKET_CENTS / 100 + 5 }]
    const j = await summary([paymentLine, modeB], withFee)
    expect(cents(j.caBrut)).toBe(BASKET_CENTS)
    expect(cents(j.remisesFinancees)).toBe(0)
    expect(cents(j.netResto)).toBe(8340)
    equationBalances(j)
  })

  it('a deposit_capture line keeps feeding the commission and never the refund figures', async () => {
    const deposit = {
      type: 'deposit_capture', applicationFeeAmount: 200, grossAmount: 2000, netToRestaurant: 1800,
      stripePaymentIntentId: 'pi_deposit_9',
    }
    const j = await summary([paymentLine, deposit, modeB])
    expect(cents(j.commissionGrubano)).toBe(1160 + 200)
    expect(j.refundsCount).toBe(1)                              // the deposit is not a refund
    expect(j.refundedCents).toBe(GROSS)
    equationBalances(j)
  })

  it('EVERY term non-zero at once: creator cost, funded discount, refund — the equation still balances', async () => {
    // The worlds above leave verseAuxCreateurs and remisesFinancees at 0, so the invariant was only ever
    // exercised on two of its five terms. Here all five carry a value, which is the only way to know the
    // refund term was added to the equation rather than substituted into it.
    const discounted = [{
      ...order('o1', BASKET_CENTS / 100), deliveryFee: 5, total: BASKET_CENTS / 100 + 5 - 8, // 8,00 € knocked off
    }]
    world([paymentLine, modeB], discounted as never)
    db.dishSale.aggregate.mockResolvedValue({ _sum: { creatorEarning: 4 } })   // 4,00 € of creator cost
    const j = await (await GET()).json()
    expect(cents(j.caBrut)).toBe(BASKET_CENTS)
    expect(cents(j.verseAuxCreateurs)).toBe(400)
    expect(cents(j.remisesFinancees)).toBe(800)
    expect(cents(j.commissionGrubano)).toBe(1160)
    expect(j.refundedCents).toBe(GROSS)
    // 10000 − 1160 − 400 − 800 − 500
    expect(cents(j.netResto)).toBe(7140)
    equationBalances(j)
  })

  it('CONTRACT PIN — the formula subtracts refundedCents and nothing else was added back', () => {
    const src = require('node:fs').readFileSync('app/api/finance/summary/route.ts', 'utf8') as string
    // Asserted on the CODE with comments stripped — BOTH directions. The route's own comment writes out
    // the algebra (« … − feeCharged + feeReturned − … ») to explain why the gross is the right term, and
    // explaining a formula is not applying it, so the forbidden shapes must be judged on code only. The
    // POSITIVE pin has to be judged on code too, or deleting the term while leaving the sentence in a
    // comment would keep this green — named by the adversarial review.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).toContain('caBrut - commissionGrubano - verseAuxCreateurs - remisesFinancees - refundedCents / 100')
    expect(code).not.toMatch(/-\s*netReversedCents\s*\/\s*100/)
    expect(code).not.toMatch(/\+\s*grubanoFeeReturned/)
    expect(code).not.toMatch(/\+\s*feeReturned/)
    // No compound assignment either: `netResto -= …` would slip past the literal-formula pin above.
    expect(code).not.toMatch(/netResto\s*[-+*\/%]=/)
    // and the commission stays refund-aware — the reason the gross is the correct term
    expect(src).toContain("type:         { in: ['payment', 'deposit_capture', 'refund'] }")
    // THE ATOMICITY PIN: one scope predicate, applied to the commission sum AND to the refund figures.
    // Two independently-written filters are exactly how the halves came apart the first time.
    expect(code).toContain("l.type === 'refund' && !refundInScope(l) ? s : s + l.applicationFeeAmount")
    expect(code).toContain("feeLines.filter((l) => l.type === 'refund' && refundInScope(l))")
    expect(code.match(/windowOrderPis\.has/g) ?? []).toHaveLength(1)
  })

  it('THE SCREEN PIN — /finance folds the refunded gross into the total it prints', () => {
    // The API deduction is invisible to a page that sums « FRAIS » client-side, so the page must carry the
    // same term. Without this the screen contradicts itself by exactly the refunded amount.
    const page = require('node:fs').readFileSync('app/[locale]/finance/page.tsx', 'utf8') as string
    expect(page).toContain('remisesFinancees + refundedEur')
    expect(page).toContain("refundedCents, netReversedCents, refundsCount,")
    // …and « Frais Grubano » must not be the name given to a total that contains customer refunds.
    expect(page).toContain("'fin.feesRefundsLabel'")
    expect(page).toContain("'fin.legendFeesRefunds'")
    expect(page).toContain("t('fin.refundsFeeNote')")
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

  it('nette les refunds (lignes négatives, sémantique A7) — et T-46 retire aussi le brut rendu', async () => {
    // Remboursement TOTAL de la commande de 100 €, écrit comme lib/ledger l'écrit : reprise 10 000 c,
    // frais restitués 1 200 c. La commission retombe à 0 (A7) et, depuis T-46, le brut rendu quitte
    // aussi le net — un remboursement intégral ne laisse rien au restaurant.
    db.ledgerEntry.findMany.mockResolvedValue([
      { type: 'payment', applicationFeeAmount: 1200, grossAmount: 10000, netToRestaurant: 8800,
        stripePaymentIntentId: 'pi_o1' },
      { type: 'refund', applicationFeeAmount: -1200, grossAmount: -10000, netToRestaurant: -8800,
        stripePaymentIntentId: 'pi_o1' },
    ])
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
    expect(j.refundedCents).toBe(10000)
    expect(j.netReversedCents).toBe(8800)
    expect(j.netResto).toBe(0)
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
    // D′ L8 (T-46): the SAME query now also reads `type`, `grossAmount`, `netToRestaurant` and the
    // PaymentIntent, so the refund figures the screen was blind to cost no extra round-trip. The
    // commission sum below is unchanged — it still adds `applicationFeeAmount` over the three types.
    expect(arg.select).toEqual({
      type: true, applicationFeeAmount: true, grossAmount: true, netToRestaurant: true,
      stripePaymentIntentId: true,
    })
    // KNOWN AND DELIBERATE (recorded in POST-BETA-CLAIMS-BACKLOG): `adjustment` and chargeback lines are
    // NOT in this filter, so a manual ledger adjustment moves neither the commission nor the refund
    // figures on this screen. Pinned so the omission stays a decision rather than an oversight.
    expect(arg.where.type.in).not.toContain('adjustment')
    expect(arg.where.type.in).not.toContain('chargeback')
  })

  it('la commande est lue avec son PaymentIntent — la jointure des refunds en dépend', async () => {
    await GET()
    const arg = db.order.findMany.mock.calls[0][0]
    expect(arg.select.stripePaymentIntentId).toBe(true)
    expect(arg.select.subtotal).toBe(true)
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
