import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ═════════════════════════════════════════════════════════════════════════════
// P5 — REMBOURSER EN TANT QU'HUMAIN (Sprint 0 — characterization photograph).
//
// Every test asserts the CURRENT behaviour of the code — nothing is fixed here.
// Title prefixes encode the verdict: [PASS-ACTUEL] / [FAIL-ATTENDU: …] /
// [NON-TESTABLE: …].
//
// What the code actually says (read 2026-07-27):
//   • SURFACE app/[locale]/finance/page.tsx — the refund modal is a 'use client'
//     preview: the Confirm button is HARDCODED `disabled aria-disabled` (l.269),
//     there is no network handler, and the page reads NO env flag at all. So the
//     modal is inert with default flags AND with REFUNDS_ENABLED=true — the audit
//     verdict ("refund humain impossible via la surface même flag ON") is
//     confirmed by code reading. Browser-level truth → it.todo below.
//   • RAIL POST /api/orders/[id]/refund → lib/refunds.ts (PLURAL) — the lib
//     itself never reads REFUNDS_ENABLED (header of lib/refunds.ts, C-2 gate
//     report, 2026-07-03). ⚠️ UPDATED BY P0-03 (vague 1, Q3 fondateur) : the
//     route is now ADMIN-GRUBANO-ONLY (requireRefundAdmin) — the OWNER (resto)
//     can no longer reach it (403 + audit). The flag gate still lives ONLY in
//     lib/refund.ts (SINGULAR — the royalty-aware engine: isRefundsEnabled).
//   → CONTRAST (post-P0-03): with REFUNDS_ENABLED=true the /finance modal stays
//     inert, and the API rail moves real money REGARDLESS of the flag — but now
//     only under an ADMIN session (the human validation Q3 requires).
//
// Complementary coverage — NOT duplicated here: tests/order-refund.test.ts owns
// the route guards (401/403 admin-gate + audit/404/409 unpaid/400 amount) and
// the pass-through mechanics to a MOCKED lib/refunds. This file instead runs the
// REAL lib/refunds (Stripe client mocked underneath) to characterize the actual
// flag (non-)gating end-to-end on the rail.
// ═════════════════════════════════════════════════════════════════════════════

const { db } = vi.hoisted(() => ({
  db: {
    order:      { findUnique: vi.fn(), update: vi.fn() },
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

// P0-03: the route is admin-gated by session (owner scope removed).
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { emailMock } = vi.hoisted(() => ({ emailMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: emailMock }))

// The Stripe CLIENT is mocked (no key, no network) but lib/refunds itself runs
// REAL — that is the point: the flag characterization must traverse the real rail.
const { stripe } = vi.hoisted(() => ({
  stripe: {
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { create: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripe }))

import { POST } from '@/app/api/orders/[id]/refund/route'
// The gate itself — lives in the SINGULAR engine, NOT on the owner rail.
import { isRefundsEnabled } from '@/lib/refund'

const call = (body?: Record<string, unknown>) =>
  POST(
    new Request('https://app.grubano.com/api/orders/o1/refund', {
      method:  'POST',
      body:    body ? JSON.stringify(body) : undefined,
      headers: { 'content-type': 'application/json' },
    }),
    { params: { id: 'o1' } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  // P0-03: the rail is characterized under the ADMIN session Q3 requires.
  sessionMock.mockResolvedValue({ user: { id: 'adm1', email: 'admin@grubano.com', role: 'admin', roles: ['admin'] } })
  auditMock.mockResolvedValue(undefined)
  db.order.findUnique.mockResolvedValue({
    id: 'o1', restaurantId: 'rest1', consumerId: 'cust1',
    paymentStatus: 'paid', stripePaymentIntentId: 'pi_p5',
  })
  db.operator.findUnique.mockResolvedValue({ email: 'client@example.com', name: 'Client' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto P5' })
  // Platform-flow charge (no transfer_data) → plain refund, routed: false.
  stripe.paymentIntents.retrieve.mockResolvedValue({
    id: 'pi_p5', status: 'succeeded', transfer_data: null,
    latest_charge: { amount: 2500, amount_refunded: 0 },
  })
  stripe.refunds.create.mockResolvedValue({ id: 're_p5' })
  emailMock.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

// ─────────────────────────────────────────────────────────────────────────────
// (a)+(b) The SURFACE — /finance refund modal. Client component ('use client',
// local useState only): browser/E2E truth, out of reach of this node harness.
// ─────────────────────────────────────────────────────────────────────────────
describe("P5 — Surface /finance : rembourser en tant qu'humain via l'UI", () => {
  it.todo(
    "[NON-TESTABLE: composant client 'use client' — vérité navigateur/E2E, hors harnais node] " +
    '(a) flags par défaut : la modale remboursement de /finance s\'ouvre mais le bouton ' +
    'Confirmer est hardcodé disabled (app/[locale]/finance/page.tsx:269) — aucun handler, ' +
    'aucun appel réseau : refund humain impossible via la surface',
  )
  it.todo(
    "[NON-TESTABLE: idem — la page ne lit AUCUN flag d'env, le disabled est statique] " +
    '(b) REFUNDS_ENABLED=true : la modale reste identiquement inerte — le flag ne conditionne ' +
    'rien dans le composant → verdict audit CONFIRMÉ par lecture du code : refund humain ' +
    'impossible via la SURFACE même flag ON',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// The RAIL — POST /api/orders/[id]/refund through the REAL lib/refunds.
// Question posed by the mission: does the owner rail work independently of
// REFUNDS_ENABLED? Answer photographed below: YES — fully independent.
// ─────────────────────────────────────────────────────────────────────────────
describe('P5 — Rail POST /api/orders/[id]/refund : gating de flag réel (rail ADMIN depuis P0-03)', () => {
  it('[PASS-ACTUEL P0-03] un RESTAURATEUR ne peut plus déclencher le rail — 403 + aucun appel Stripe + tentative auditée', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op1', email: 'resto@x.com', role: 'restaurant', roles: ['restaurant'] } })
    const res = await call()
    expect(res.status).toBe(403)
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'refund.denied' }))
  })

  it("[PASS-ACTUEL] flag OFF (défaut) : le rail ADMIN rembourse indépendamment du flag — 200 + refund Stripe réellement créé (lib/refunds pluriel = non-flaggé, décision C-2 documentée ; le contrôle humain = la garde admin P0-03)", async () => {
    // Deterministic OFF even if the ambient CI env sets the flag ('' !== 'true').
    vi.stubEnv('REFUNDS_ENABLED', '')

    const res = await call() // empty body = full refund of the remainder
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      refundId: 're_p5', refundedCents: 2500, remainingCents: 0, routed: false,
    })
    // Real money movement reached Stripe, flag OFF — with the state-dependent
    // idempotency key computed by lib/refunds (refund-<pi>-<amount>-<already>).
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1)
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_p5', amount: 2500 },
      { idempotencyKey: 'refund-pi_p5-2500-0' },
    )
  })

  it('[PASS-ACTUEL] flag ON (REFUNDS_ENABLED=true) : comportement strictement identique au flag OFF — le rail ne lit jamais le flag', async () => {
    const runOnce = async () => {
      stripe.paymentIntents.retrieve.mockClear()
      stripe.refunds.create.mockClear()
      const res = await call({ amountCents: 750 }) // partial, to also pin the amount path
      return {
        status:     res.status,
        body:       await res.json(),
        createArgs: stripe.refunds.create.mock.calls,
      }
    }

    vi.stubEnv('REFUNDS_ENABLED', '')
    const off = await runOnce()
    vi.unstubAllEnvs()
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    const on = await runOnce()

    // Byte-identical outcome in both flag states = the rail is flag-independent.
    expect(on).toEqual(off)
    expect(off.status).toBe(200)
    expect(off.body).toEqual({
      refundId: 're_p5', refundedCents: 750, remainingCents: 1750, routed: false,
    })
  })

  it('[PASS-ACTUEL] le rail ne mute jamais paymentStatus, flag ON comme OFF (le ledger webhook est la vérité)', async () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    await call()
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The CONTRAST — the REFUNDS_ENABLED gate DOES exist, but in lib/refund.ts
// (SINGULAR engine: admin/claims/dispute/webhook rails), NOT on the owner rail
// characterized above. Photographing the gate function pins where the
// kill-switch actually bites.
// ─────────────────────────────────────────────────────────────────────────────
describe('P5 — Contraste : le gate REFUNDS_ENABLED vit dans lib/refund (moteur), pas sur le rail owner', () => {
  it('[PASS-ACTUEL] isRefundsEnabled() : défaut OFF — flag absent/vide → false', () => {
    vi.stubEnv('REFUNDS_ENABLED', '')
    expect(isRefundsEnabled()).toBe(false)
  })

  it("[PASS-ACTUEL] isRefundsEnabled() : seul le string exact 'true' active — 'TRUE' et '1' → false", () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    expect(isRefundsEnabled()).toBe(true)

    vi.stubEnv('REFUNDS_ENABLED', 'TRUE')
    expect(isRefundsEnabled()).toBe(false)

    vi.stubEnv('REFUNDS_ENABLED', '1')
    expect(isRefundsEnabled()).toBe(false)
  })
})
