// tests/prel11-money-state-hardening.test.ts — T-102 and T-103: two P1s the adversarial review of the
// T-90/T-93 hardening found, both about a financial figure being WRONG rather than money moving.
//
// T-102 — A REDELIVERED WEBHOOK DOUBLE-COUNTED A DINE-IN BILL. Stripe delivers at least once, and a
// dashboard resend is one click. `app/api/webhooks/stripe/route.ts` computed the collected total as
// `stored + amount_received`, unconditionally. On a 2000 c bill paid 1000 c: delivery one stored
// amountPaid = 10.00 and stamped the PI; delivery two then PASSED the stale-PI guard — because the PI now
// matches — and computed 1000 + 1000 = 2000, marking the bill SETTLED on half the money, freeing the table
// and releasing the customer's empreinte. Reachable with every product flag closed, because the dine-in
// money-IN rail is deliberately live. This is the one finding in the review that was live, not latent.
//
// T-103 — THE PREFLIGHT SAW HOSTING INJECTION AND STILL SAID PASS. T-100 added CHARGEBACKS_ENABLED and
// PUNITIVE_CAPTURE_ENABLED to the watched set, so the provenance block PRINTS `effective=process` for a
// flag set in the cPanel Node.js selector. But the money-flag loop reads the merged view of the env FILES,
// where such a flag never appears — so the operator printed « ABSENT → EFFECTIVE FALSE » and then
// « RESULT: PASS » about a flag that was OPEN in the running process. A fact among forty facts is not a
// refusal, and being the refusal is this operator's entire purpose.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const WEBHOOK = read('app/api/webhooks/stripe/route.ts')
const PREFLIGHT = read('scripts/server/phase2-preflight.js')

// ══ T-102 — the arithmetic, executed, not just pinned ══════════════════════════════════════════════
describe('T-102 — a redelivered payment_intent.succeeded cannot double-count a dine-in bill', () => {
  /** The expression the route now uses, lifted from its source so the test cannot drift from it. */
  const collected = (storedEuros: number, storedPi: string | null, eventPi: string, receivedCents: number) => {
    const samePi = storedPi === eventPi
    const priorCents = Math.round((storedEuros ?? 0) * 100)
    return samePi ? Math.max(priorCents, receivedCents) : priorCents + receivedCents
  }
  /** The OLD expression, kept ONLY to prove the defect was real and that the new one differs. */
  const collectedOld = (storedEuros: number, receivedCents: number) => Math.round((storedEuros ?? 0) * 100) + receivedCents

  it('THE DEFECT, reproduced: the old expression settles a 2000 c bill on 1000 c collected', () => {
    const BILL = 2000
    // delivery 1 — nothing stored yet
    expect(collectedOld(0, 1000)).toBe(1000)
    expect(collectedOld(0, 1000) < BILL).toBe(true)          // partial: ticket stays OPEN, amountPaid = 10.00
    // delivery 2 — the SAME event again
    expect(collectedOld(10, 1000)).toBe(2000)
    expect(collectedOld(10, 1000) >= BILL).toBe(true)         // ← the bill is declared SETTLED on half the cash
  })

  it('THE FIX: the same redelivery is recognised and the bill stays OPEN at the true figure', () => {
    const BILL = 2000
    expect(collected(0, null, 'pi_B', 1000)).toBe(1000)       // delivery 1
    expect(collected(10, 'pi_B', 'pi_B', 1000)).toBe(1000)    // delivery 2 — SAME PI, not added twice
    expect(collected(10, 'pi_B', 'pi_B', 1000) < BILL).toBe(true)
    // …and a third, fourth, Nth delivery is stable
    for (let i = 0; i < 5; i++) expect(collected(10, 'pi_B', 'pi_B', 1000)).toBe(1000)
  })

  it('a SECOND, DIFFERENT PaymentIntent still adds — the fix must not break instalment collection', () => {
    // 500 c on pi_A, then 1500 c on pi_B → 2000 c. Nothing about the fix may swallow the second payment.
    expect(collected(0, null, 'pi_A', 500)).toBe(500)
    expect(collected(5, 'pi_A', 'pi_B', 1500)).toBe(2000)
    // …and a redelivery of pi_B preserves what pi_A contributed
    expect(collected(20, 'pi_B', 'pi_B', 1500)).toBe(2000)
  })

  it('under-counting is the direction chosen, and it is the recoverable one', () => {
    // If amount_received ever GREW between deliveries (an incremental authorization this rail does not
    // perform), max() under-counts. That keeps the ticket OPEN and the remainder collectable. Declaring a
    // bill paid is what cannot be undone: the table is freed and the empreinte released.
    expect(collected(20, 'pi_B', 'pi_B', 2300)).toBe(2300)   // grew → the larger figure wins
    expect(collected(23, 'pi_B', 'pi_B', 1500)).toBe(2300)   // shrank → the stored figure wins, never doubled
  })

  it('the route really contains this expression, and no longer the old one', () => {
    expect(WEBHOOK).toContain('const samePi         = ticket.stripePaymentIntentId === pi.id')
    expect(WEBHOOK).toContain('const totalCents     = samePi ? Math.max(priorCents, receivedCents) : priorCents + receivedCents')
    // the old, unconditional sum is gone
    expect(WEBHOOK).not.toContain("const totalCents     = Math.round((ticket.amountPaid ?? 0) * 100) + receivedCents")
    // a redelivery is REPORTED, not silently absorbed — an operator needs to know it happened
    expect(WEBHOOK).toContain('REDELIVERY of PI')
    expect(WEBHOOK).toContain('already accounted, not counted twice')
  })

  it('the stale-PI guard is still there — it answers a DIFFERENT question and both are needed', () => {
    // The guard catches a superseded PI (money captured on an older intent). It cannot catch a redelivery
    // of the CURRENT one, because the id matches: that is precisely why the defect survived it.
    expect(WEBHOOK).toContain('if (ticket.stripePaymentIntentId && ticket.stripePaymentIntentId !== pi.id)')
    expect(WEBHOOK).toContain("reason: 'stale_pi'")
    const guardAt = WEBHOOK.indexOf("reason: 'stale_pi'")
    const fixAt = WEBHOOK.indexOf('const samePi         = ticket.stripePaymentIntentId === pi.id')
    expect(guardAt).toBeGreaterThan(-1)
    expect(fixAt).toBeGreaterThan(guardAt) // the redelivery check runs AFTER the stale check, as it must
  })
})

// ══ T-103 — an injected money flag is a FAILED STEP, not a note ════════════════════════════════════
describe('T-103 — the preflight refuses when the hosting layer holds a money flag', () => {
  it('the money-flag loop reads the FILES, which is why a second check was needed', () => {
    // Not a criticism of the loop: the file view is the right thing for «what did we configure?». It is
    // simply blind to «what is the process actually holding?», and only the provenance report knows that.
    expect(PREFLIGHT).toContain('for (const k of MONEY_FLAGS_MUST_BE_FALSE) {')
    expect(PREFLIGHT).toContain("if (flag(k) === 'true') {")
    expect(PREFLIGHT).toContain('const mergedA = prov.mergeNextEnvFiles(textsA)')
  })

  it('an effective source of `process` on a money flag FAILS the run, and says what to do', () => {
    expect(PREFLIGHT).toContain("if (e.effectiveSource === 'process' || (e.presentBeforeEnvLoad && !e.presentInEnvFiles)) injected.push(k)")
    expect(PREFLIGHT).toContain("F('MONEY FLAGS INJECTED BY THE HOSTING LAYER'")
    expect(PREFLIGHT).toContain("return fail('5 provenance: '")
    expect(PREFLIGHT).toContain('remove the variable from the cPanel Node.js selector, restart Passenger, re-run')
    // it is a REFUSAL, not an anomaly appended to a passing run
    const block = PREFLIGHT.slice(PREFLIGHT.indexOf('const injected = []'))
    expect(block.slice(0, 1400)).toContain('return fail(')
  })

  it('it iterates the SAME canonical list T-100 widened — one definition, two readers', () => {
    // If this check had its own list, the day a flag is added to one and not the other is the day the
    // report goes back to lying. It reads MONEY_FLAGS_MUST_BE_FALSE, which is `prov`'s.
    expect(PREFLIGHT).toContain('const MONEY_FLAGS_MUST_BE_FALSE = prov.MONEY_FLAGS_MUST_BE_FALSE')
    const block = PREFLIGHT.slice(PREFLIGHT.indexOf('const injected = []'), PREFLIGHT.indexOf('MONEY FLAGS INJECTED'))
    expect(block).toContain('for (const k of MONEY_FLAGS_MUST_BE_FALSE)')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prov = require('../scripts/server/env-provenance.js') as { MONEY_FLAGS_MUST_BE_FALSE: string[]; WATCHED_SECRET_KEYS: string[] }
    // and every one of them is WATCHED, or the provenance report would have no entry to judge
    for (const k of prov.MONEY_FLAGS_MUST_BE_FALSE) expect(prov.WATCHED_SECRET_KEYS, k).toContain(k)
  })

  it('the predicate is the right one — it catches the cPanel shape and not an ordinary file definition', () => {
    // Executed, not merely pinned: the two shapes a provenance entry can take for a money flag.
    const injected = (e: { effectiveSource: string; presentBeforeEnvLoad: boolean; presentInEnvFiles: boolean }) =>
      e.effectiveSource === 'process' || (e.presentBeforeEnvLoad && !e.presentInEnvFiles)
    // set in the cPanel selector, absent from every file → REFUSED
    expect(injected({ effectiveSource: 'process', presentBeforeEnvLoad: true, presentInEnvFiles: false })).toBe(true)
    // defined in .env.local, not in the process before load → ordinary, allowed through to the file loop
    expect(injected({ effectiveSource: '.env.local', presentBeforeEnvLoad: false, presentInEnvFiles: true })).toBe(false)
    // absent everywhere → allowed (and effectively false)
    expect(injected({ effectiveSource: 'none', presentBeforeEnvLoad: false, presentInEnvFiles: false })).toBe(false)
    // the subtle one: present in the process AND in a file — the file loop already judges its VALUE
    expect(injected({ effectiveSource: '.env.local', presentBeforeEnvLoad: true, presentInEnvFiles: true })).toBe(false)
  })

  it('and the fact line is printed even when the answer is NO — silence is not evidence', () => {
    expect(PREFLIGHT).toContain("'NO — every money flag the process holds comes from an env file'")
  })
})
