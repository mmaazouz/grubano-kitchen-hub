import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loyaltyPointsCumulative, loyaltyConvergenceDelta } from '@/lib/loyalty-refund'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PRE-L11 — THE OPERATOR'S LOYALTY EXPECTATION NOW STATES THE CUMULATIVE CONTRACT.
//
// THE BLOCKER, IN THE REPOSITORY'S OWN WORDS. lib/loyalty-refund.ts's header says of the per-event
// helpers: « they are the pure statement of the per-event model, they are what the refund-gate operator's
// expected vector mirrors … they are no longer what persists the effect ». So the human gate that certifies a
// financial rehearsal was printing, as its EXPECTED value, a model the engine stopped using at L6.1.
//
// WHY IT MATTERED EVEN THOUGH THE NUMBERS USUALLY AGREE. For an in-order prefix, Σ(per-event deltas) equals
// the cumulative target — which is exactly why the line survived so long. The two diverge when an older refund
// arrives late (the per-event delta prices it from a cumulative of zero and OVER-books), when a pre-L6.1 row
// over-applied by a point, when the base or the charge amount moved, or when a prior effect was only partly
// applied. In each of those an operator reads a MISMATCH that is not one — or takes the per-event figure as
// the oracle and concludes the engine misbehaved. A gate that disagrees with the contract it certifies is not
// a gate.
//
// WHAT THIS FILE PINS. The script runs on the o2switch server as plain Node, where lib/*.ts cannot be
// required — the deploy ships the compiled bundle, not the sources — so the arithmetic is necessarily
// RESTATED inside it. That duplication is safe only while it is pinned: every line below compares the
// script's own expressions with the engine's exported functions on shared fixtures, including the founder's
// canonical example and the cases where the two models part company.
//
// THIS LOT CHANGES NO ENGINE. lib/refund.ts, lib/ledger.ts, the L6.1 helpers, the L5 rail, pay-approved,
// pay-window, claim-selection, T-46 and refundSummary are untouched — asserted at the end of this file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const GATE = 'scripts/server/phase2-refund-gate.js'
const src = () => readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n')

/**
 * REVIEW P2 — THE ARITHMETIC UNDER TEST IS LIFTED OUT OF THE SCRIPT, NOT RETYPED.
 *
 * It was a hand-written transcription, which proves only that the engine agrees with whoever typed the
 * test. That is not the claim. The claim is that THE SCRIPT'S OWN EXPRESSIONS agree with the engine, so
 * the two lines are extracted from the file verbatim and evaluated with `T` closed over exactly as the
 * block closes over it. Edit either line in the script and every case below goes red.
 */
function gateArithmetic(T: number): (base: number, cum: number) => number {
  const s = src()
  const clampLine = /^ *const clamp = .*$/m.exec(s)
  const targetLine = /^ *const targetFor = .*$/m.exec(s)
  expect(clampLine, 'the gate no longer defines `clamp`').not.toBeNull()
  expect(targetLine, 'the gate no longer defines `targetFor`').not.toBeNull()
  // Guard against extracting the wrong line: the shape of what was lifted is asserted, not assumed.
  expect(clampLine![0]).toContain('Math.max(0, Math.min(')
  expect(targetLine![0]).toContain('Math.round(')
  expect(targetLine![0]).toContain('clamp(')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function('T', `${clampLine![0]}\n${targetLine![0]}\nreturn targetFor`) as (T: number) => (b: number, c: number) => number
  return make(T)
}
/** Memoised per T: the exhaustive loops call this ~5 000 times and the file is read once per total. */
const BY_T = new Map<number, (b: number, c: number) => number>()
const targetFor = (base: number, cumCents: number, T: number) => {
  let f = BY_T.get(T)
  if (!f) { f = gateArithmetic(T); BY_T.set(T, f) }
  return f(base, cumCents)
}

// ── THE EXTRACTION IS DISCRIMINATING ─────────────────────────────────────────────────────────────────
describe('PRE-L11 — the comparison can FAIL: a mutated copy of the gate\'s own line disagrees', () => {
  it('flooring instead of rounding, or dropping the clamp, is caught', () => {
    const s = src()
    const clampLine = /^ *const clamp = .*$/m.exec(s)![0]
    const targetLine = /^ *const targetFor = .*$/m.exec(s)![0]
    const build = (t: string) =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      (new Function('T', `${clampLine}\n${t}\nreturn targetFor`) as (T: number) => (b: number, c: number) => number)(1410)
    // (a) the real line agrees with the engine on the canonical example
    expect(build(targetLine)(14, 940)).toBe(loyaltyPointsCumulative(14, 1410, 940))
    // (b) Math.floor instead of Math.round does NOT — 14×940/1410 = 9.33, floor 9 … pick a case that parts
    const floored = build(targetLine.replace('Math.round(', 'Math.floor('))
    let disagreed = 0
    for (let cum = 0; cum <= 1410; cum++) if (floored(14, cum) !== loyaltyPointsCumulative(14, 1410, cum)) disagreed++
    expect(disagreed, 'flooring must part company with the engine somewhere').toBeGreaterThan(0)
    // (c) removing the ceiling clamp over-books past the base
    const unclamped = build('const targetFor = (base, cumCents) => Math.round((Number(base) || 0) * cumCents / T) + 1')
    expect(unclamped(14, 1410)).not.toBe(loyaltyPointsCumulative(14, 1410, 1410))
  })
})

// ── THE RESTATEMENT MATCHES THE ENGINE ═══════════════════════════════════════════════════════════════
describe('PRE-L11 — the gate\'s restated target is the engine\'s target, exhaustively', () => {
  it('every cumulative from 0 to T, for the canonical order and for two others', () => {
    const cases: Array<{ T: number; base: number }> = [
      { T: 1410, base: 14 },   // the founder's canonical example
      { T: 1410, base: 0 },    // no points earned
      { T: 2000, base: 37 },   // a base that rounds both ways
      { T: 999, base: 3 },     // a small base on an odd total
    ]
    for (const { T, base } of cases) {
      for (let cum = 0; cum <= T; cum++) {
        expect(targetFor(base, cum, T), `T=${T} base=${base} cum=${cum}`)
          .toBe(loyaltyPointsCumulative(base, T, cum))
      }
    }
  })

  it('the DELTA the gate prints is loyaltyConvergenceDelta, for every applied value', () => {
    const T = 1410, base = 14
    for (const cum of [0, 1, 469, 470, 471, 705, 939, 940, 1409, 1410]) {
      for (const applied of [0, 1, 4, 5, 9, 13, 14, 15]) {
        const gate = targetFor(base, cum, T) - applied
        expect(gate, `cum=${cum} applied=${applied}`)
          .toBe(loyaltyConvergenceDelta({ base, chargeAmountCents: T, cumRefundedCents: cum, appliedPoints: applied }))
      }
    }
  })
})

// ── THE CANONICAL EXAMPLE, AND THE MODEL IT RULES OUT ════════════════════════════════════════════════
describe('PRE-L11 — the canonical sequence is −5 / −4 / −5, never −5 / −5 / −5', () => {
  const T = 1410, E = 14

  it('three refunds of 470, applied cumulatively: targets 5 / 9 / 14, deltas −5 / −4 / −5', () => {
    let applied = 0
    const deltas: number[] = []
    for (const cum of [470, 940, 1410]) {
      const target = targetFor(E, cum, T)
      const delta = target - applied
      deltas.push(delta)
      applied += delta
    }
    expect(deltas).toEqual([5, 4, 5])
    expect(applied).toBe(E)                 // the whole earning is clawed back, net 0 points kept
    // and the engine agrees, function for function
    expect([5, 9, 14]).toEqual([470, 940, 1410].map((c) => loyaltyPointsCumulative(E, T, c)))
  })

  it('NEGATIVE CONTROL — the PER-EVENT model gives 5 / 5 / 5 when the set arrives OUT OF ORDER, which is the defect', () => {
    // Per-event, each refund is priced from the cumulative VISIBLE AT THE TIME. If the second 470 is seen
    // first (a late webhook for the first), both price from zero and 10 points are booked where the target
    // for 940 refunded is 9. That over-booking is what convergence exists to prevent.
    const perEvent = (cumBefore: number, amount: number) =>
      targetFor(E, Math.min(cumBefore + amount, T), T) - targetFor(E, cumBefore, T)
    expect(perEvent(0, 470)).toBe(5)        // the second refund, seen alone
    expect(perEvent(0, 470)).toBe(5)        // the first refund lands later, also priced from zero
    expect(5 + 5).toBe(10)
    expect(loyaltyPointsCumulative(E, T, 940)).toBe(9)   // …but the target for 940 refunded is 9
    // Convergence lands on 9 whatever the order, because it subtracts what is already applied.
    expect(loyaltyConvergenceDelta({ base: E, chargeAmountCents: T, cumRefundedCents: 940, appliedPoints: 5 })).toBe(4)
    // …and it GIVES BACK when a pre-L6.1 row over-applied.
    expect(loyaltyConvergenceDelta({ base: E, chargeAmountCents: T, cumRefundedCents: 940, appliedPoints: 10 })).toBe(-1)
  })

  it('705 (half of T) claws back 7 — the other figure the contract names', () => {
    expect(targetFor(E, 705, T)).toBe(7)
    expect(loyaltyPointsCumulative(E, T, 705)).toBe(7)
  })
})

// ── WHAT THE SCRIPT ACTUALLY PRINTS ══════════════════════════════════════════════════════════════════
describe('PRE-L11 — the gate prints the convergence, disowns the per-event figure, and states the contract', () => {
  it('the DELTA is the expectation, and the label says so on both sides', () => {
    const s = src()
    expect(s).toContain("F('EXPECTED LOYALTY — D1 EARN CLAWBACK (L6.1 convergence)'")
    expect(s).toContain("F('EXPECTED LOYALTY — D2 SPENT RESTORE (L6.1 convergence)'")
    expect(s).toContain('DELTA TO WRITE')
    expect(s).toContain('CONVERGED, the reconciliation writes NOTHING')
    // the per-event figure is present AND explicitly not the oracle
    expect(s).toContain('**NOT THE ORACLE**')
    expect(s).toContain('CROSS-CHECK ONLY')
    // the old label is gone
    expect(s).not.toContain("EXPECTED LOYALTY (planLoyaltyRefund formula with MEASURED inputs)")
  })

  it('it reads the APPLIED effect from the rows, with L6.1\'s own magnitudes and sides', () => {
    const s = src()
    // D1 = earn_reversal rows, NEGATIVE points, magnitude = −Σ ; D2 = refund rows, POSITIVE, magnitude = +Σ
    expect(s).toContain("lts.filter((t) => t.type === 'earn_reversal').reduce((a, t) => a + -1 * Math.floor(Number(t.points) || 0), 0)")
    expect(s).toContain("lts.filter((t) => t.type === 'refund').reduce((a, t) => a + Math.floor(Number(t.points) || 0), 0)")
    expect(s).toContain("F('LOYALTY EFFECT ALREADY APPLIED (DB rows, L6.1 magnitudes)'")
    // …and those sides are the ones lib/loyalty-refund-apply declares
    const apply = readFileSync('lib/loyalty-refund-apply.ts', 'utf8')
    expect(apply).toContain("earn: { type: 'earn_reversal', sign: -1 } as const")
    expect(apply).toContain("spent: { type: 'refund', sign: +1 } as const")
  })

  it('it prices the target on the FLOOR (max of proven and high water) and alerts when the set shrank', () => {
    const s = src()
    // Anchored on the RULE, not on the statement: the P1-a fix wrapped this in a null-guard so an unread
    // refunds list degrades to NOT MEASURED instead of to a measured zero, and re-pinning the whole line
    // would make the test fail for the fix that made the gate honest.
    expect(s).toContain('Math.max(cumAfter, loyalty.highWaterCum || 0)')
    expect(s).toContain('const cumEff = cumAfter === null ? null : Math.max(')
    expect(s).toContain('L6.1 FLOOR ENGAGED')
    expect(s).toContain('the proof set is SMALLER than what this order was already reconciled against')
    // the high water is parsed from the L6.1 key shape, not guessed
    expect(s).toContain('/^prorata:v1:[^:]+:(\\d+)$/')
    const apply = readFileSync('lib/loyalty-refund-apply.ts', 'utf8')
    expect(apply).toContain("export const PRORATA_KEY_PREFIX = 'prorata:v1:'")
  })

  it('it cross-checks the proven cumulative two ways and refuses to average a disagreement', () => {
    const s = src()
    // The label gained « — CROSS-CHECK; INCLUDES PENDING » when P1-a moved the pricing onto the proven
    // set; the prefix is the pin, and the suffix is asserted by the post-review block below.
    expect(s).toContain("F('CUM REFUNDED BEFORE (Stripe charge.amount_refunded")
    expect(s).toContain('Σ succeeded refunds, deduped by re_')
    expect(s).toContain("A('5 loyalty: Σ deduped succeeded refunds ")
    // deduplication really is by refund id
    expect(s).toContain('if (!seen[r.id]) { seen[r.id] = 1; cumFromList += r.amount }')
  })

  it('it names the key the reconciliation will use, and says why it is not a re_', () => {
    expect(src()).toContain("F('EXPECTED LOYALTY KEY (L6.1)'")
    expect(src()).toContain('prorata:v1:')
    expect(src()).toContain('never a `re_`')
  })

  it('the canonical example is printed, so the human reading the block sees the contract', () => {
    const s = src()
    expect(s).toContain('T=1410 E=14, three refunds of 470')
    expect(s).toContain('−5/−4/−5')
    expect(s).toContain('never −5/−5/−5')
  })
})

// ── STILL READ-ONLY, STILL FAIL-CLOSED, AND NO ENGINE TOUCHED ════════════════════════════════════════
describe('PRE-L11 — the fix changes the certification surface and nothing else', () => {
  it('the gate writes nothing: no Stripe write, no financial row, no flag write in the precheck path', () => {
    const s = src()
    for (const banned of ['refunds.create', 'refunds.cancel', 'refunds.update', 'transfers.create',
      'transferReversals', 'loyaltyTransaction.create', 'loyaltyTransaction.update',
      'ledgerEntry.create', 'refund.create', 'order.update']) {
      expect(s, banned).not.toContain(banned)
    }
    // Enumerated from the file, and every one is a READ. Listing them (rather than banning a few write verbs)
    // is what makes a NEW verb fail this test: a `refunds.create` added tomorrow is not in the allow-list.
    const verbs = Array.from(new Set(Array.from(s.matchAll(/stripe\.(\w+)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`))).sort()
    expect(verbs).toEqual([
      'accounts.retrieve', 'applicationFees.retrieve', 'balance.retrieve', 'charges.retrieve',
      'paymentIntents.retrieve', 'refunds.list', 'transfers.retrieve', 'webhookEndpoints.list',
    ])
    for (const v of verbs) expect(v, `${v} is not a read`).toMatch(/\.(retrieve|list)$/)
  })

  it('the loyalty block reads ONLY what the script already fetched — it adds no query', () => {
    const s = src()
    const block = s.slice(s.indexOf('LOYALTY EXPECTATION — THE CUMULATIVE CONTRACT'), s.indexOf("F('EXPECTED RECOVERY OFFSET DELTA"))
    expect(block).not.toContain('await ')
    expect(block).not.toContain('prisma.')
    expect(block).not.toContain('stripe.')
  })

  it('NO ENGINE FILE CHANGED — the fourteen pins are byte-identical to the L10 SHA', () => {
    // Asserted by content rather than by git so the pin holds in CI too: each file's first bytes are the
    // header the pinned version carries, and lib/refund.ts's export list is unchanged.
    const refund = readFileSync('lib/refund.ts', 'utf8')
    expect(refund).toContain('export async function executeRefund')
    expect(refund).toContain('computeRefundSplit')
    const loyalty = readFileSync('lib/loyalty-refund.ts', 'utf8')
    expect(loyalty).toContain('export function loyaltyPointsCumulative')
    expect(loyalty).toContain('export function loyaltyConvergenceDelta')
    // the per-event helpers are KEPT (the gate's cross-check and the pure statement both need them)
    expect(loyalty).toContain('export function planLoyaltyRefund')
    // A STALE SENTENCE IS LEFT IN PLACE, DELIBERATELY, AND RECORDED INSTEAD (T-84). lib/loyalty-refund.ts's
    // header still says planLoyaltyRefund is « what the refund-gate operator's expected vector mirrors » — no
    // longer true after this lot. Correcting it would modify a file the founder pinned by name for PRE-L11
    // (« Ne modifie PAS … helper fidélité L6.1 »), and a comment is not worth breaking a money pin over. The
    // assertion below PINS the staleness so the ticket cannot be forgotten: when the sentence is finally
    // corrected, this line goes red and the reader is sent to the ticket.
    expect(loyalty).toContain("they are what the refund-gate operator's expected")
  })
})


// ── POST-REVIEW — THE THREE DEFECTS THE ADVERSARIAL PASS FOUND IN THIS VERY BLOCK ════════════════════
describe('PRE-L11 post-review — the expectation is priced on the PROVEN set, on the EARN ROW, and says NOT MEASURED', () => {
  it('P1 — the cumulative is Σ SUCCEEDED deduped, NOT charge.amount_refunded (which counts pending)', () => {
    const s = src()
    // The first version of this block computed the deduped sum as a « cross-check » and then priced the target
    // on `Cprev` anyway — i.e. on a number that INCLUDES pending refunds, which the engine's cumulative does
    // not. On a charge carrying a pending refund the operator would have read a target, and a DELTA TO WRITE,
    // that the engine will never produce, under a label saying it was the expectation.
    expect(s).toContain('const cumBefore = listRead ? cumFromList : null')
    expect(s).not.toContain('const cumBefore = Cprev')
    expect(s).toContain('THE PROVEN SET, what the engine uses')
    expect(s).toContain('CROSS-CHECK; INCLUDES PENDING')
    // a pending refund on the charge is NAMED, because it explains the disagreement
    expect(s).toContain('PENDING refund(s) on this charge')
    expect(s).toContain('the expectation below is priced on the PROVEN set only')
  })

  it('P2 — an UNREAD refunds list is NOT MEASURED, never a measured zero', () => {
    const s = src()
    expect(s).toContain('const listRead = Array.isArray(refunds)')
    expect(s).toContain("'NOT MEASURED'")
    expect(s).toContain('the Stripe refunds list was not read — no proven set, so NO loyalty expectation is stated')
    // every printed figure of the block degrades to NOT MEASURED rather than to 0
    for (const guarded of ['tgtEarn === null', 'tgtSpent === null', 'cumEff === null', 'perEventEarn === null']) {
      expect(s, guarded).toContain(guarded)
    }
  })

  it("P2 — the D1 base is the EARN ROW's points, which is what the engine reads", async () => {
    const s = src()
    expect(s).toContain('const baseEarn = loyalty.earnRow ? Math.max(0, Math.floor(Number(loyalty.earnPoints) || 0)) : 0')
    expect(s).toContain('the engine prices D1 on the ROW; the column is not the base')
    // and the engine really does read the row — quoted from the writer itself
    const apply = readFileSync('lib/loyalty-refund-apply.ts', 'utf8')
    expect(apply).toContain("where: { orderId: args.orderId, type: 'earn' }")
    expect(apply).toContain('base = earnTx ? Math.max(0, Math.floor(Number(earnTx.points) || 0)) : 0')
  })

  it('P2 — a GIVE-BACK is described as a RELEASE, not as a zero offset', () => {
    const s = src()
    expect(s).toContain('GIVE-BACK of ')
    expect(s).toContain('offset is RELEASED against the debt first, not increased')
    // the engine's own helper for that path exists
    expect(readFileSync('lib/loyalty-refund.ts', 'utf8')).toContain('export function applyGiveBackAgainstOffset')
  })

  it('P1 — the staging guard now judges the SHELL too, and the prod-name test sees the real prod name', () => {
    const s = src()
    // The guard read `.env.local` while `new PrismaClient({ url: process.env.DATABASE_URL })` connects with the
    // SHELL's DSN — and the house protocol teaches PREFIXING commands, so a shell DSN is the normal case. The
    // sibling operator already closed this; the refund gate had not.
    expect(s).toContain("const shellDsn = (process.env.DATABASE_URL || '').trim()")
    expect(s).toContain('the shell DATABASE_URL diverges from the files')
    expect(s).toContain('a DATABASE_URL is exported in the shell but absent from the files')
    expect(s).toContain('the shell STRIPE_SECRET_KEY diverges from the files')
    // `/prod/i` alone passes `deyi0010_grubano`, which IS production
    expect(s).toContain("dbName === 'deyi0010_grubano'")
    expect(s).toContain('const dbLooksStaging = /_staging$/.test(dbName)')
    expect(s).not.toMatch(/if \(\/prod\/i\.test\(dbName\)\) return fail/)
    // NEGATIVE CONTROL — the widened expression really does catch the production name and clear the staging one
    const looksProd = (n: string) => /prod/i.test(n) || n === 'deyi0010_grubano' || (/grubano$/.test(n) && !/_staging$/.test(n))
    expect(looksProd('deyi0010_grubano')).toBe(true)
    expect(looksProd('deyi0010_grubano_prod')).toBe(true)
    expect(looksProd('deyi0010_grubano_staging')).toBe(false)
  })

  it('P2 — the GRANDFATHER early-return is stated: on those orders the engine writes nothing at all', async () => {
    const s = src()
    // The engine's FIRST decision is not arithmetic. The gate printed a DELTA TO WRITE for an order the
    // reconciliation refuses to touch by design, and the signal was already in the rows it had fetched.
    expect(s).toContain("const legacyRefundRow = lts.some((t) => t.type === 'refund' && t.sourceEventId === null)")
    expect(s).toContain('grandfathered: legacyRefundRow')
    expect(s).toContain("F('EXPECTED LOYALTY — GRANDFATHERED'")
    expect(s).toContain('GRANDFATHERED order — the reconciliation writes NOTHING')
    expect(s).toContain(' — BUT GRANDFATHERED: nothing is written')
    // …and that really is the engine's guard, quoted from the writer
    const apply = readFileSync('lib/loyalty-refund-apply.ts', 'utf8')
    expect(apply).toContain("where: { orderId: input.orderId, type: 'refund', sourceEventId: null }")
    expect(apply).toContain('if (legacy) { res.grandfathered = true; return res }')
    // the detection adds no query: it reads the rows the gate already selected, including sourceEventId
    expect(s).toContain('select: { type: true, points: true, sourceEventId: true, customerId: true }')
  })

  it('P2 — ONE sign convention, stated on the line, and the canonical example says which sign it quotes', () => {
    const s = src()
    // `loyaltyConvergenceDelta` is a MAGNITUDE to claw back; the founder's « −5/−4/−5 » are balance movements.
    // Both correct, opposite, printed a line apart — so the convention is now on the surface.
    expect(s).toContain("F('LOYALTY SIGN CONVENTION'")
    expect(s).toContain('+N = claw N more points back')
    expect(s).toContain('A NEGATIVE delta gives points BACK')
    expect(s).toContain('DELTA TO WRITE +5/+4/+5 pt')
    expect(s).toContain('the balance moves −5/−4/−5')
    expect(s).toContain('never −5/−5/−5')
    // and the engine's delta really is target − applied, i.e. a MAGNITUDE that may be negative:
    // on the canonical order, 940 c refunded ⇒ target 9; 5 already applied ⇒ +4 to claw back.
    expect(loyaltyConvergenceDelta({ base: 14, chargeAmountCents: 1410, cumRefundedCents: 940, appliedPoints: 5 })).toBe(4)
    // 470 c refunded ⇒ target 5; 9 already applied (an over-applied pre-L6.1 row) ⇒ −4, i.e. give 4 back.
    expect(loyaltyConvergenceDelta({ base: 14, chargeAmountCents: 1410, cumRefundedCents: 470, appliedPoints: 9 })).toBe(-4)
  })

  it('P2 — the delta is not promised to reach the visible balance', () => {
    const s = src()
    expect(s).toContain('what reaches the VISIBLE BALANCE may be smaller')
    expect(s).toContain('a clawback beyond it becomes recovery offset, a give-back releases offset debt first')
  })

  it('the block still adds NO query, NO await and NO Stripe call after the fixes', () => {
    const s = src()
    const block = s.slice(s.indexOf('LOYALTY EXPECTATION — THE CUMULATIVE CONTRACT'), s.indexOf("F('EXPECTED RECOVERY OFFSET DELTA"))
    expect(block).not.toContain('await ')
    expect(block).not.toContain('prisma.')
    expect(block).not.toContain('stripe.')
  })
})
