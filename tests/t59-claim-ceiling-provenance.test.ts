// tests/t59-claim-ceiling-provenance.test.ts — T-59 (P2 of the round-13 final audit, blocking Mode B)
//
// THE DEFECT. `buildClaimScope` already knew whether the ceiling was proven against live Stripe
// cash truth (`ceilingSource: 'stripe' | 'db_only'`), but that provenance stopped inside the
// server: `publicClaimScope` did not export it and `getClaimEligibility` dropped it. The consumer
// form therefore printed « Maximum remboursable : X » in BOTH cases — including the case where
// Stripe could not be read at all, where X ignores every refund issued outside the rail (Stripe
// Dashboard) and can be strictly larger than the cash that is actually refundable.
//
// No money can move from that (the refund engine re-reads Stripe and refuses anything above the
// real remainder, and REFUNDS is gated shut), so the defect is a PROMISE defect: the product
// states as verified cash a number it has not verified. This file pins the fix in three layers:
//   1. the provenance reaches the public scope and the eligibility payload (unit);
//   2. every degraded Stripe path yields ceilingVerified === false while the AMOUNT stays
//      fail-soft (a Stripe outage must not deny a legitimate claim);
//   3. the two consumer surfaces only ever use the cash wording under `ceilingVerified === true`
//      (source pin), and the neutral wording exists in all five locales.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { findFirst: vi.fn(), count: vi.fn() },
    refund: { aggregate: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { buildClaimScope, publicClaimScope } from '@/lib/claim-scope'
import { getClaimEligibility } from '@/lib/claims'

const ORDER = {
  consumerId: 'u1',
  paymentStatus: 'paid',
  total: 20,                    // 2000 c
  updatedAt: new Date(),
  items: [{ itemId: 'i1', name: 'Gnocchi', qty: 2, price: 10 }],
  stripePaymentIntentId: 'pi_test',
}
const charge = (amountRefunded: number) => ({ id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: amountRefunded })

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findUnique.mockResolvedValue({ ...ORDER })
  db.claim.findFirst.mockResolvedValue(null)
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
})

// ── 1. THE PROVENANCE IS PART OF THE PUBLIC SCOPE ────────────────────────────────
describe('T-59 — publicClaimScope carries the ceiling provenance', () => {
  const scopeInput = { items: ORDER.items, orderTotalEur: 20, alreadyRefundedCents: 0 }

  it('Stripe truth read → ceilingVerified true', () => {
    const s = buildClaimScope({ ...scopeInput, stripe: { capturedCents: 2000, refundedCents: 0, pendingCents: 0 } })
    expect(s.ceilingSource).toBe('stripe')
    expect(s.ceilingContested).toBe(false)
    expect(publicClaimScope(s).ceilingVerified).toBe(true)
  })

  it('a DISPUTED charge → read, but not proven: ceilingVerified false at the same cap', () => {
    const s = buildClaimScope({ ...scopeInput, stripe: { capturedCents: 2000, refundedCents: 0, pendingCents: 0, disputed: true } })
    expect(s.ceilingSource).toBe('stripe')   // Stripe WAS read
    expect(s.ceilingContested).toBe(true)    // …but cash may have left on the dispute rail
    expect(s.maxAuthorityCents).toBe(2000)   // the cap is unchanged: wording only
    expect(publicClaimScope(s).ceilingVerified).toBe(false)
  })

  it('Stripe truth absent → ceilingVerified false, even though the amount is unchanged', () => {
    const s = buildClaimScope({ ...scopeInput, stripe: null })
    expect(s.ceilingSource).toBe('db_only')
    const pub = publicClaimScope(s)
    expect(pub.ceilingVerified).toBe(false)
    expect(pub.maxAuthorityCents).toBe(2000) // the cap itself is unchanged: this fix is about wording, not authority
  })

  it('the non-array items path (lines unavailable) carries the dispute too, in BOTH directions', () => {
    // buildClaimScope has an EARLY return when Order.items is not an array — it must carry the
    // same provenance as the main return, or a malformed-items order would read « verified ».
    const disputed = buildClaimScope({ ...scopeInput, items: null, stripe: { capturedCents: 2000, refundedCents: 0, pendingCents: 0, disputed: true } })
    expect(disputed.linesUnavailable).toBe(true)
    expect(disputed.ceilingContested).toBe(true)
    expect(publicClaimScope(disputed).ceilingVerified).toBe(false)
    const clean = buildClaimScope({ ...scopeInput, items: null, stripe: { capturedCents: 2000, refundedCents: 0, pendingCents: 0 } })
    expect(clean.linesUnavailable).toBe(true)
    expect(clean.ceilingContested).toBe(false)
    expect(publicClaimScope(clean).ceilingVerified).toBe(true)
    expect(publicClaimScope(buildClaimScope({ ...scopeInput, items: null, stripe: null })).ceilingVerified).toBe(false)
  })

  it('the public scope leaks no Stripe internals — only the boolean', () => {
    const s = buildClaimScope({ ...scopeInput, stripe: { capturedCents: 2000, refundedCents: 1500, pendingCents: 0 } })
    const pub = publicClaimScope(s) as Record<string, unknown>
    expect(Object.keys(pub).sort()).toEqual(['alreadyRefundedCents', 'ceilingVerified', 'itemSelectionAvailable', 'lines', 'maxAuthorityCents'])
    expect(pub.stripeRemainingCents).toBeUndefined()
    expect(pub.ceilingSource).toBeUndefined()
  })
})

// ── 2. EVERY DEGRADED STRIPE PATH IS HONEST, AND STILL FAIL-SOFT ON THE AMOUNT ────
describe('T-59 — getClaimEligibility reports whether the ceiling is proven', () => {
  it('Stripe readable → ceilingVerified true, ceiling is the Stripe remainder', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(1500) })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(true)
    expect(e.maxRefundableCents).toBe(500)
    expect(e.scope?.ceilingVerified).toBe(true)
  })

  it('Stripe THROWS → ceilingVerified false, and the claim is still offered at the DB ceiling', async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(false)
    expect(e.scope?.ceilingVerified).toBe(false)
    expect(e.maxRefundableCents).toBe(2000) // fail-soft: an outage must not deny a legitimate claim
    expect(e.canClaim).toBe(true)
  })

  it('the order has NO PaymentIntent → ceilingVerified false and Stripe is never called', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, stripePaymentIntentId: null })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(false)
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
  })

  it('the PaymentIntent has no charge yet → ceilingVerified false', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(false)
  })

  it('a charge read + a FAILING refund list is still verified truth (captured/refunded held)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(0) })
    stripeMock.refunds.list.mockRejectedValue(new Error('rate limited'))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(true)
    expect(e.maxRefundableCents).toBe(2000)
  })

  it('a NON-owner gets ceilingVerified false and no scope at all', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, consumerId: 'someone-else' })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e).toMatchObject({ canClaim: false, reason: 'not_owner', maxRefundableCents: 0, ceilingVerified: false })
    expect(e.scope).toBeUndefined()
  })

  it('a DISPUTED charge is never « verified »: a chargeback takes cash out where neither ceiling looks', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { ...charge(0), disputed: true } })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(false)
    expect(e.scope?.ceilingVerified).toBe(false)
    // the cap itself is untouched — this fix never widens or narrows authority
    expect(e.maxRefundableCents).toBe(2000)
    expect(e.canClaim).toBe(true)
  })

  it('a DISPUTED charge on an order whose items are not an array is still unverified', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, items: null })
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { ...charge(0), disputed: true } })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.ceilingVerified).toBe(false)
    expect(e.scope?.ceilingVerified).toBe(false)
    expect(e.scope?.itemSelectionAvailable).toBe(false) // the whole-order branch — the one that prints the ceiling
  })

  it('a disputed AND partly refunded charge keeps the smaller cap and stays unverified', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { ...charge(1500), disputed: true } })
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(e.maxRefundableCents).toBe(500)
    expect(e.ceilingVerified).toBe(false)
  })

  // Every exit that carries a scope must report the SOURCE, never the exit reason.
  const REFUSED_EXITS = [
    { reason: 'not_paid', setup: () => db.order.findUnique.mockResolvedValue({ ...ORDER, paymentStatus: 'authorized' }) },
    { reason: 'window_expired', setup: () => db.order.findUnique.mockResolvedValue({ ...ORDER, updatedAt: new Date(Date.now() - 1000 * 3600 * 24 * 30) }) },
    { reason: 'active_claim', setup: () => db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'restaurant_review', decidedAt: null, restaurantResponseReason: null, arbitrationReason: null, refundError: null, refundId: null, refundAttempted: false, arbitrationDecision: null, restaurantResponse: null, reason: 'quality' }) },
  ] as const
  for (const exit of REFUSED_EXITS) {
    it(`the ${exit.reason} exit reports the ceiling source in BOTH directions`, async () => {
      exit.setup()
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge(0) })
      const proven = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
      expect(proven).toMatchObject({ canClaim: false, reason: exit.reason, ceilingVerified: true })

      vi.clearAllMocks()
      db.order.findUnique.mockResolvedValue({ ...ORDER })
      db.claim.findFirst.mockResolvedValue(null)
      db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
      stripeMock.refunds.list.mockResolvedValue({ data: [] })
      exit.setup()
      stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
      const unproven = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
      expect(unproven).toMatchObject({ canClaim: false, reason: exit.reason, ceilingVerified: false })
    })
  }

  // Pre-fix, the payload had NO such key: the UI had nothing to branch on (the hole T-59 describes).
  // The flag must be an OWN, explicit boolean on every exit — absent would silently read as falsy
  // in one consumer and as « unknown » in another. (The real break/restore evidence is the
  // differential-control run shipped with the certification report.)
  it('every exit carries ceilingVerified as an OWN explicit boolean, in the payload AND the scope', async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
    const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(Object.prototype.hasOwnProperty.call(e, 'ceilingVerified')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(e.scope ?? {}, 'ceilingVerified')).toBe(true)
    expect(e.ceilingVerified).toBe(false)
    db.order.findUnique.mockResolvedValue({ ...ORDER, consumerId: 'someone-else' })
    const notOwner = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
    expect(Object.prototype.hasOwnProperty.call(notOwner, 'ceilingVerified')).toBe(true)
    expect(notOwner.ceilingVerified).toBe(false)
  })
})

// ── 3. THE TWO CONSUMER SURFACES + THE FIVE LOCALES ──────────────────────────────
const ROOT = path.join(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const CLAIM_SECTION = 'components/claims/ClaimSection.tsx'
const HELP_PAGE = 'app/[locale]/eat/order/[orderId]/help/page.tsx'

describe('T-59 — the cash wording is guarded at every consumer surface', () => {
  // Pins are whitespace-insensitive (a reformat cannot break them) and ANCHORED on the whole
  // call `t(<operand> === true ? <cash> : <neutral>`, so an inverted or widened guard
  // (`!el.ceilingVerified === true`, `el.canClaim || el.ceilingVerified === true`) goes RED.
  const flat = (p: string) => read(p).replace(/\s+/g, ' ')

  it('ClaimSection uses client.maxRefundable ONLY under ceilingVerified === true', () => {
    const src = flat(CLAIM_SECTION)
    expect(src.split('client.maxRefundable').length - 1).toBe(1)
    // the neutral branch must be the DEFAULT one (ternary false-branch), i.e. fail-closed
    expect(src).toMatch(/\{ ?t\(el\.ceilingVerified === true \? 'client\.maxRefundable' : 'client\.maxRequestUnverified', \{ amount:/)
  })

  it('the help page uses the « ce qui reste remboursable » cap sentence ONLY under ceilingVerified === true', () => {
    const src = flat(HELP_PAGE)
    expect(src.split("'refundEstimateCapped'").length - 1).toBe(1)
    expect(src).toMatch(/\{t\(eligibility\?\.ceilingVerified === true \? 'refundEstimateCapped' : 'refundEstimateCappedUnverified'\)\}/)
  })

  it('the indicative item estimate is clamped to the server ceiling, as resolveClaimAmount does', () => {
    // Same family as T-59: on a partly refunded order the item picker must not display a figure
    // larger than the claim may ask for. Whitespace-insensitive so a reformat cannot break it.
    const flat = read(CLAIM_SECTION).replace(/\s+/g, ' ')
    expect(flat).toMatch(/const selectionEstimateCents = Math\.min\(itemSelection\.reduce\(/)
    expect(flat).toMatch(/\}, 0\), el\.maxRefundableCents\)/)
  })

  it('neither surface reads the raw ceilingSource or a Stripe amount', () => {
    for (const f of [CLAIM_SECTION, HELP_PAGE]) {
      const src = read(f)
      expect(src).not.toMatch(/ceilingSource/)
      expect(src).not.toMatch(/stripeRemainingCents/)
    }
  })

  it('both neutral keys exist, non-empty, in all five locales', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      const max = m.claims?.client?.maxRequestUnverified
      const cap = m.eat?.help?.refundEstimateCappedUnverified
      expect(typeof max, loc).toBe('string')
      expect(max.trim().length, loc).toBeGreaterThan(0)
      expect(max, loc).toContain('{amount}')
      expect(typeof cap, loc).toBe('string')
      expect(cap.trim().length, loc).toBeGreaterThan(0)
      // the neutral wording must not be the cash wording it replaces
      expect(max, loc).not.toBe(m.claims.client.maxRefundable)
      expect(cap, loc).not.toBe(m.eat.help.refundEstimateCapped)
      // LOCALE-AGNOSTIC NEUTRALITY: the neutral string must not reuse the cash lead-in it replaces
      // (« Maximum remboursable : » / « Maximum refundable: » / …), in any language.
      const cashLeadIn = m.claims.client.maxRefundable.split('{amount}')[0].trim()
      expect(max.startsWith(cashLeadIn), loc).toBe(false)
      // The cap sentences legitimately share their opening (« Ce montant est plafonné par »), so the
      // cap check is containment: the neutral string must not carry the cash sentence, even minus
      // its final punctuation.
      const cashCapBody = m.eat.help.refundEstimateCapped.replace(/[.。!]\s*$/, '')
      expect(cap.includes(cashCapBody), loc).toBe(false)
      expect(max.includes(cashLeadIn), loc).toBe(false)
    }
  })

  it('the neutral wording promises nothing: no actor, no verification timing, no refund guarantee', () => {
    // The restaurant decides first (lib/claims.ts respondToClaim) — copy that says Grubano verifies
    // "before any decision" would be false. The neutral strings state a cap and stop there.
    const BANNED = [/Grubano/i, /vérifi/i, /verif/i, /rimbors/i, /reembols/i, /refundable/i, /remboursable/i]
    // Arabic has its own cash / verification vocabulary: « القابل للرد » / « قابلاً للردّ » (refundable),
    // « تبقّى » (remains), « تحقق » (verify), « استرداد » (refund) — plus the brand, never transliterated.
    const BANNED_AR = [/Grubano/i, /قابل/, /للرد/, /تبق/, /تحقق/, /استرد/]
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      for (const re of loc === 'ar' ? BANNED_AR : BANNED) {
        expect(m.claims.client.maxRequestUnverified, `${loc} max / ${re}`).not.toMatch(re)
        expect(m.eat.help.refundEstimateCappedUnverified, `${loc} cap / ${re}`).not.toMatch(re)
      }
    }
    // the Arabic bans are live: they DO match the Arabic cash wording they guard against
    const ar = JSON.parse(read('messages/ar.json'))
    expect(ar.claims.client.maxRefundable).toMatch(/قابل/)
    expect(ar.eat.help.refundEstimateCapped).toMatch(/للرد/)
    const fr = JSON.parse(read('messages/fr.json'))
    expect(fr.claims.client.maxRefundable).toMatch(/^Maximum remboursable/) // unchanged, still used when proven
  })

  it('no THIRD surface may use the cash wording: only the two known files reference those keys', () => {
    const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : (/\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : [])))
    const sources = [...walk('app'), ...walk('components'), ...walk('lib')]
    const usingCashKey = sources.filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      return src.includes('client.maxRefundable') || src.includes("'refundEstimateCapped'")
    })
    expect(usingCashKey.sort()).toEqual([CLAIM_SECTION, HELP_PAGE].sort())
  })
})
