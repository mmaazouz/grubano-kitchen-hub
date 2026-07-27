import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

// ── P4 — ANNULATION CÔTÉ CLIENT — characterization tests (Sprint 0) ──────────
// Audit verdict: client-side order cancellation is NONEXISTENT, while the
// checkout UI promises « annulation gratuite sous 2 min » (eat.checkout.reassure).
// These tests PHOTOGRAPH the current behavior — they are GREEN today. Every
// [FAIL-ATTENDU] test asserts the current (buggy/missing) behavior and must be
// INVERTED once the post-arbitrage fix lands.
//
// Proven facts encoded below:
//   1. app/api/orders/[id]/cancel/route.ts does not exist (fs-level proof).
//   2. app/api/orders/[id]/route.ts exports GET only — no DELETE/PUT/PATCH.
//   3. PATCH /api/orders/[id]/status rejects ANY consumer session with 403
//      BEFORE body parsing and BEFORE scope resolution — even the consumer who
//      owns the order cannot request 'cancelled'. Only restaurant/admin pass.
//   4. The « annulation gratuite sous 2 min » promise IS displayed at checkout
//      (messages/fr.json → eat.checkout.reassure, rendered by
//      app/[locale]/eat/checkout/[orderId]/page.tsx) with no backing handler.
// Note: a cancel route DOES exist for table reservations
// (app/api/reservations/[id]/cancel) — reservations, NOT orders; the audit
// verdict on order cancellation stands.

const ROOT = process.cwd()

// Mock pattern copied from tests/order-status-ownership-route.test.ts (same domain).
const { db, getToken, resolveScope, sendEmail } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
  },
  getToken:     vi.fn(),
  resolveScope: vi.fn(),
  sendEmail:    vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))

import { PATCH } from '@/app/api/orders/[id]/status/route'

const patchStatus = (id: string, body: Record<string, unknown>) =>
  PATCH(
    new NextRequest(`http://x/api/orders/${id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1',
  })
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) =>
    Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-07-27T10:00:00Z') }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue(null)   // → loyalty + email blocks skip cleanly
  db.restaurant.findUnique.mockResolvedValue(null)
  sendEmail.mockResolvedValue(undefined)
})

describe('P4 — annulation client : absence de handler (preuve filesystem)', () => {
  it("[FAIL-ATTENDU: annulation client inexistante] aucune route app/api/orders/[id]/cancel/route.ts n'existe", () => {
    // AUDIT: the consumer has NO endpoint to cancel their own order. After the
    // post-arbitrage fix creates the cancel handler, this expectation must be
    // INVERTED (toBe(true)) and replaced by real handler-level tests.
    const cancelRoute = path.join(ROOT, 'app', 'api', 'orders', '[id]', 'cancel', 'route.ts')
    expect(fs.existsSync(cancelRoute)).toBe(false)
  })

  it("[FAIL-ATTENDU: annulation client inexistante] /api/orders/[id] n'exporte que GET — aucun DELETE/PUT/PATCH d'annulation", () => {
    // AUDIT: source-level characterization — the single-order route offers no
    // mutation verb a consumer could use to cancel. Invert/replace after fix.
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'orders', '[id]', 'route.ts'), 'utf-8')
    const exportedHandlers = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/g)]
      .map((m) => m[1])
    expect(exportedHandlers).toEqual(['GET'])
  })
})

describe('P4 — PATCH /api/orders/[id]/status : scoping restaurant/admin uniquement', () => {
  it('[FAIL-ATTENDU: un consumer ne peut pas annuler SA propre commande] session consumer → 403 avant parsing du body, aucune écriture', async () => {
    // AUDIT: the role gate (['restaurant','admin'].includes(role)) fires BEFORE
    // the body is parsed and BEFORE establishment scope is resolved — a consumer
    // asking for 'cancelled' on their own order is rejected with a blanket 403.
    // After the fix (dedicated cancel path or consumer-aware scoping), this
    // characterization must be replaced by the consumer happy path.
    getToken.mockResolvedValue({ role: 'consumer', sub: 'c1' })
    const res = await patchStatus('o1', { status: 'cancelled' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Accès refusé' })
    expect(resolveScope).not.toHaveBeenCalled()       // gate fires before scoping
    expect(db.order.findUnique).not.toHaveBeenCalled() // order never even loaded
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] sans session → 401, aucune écriture', async () => {
    getToken.mockResolvedValue(null)
    const res = await patchStatus('o1', { status: 'cancelled' })
    expect(res.status).toBe(401)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it("[PASS-ACTUEL] l'annulation existe UNIQUEMENT côté restaurant : received → cancelled par un restaurant propriétaire → 200", async () => {
    // Characterizes that cancellation as a state IS reachable — but only by the
    // restaurant/admin side (TRANSITIONS: any non-terminal state → cancelled).
    db.order.findUnique.mockResolvedValue({
      id: 'o1', status: 'received', restaurantId: 'r1', pointsEarned: 0, consumerId: 'c1', fulfillmentType: 'delivery',
    })
    const res = await patchStatus('o1', { status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'cancelled' })
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'cancelled' } }))
  })
})

describe('P4 — promesse checkout « annulation 2 min »', () => {
  it("[FAIL-ATTENDU: promesse « annulation 2 min » non tenue] eat.checkout.reassure affiche « annulation gratuite sous 2 min » alors qu'aucun handler client n'existe", () => {
    // AUDIT: the checkout page (app/[locale]/eat/checkout/[orderId]/page.tsx,
    // t('reassure') on the eat.checkout namespace) promises a free 2-minute
    // cancellation window — with NO backing endpoint. Once the fix ships either
    // the handler (invert the existsSync half) or the copy changes (update the
    // toContain half); this test pins the current broken-promise pair.
    const fr = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', 'fr.json'), 'utf-8'))
    const reassure: string = fr.eat.checkout.reassure
    expect(reassure).toContain('annulation gratuite sous 2 min')
    const cancelRoute = path.join(ROOT, 'app', 'api', 'orders', '[id]', 'cancel', 'route.ts')
    expect(fs.existsSync(cancelRoute)).toBe(false) // promise made, handler absent
  })

  it.todo("[NON-TESTABLE: UI navigateur] le bouton « Annuler » de /eat/order/[orderId]/help est inerte (commentaire source : « Annuler » is inert (no cancel API)) — où meurt l'option affichée, à vérifier au navigateur")
})
