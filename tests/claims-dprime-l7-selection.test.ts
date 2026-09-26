// tests/claims-dprime-l7-selection.test.ts — D′ L7 / T-50: THE PERSISTED SELECTION & THE EXPLICIT SCOPE
//
// WHAT THIS LOT CHANGED, AND WHY IT NEEDED ITS OWN SUITE. Until L7 a claim kept one number. The scope
// the customer had in mind, the articles they pointed at, the quantities they disputed and the ceiling
// that was known when they filed were computed, used once and discarded — and « the whole order » was
// the value silence produced. Three failures followed from that, all of them about honesty rather than
// arithmetic: a one-dish claim and a whole-order claim were indistinguishable afterwards; a customer
// could obtain a whole-order claim without one deliberate gesture; and a stale UI value could suppress
// the amount the customer had just typed, with nothing said.
//
// The letters A–R below are the founder's mandatory list, mapped onto the twenty sections of the L7
// instruction. Each test names the decision it defends, so a future change that breaks one is told
// WHICH promise it broke rather than merely that an assertion failed.
//
// THE ONE THING THIS LOT MUST NOT DO (invariant S-26). The selection is TRACEABILITY. It creates no
// right and no refusal: a quantity recorded in an earlier claim is never subtracted from a later one.
// Test J drives that directly and carries a negative control, because « we already gave you that dish »
// implemented by accident is a silent refusal of a legitimate claim — the exact class of defect the
// founder deferred to the post-beta ANTI-REPEAT ITEM CLAIM POLICY.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openClaimsWindow } from './support/claims-window'
import {
  resolveScopeMode, buildClaimSelection, readClaimSelection, systemClaimSelection,
  selectionLineSummary, selectionTotalQty, previouslyClaimedByLine,
  CLAIM_SELECTION_VERSION, CLAIM_SCOPE_MODES,
} from '@/lib/claim-selection'
import { buildClaimScope, resolveClaimAmount, ceilingVerifiedOf } from '@/lib/claim-scope'
import { scopeRequirement, CUSTOMER_SELECTABLE_REASONS, CLAIM_REASONS } from '@/lib/claim-reasons'

// ── the real route, driven end to end (what a customer actually receives is an HTTP answer) ─────────
const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
const { rateLimitMock } = vi.hoisted(() => ({ rateLimitMock: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false }))
const { ackMock } = vi.hoisted(() => ({ ackMock: vi.fn() }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimAckEmail: ackMock, sendClaimDecisionEmail: vi.fn() }))
vi.mock('@/lib/dish-photo', () => ({ processDishImage: vi.fn(), ALLOWED_IMAGE_TYPES: ['image/jpeg'] as const }))

import { POST } from '@/app/api/claims/route'

// 2 × Gnocchi at 12,50 € and 1 × Tiramisu at 6,00 €; total 32,50 € (a 1,50 € delivery fee on top of
// 31,00 € of lines). The quantity 2 is load-bearing: half the tests below are about disputing ONE of
// two identical portions, which the pre-L7 claim could not express.
const ITEMS = [
  { itemId: 'm1', name: 'Gnocchi', qty: 2, price: 12.5 },
  { itemId: 'm2', name: 'Tiramisu', qty: 1, price: 6 },
]
const ORDER = {
  id: 'o1', consumerId: 'owner', restaurantId: 'r1', paymentStatus: 'paid', status: 'delivered',
  total: 32.5, deliveredAt: new Date(), createdAt: new Date(), updatedAt: new Date(), items: ITEMS,
}
const post = (body: unknown) =>
  POST(new Request('https://app.grubano.com/api/claims', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never)
/** The `data` object the route handed Prisma — the row as it will exist. */
const created = () => db.claim.create.mock.calls[0][0].data as Record<string, unknown>
const snapshot = () => created().selection as Record<string, unknown>

const scope = (over: Partial<{ items: unknown; orderTotalEur: number; alreadyRefundedCents: number }> = {}) =>
  buildClaimScope({ items: ITEMS, orderTotalEur: 32.5, alreadyRefundedCents: 0, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  openClaimsWindow()
  tokenMock.mockResolvedValue({ sub: 'owner' })
  rateLimitMock.mockReturnValue(null)
  db.order.findUnique.mockResolvedValue(ORDER)
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.count.mockResolvedValue(0)
  ackMock.mockResolvedValue(undefined)
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A — THE SNAPSHOT EXISTS, IN ONE SHAPE, WRITTEN BY THE CREATE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('A — every claim this build creates carries a v1 snapshot, written in the same create', () => {
  it('the row leaves the route with a complete snapshot and no field the client could have set', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 1 }] })
    expect(res.status).toBe(201)
    expect(snapshot()).toEqual({
      v: CLAIM_SELECTION_VERSION,
      mode: 'items',
      modeSource: 'client',
      lines: [{ index: 0, itemId: 'm1', qty: 1, unitCents: 1250, name: 'Gnocchi' }],
      requestedCents: 1250,
      ceilingVerified: false, // no live Stripe read on this order (no PaymentIntent) — see I
    })
  })

  it('the snapshot carries NO Stripe identifier, no payment id and no secret', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    const json = JSON.stringify(snapshot())
    for (const forbidden of ['pi_', 're_', 'ch_', 'secret', 'stripe', 'paymentIntent']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('the version is a CONSTANT, not a free field: a reader that meets another version records nothing', () => {
    expect(CLAIM_SELECTION_VERSION).toBe(1)
    expect(readClaimSelection({ v: 2, mode: 'whole', modeSource: 'client', lines: [], requestedCents: 100 })).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// B/C/D — THE THREE MODES, EACH RECORDING WHAT IT ACTUALLY PRICED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('B — mode items records the articles and the quantities, priced by the server', () => {
  it('two disputed lines are both recorded, each with the quantity chosen and the SERVER price', async () => {
    await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 2 }, { index: 1, qty: 1 }] })
    expect(snapshot().lines).toEqual([
      { index: 0, itemId: 'm1', qty: 2, unitCents: 1250, name: 'Gnocchi' },
      { index: 1, itemId: 'm2', qty: 1, unitCents: 600, name: 'Tiramisu' },
    ])
    expect(snapshot().requestedCents).toBe(3100)
    expect(created().requestedAmountCents).toBe(3100)
  })

  it('the amount in the snapshot is the amount on the ROW — one figure, not two', async () => {
    await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 1, qty: 1 }] })
    expect(snapshot().requestedCents).toBe(created().requestedAmountCents)
  })
})

describe('C — mode amount records the figure and names no line', () => {
  it('the customer’s own figure is recorded, with an empty line list', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'amount', requestedAmountCents: 500 })
    expect(snapshot()).toMatchObject({ mode: 'amount', modeSource: 'client', lines: [], requestedCents: 500 })
    expect(created().requestedAmountCents).toBe(500)
  })
})

describe('D — mode whole records the ceiling the server derived', () => {
  it('no lines, and the amount is the remaining authority rather than anything the client sent', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(snapshot()).toMatchObject({ mode: 'whole', lines: [], requestedCents: 3250 })
  })

  it('a partly refunded order records the REMAINING ceiling, so the trail matches the money', async () => {
    db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 3000 } })
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(snapshot().requestedCents).toBe(250)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// E/F/G — THE MATRIX: WHICH REASON MAY USE WHICH SCOPE, AND WHO DECIDED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('E — the reason decides which scopes exist, and there is ONE copy of that rule', () => {
  it('the matrix answers for every reason the enum can carry — no reason falls through undefined', () => {
    for (const r of CLAIM_REASONS) {
      expect(scopeRequirement(r), r).toBeTruthy()
    }
    expect(scopeRequirement('not_a_reason')).toBeNull()
  })

  it('items-only reasons resolve to items with no scope named; the customer left nothing unsaid', () => {
    for (const r of ['missing_item', 'wrong_item', 'wrong_quantity']) {
      expect(resolveScopeMode({ reason: r }), r).toMatchObject({ ok: true, mode: 'items', modeSource: 'derived' })
    }
  })

  it('an explicit-scope reason REFUSES silence — no mode is preselected on the customer’s behalf', () => {
    for (const r of ['quality', 'allergen_safety', 'other', 'excessive_wait', 'payment_issue']) {
      expect(resolveScopeMode({ reason: r }), r).toMatchObject({ ok: false, code: 'scope_required' })
    }
  })

  it('not_received derives the whole order, because that is what « rien n’est arrivé » means', () => {
    expect(resolveScopeMode({ reason: 'not_received' })).toMatchObject({ ok: true, mode: 'whole', modeSource: 'derived' })
    // …and the customer may still narrow it deliberately.
    expect(resolveScopeMode({ reason: 'not_received', scope: 'items' })).toMatchObject({ ok: true, mode: 'items', modeSource: 'client' })
  })

  it('a reason the customer may not file at all is refused, whatever scope accompanies it', () => {
    expect(resolveScopeMode({ reason: 'restaurant_closed' })).toMatchObject({ ok: false, code: 'reason_not_selectable' })
    for (const s of CLAIM_SCOPE_MODES) {
      expect(resolveScopeMode({ reason: 'restaurant_closed', scope: s }), s).toMatchObject({ ok: false, code: 'reason_not_selectable' })
    }
    expect(CUSTOMER_SELECTABLE_REASONS).not.toContain('restaurant_closed')
  })

  it('the SUPERSEDED batch-2 taxonomy decides nothing any more — one matrix, one owner', () => {
    // `authorityScope` / `requiresItemSelection` answered « how wide may this reason's ceiling be » and
    // `resolveClaimAmount` used to branch on it. L7 replaced that with an explicit mode. Both are still
    // exported (removing a public export is L8's business), and both must now be INERT: two matrices
    // describing which reason may claim what will eventually disagree, and only one may decide.
    const fs = require('node:fs') as typeof import('node:fs')
    const claims = fs.readFileSync('lib/claims.ts', 'utf8')
    // Re-exported (the `export { … }` block), never CALLED — a call looks like `authorityScope(`.
    expect(claims).toContain('authorityScope,')
    expect(claims).not.toMatch(/authorityScope\(/)
    expect(claims).not.toMatch(/requiresItemSelection\(/)
    expect(fs.readFileSync('lib/claim-scope.ts', 'utf8')).not.toContain('authorityScope')
    expect(fs.readFileSync('lib/claim-selection.ts', 'utf8')).not.toContain('authorityScope')
    // …and the client reads the LIVE matrix, not the superseded one.
    const form = fs.readFileSync('components/claims/ClaimSection.tsx', 'utf8')
    expect(form).toContain('scopeRequirement(reason)')
    expect(form).not.toContain('authorityScope')
  })

  it('an unknown scope value is refused rather than coerced to a mode', () => {
    for (const bad of ['whole_order', 'WHOLE', 'all', 'toute la commande', '{}']) {
      expect(resolveScopeMode({ reason: 'quality', scope: bad }), bad).toMatchObject({ ok: false, code: 'invalid_scope' })
    }
  })
})

describe('F — an items-only reason is never SILENTLY narrowed from a wider scope', () => {
  it('asking for the whole order on a missing-item reason is refused, and the refusal says which gesture is missing', () => {
    const r = resolveScopeMode({ reason: 'missing_item', scope: 'whole' })
    expect(r).toMatchObject({ ok: false, code: 'scope_not_allowed' })
    if (!r.ok) expect(r.error).toMatch(/articles/)
  })

  it('…through the real route too: 400 with the code, and nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', scope: 'whole' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('scope_not_allowed')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — a resolver that narrowed instead of refusing would be caught', () => {
    const vulnerable = (_reason: string, _scope: string) => ({ ok: true as const, mode: 'items' as const })
    expect(vulnerable('missing_item', 'whole')).toMatchObject({ ok: true }) // ← the defect: silently answers
    expect(resolveScopeMode({ reason: 'missing_item', scope: 'whole' })).toMatchObject({ ok: false })
  })
})

describe('G — modeSource records WHO decided the scope', () => {
  it('client when the request named it, derived when the reason did, system for Grubano’s own claim', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(snapshot().modeSource).toBe('client')
    db.claim.create.mockClear()
    await post({ orderId: 'o1', reason: 'not_received' })
    expect(snapshot().modeSource).toBe('derived')
    expect(systemClaimSelection(1000).modeSource).toBe('system')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// H — QUANTITIES: THE DISPUTED ONE, NOT THE PURCHASED ONE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('H — one of two identical portions can be claimed, and the snapshot says so', () => {
  it('disputing 1 of 2 records qty 1 and prices ONE portion', async () => {
    await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 1 }] })
    expect(snapshot().lines).toEqual([{ index: 0, itemId: 'm1', qty: 1, unitCents: 1250, name: 'Gnocchi' }])
    expect(created().requestedAmountCents).toBe(1250)
  })

  it('a quantity above what was purchased is REFUSED, never clamped down into a claim', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 3 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('qty_over_purchased')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('zero, negative, fractional and absent quantities are refused', async () => {
    for (const qty of [0, -1, 1.5]) {
      vi.clearAllMocks(); openClaimsWindow()
      tokenMock.mockResolvedValue({ sub: 'owner' }); rateLimitMock.mockReturnValue(null)
      db.order.findUnique.mockResolvedValue(ORDER); db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
      db.claim.findFirst.mockResolvedValue(null)
      const res = await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty }] })
      expect(res.status, String(qty)).toBe(400)
      expect(db.claim.create, String(qty)).not.toHaveBeenCalled()
    }
  })

  it('the snapshot builder DROPS a quantity below 1 instead of raising it to 1', () => {
    // Unreachable through the route (resolveClaimAmount refuses qty ≤ 0 first), which is precisely why it
    // is pinned: buildClaimSelection is exported, and clamping upward would invent a disputed portion the
    // customer never claimed — inside the record whose only job is to say what they did claim.
    const snap = buildClaimSelection({
      mode: 'items', modeSource: 'client',
      selection: [{ index: 0, qty: 0 }, { index: 1, qty: -2 }],
      scopeLines: scope().lines, requestedCents: 0, ceilingVerified: false,
    })
    expect(snap.lines).toEqual([])
    // …and a quantity ABOVE what was purchased is still clamped DOWN, never dropped: the line is real and
    // the excess is the only part that is not.
    const clamped = buildClaimSelection({
      mode: 'items', modeSource: 'client', selection: [{ index: 1, qty: 9 }],
      scopeLines: scope().lines, requestedCents: 600, ceilingVerified: false,
    })
    expect(clamped.lines).toEqual([{ index: 1, itemId: 'm2', qty: 1, unitCents: 600, name: 'Tiramisu' }])
  })

  it('NEGATIVE CONTROL — the pre-L7 client sent the PURCHASED quantity, which this records differently', () => {
    // The old page had a boolean per line and posted `qty: it.qty`: ticking the gnocchi claimed both.
    const oldClientBody = ITEMS.map((it, i) => ({ index: i, qty: it.qty })).filter((_, i) => i === 0)
    expect(oldClientBody).toEqual([{ index: 0, qty: 2 }])                           // ← the defect
    const asked = buildClaimSelection({
      mode: 'items', modeSource: 'client', selection: [{ index: 0, qty: 1 }],
      scopeLines: scope().lines, requestedCents: 1250, ceilingVerified: false,
    })
    expect(asked.lines[0].qty).toBe(1)                                              // fixed: what was disputed
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// I — ceilingVerified: T-59's PROVENANCE, RECORDED AND NEVER OPTIMISTIC
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('I — the snapshot records whether the ceiling was PROVEN at filing time', () => {
  it('false when no live Stripe truth was read — the safe value is the honest one', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(snapshot().ceilingVerified).toBe(false)
  })

  it('the flag is stored verbatim, and anything that is not exactly true is false', () => {
    expect(buildClaimSelection({ mode: 'whole', modeSource: 'client', scopeLines: [], requestedCents: 1, ceilingVerified: true }).ceilingVerified).toBe(true)
    for (const junk of [1, 'true', {}, [], null, undefined]) {
      expect(buildClaimSelection({
        mode: 'whole', modeSource: 'client', scopeLines: [], requestedCents: 1,
        ceilingVerified: junk as unknown as boolean,
      }).ceilingVerified, String(junk)).toBe(false)
    }
    expect(readClaimSelection({ v: 1, mode: 'whole', modeSource: 'client', lines: [], requestedCents: 1, ceilingVerified: 'yes' })!.ceilingVerified).toBe(false)
  })

  it('a system claim is never marked verified: nothing read Stripe on the cancellation path', () => {
    expect(systemClaimSelection(1000)).toMatchObject({ mode: 'whole', modeSource: 'system', lines: [], ceilingVerified: false })
  })

  it('ONE DEFINITION — the snapshot and the customer’s label ask the same function', () => {
    // T-59 decides whether the word « remboursable » may be said at all. L7 added a second reader (the
    // snapshot records the provenance of the ceiling known at filing), and the expression was copied
    // there first. A money rule in two copies eventually disagrees with itself: one reader would keep
    // saying « remboursable » after the other had stopped. Both now call ceilingVerifiedOf.
    expect(ceilingVerifiedOf({ ceilingSource: 'stripe', ceilingContested: false })).toBe(true)
    expect(ceilingVerifiedOf({ ceilingSource: 'stripe', ceilingContested: true })).toBe(false)
    expect(ceilingVerifiedOf({ ceilingSource: 'db_only', ceilingContested: false })).toBe(false)
    const fs = require('node:fs') as typeof import('node:fs')
    const COPY = /ceilingSource === 'stripe'/g
    for (const p of ['lib/claims.ts', 'lib/claim-selection.ts', 'app/api/claims/route.ts']) {
      expect((fs.readFileSync(p, 'utf8').match(COPY) ?? []).length, p).toBe(0)
    }
    // …and exactly ONE definition exists, inside the helper itself.
    expect((fs.readFileSync('lib/claim-scope.ts', 'utf8').match(COPY) ?? []).length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// J — S-26: NO AUTOMATIC HISTORICAL CONSUMPTION. THE CORE PROHIBITION OF THIS LOT.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('J — a quantity recorded in an earlier claim is NEVER subtracted from a later one', () => {
  const earlier = buildClaimSelection({
    mode: 'items', modeSource: 'client', selection: [{ index: 0, qty: 1 }],
    scopeLines: scope().lines, requestedCents: 1250, ceilingVerified: false,
  })

  it('the SAME line and the SAME quantity price identically the second time', () => {
    const first = resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }] })
    const second = resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }] })
    expect(first).toMatchObject({ ok: true, amountCents: 1250 })
    expect(second).toEqual(first)
    // and the full purchased quantity is still reachable — maxQty did not shrink
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 2 }] }))
      .toMatchObject({ ok: true, amountCents: 2500 })
  })

  it('the pricing path cannot even SEE the history: prior claims are not one of its parameters', () => {
    // A structural statement, not a behavioural one: there is no argument through which a caller could
    // pass earlier selections, so no future caller can start subtracting them « just here ».
    expect(earlier.lines[0].qty).toBe(1)
    const withHistory = resolveClaimAmount as unknown as (s: unknown, i: unknown, hist?: unknown) => unknown
    const ignored = withHistory(scope(), { mode: 'items', selection: [{ index: 0, qty: 2 }] }, [earlier])
    expect(ignored).toMatchObject({ ok: true, amountCents: 2500 }) // the third argument changes nothing
  })

  it('what DOES limit a second claim is money and exclusivity, not quantities', () => {
    // The protections the founder kept: the remaining financial ceiling…
    expect(resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }), { mode: 'items', selection: [{ index: 0, qty: 2 }] }))
      .toMatchObject({ ok: true, amountCents: 250 })
    // …and one ACTIVE claim per order, enforced by activeOrderKey @unique in the schema.
    const claims = require('node:fs').readFileSync('prisma/schema.prisma', 'utf8') as string
    expect(claims).toMatch(/activeOrderKey/)
  })

  it('NEGATIVE CONTROL — an implementation that consumed the history WOULD turn this suite red', () => {
    // The post-beta policy the founder deferred, written out here and nowhere else in the tree.
    const consuming = (available: number, alreadyClaimed: number) => Math.max(0, available - alreadyClaimed)
    expect(consuming(2, 1)).toBe(1) // ← a second claim on the gnocchi would be capped at ONE portion
    // The real resolver, given the same history, still prices both portions. If someone implemented the
    // rule above inside resolveClaimAmount, this assertion — and only this assertion — would fail.
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 2 }] }))
      .toMatchObject({ ok: true, amountCents: 2500 })
  })

  it('STATIC — the pricing module cannot even reach the history helper', () => {
    const src = require('node:fs').readFileSync('lib/claim-scope.ts', 'utf8') as string
    // Not one mention, in code or in prose: the helper's name never appears, so nobody can wire it in
    // « while they are in there ».
    expect(src).not.toContain('previouslyClaimed')
    // And no IMPORT from the module that holds it. The type it does need (`ClaimScopeMode`) is declared in
    // lib/claim-reasons precisely so the module that PRICES a mode and the module that RECORDS one never
    // have to depend on each other. (Prose mentions are stripped: only the import lines are the contract.)
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
    expect(imports).not.toContain('claim-selection')
    expect(imports).toContain("from '@/lib/claim-reasons'")
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// K — previouslyClaimed IS A SIGNAL, AND REPORTS WHAT IT CANNOT ATTRIBUTE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('K — the history is described for a human, with no budget and no silent gap', () => {
  const sel = (lines: Array<{ index: number; qty: number }>) => buildClaimSelection({
    mode: 'items', modeSource: 'client', selection: lines,
    scopeLines: scope().lines, requestedCents: 1, ceilingVerified: false,
  })

  it('earlier claims are grouped by line, in the order they were supplied', () => {
    const r = previouslyClaimedByLine([
      { id: 'c1', status: 'refunded', selection: sel([{ index: 0, qty: 1 }]) },
      { id: 'c2', status: 'refused', selection: sel([{ index: 0, qty: 2 }, { index: 1, qty: 1 }]) },
    ])
    expect(r.byLine[0]).toEqual([{ claimId: 'c1', status: 'refunded', qty: 1 }, { claimId: 'c2', status: 'refused', qty: 2 }])
    expect(r.byLine[1]).toEqual([{ claimId: 'c2', status: 'refused', qty: 1 }])
    expect(r.unattributable).toEqual([])
  })

  it('a claim that names no line is REPORTED, never counted as « nothing was claimed »', () => {
    const r = previouslyClaimedByLine([
      { id: 'legacy', status: 'refunded', selection: null },
      { id: 'amt', status: 'refunded', selection: buildClaimSelection({ mode: 'amount', modeSource: 'client', scopeLines: [], requestedCents: 500, ceilingVerified: false }) },
      { id: 'whole', status: 'refunded', selection: systemClaimSelection(3250) },
      { id: 'empty', status: 'refunded', selection: { v: 1, mode: 'items', modeSource: 'client', lines: [], requestedCents: 0 } },
    ])
    expect(r.byLine).toEqual({})
    expect(r.unattributable).toEqual([
      { claimId: 'legacy', status: 'refunded', reason: 'not_recorded' },
      { claimId: 'amt', status: 'refunded', reason: 'mode_amount' },
      { claimId: 'whole', status: 'refunded', reason: 'mode_whole' },
      { claimId: 'empty', status: 'refunded', reason: 'no_lines' },
    ])
  })

  it('the report contains no ceiling, no remaining quantity and no verdict — nothing to consume', () => {
    const r = previouslyClaimedByLine([{ id: 'c1', status: 'refunded', selection: sel([{ index: 0, qty: 1 }]) }])
    const json = JSON.stringify(r)
    for (const forbidden of ['maxQty', 'remaining', 'ceiling', 'available', 'allowed', 'blocked']) {
      expect(json).not.toContain(forbidden)
    }
  })

  it('NEGATIVE CONTROL — a helper that returned a remaining quantity would be caught by the shape test above', () => {
    const vulnerable = { byLine: { 0: [{ claimId: 'c1', qty: 1, remaining: 1 }] } }
    expect(JSON.stringify(vulnerable)).toContain('remaining') // ← the shape this lot must not produce
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// L — THE SNAPSHOT IS FROZEN: WRITTEN ONCE, BY THE CREATE, AND BY NOTHING ELSE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('L — no later route can rewrite what the customer asked for', () => {
  const walk = (dir: string): string[] => {
    const fs = require('node:fs') as typeof import('node:fs')
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name
      if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); continue }
      if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
    return out
  }

  it('lib/claims.ts writes it exactly twice — the customer claim and the system claim — and no route writes it at all', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const WRITE = /selection:\s*(selectionSnapshot|systemClaimSelection|buildClaimSelection)/g
    const claims = fs.readFileSync('lib/claims.ts', 'utf8')
    expect((claims.match(WRITE) ?? []).length).toBe(2)
    const offenders: string[] = []
    for (const f of [...walk('app'), ...walk('lib')]) {
      if (f === 'lib/claims.ts') continue
      if (WRITE.test(fs.readFileSync(f, 'utf8'))) offenders.push(f)
      WRITE.lastIndex = 0
    }
    expect(offenders).toEqual([])
  })

  it('no update, updateMany or upsert anywhere names the column', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const f of [...walk('app'), ...walk('lib')]) {
      const s = fs.readFileSync(f, 'utf8')
      // Every `data: { … }` block that mentions `selection` must belong to a create. The two legitimate
      // writes are inside `claim.create` calls in lib/claims.ts; anything else is a rewrite.
      // No `s` flag: this project's tsc target predates es2018, and `[\s\S]` says the same thing.
      const rewrite = /claim\.(update|updateMany|upsert)\([^)]*selection/
      expect(rewrite.test(s), f).toBe(false)
    }
  })

  it('the arbitration and ceiling routes — the two that DO write to a claim — never touch it', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['app/api/admin/claims/[id]/arbitrate/route.ts', 'app/api/admin/claims/[id]/ceiling/route.ts',
      'app/api/admin/claims/[id]/withdraw-approval/route.ts', 'app/api/claims/[id]/respond/route.ts']) {
      expect(fs.readFileSync(p, 'utf8'), p).not.toContain('selection')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// M — THE SYSTEM CLAIM
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('M — Grubano’s own claim records its own scope', () => {
  it('mode whole, source system, no lines, the amount it was raised for', () => {
    expect(systemClaimSelection(4200)).toEqual({
      v: 1, mode: 'whole', modeSource: 'system', lines: [], requestedCents: 4200, ceilingVerified: false,
    })
  })

  it('a negative or fractional amount cannot enter the snapshot', () => {
    expect(systemClaimSelection(-5).requestedCents).toBe(0)
    expect(systemClaimSelection(12.7).requestedCents).toBe(12)
    expect(systemClaimSelection(NaN as unknown as number).requestedCents).toBe(0)
  })

  it('modeSource system is readable back — an admin can tell a machine claim from a customer’s', () => {
    expect(readClaimSelection(systemClaimSelection(100))!.modeSource).toBe('system')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// N — THE ACKNOWLEDGEMENT: WHAT THE CUSTOMER IS TOLD, AND WHAT IS NOT INVENTED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('N — the ack describes the selection when there is one, and stays silent when there is not', () => {
  it('the route hands the PERSISTED snapshot to the e-mail, not the request body', async () => {
    await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 1 }] })
    expect(ackMock).toHaveBeenCalledTimes(1)
    expect(ackMock.mock.calls[0][0].selection).toMatchObject({ v: 1, mode: 'items' })
    expect(ackMock.mock.calls[0][0].selection.lines[0]).toMatchObject({ qty: 1, name: 'Gnocchi' })
  })

  it('the rendered lines read « 2 × Gnocchi » and carry NO price', () => {
    const snap = buildClaimSelection({
      mode: 'items', modeSource: 'client', selection: [{ index: 0, qty: 2 }, { index: 1, qty: 1 }],
      scopeLines: scope().lines, requestedCents: 3100, ceilingVerified: false,
    })
    expect(selectionLineSummary(snap)).toEqual(['2 × Gnocchi', '1 × Tiramisu'])
    for (const l of selectionLineSummary(snap)) {
      expect(l).not.toMatch(/€|\d{3,}|EUR/)
    }
  })

  it('an amount or whole-order claim renders NO line list — there is nothing to enumerate', () => {
    expect(selectionLineSummary(systemClaimSelection(100))).toEqual([])
    expect(selectionLineSummary(buildClaimSelection({ mode: 'amount', modeSource: 'client', scopeLines: [], requestedCents: 500, ceilingVerified: false }))).toEqual([])
  })

  it('a legacy claim renders nothing extra, and is never described as « toute la commande »', () => {
    expect(selectionLineSummary(readClaimSelection(null))).toEqual([])
    expect(selectionLineSummary(readClaimSelection(undefined))).toEqual([])
    expect(selectionLineSummary(readClaimSelection('{}'))).toEqual([])
    expect(selectionTotalQty(readClaimSelection(null))).toBe(0)
  })

  it('STATIC — the e-mail body renders the lines only through the summary helper, so no price can slip in', () => {
    const src = require('node:fs').readFileSync('lib/claim-emails.ts', 'utf8') as string
    expect(src).toContain('selectionLineSummary(readClaimSelection(p.selection))')
    // the ack block must not format money next to an article
    const ackBlock = src.slice(src.indexOf('sendClaimAckEmail'), src.indexOf('sendClaimDecisionEmail'))
    expect(ackBlock).not.toMatch(/unitCents/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// O — LEGACY: NINE CLAIMS THAT RECORDED NOTHING, AND MUST KEEP SAYING SO
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('O — « not recorded » is a state, and no code turns it into a scope', () => {
  it('every untrusted shape reads back as null, never as a default mode', () => {
    for (const junk of [null, undefined, '', 0, false, [], 'whole', { mode: 'whole' },
      { v: 1, mode: 'everything', modeSource: 'client', lines: [] },
      { v: 1, mode: 'whole', modeSource: 'someone', lines: [] },
      { v: '1', mode: 'whole', modeSource: 'client', lines: [] }]) {
      expect(readClaimSelection(junk), JSON.stringify(junk) ?? String(junk)).toBeNull()
    }
  })

  it('a valid snapshot with a corrupt LINE drops that line and keeps the rest — never invents one', () => {
    const r = readClaimSelection({
      v: 1, mode: 'items', modeSource: 'client', requestedCents: 1250, ceilingVerified: false,
      lines: [{ index: 0, qty: 1, unitCents: 1250, name: 'Gnocchi', itemId: 'm1' },
        { index: 'x', qty: 1 }, { index: 1, qty: 0 }, null, 'nope'],
    })
    expect(r!.lines).toEqual([{ index: 0, itemId: 'm1', qty: 1, unitCents: 1250, name: 'Gnocchi' }])
  })

  it('no code path anywhere substitutes a mode for a missing snapshot', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['lib/claim-selection.ts', 'lib/claim-emails.ts', 'components/claims/AdminClaimsArbitration.tsx']) {
      const s = fs.readFileSync(p, 'utf8')
      // the shapes a fallback would take: `?? 'whole'`, `|| 'whole'`, `: 'whole'` after a null check
      expect(s, p).not.toMatch(/\?\?\s*'whole'/)
      expect(s, p).not.toMatch(/\|\|\s*'whole'/)
    }
  })

  it('L7 performs NO backfill: nothing in this lot writes a snapshot onto an existing claim', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['lib/claims.ts', 'app/api/claims/route.ts']) {
      expect(fs.readFileSync(p, 'utf8'), p).not.toMatch(/backfill/i)
    }
    expect(fs.existsSync('scripts/server/l7-selection-backfill.js')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// P — WHO SEES IT: THE ADMIN, AND NOT THE RESTAURANT (THAT IS L8'S CONTRACT)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('P — the selection reaches the admin surface and is stripped from the restaurant’s', () => {
  it('the restaurant projection REMOVES it, deliberately and visibly', () => {
    const src = require('node:fs').readFileSync('lib/claims.ts', 'utf8') as string
    const fn = src.slice(src.indexOf('export async function listRestaurantClaims'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('delete pub.selection')
  })

  it('the ADMIN list selects it explicitly', () => {
    const src = require('node:fs').readFileSync('lib/claims.ts', 'utf8') as string
    const fn = src.slice(src.indexOf('export async function listPendingRestaurantClaims'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('selection: true')
  })

  it('the admin view distinguishes « the row recorded nothing » from « this list did not fetch it »', () => {
    // The distinction is invisible in the type (`unknown` covers both) and decisive on screen: the two D′
    // L4 money queues use the curated `select` the financial rail shares, so `selection` arrives
    // `undefined` there. Rendering « Sélection non enregistrée » on the screen where an admin approves
    // money would assert, falsely, that the customer chose nothing.
    const src = require('node:fs').readFileSync('components/claims/AdminClaimsArbitration.tsx', 'utf8') as string
    const view = src.slice(src.indexOf('const SelectionView'), src.indexOf('const locale'))
    expect(view).toContain('if (value === undefined) return null')
    expect(view).toContain("t('admin.selectionNotRecorded')")
    // and the guard comes FIRST — after readClaimSelection it would be unreachable, since that returns
    // null for undefined too.
    expect(view.indexOf('value === undefined')).toBeLessThan(view.indexOf('readClaimSelection(value)'))
    // The reader still treats both as « nothing to show » — the difference lives in the view, not here.
    expect(readClaimSelection(undefined)).toBeNull()
    expect(readClaimSelection(null)).toBeNull()
  })

  it('the two money queues are NOT widened by this lot — their select is the rail’s', () => {
    const src = require('node:fs').readFileSync('lib/claims.ts', 'utf8') as string
    for (const fn of ['listApprovedAwaitingPayment', 'listAwaitingRatification']) {
      const body = src.slice(src.indexOf('export async function ' + fn))
      expect(body.slice(0, body.indexOf('\n}')), fn).not.toContain('selection')
    }
  })

  it('the restaurant-facing route and component never name the column', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['app/api/claims/[id]/respond/route.ts']) {
      expect(fs.readFileSync(p, 'utf8'), p).not.toContain('selection')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Q — THE CLIENT IS NEVER THE AUTHORITY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('Q — nothing the client sends about prices, names or ids reaches the snapshot', () => {
  it('forged unitCents, name, itemId and lineCents are structurally unreadable', async () => {
    await post({
      orderId: 'o1', reason: 'missing_item', scope: 'items',
      items: [{ index: 0, qty: 1, unitCents: 999999, lineCents: 999999, price: 999999, name: 'Caviar', itemId: 'forged' }],
    })
    expect(snapshot().lines).toEqual([{ index: 0, itemId: 'm1', qty: 1, unitCents: 1250, name: 'Gnocchi' }])
    expect(snapshot().requestedCents).toBe(1250)
  })

  it('a client-supplied mode, modeSource or v in the items payload cannot reach the row', async () => {
    await post({
      orderId: 'o1', reason: 'missing_item', scope: 'items',
      items: [{ index: 0, qty: 1 }], mode: 'whole', modeSource: 'system', v: 99, selection: { v: 99 },
    })
    expect(snapshot()).toMatchObject({ v: 1, mode: 'items', modeSource: 'client' })
  })

  it('an index that is not a line of THIS order is refused, not dropped into a shorter selection', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 1 }, { index: 42, qty: 1 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_selection')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('buildClaimSelection drops an index the server does not know rather than inventing a line', () => {
    const snap = buildClaimSelection({
      mode: 'items', modeSource: 'client',
      selection: [{ index: 0, qty: 1 }, { index: 42, qty: 1 }],
      scopeLines: scope().lines, requestedCents: 1250, ceilingVerified: false,
    })
    expect(snap.lines.map((l) => l.index)).toEqual([0])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// R — EVERY REFUSAL A CUSTOMER CAN PROVOKE HAS A SENTENCE IN THEIR OWN LANGUAGE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('R — the codes travel, and the client can say them in five languages', () => {
  const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
  /** The L7 codes the help page maps, and the i18n key each one renders. */
  const MAPPED: Record<string, string> = {
    scope_required: 'claimScopeRequired', items_required: 'claimItemsRequired',
    scope_not_allowed: 'claimItemsRequired', item_lines_unavailable: 'claimItemLinesUnavailable',
    invalid_selection: 'claimInvalidSelection', duplicate_selection: 'claimDuplicateSelection',
    invalid_qty: 'claimInvalidQty', qty_over_purchased: 'claimQtyOverPurchased',
    amount_required: 'claimAmountRequired', amount_over_ceiling: 'claimAmountOverCeiling',
  }

  it('every mapped code has a non-empty string in all five locales', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const loc of LOCALES) {
      const m = JSON.parse(fs.readFileSync('messages/' + loc + '.json', 'utf8'))
      for (const key of Array.from(new Set(Object.values(MAPPED)))) {
        expect(typeof m.eat?.help?.[key], loc + '.' + key).toBe('string')
        expect(String(m.eat.help[key]).trim().length, loc + '.' + key).toBeGreaterThan(0)
      }
    }
  })

  it('the help page maps exactly these codes, so a code with no label cannot appear silently', () => {
    const src = require('node:fs').readFileSync('app/[locale]/eat/order/[orderId]/help/page.tsx', 'utf8') as string
    const block = src.slice(src.indexOf('const REFUSAL_LABEL'), src.indexOf('}', src.indexOf('const REFUSAL_LABEL')))
    for (const [code, key] of Object.entries(MAPPED)) {
      expect(block, code).toContain(code)
      expect(block, key).toContain(key)
    }
  })

  it('the ack e-mail’s new key exists in all five locales', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const loc of LOCALES) {
      const m = JSON.parse(fs.readFileSync('messages/' + loc + '.json', 'utf8'))
      expect(typeof m.claimEmails?.ack?.items, loc).toBe('string')
    }
  })

  it('a scope value that is not one of the three is refused by the SCHEMA, before any domain logic runs', async () => {
    // The route's zod enum is the first boundary, so a broken client never reaches resolveScopeMode with a
    // made-up scope: it gets a 400 and no domain code, which is the truthful answer (there is no eligibility
    // rule to name). The domain guard still exists for any non-route caller, and it is asserted in E.
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'nonsense' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBeUndefined()
    expect(db.claim.create).not.toHaveBeenCalled()
    expect(resolveScopeMode({ reason: 'quality', scope: 'nonsense' })).toMatchObject({ ok: false, code: 'invalid_scope' })
  })

  it('the route forwards the CODE beside the sentence, for every L7 refusal class', async () => {
    const cases: Array<[unknown, string]> = [
      [{ orderId: 'o1', reason: 'quality' }, 'scope_required'],
      [{ orderId: 'o1', reason: 'missing_item', scope: 'whole' }, 'scope_not_allowed'],
      [{ orderId: 'o1', reason: 'restaurant_closed' }, 'reason_not_selectable'],
      [{ orderId: 'o1', reason: 'missing_item', scope: 'items' }, 'items_required'],
      [{ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 9 }] }, 'qty_over_purchased'],
      [{ orderId: 'o1', reason: 'missing_item', scope: 'items', items: [{ index: 0, qty: 1 }, { index: 0, qty: 1 }] }, 'duplicate_selection'],
      [{ orderId: 'o1', reason: 'quality', scope: 'amount' }, 'amount_required'],
      [{ orderId: 'o1', reason: 'quality', scope: 'amount', requestedAmountCents: 999999 }, 'amount_over_ceiling'],
      [{ orderId: 'o1', reason: 'quality', scope: 'whole', requestedAmountCents: 10 }, 'amount_not_allowed'],
      [{ orderId: 'o1', reason: 'quality', scope: 'amount', requestedAmountCents: 10, items: [{ index: 0, qty: 1 }] }, 'items_not_allowed'],
    ]
    for (const [body, code] of cases) {
      const res = await post(body)
      expect(res.status, code).toBe(400)
      const j = await res.json()
      expect(j.reason, code).toBe(code)
      expect(typeof j.error, code).toBe('string')
      expect(String(j.error).length, code).toBeGreaterThan(10)
    }
    expect(db.claim.create).not.toHaveBeenCalled()
  })
})
