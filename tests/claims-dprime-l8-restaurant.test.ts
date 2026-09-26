// tests/claims-dprime-l8-restaurant.test.ts — D′ L8 (S-19 / T-46): THE RESTAURANT CONTRACT
//
// The letters A–V are the founder's mandatory list. Three properties carry the lot, and each has its own
// negative control because each would fail SILENTLY:
//
//  • ZERO LEAK. The projection used to be a whole-row serialisation whose only redaction was one `delete`.
//    Nothing rendered the extra fields, so nothing failed — the payload just happened to be ignored. Test A
//    builds a Claim with EVERY sensitive column populated and asserts none of them survives; test B adds a
//    column that does not exist in the model and asserts it does not appear either, which is the property a
//    curated `select` cannot give you (it fixes today and leaks on the next widening).
//  • FIGURES OR SILENCE. The restaurant is told money only from the ledger line of the Stripe refund. The
//    tempting source — `Refund.applicationFeeRefundCents` / `restaurantReverseCents` — is a PREDICTION the
//    refund engine itself logs a mismatch against. Tests J–O drive the projection and assert both the exact
//    figures and, in every unproven shape, the ABSENCE of figures.
//  • NO MONEY FROM A RESTAURANT ACTION. Tests F/G/V answer a claim in a world where the refund engine is
//    armed and REFUNDS_ENABLED is true, and prove nothing moves.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

// ── the Prisma surface this lot reads, mocked method by method ────────────────────────────────────
const { db } = vi.hoisted(() => ({
  db: {
    claim:       { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    refund:      { findMany: vi.fn(), findUnique: vi.fn() },
    ledgerEntry: { findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    order:       { findMany: vi.fn(), findUnique: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
    operator:    { findUnique: vi.fn() },
    emailDispatch: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    emailLog:    { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// The engine is ARMED in this file on purpose: F/G/V prove a restaurant answer never reaches it.
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({
  executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 90_000,
}))
const { stripeMock } = vi.hoisted(() => ({ stripeMock: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ getStripe: stripeMock }))
// The route's owner scope: resolved from a session in production, which needs a request scope this runner
// does not have. The scope itself is tested where it belongs (tests/claims-routes.test.ts); here the
// subject is the GATE and the payload.
const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

import { listRestaurantClaims, respondToClaim, readClaimFinancialEffect } from '@/lib/claims'
import { RESTAURANT_STATUSES, restaurantClaimStatus, RESTAURANT_REFUNDED_TRIGGER, restaurantRefundedKey } from '@/lib/claim-action-rules'
import { RESTAURANT_VIEW_KEYS, RESTAURANT_FORBIDDEN_KEYS } from '@/lib/claim-restaurant-view'
import { buildClaimSelection } from '@/lib/claim-selection'

const DAY = 86_400_000

/** A Claim row with EVERY sensitive column populated — the §20 fixture. */
const FULL_CLAIM = {
  id: 'clm_aaaaaaaaaaaaaaaaaa1234', orderId: 'ord_aaaaaaaaaaaaaaaaab5678',
  consumerId: 'op_consumer_secret', restaurantId: 'r1',
  reason: 'missing_item', description: 'Il manquait les gnocchi.', photoUrl: 'https://cdn/x.jpg',
  requestedAmountCents: 1250, approvedAmountCents: 1000,
  status: 'restaurant_review',
  restaurantResponse: null, restaurantResponseReason: null,
  responseDeadlineAt: new Date(Date.now() + DAY), createdAt: new Date(Date.now() - DAY), decidedAt: null,
  decidedBy: 'admin', refundAttempted: true,
  refundId: 'rf_secret_row', refundError: 'no_refund_proven_rail_locked: la ligne rf_secret_row de re_SECRET est morte — décision humaine requise.',
  activeOrderKey: 'ord_aaaaaaaaaaaaaaaaab5678',
  contestedAt: new Date(), contestReason: 'Le client insiste.',
  arbitratedBy: 'op_admin_secret', arbitrationDecision: 'approved', arbitrationReason: 'Note interne Grubano.',
  arbitratedAt: new Date(),
  selection: buildClaimSelection({
    mode: 'items', modeSource: 'client', selection: [{ index: 0, qty: 2 }],
    scopeLines: [{ index: 0, itemId: 'm1', name: 'Gnocchi', maxQty: 2, unitCents: 1250, lineCents: 2500 }],
    requestedCents: 2500, ceilingVerified: true,
  }),
}

/** The three integers of a refund ledger line, from the two Stripe facts (lib/ledger's own mapping). */
const z = (n: number) => (n === 0 ? 0 : n)
const ledgerLine = (refund: number, reversal: number, feeBack: number) => ({
  sourceEventId: 're_1',
  grossAmount:          z(-refund),
  applicationFeeAmount: z(-(refund - reversal + feeBack)),
  netToRestaurant:      z(-(reversal - feeBack)),
})

/** Install a world. Everything defaults to « nothing known », so a test states only what it needs. */
function world(o: {
  claims?: Array<Record<string, unknown>>
  refunds?: Array<Record<string, unknown>>
  binders?: Array<{ refundId: string; _count: { _all: number } }>
  ledger?: Array<Record<string, unknown>>
  feeCharged?: number | null
  priors?: Array<Record<string, unknown>>
  throwOn?: string[]
} = {}) {
  const t = new Set(o.throwOn ?? [])
  const claims = o.claims ?? []
  db.claim.findMany.mockImplementation(async (args: { where?: Record<string, unknown>; take?: number }) => {
    if (t.has('claim.findMany')) throw new Error('claim.findMany down')
    // The prior-claims read is the one with take 400 (keyed on orderId).
    if (args?.take === 400) {
      if (t.has('claim.findMany:priors')) throw new Error('priors read down')
      return o.priors ?? claims
    }
    const w = (args?.where ?? {}) as { status?: string; NOT?: { status?: string } }
    if (typeof w.status === 'string') return claims.filter((c) => c.status === w.status)
    if (w.NOT?.status) return claims.filter((c) => c.status !== w.NOT!.status)
    return claims
  })
  db.refund.findMany.mockImplementation(async () => {
    if (t.has('refund.findMany')) throw new Error('refund.findMany down')
    return o.refunds ?? []
  })
  db.claim.groupBy.mockImplementation(async () => {
    if (t.has('claim.groupBy')) throw new Error('claim.groupBy down')
    return o.binders ?? []
  })
  db.ledgerEntry.findMany.mockImplementation(async () => {
    if (t.has('ledgerEntry.findMany')) throw new Error('ledgerEntry.findMany down')
    return o.ledger ?? []
  })
  db.order.findMany.mockResolvedValue(claims.map((c) => ({ id: c.orderId, stripePaymentIntentId: 'pi_1' })))
  db.ledgerEntry.groupBy.mockImplementation(async () => (
    typeof o.feeCharged === 'number'
      ? [{ stripePaymentIntentId: 'pi_1', _sum: { applicationFeeAmount: o.feeCharged } }]
      : []
  ))
}

beforeEach(() => {
  vi.clearAllMocks()
  openClaimsWindow()
  refundsFlag.mockReturnValue(false)
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1' })
  stripeMock.mockImplementation(() => { throw new Error('this lot never calls Stripe') })
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['r1'], operatorId: 'op1' })
  world()
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// A — ZERO LEAK, ON A CLAIM WHERE EVERY SENSITIVE FIELD IS POPULATED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('A — the restaurant payload contains none of the internal fields', () => {
  it('a fully populated Claim projects to exactly the view’s own keys, and nothing else', async () => {
    world({ claims: [FULL_CLAIM] })
    const [view] = await listRestaurantClaims(['r1'])
    expect(Object.keys(view).sort()).toEqual([...RESTAURANT_VIEW_KEYS].sort())
  })

  it('not one forbidden field name appears anywhere in the SERIALISED payload, at any depth', async () => {
    world({ claims: [FULL_CLAIM] })
    const json = JSON.stringify(await listRestaurantClaims(['r1']))
    for (const k of RESTAURANT_FORBIDDEN_KEYS) expect(json, k).not.toContain(k)
  })

  it('not one internal VALUE survives either — the ids and the marker text are gone', async () => {
    world({ claims: [FULL_CLAIM] })
    const json = JSON.stringify(await listRestaurantClaims(['r1']))
    for (const v of ['op_consumer_secret', 'op_admin_secret', 'rf_secret_row', 're_SECRET',
      'no_refund_proven_rail_locked', 'Le client insiste', 'Note interne Grubano',
      FULL_CLAIM.orderId, 'modeSource', 'unitCents']) {
      expect(json, v).not.toContain(v)
    }
    // the ORDER is identified by its public reference, which is what the e-mails print
    expect(json).toContain('GR-')
  })

  it('NEGATIVE CONTROL — the projection this replaced fails every assertion above', async () => {
    // The old shape, reproduced: the whole row minus `selection`. Kept ONLY here.
    const old = { ...FULL_CLAIM } as Record<string, unknown>
    delete old.selection
    const json = JSON.stringify([{ ...old, safety: false }])
    const leaked = RESTAURANT_FORBIDDEN_KEYS.filter((k) => json.includes(k))
    // ← the defect: the payload carried the consumer's id, the engine marker, the arbitrator, the key…
    expect(leaked.length).toBeGreaterThan(8)
    expect(json).toContain('no_refund_proven_rail_locked')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// B — A FUTURE COLUMN CANNOT LEAK BY DEFAULT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('B — a column that does not exist yet does not appear either', () => {
  it('an extra field on the row is absent from the view, without anyone having listed it', async () => {
    // The row carries a column this build has never heard of. A curated `select` would have to be widened
    // for it to arrive — but a widening is exactly what happens when someone adds a field they DO want, and
    // then the new one rides along. The builder assigns keys by name, so this can never happen.
    world({ claims: [{ ...FULL_CLAIM, internalRiskScore: 0.97, operatorNoteDraft: 'ne pas montrer' }] })
    const json = JSON.stringify(await listRestaurantClaims(['r1']))
    expect(json).not.toContain('internalRiskScore')
    expect(json).not.toContain('operatorNoteDraft')
    expect(json).not.toContain('ne pas montrer')
  })

  it('STATIC — the projection never spreads a row, and the builder is the only assembler', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('lib/claims.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function listRestaurantClaims'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('buildRestaurantClaimView')
    // Spread INTO AN OBJECT is what leaks a row; a spread into an ARRAY (`[...claims, ...priorRows]`) copies
    // references and reaches no payload. The assertion names the shape that matters rather than the three
    // characters, so it cannot be satisfied by renaming a variable.
    for (const spread of ['{ ...c', '{ ...r', '{ ...row', '{ ...claim', '{...c']) expect(body, spread).not.toContain(spread)
    const view = fs.readFileSync('lib/claim-restaurant-view.ts', 'utf8')
    expect(view).not.toContain('...input')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// C / D — THE L7 SELECTION, SHOWN AND NEVER INVENTED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('C — mode items is rendered as articles and quantities', () => {
  it('« 2 × Gnocchi », and no unit price, item id or modeSource', async () => {
    world({ claims: [FULL_CLAIM] })
    const [view] = await listRestaurantClaims(['r1'])
    expect(view.selection).toEqual({ mode: 'items', lines: ['2 × Gnocchi'], requestedCents: 2500 })
  })
})

describe('D — a claim with no recorded selection is never described as a whole-order claim', () => {
  it('selection null → the view carries null, and the panel’s own copy says « non enregistrée »', async () => {
    world({ claims: [{ ...FULL_CLAIM, selection: null }] })
    const [view] = await listRestaurantClaims(['r1'])
    expect(view.selection).toBeNull()
    expect(JSON.stringify(view)).not.toContain('whole')
  })

  it('an unreadable snapshot is also null — never a mode guessed from a corrupt value', async () => {
    for (const junk of [{ v: 2, mode: 'whole' }, 'whole', 0, [], { mode: 'whole' }]) {
      world({ claims: [{ ...FULL_CLAIM, selection: junk }] })
      const [view] = await listRestaurantClaims(['r1'])
      expect(view.selection, JSON.stringify(junk)).toBeNull()
    }
  })

  it('STATIC — no fallback to a mode exists in the projection or the panel', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['lib/claim-restaurant-view.ts', 'components/claims/RestaurantClaimsPanel.tsx']) {
      const s = fs.readFileSync(p, 'utf8')
      expect(s, p).not.toMatch(/\?\?\s*'whole'/)
      expect(s, p).not.toMatch(/\|\|\s*'whole'/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// E — previouslyClaimed IS A SIGNAL, AND S-26 IS UNTOUCHED
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('E — an earlier claim on the same line is shown and consumes nothing', () => {
  const earlier = {
    ...FULL_CLAIM, id: 'clm_earlier_000000ffffff', status: 'refunded', refundError: null, refundId: null,
    selection: buildClaimSelection({
      mode: 'items', modeSource: 'client', selection: [{ index: 0, qty: 1 }],
      scopeLines: [{ index: 0, itemId: 'm1', name: 'Gnocchi', maxQty: 2, unitCents: 1250, lineCents: 2500 }],
      requestedCents: 1250, ceilingVerified: false,
    }),
  }

  it('the line carries the earlier claim’s display ref, its business status and its quantity', async () => {
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM, earlier] })
    const [view] = await listRestaurantClaims(['r1'])
    // The ARTICLE is part of the signal: without it a restaurateur reads « réclamation FFFFFF — 1 unité »
    // and never learns which dish, and a claim naming two lines prints twice indistinguishably.
    expect(view.previouslyClaimed.byLine[0]).toEqual([
      { claimRef: 'FFFFFF', status: expect.any(String), qty: 1, name: 'Gnocchi' },
    ])
    // A display handle, never the id.
    expect(JSON.stringify(view)).not.toContain(earlier.id)
  })

  it('an earlier claim with NO line is counted, not dropped — silence would read as « none »', async () => {
    const legacy = { ...earlier, id: 'clm_legacy_0000000aaaaaa', selection: null }
    const wholeOne = { ...earlier, id: 'clm_whole_00000000bbbbb', selection: buildClaimSelection({ mode: 'whole', modeSource: 'client', scopeLines: [], requestedCents: 500, ceilingVerified: false }) }
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM, legacy, wholeOne] })
    const [view] = await listRestaurantClaims(['r1'])
    expect(view.previouslyClaimed.byLine).toEqual({})
    expect(view.previouslyClaimed.unattributableCount).toBe(2)
  })

  it('S-26 — the signal carries no budget: no ceiling, no remaining quantity, no verdict', async () => {
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM, earlier] })
    const json = JSON.stringify((await listRestaurantClaims(['r1']))[0].previouslyClaimed)
    for (const w of ['maxQty', 'remaining', 'ceiling', 'available', 'allowed', 'blocked', 'consumed']) {
      expect(json, w).not.toContain(w)
    }
  })

  it('S-26 — and it changes NOTHING the customer may still claim', async () => {
    // The same order, the same line, an earlier refunded claim on it: the current claim's requested amount
    // and the view's own numbers are byte-identical to the world without any prior claim.
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM] })
    const [alone] = await listRestaurantClaims(['r1'])
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM, earlier] })
    const [withPrior] = await listRestaurantClaims(['r1'])
    expect(withPrior.requestedAmountCents).toBe(alone.requestedAmountCents)
    expect(withPrior.financialEffect).toEqual(alone.financialEffect)
    expect(withPrior.canRespond).toBe(alone.canRespond)
    // …and the ONLY difference between the two payloads is the signal itself.
    expect({ ...withPrior, previouslyClaimed: null }).toEqual({ ...alone, previouslyClaimed: null })
  })

  it('NEGATIVE CONTROL — a consuming rule would change the second claim, and nothing here does', () => {
    const consuming = (purchased: number, alreadyClaimed: number) => Math.max(0, purchased - alreadyClaimed)
    expect(consuming(2, 1)).toBe(1) // ← the post-beta policy, written out and implemented nowhere
    const fs = require('node:fs') as typeof import('node:fs')
    expect(fs.readFileSync('lib/claim-scope.ts', 'utf8')).not.toContain('previouslyClaimed')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// F / G / V — A RESTAURANT ANSWER MOVES NO MONEY, ARMED OR NOT
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('F/G/V — answering a claim never reaches the engine, a Refund row or Stripe', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', restaurantId: 'r1', status: 'restaurant_review' })
    db.claim.updateMany.mockResolvedValue({ count: 1 })
  })

  for (const [label, armed] of [['F (REFUNDS_ENABLED false)', false], ['G (REFUNDS_ENABLED true — the armed world)', true]] as const) {
    it(`${label} — accept routes to arbitration and moves 0`, async () => {
      refundsFlag.mockReturnValue(armed)
      db.claim.findUnique.mockResolvedValueOnce({ id: 'cl1', restaurantId: 'r1', status: 'restaurant_review' })
        .mockResolvedValueOnce({ id: 'cl1', orderId: 'o1', status: 'arbitration', restaurantResponse: 'accepted', decidedAt: null })
      const r = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept' })
      expect(r.ok).toBe(true)
      expect(execMock).not.toHaveBeenCalled()
      expect(stripeMock).not.toHaveBeenCalled()
      expect(db.claim.updateMany.mock.calls[0][0].data.status).toBe('arbitration')
      // and nothing wrote an approved amount or an arbitration decision
      const data = db.claim.updateMany.mock.calls[0][0].data as Record<string, unknown>
      for (const k of ['approvedAmountCents', 'arbitrationDecision', 'arbitratedBy', 'arbitratedAt', 'refundId', 'refundAttempted', 'selection']) {
        expect(data, k).not.toHaveProperty(k)
      }
    })

    it(`${label} — refuse is terminal-pending-contest and moves 0`, async () => {
      refundsFlag.mockReturnValue(armed)
      db.claim.findUnique.mockResolvedValueOnce({ id: 'cl1', restaurantId: 'r1', status: 'restaurant_review' })
        .mockResolvedValueOnce({ id: 'cl1', orderId: 'o1', status: 'refused', restaurantResponse: 'refused', decidedAt: new Date() })
      const r = await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action: 'refuse', reason: 'plat servi' })
      expect(r.ok).toBe(true)
      expect(execMock).not.toHaveBeenCalled()
      expect(stripeMock).not.toHaveBeenCalled()
      expect(db.claim.updateMany.mock.calls[0][0].data.status).toBe('refused')
    })
  }

  it('U — Claim.selection is untouched by an answer, in both directions', async () => {
    for (const action of ['accept', 'refuse'] as const) {
      vi.clearAllMocks()
      db.claim.findUnique.mockResolvedValueOnce({ id: 'cl1', restaurantId: 'r1', status: 'restaurant_review' })
        .mockResolvedValueOnce({ id: 'cl1', orderId: 'o1', status: 'refused', restaurantResponse: 'refused', decidedAt: null })
      db.claim.updateMany.mockResolvedValue({ count: 1 })
      await respondToClaim({ claimId: 'cl1', restaurantIds: ['r1'], action })
      for (const call of db.claim.updateMany.mock.calls) {
        expect(Object.keys(call[0].data as object), action).not.toContain('selection')
      }
    }
  })

  it('STATIC — the respond route names no money symbol, and ASSIGNS no arbitration field', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    // Comments stripped: the route's own comment EXPLAINS which internal fields it stopped forwarding, and
    // naming them in that explanation is not naming them in code.
    const src = fs.readFileSync('app/api/claims/[id]/respond/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const s of ['executeRefund', 'triggerClaimRefund', 'approvedAmountCents', 'arbitratedBy',
      'lib/refund', 'lib/stripe', 'refund.create']) {
      expect(src, s).not.toContain(s)
    }
    // `arbitrationDecision` IS named — as a TYPE (`arbitrationDecision?: string | null`), because the
    // derived label reads it. The distinction that matters is the colon: `x?:` is a declaration, `x:` is an
    // assignment into an object. Only the second could write it.
    expect(src).toContain('arbitrationDecision?:')
    expect(src).not.toMatch(/arbitrationDecision:\s/)
    expect(src).not.toMatch(/arbitratedAt/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// J / K / L / M / N / O — THE FINANCIAL BLOCK, THROUGH THE PROJECTION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('the T-46 block on a refunded claim, end to end', () => {
  const refunded = {
    ...FULL_CLAIM, status: 'refunded', refundError: null, refundId: 'rf1',
    arbitrationDecision: 'approved', approvedAmountCents: 500,
  }
  const succeededRow = { id: 'rf1', orderId: FULL_CLAIM.orderId, status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' }

  it('J — a PARTIAL refund with a complete ledger line → the exact three figures', async () => {
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({
      confirmed: true, customerRefundCents: 500, grubanoFeeReturnedCents: 40,
      restaurantNetImpactCents: -460, source: 'ledger',
    })
    expect(view.status).toBe('refunded')
  })

  it('K — a FULL refund, same contract', async () => {
    world({
      claims: [refunded], refunds: [{ ...succeededRow, amountCents: 1000 }], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(1000, 1000, 80)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toMatchObject({
      confirmed: true, customerRefundCents: 1000, grubanoFeeReturnedCents: 80, restaurantNetImpactCents: -920,
    })
  })

  it('L — a PENDING refund → no figures, and the status is not « remboursée »', async () => {
    world({
      claims: [{ ...refunded, status: 'refunding' }], refunds: [{ ...succeededRow, status: 'pending' }],
      binders: [{ refundId: 'rf1', _count: { _all: 1 } }], ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
    expect(view.status).toBe('refunding')
    expect(JSON.stringify(view)).not.toContain('460')
  })

  it('M — a FAILED refund → no figures', async () => {
    world({
      claims: [refunded], refunds: [{ ...succeededRow, status: 'failed' }],
      binders: [{ refundId: 'rf1', _count: { _all: 1 } }], ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
  })

  it('N — succeeded at Stripe but NO ledger line → no figures, named as missing', async () => {
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
  })

  it('O — an external refund with no fee-back returns NO fee, and invents none', async () => {
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 0)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toMatchObject({
      confirmed: true, customerRefundCents: 500, grubanoFeeReturnedCents: 0, restaurantNetImpactCents: -500,
    })
  })

  it('O — …and a refund Grubano absorbed entirely is NOT presented as a fee give-back', async () => {
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 0, 0)], feeCharged: 40,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
  })

  it('a row bound by TWO claims makes the figures ambiguous for both (A-S43)', async () => {
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 2 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
  })

  it('every auxiliary read failing leaves NO figures — each one fails CLOSED, on its own axis', async () => {
    // Two DIFFERENT questions ride on these reads, and the test says which is which rather than asserting
    // one blanket outcome:
    //   • the Refund row and the binder count prove the SETTLEMENT — without them the label cannot say
    //     « remboursée » (F03 / A-S43), so the status goes neutral AND the figures are withheld ;
    //   • the ledger line is the source of the FIGURES only — the settlement is still proven, so the label
    //     stays « remboursée » while the money block reports that it has no line to read.
    // Conflating the two would have hidden that an unreadable binder count used to publish figures anyway.
    for (const bad of ['refund.findMany', 'claim.groupBy']) {
      world({
        claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
        ledger: [ledgerLine(500, 500, 40)], feeCharged: 80, throwOn: [bad],
      })
      const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
      expect(view.financialEffect.confirmed, bad).toBe(false)
      expect(view.status, bad).not.toBe('refunded')
    }
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80, throwOn: ['ledgerEntry.findMany'],
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.status).toBe('refunded')
    expect(view.financialEffect).toEqual({ confirmed: false })
    expect(JSON.stringify(view)).not.toContain('460')
  })

  // ── THE FOUR DEFECTS THE ADVERSARIAL REVIEW FOUND, each with the scenario that produced it ───────
  it('REVIEW P1 — a DISOWNED binding (resume_mismatch) never publishes the other claim’s figures', async () => {
    // The engine writes `resume_mismatch` when the row it resumed is NOT this claim's. `Claim.refundId`
    // still points at it, the row still reads succeeded, and its ledger line still exists — so without a
    // check on `refundError` the restaurant would be shown another claim's refund as its own cost.
    world({
      claims: [{ ...refunded, refundError: 'resume_mismatch: la ligne rf1 porte 500 c pour la réclamation clX' }],
      refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
    expect(JSON.stringify(view)).not.toContain('460')
    // The LABEL for a 'refunded' claim carrying any marker is « dossier clôturé par Grubano »
    // (claimClosureKind → settled_by_declaration), which asserts no money — and the figures are withheld.
    // The two halves now agree; before this fix the label said « clôturé » while the block said −4,60 €.
    expect(view.status).toBe('closed')
  })

  it('REVIEW P1 — a refund REVERTED at Stripe after settlement publishes nothing', async () => {
    // REVERTED_AFTER_REFUND: raw status still 'refunded', our base may still say the row succeeded, the
    // ledger line is still there. The label already read neutral; the FIGURES did not.
    world({
      claims: [{ ...refunded, refundError: 'stripe_reverted_after_refund: re_1 annulé chez Stripe' }],
      refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
    expect(view.status).toBe('under_review')
  })

  it('REVIEW P2 — a bound row on ANOTHER order is not this claim’s refund', async () => {
    world({
      claims: [refunded], refunds: [{ ...succeededRow, orderId: 'ord_someone_else' }],
      binders: [{ refundId: 'rf1', _count: { _all: 1 } }], ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toEqual({ confirmed: false })
  })

  it('REVIEW P3 — the server’s diagnosis vocabulary never reaches the restaurant', async () => {
    // `ledger_inconsistent` and friends are written for whoever repairs the accounting. The unconfirmed
    // shape the restaurant receives is spec §10's: `{ confirmed: false }`, and nothing else.
    world({
      claims: [refunded], refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 0, 0)], feeCharged: 40,
    })
    const json = JSON.stringify(await listRestaurantClaims(['r1'], { view: 'history' }))
    for (const code of ['ledger_inconsistent', 'ledger_ambiguous', 'ledger_line_missing',
      'claim_money_state_open', 'refund_not_succeeded', 'refund_id_unknown']) {
      expect(json, code).not.toContain(code)
    }
    // The unconfirmed shape is spec §10's, exactly: one key.
    const [v] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(Object.keys(v.financialEffect)).toEqual(['confirmed'])
  })

  it('REVIEW P2 — an earlier claim that WAS refunded reads « remboursée », not « en vérification »', async () => {
    // Prior statuses were derived from « nothing known », so a genuinely refunded earlier claim appeared as
    // under review. They now use the SAME row facts as the page's own claims.
    const earlierRefunded = { ...refunded, id: 'clm_prior_00000000ddddd', status: 'refunded', refundError: null, refundId: 'rf1' }
    world({
      claims: [FULL_CLAIM], priors: [FULL_CLAIM, earlierRefunded],
      refunds: [succeededRow], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'])
    const entries = Object.values(view.previouslyClaimed.byLine).flat()
    expect(entries.map((e) => e.status)).toContain('refunded')
  })

  it('REVIEW P3 — a TRUNCATED earlier-claims read is reported, never read as « none »', async () => {
    world({ claims: [FULL_CLAIM], priors: Array.from({ length: 400 }, (_, i) => ({ ...FULL_CLAIM, id: 'clm_bulk_' + i })) })
    const [view] = await listRestaurantClaims(['r1'])
    expect(view.previouslyClaimed.incomplete).toBe(true)
    // An UNREADABLE list is not a complete one either — « aucune réclamation antérieure » is not something
    // a failed read establishes.
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM], throwOn: ['claim.findMany:priors'] })
    const [v2] = await listRestaurantClaims(['r1'])
    expect(v2.previouslyClaimed.incomplete).toBe(true)
    // …and a short, successful read IS complete.
    world({ claims: [FULL_CLAIM], priors: [FULL_CLAIM] })
    const [v3] = await listRestaurantClaims(['r1'])
    expect(v3.previouslyClaimed.incomplete).toBe(false)
  })

  it('REVIEW P2 — a system claim’s internal order id is redacted from the customer message', async () => {
    const sys = { ...FULL_CLAIM, reason: 'system_order_cancelled', description: `Annulation par le restaurant d'une commande payée (${FULL_CLAIM.orderId}).` }
    world({ claims: [sys], priors: [sys] })
    const [view] = await listRestaurantClaims(['r1'])
    expect(view.customerMessage).not.toContain(FULL_CLAIM.orderId)
    expect(view.customerMessage).toContain('GR-')
    // …and the SOURCE now writes the public reference, so new rows never carry the id at all.
    const src = require('node:fs').readFileSync('app/api/orders/[id]/status/route.ts', 'utf8') as string
    expect(src).toContain('commande payée (${orderRef(order.id)})')
  })

  it('REVIEW P1 — the restaurant notice has its OWN population, so the ordinary path is reachable', () => {
    // Surfaced only as a column on « avis client non envoyés », the notice would never be seen on the
    // ordinary settlement path (the rail dispatches the customer's notice, so the claim leaves that list).
    const fs = require('node:fs') as typeof import('node:fs')
    const lists = fs.readFileSync('lib/claim-closure-lists.ts', 'utf8')
    expect(lists).toContain('export async function listPendingRestaurantRefundNotices')
    // its population is SETTLED refunds, not « customer notice missing »
    const fn = lists.slice(lists.indexOf('export async function listPendingRestaurantRefundNotices'))
    expect(fn).toContain("status: 'refunded'")
    expect(fn).toContain('refundError: null')
    expect(fn).toContain('RESTAURANT_REFUNDED_TRIGGER')
    const route = fs.readFileSync('app/api/admin/claims/financial-verification/route.ts', 'utf8')
    expect(route).toContain('listPendingRestaurantRefundNotices')
    expect(route).toContain('restaurantNoticesPending')
    const card = fs.readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    expect(card).toContain('data-section="restaurant-notices"')
  })

  it('NEGATIVE CONTROL — the Refund row’s predicted fee would have shown a different net', async () => {
    // The row predicts a 50 c fee refund; Stripe really returned 40 c. The engine logs the mismatch and
    // never rewrites the row, so a projection reading the row would tell the restaurant −450 instead of −460.
    const predicted = { ...succeededRow, applicationFeeRefundCents: 50, restaurantReverseCents: 500 }
    expect(-(predicted.restaurantReverseCents - predicted.applicationFeeRefundCents)).toBe(-450) // ← the defect
    world({
      claims: [refunded], refunds: [predicted], binders: [{ refundId: 'rf1', _count: { _all: 1 } }],
      ledger: [ledgerLine(500, 500, 40)], feeCharged: 80,
    })
    const [view] = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(view.financialEffect).toMatchObject({ restaurantNetImpactCents: -460 })
  })

  it('STATIC — neither the projection nor the sender reads a predicted Refund field', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['lib/claim-restaurant-view.ts', 'lib/claim-financial-effect.ts']) {
      const s = fs.readFileSync(p, 'utf8')
      // named in prose (explaining why they are not used) but never READ
      expect(s, p).not.toMatch(/\.applicationFeeRefundCents/)
      expect(s, p).not.toMatch(/\.restaurantReverseCents/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE LIFECYCLE VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('the restaurant never reads an internal token', () => {
  const facts = (over: Record<string, unknown>) => ({
    status: 'restaurant_review', refundError: null, refundId: null, refundAttempted: false,
    arbitrationDecision: null, restaurantResponse: null, ...over,
  })

  it('every raw status maps into the closed set, and an unknown one falls through to neutral', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'received'],
      [{ status: 'refused', restaurantResponse: 'refused' }, 'answered_refused'],
      [{ status: 'arbitration' }, 'grubano_deciding'],
      [{ status: 'approved' }, 'approved_awaiting_refund'],
      [{ status: 'approved', refundAttempted: true }, 'under_review'],
      [{ status: 'refunding', refundId: 'rf1' }, 'under_review'],
      [{ status: 'refunded', refundError: null }, 'under_review'],
      [{ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, 'refusal_confirmed'],
      [{ status: 'refused_final', arbitrationDecision: 'refused_final' }, 'refused_by_grubano'],
      [{ status: 'refused_final', arbitrationDecision: null }, 'closed'],
      [{ status: 'financial_verification' }, 'under_review'],
      [{ status: 'a_status_nobody_has_written_yet' }, 'under_review'],
    ]
    for (const [over, expected] of cases) {
      expect(restaurantClaimStatus(facts(over), null, null), JSON.stringify(over)).toBe(expected)
    }
  })

  it('« remboursée » needs the row proof — a reverted refund reads neutral', () => {
    const settled = facts({ status: 'refunded', refundError: null })
    expect(restaurantClaimStatus(settled, null, true)).toBe('refunded')
    expect(restaurantClaimStatus(settled, null, false)).toBe('under_review')
    expect(restaurantClaimStatus(settled, null, null)).toBe('under_review')
    // REVERTED_AFTER_REFUND: raw status still 'refunded', money actually reversed at Stripe
    const reverted = facts({ status: 'refunded', refundError: 'stripe_reverted_after_refund: re_1 annulé' })
    expect(restaurantClaimStatus(reverted, null, true)).toBe('under_review')
  })

  it('no marker token or operator sentence can reach the label set', () => {
    const tokens = ['no_refund_proven', 'no_refund_proven_rail_locked', 'engine_row_dead', 'engine_failed',
      'reconcile_required', 'resume_mismatch', 'row_voided', 'stripe_failed', 'v13', 'rail_locked', 'T1', 'T2', 'T3']
    for (const tok of tokens) {
      expect(RESTAURANT_STATUSES as readonly string[], tok).not.toContain(tok)
      for (const s of RESTAURANT_STATUSES) expect(s, tok).not.toContain(tok)
    }
  })

  it('the five locales carry a non-empty sentence for every label, under their OWN namespace', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(fs.readFileSync('messages/' + loc + '.json', 'utf8'))
      expect(Object.keys(m.claims.restaurant.status).sort(), loc).toEqual([...RESTAURANT_STATUSES].sort())
      for (const s of RESTAURANT_STATUSES) {
        expect(String(m.claims.restaurant.status[s]).trim().length, `${loc}.${s}`).toBeGreaterThan(0)
      }
      // NOT the customer's namespace: those sentences are addressed to the claimant.
      expect(m.claims.status[RESTAURANT_STATUSES[0]], loc).toBeUndefined()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// H / I — SURFACE ONLY, AND INTAKE HAS NO SAY
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('H/I — the restaurant workflow follows SURFACE and nothing else', () => {
  const PRODUCT_FLAGS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'] as const
  const clean = () => { closeClaimsWindow(); for (const k of PRODUCT_FLAGS) delete process.env[k] }

  it('H — SURFACE open, INTAKE closed: the existing file is readable AND answerable', async () => {
    clean()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'
    process.env.CLAIMS_INTAKE_ENABLED = 'false'
    const { GET } = await import('@/app/api/claims/restaurant/route')
    world({ claims: [FULL_CLAIM] })
    const res = await GET(new Request('https://app.grubano.com/api/claims/restaurant'))
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.view).toBe('pending')
    expect(body.claims).toHaveLength(1)
    // readable AND answerable while INTAKE is shut: intake closes the door to NEW claims, it does not hide
    // a file whose response deadline is running.
    expect(body.claims[0].canRespond).toBe(true)
    clean()
  })

  it('I — SURFACE closed: the workflow is shut, whatever INTAKE says', async () => {
    clean()
    process.env.CLAIMS_SURFACE_ENABLED = 'false'
    process.env.CLAIMS_INTAKE_ENABLED = 'true'
    const { GET } = await import('@/app/api/claims/restaurant/route')
    const res = await GET(new Request('https://app.grubano.com/api/claims/restaurant'))
    expect(await res.json()).toEqual({ enabled: false })
    expect(db.claim.findMany).not.toHaveBeenCalled()
    clean()
  })

  it('the client can no longer choose which statuses it sees — only the whitelisted view', async () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('app/api/claims/restaurant/route.ts', 'utf8')
    expect(src).not.toContain("get('status')")
    expect(src).toContain("get('view')")
    expect(src).toContain("=== 'history' ? 'history' : 'pending'")
    // …and REFUNDS_ENABLED has no say in a read
    expect(src).not.toContain('isRefundsEnabled')
  })

  it('the two views PARTITION the restaurant’s claims — none is unreachable', async () => {
    const pendingClaim = { ...FULL_CLAIM, id: 'clm_pending_00000000aaaa', status: 'restaurant_review' }
    const doneClaim = { ...FULL_CLAIM, id: 'clm_done_0000000000bbbb', status: 'refused_final', arbitrationDecision: 'refused_final' }
    world({ claims: [pendingClaim, doneClaim], priors: [] })
    const pending = await listRestaurantClaims(['r1'], { view: 'pending' })
    const history = await listRestaurantClaims(['r1'], { view: 'history' })
    expect(pending.map((c) => c.id)).toEqual([pendingClaim.id])
    expect(history.map((c) => c.id)).toEqual([doneClaim.id])
    // control parity: the answerable set is exactly the pending view
    expect(pending.every((c) => c.canRespond)).toBe(true)
    expect(history.every((c) => !c.canRespond)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// P / Q / R / S / T — THE POST-MONEY NOTICE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('P/Q/R/S/T — the restaurant is told about money only once, and only when it is proven', () => {
  it('T — the Stripe webhook sends nothing and cannot reach a sender module', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('app/api/webhooks/stripe/route.ts', 'utf8')
    for (const s of ['claim-emails', 'sendRestaurantRefundedEmail', 'sendClaimClosureEmail', 'claim-email-toast']) {
      expect(src, s).not.toContain(s)
    }
  })

  it('P — the notice class is `closure`, whose gate is TRUE with every flag off', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'false'
    process.env.CLAIMS_INTAKE_ENABLED = 'false'
    process.env.REFUNDS_ENABLED = 'false'
    const { claimNoticeGate } = await import('@/lib/claim-flags')
    expect(claimNoticeGate('closure')).toBe(true)
    expect(claimNoticeGate('post_money')).toBe(true)
    // …and the pre-money class is the one that closes, which is the whole point of the split
    expect(claimNoticeGate('pre_money')).toBe(false)
    delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED; delete process.env.REFUNDS_ENABLED
  })

  it('Q — the dedupe key is anchored on the PROVEN refund, so a replay cannot send twice', () => {
    // sendTransactional claims @@unique([trigger, dedupeKey]) BEFORE sending, so ten replays of the same
    // proof compete for ONE slot. What this asserts is the property that makes that true: the key is a pure
    // function of (claim, re_), so ten computations are one key.
    const keys = new Set(Array.from({ length: 10 }, () => restaurantRefundedKey('cl1', 're_1')))
    expect(keys.size).toBe(1)
    expect(Array.from(keys)[0]).toBe('claim:cl1:resto_refunded:re_1')
    // …and a DIFFERENT refund on the same claim is a different financial event, so it is a different key
    expect(restaurantRefundedKey('cl1', 're_2')).not.toBe(restaurantRefundedKey('cl1', 're_1'))
    expect(RESTAURANT_REFUNDED_TRIGGER).toBe('claim_restaurant_refunded')
  })

  it('Q — the trigger is distinct from every consumer trigger (a shared slot would swallow one send)', async () => {
    const { CLOSURE_TRIGGER, CLOSURE_RECORD_TRIGGER } = await import('@/lib/claim-action-rules')
    const consumerTriggers = new Set([...Object.values(CLOSURE_TRIGGER), CLOSURE_RECORD_TRIGGER,
      'claim_ack', 'claim_decision_accepted', 'claim_decision_refused', 'refund_confirmation'])
    expect(consumerTriggers.has(RESTAURANT_REFUNDED_TRIGGER)).toBe(false)
  })

  it('R/S — an unconfirmed block sends NOTHING, and says which evidence is missing', async () => {
    const { sendRestaurantRefundedEmail } = await import('@/lib/claim-emails')
    db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar', operator: { email: 'resto@x.test', name: 'M', locale: 'fr' } })
    for (const reason of ['ledger_line_missing', 'refund_not_succeeded', 'ledger_inconsistent', 'ledger_ambiguous'] as const) {
      const r = await sendRestaurantRefundedEmail({
        claimId: 'cl1', restaurantId: 'r1', orderId: 'o1', stripeRefundId: 're_1',
        effect: { confirmed: false, reason }, claimsOpen: true,
      })
      expect(r, reason).toEqual({ status: 'skipped', why: 'ledger_incomplete' })
    }
    expect(db.emailDispatch.create).not.toHaveBeenCalled()
  })

  it('R — no `re_` proven → nothing sent', async () => {
    const { sendRestaurantRefundedEmail } = await import('@/lib/claim-emails')
    const r = await sendRestaurantRefundedEmail({
      claimId: 'cl1', restaurantId: 'r1', orderId: 'o1', stripeRefundId: '',
      effect: { confirmed: true, customerRefundCents: 500, grubanoFeeReturnedCents: 40, restaurantNetImpactCents: -460, source: 'ledger' },
      claimsOpen: true,
    })
    expect(r).toEqual({ status: 'skipped', why: 'stripe_not_confirmed' })
    expect(db.emailDispatch.create).not.toHaveBeenCalled()
  })

  it('S — the admin list reports WHY a notice was not sent, per claim', async () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('lib/claim-closure-lists.ts', 'utf8')
    // The five states the founder's §18 asks for, plus the honest 'unknown' for an unreadable probe.
    for (const s of ['not_due', 'refund_not_succeeded', 'ledger_incomplete', 'already_sent', 'pending', 'unknown']) {
      expect(src, s).toContain(`'${s}'`)
    }
    expect(src).toContain('RESTAURANT_REFUNDED_TRIGGER')
    // and it reads EmailDispatch (the idempotency registry), not EmailLog
    expect(src).toContain('emailDispatch.findMany')
    expect(src).not.toContain('emailLog')
  })

  it('the sender takes the figures as a PARAMETER — no sender module reads a ledger or Stripe', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('lib/claim-emails.ts', 'utf8')
    // Asserted over the WHOLE module, deliberately: slicing a function body by its closing brace is
    // fragile (nested blocks), and the property worth holding is stronger anyway — NO sender in this file
    // may read the ledger, call Stripe, or derive a financial effect of its own. (It does read a Refund
    // ROW for the customer's closure proof, which predates this lot and is not a money figure.)
    for (const s of ['ledgerEntry', 'getStripe', 'deriveFinancialEffect', 'grossAmount', 'netToRestaurant']) {
      expect(src, s).not.toContain(s)
    }
    expect(src).not.toMatch(/@\/lib\/(refund|stripe|claims)['"]/)
    // The figures arrive as a parameter, and the sender only prints them.
    const fn = src.slice(src.indexOf('export async function sendRestaurantRefundedEmail'), src.indexOf('// ── (1) Accusé'))
    expect(fn).toContain('p.effect')
    expect(fn).toContain('if (!p.effect.confirmed)')
  })

  it('V — nothing in this lot writes to Stripe', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    for (const p of ['lib/claim-restaurant-view.ts', 'lib/claim-financial-effect.ts',
      'app/api/claims/restaurant/route.ts', 'app/api/claims/[id]/respond/route.ts',
      'components/claims/RestaurantClaimsPanel.tsx']) {
      const s = fs.readFileSync(p, 'utf8')
      for (const w of ['getStripe', 'stripe.refunds.create', 'refunds.create', 'lib/stripe']) {
        expect(s, `${p} / ${w}`).not.toContain(w)
      }
    }
    // and the projection never ran one in any test of this file
    expect(stripeMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-46 — THE FINANCE SUMMARY NOW SEES REFUNDS (additive; no existing figure moves)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('T-46 — /api/finance/summary exposes the refunds it used to ignore', () => {
  it('the three measured fields come from the ledger refund lines, and caBrut/netResto are untouched', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const src = fs.readFileSync('app/api/finance/summary/route.ts', 'utf8')
    expect(src).toContain('refundedCents')
    expect(src).toContain('netReversedCents')
    expect(src).toContain('refundsCount')
    // derived from the ledger, never from a Refund row
    expect(src).not.toContain('prisma.refund')
    expect(src).not.toContain('applicationFeeRefundCents')
    // the unchanged arithmetic, asserted so a later edit to netResto is a deliberate act
    expect(src).toContain('const caBrut = round2(orders.reduce((s, o) => s + o.subtotal, 0))')
    expect(src).toContain('caBrut - commissionGrubano - verseAuxCreateurs - remisesFinancees')
  })

  it('the arithmetic of the two candidate remediations really differs — which is why netResto is left alone', () => {
    // 5,00 € refunded, 0,40 € of commission returned, transfer fully reversed.
    const caBrut = 5.0, commissionAfter = 0.0, netReversed = 4.6, refunded = 5.0
    expect(caBrut - commissionAfter - netReversed).toBeCloseTo(0.4, 5) // spec v2 §7.3's literal formula
    expect(caBrut - commissionAfter - refunded).toBeCloseTo(0.0, 5)    // the ticket's other candidate
    // The residue is exactly the commission Grubano returned to the CUSTOMER, and choosing between the two
    // moves a restaurateur's net. GO-LIVE-TICKETS T-46 says that choice is « à trancher » by the founder.
  })
})
