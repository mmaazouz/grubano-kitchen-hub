// tests/claim-help-amount-basis.test.ts — T-86 (PRE-L11 adversarial review)
//
// THE DEFECT. /eat/order/[id]/help told the customer « Montant demandé : 8,00 € », summed from
// `Order.items[].price` — the MenuItem LIST price. On any order whose total is BELOW the sum of its
// lines (a promotion, a bundle, points redeemed) lib/claim-scope scales every unit down to the basis
// actually paid, and `resolveClaimAmount` prices the claim from THOSE units. The page's only guard was
// a clamp to `maxRefundableCents` — the ORDER ceiling, which does not bind a one-line selection. So the
// filing screen stated one figure and the acknowledgement e-mail, /eat/account/claims and the tracking
// widget then stated a smaller one. `components/claims/ClaimSection.tsx` had already been reading
// `unitCents`; this page had not, which is how two consumer surfaces on the same order disagreed.
//
// WHY THIS FILE EXISTS RATHER THAN ANOTHER CLAMP. The arithmetic is not the page's to own: the only
// figure that will ever be recorded comes from `resolveClaimAmount`, so the test proves the page reads
// the SAME input, and proves the discount really does move it — a control on the engine, not on the copy.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildClaimScope, resolveClaimAmount, publicClaimScope } from '@/lib/claim-scope'

const HELP = readFileSync('app/[locale]/eat/order/[orderId]/help/page.tsx', 'utf8')
const SECTION = readFileSync('components/claims/ClaimSection.tsx', 'utf8')

/** The founder-shaped case: 40 € of lines on an order paid 20 €. */
const DISCOUNTED = {
  items: [
    { name: 'Gnocchi truffe', qty: 1, price: 8 },
    { name: 'Risotto', qty: 1, price: 12 },
    { name: 'Tiramisu', qty: 2, price: 10 },
  ],
  orderTotalEur: 20,
  alreadyRefundedCents: 0,
}

describe('T-86 — the engine really does price a discounted line below its list price', () => {
  it('a one-line selection is worth HALF its list price, and the order ceiling does not catch it', () => {
    const scope = buildClaimScope(DISCOUNTED)
    // 8 + 12 + 2×10 = 40 € of lines, 20 € paid ⇒ scale = 1/2
    expect(scope.lines.map((l) => l.unitCents)).toEqual([400, 600, 500])
    expect(scope.maxAuthorityCents).toBe(2000)
    const r = resolveClaimAmount(scope, { mode: 'items', selection: [{ index: 0, qty: 1 }] })
    expect(r.ok).toBe(true)
    expect(r.ok && r.amountCents).toBe(400)
    // THE POINT: the old page showed 8,00 € and its clamp did nothing, because 800 < the 2000 ceiling.
    expect(800).toBeLessThan(scope.maxAuthorityCents)
  })

  it('the figure the page now computes equals the figure the engine will record, line for line', () => {
    const scope = buildClaimScope(DISCOUNTED)
    const pub = publicClaimScope(scope)
    const byIndex = new Map(pub.lines.map((l) => [l.index, l.unitCents]))
    const cases = [
      [{ index: 0, qty: 1 }],
      [{ index: 2, qty: 2 }],
      [{ index: 1, qty: 1 }, { index: 2, qty: 1 }],
    ]
    for (const sel of cases) {
      // the page's arithmetic, restated: Σ unitCents × qty, in euros
      const page = sel.reduce((s, x) => s + (byIndex.get(x.index)! / 100) * x.qty, 0)
      const engine = resolveClaimAmount(scope, { mode: 'items', selection: sel })
      expect(engine.ok, JSON.stringify(sel)).toBe(true)
      expect(page, JSON.stringify(sel)).toBe((engine.ok ? engine.amountCents : 0) / 100)
    }
  })

  it('an undiscounted order is unaffected — the fix is a basis change, not a discount', () => {
    const scope = buildClaimScope({ items: [{ name: 'Wrap', qty: 2, price: 9 }], orderTotalEur: 18, alreadyRefundedCents: 0 })
    expect(scope.lines[0].unitCents).toBe(900)
    const r = resolveClaimAmount(scope, { mode: 'items', selection: [{ index: 0, qty: 2 }] })
    expect(r.ok && r.amountCents).toBe(1800)
  })
})

describe('T-86 — the help page reads the SERVER basis and no longer sums list prices', () => {
  it('it consumes scope.lines[].unitCents, indexed by the position in Order.items', () => {
    expect(HELP).toContain('scope?: {')
    expect(HELP).toContain('lines?: Array<{ index: number; name: string; maxQty: number; unitCents: number; lineCents: number }>')
    expect(HELP).toContain('const unitCentsByIndex = useMemo(')
    expect(HELP).toContain('for (const l of eligibility?.scope?.lines ?? [])')
    expect(HELP).toContain('m.set(l.index, Math.max(0, Math.round(l.unitCents)))')
    // and the index really is the raw position, which is why it may index this list directly
    expect(readFileSync('lib/claim-scope.ts', 'utf8')).toContain('index:     position,')
  })

  it('NO expression on the page multiplies the list price any more — the whole defect was that product', () => {
    // A negative control on the SHAPE, because this is the one basis the page must never use again.
    const code = HELP.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/it\.price/)
    expect(code).not.toMatch(/\.price\s*\*/)
    // the estimate and the per-line price both come from the map
    expect(HELP).toContain('const unit = unitCentsByIndex.get(i)')
    expect(HELP).toContain('return s + (unit / 100) * Math.min(picked[i] ?? 0, it.qty ?? 1)')
    expect(HELP).toContain('formatEuros((unitCentsByIndex.get(i)! / 100) * (on ? qty : maxQty), locale)')
  })

  it('a line the server did NOT price states no figure, instead of an understated one', () => {
    // claim-scope DROPS a malformed line rather than guess it; the page must not add such a line up.
    const scope = buildClaimScope({
      items: [{ name: 'Bon', qty: 1, price: 10 }, { name: 'Cassé', qty: 0, price: 5 }],
      orderTotalEur: 10,
      alreadyRefundedCents: 0,
    })
    expect(scope.lines.map((l) => l.index)).toEqual([0]) // index 1 dropped, position preserved
    expect(HELP).toContain('const estimatePriceable = useMemo(')
    expect(HELP).toContain('!items.some((_, i) => (picked[i] ?? 0) > 0 && !unitCentsByIndex.has(i))')
    expect(HELP).toContain('{anySelected && estimatePriceable')
    expect(HELP).toContain('{unitCentsByIndex.has(i) && (')
  })

  it('the ORDER ceiling clamp is KEPT on top — it answers a different question', () => {
    // It still catches an order already partly refunded outside the rail. It was never the line basis.
    expect(HELP).toContain('const estimate = eligibility ? Math.min(rawEstimate, ceilingEuros) : rawEstimate')
    expect(HELP).toContain('const estimateCapped = !!eligibility && rawEstimate > ceilingEuros')
  })

  it('the two consumer surfaces now state the same basis', () => {
    expect(SECTION).toContain('return sum + (line ? line.unitCents * sel.qty : 0)')
    expect(SECTION).toContain('{formatEuros(line.unitCents / 100, locale)}')
    // both read unitCents; neither reads a list price for money
    expect(SECTION).not.toMatch(/it\.price/)
  })

  it('NO new copy: the five locales are untouched by this fix', () => {
    for (const l of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'))
      expect(typeof m.eat.help.refundEstimate, l).toBe('string')
      expect(typeof m.eat.help.refundPickToEstimate, l).toBe('string')
    }
  })
})
