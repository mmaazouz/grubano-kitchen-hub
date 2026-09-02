import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

// ── P7 — LIVRAISON TERMINALE — characterization tests (Sprint 0) ──────────────
// Audit verdict: "delivery terminal at ready — delivered never reachable on the
// restaurant side" for a fulfillmentType='delivery' order.
//
// These are CHARACTERIZATION tests: they photograph the CURRENT behavior of the
// code (branch sprint0-prep), bugs included. The suite must be GREEN today.
// Nothing is fixed here.
//
// Proven facts encoded below (read from the code, NOT from the audit verdict):
//   1. API level — the verdict is CONTRADICTED: PATCH /api/orders/[id]/status
//      (restaurant/admin only) accepts ready→picked_up, picked_up→delivered AND
//      even ready→delivered DIRECTLY. 'delivered' IS reachable via the API by
//      the restaurant. The TRANSITIONS comment reserves ready→delivered for the
//      PICKUP hand-off, but the code NEVER reads order.fulfillmentType — the
//      state machine is fulfillment-blind.
//   2. UI level — the verdict is CONFIRMED: components/orders/order-actions.tsx
//      renders, for a DELIVERY order at 'ready', ONLY the waitingCourier label
//      (the single advance button of the ready branch is gated on isPickup).
//      No operator surface ever moves a delivery order past 'ready'.
//   3. Courier surface — POST /api/logistics/missions/[id]/deliver exists but:
//      (a) it is gated by LOGISTICS_MISSIONS_ENABLED (default OFF → 404), and
//      (b) advanceMissionByCourier (lib/mission-attribution.ts) writes ONLY the
//          Mission model (mission.updateMany) — prisma.order is NEVER touched.
//      The courier's 'delivered' therefore NEVER propagates to the consumer
//      Order, which stays stuck (the loyalty credit, gated on Order 'delivered'
//      inside the restaurant PATCH, never fires on the courier rail).
//   4. Repo-wide: no other server surface writes Order.status to 'picked_up' or
//      'delivered' (grep over app/ + lib/ — only the restaurant/admin PATCH).
//
// Net: the audit verdict is FALSE at the raw API level but TRUE in practice —
// the terminality is a UI gap + a missing mission→order propagation, not the
// API state machine.

const ROOT = process.cwd()

// Mock pattern copied from tests/p1-p10/p3-annulation-resto-payee.test.ts (same
// domain) + tests/logistics-mission-step-routes.test.ts (courier step routes).
const { db, getToken, getServerSession, resolveScope, sendEmail, accrual, position } = vi.hoisted(() => ({
  db: {
    // PATCH /api/orders/[id]/status surface
    order:              { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn() , findUnique: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    $transaction:       vi.fn(),
    $queryRawUnsafe:     vi.fn(),
    // Courier deliver surface (step-handler + REAL advanceMissionByCourier)
    logisticsProfile:   { findUnique: vi.fn() },
    mission:            { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  getToken:         vi.fn(), // next-auth/jwt — orders status route
  getServerSession: vi.fn(), // next-auth     — logistics step-handler
  resolveScope:     vi.fn(),
  sendEmail:        vi.fn(),
  accrual:  { accrueCourierCourseEarning: vi.fn(), accrueCourierTipEarning: vi.fn() },
  position: { deleteCourierPositionForMission: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: resolveScope }))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: sendEmail }))
// Flag-gated money/geoloc side-effects of the deliver step — spied so nothing real runs.
vi.mock('@/lib/courier-accrual', () => accrual)
vi.mock('@/lib/courier-position', () => position)
// NOTE: '@/lib/missions' and '@/lib/mission-attribution' are intentionally REAL —
// the P7 point is precisely what the real courier transition does (and does NOT)
// write. isMissionsEnabled() reads process.env at call time → vi.stubEnv works.

import { PATCH } from '@/app/api/orders/[id]/status/route'
import { POST as deliver } from '@/app/api/logistics/missions/[id]/deliver/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const patchStatus = (id: string, body: Record<string, unknown>) =>
  PATCH(
    new NextRequest(`http://x/api/orders/${id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id } },
  )

const postDeliver = (id: string) =>
  deliver(new Request(`http://x/api/logistics/missions/${id}/deliver`, { method: 'POST' }), { params: { id } })

// A DELIVERY order owned by the calling restaurant — the P7 subject.
const deliveryOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1', status: 'ready', restaurantId: 'r1', consumerId: 'c1',
  paymentStatus: 'paid', total: 37.9, pointsEarned: 8, fulfillmentType: 'delivery',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Restaurant PATCH defaults
  getToken.mockResolvedValue({ role: 'restaurant' })
  resolveScope.mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1',
  })
  db.order.findUnique.mockResolvedValue(deliveryOrder())
  db.order.update.mockImplementation(({ data }: { data: { status: string } }) =>
    Promise.resolve({ id: 'o1', status: data.status, updatedAt: new Date('2026-07-27T10:00:00Z') }))
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.operator.findUnique.mockResolvedValue(null)   // → loyalty + email lookups skip cleanly
  db.restaurant.findUnique.mockResolvedValue(null)
  sendEmail.mockResolvedValue(undefined)
  // Courier deliver defaults (each test opts in via vi.stubEnv)
  getServerSession.mockResolvedValue({ user: { email: 'courier@x.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'cP' })
  db.mission.findUnique.mockResolvedValue({ id: 'm1', status: 'picked_up', courierId: 'cP' })
  db.mission.updateMany.mockResolvedValue({ count: 1 })
  accrual.accrueCourierCourseEarning.mockResolvedValue(undefined)
  accrual.accrueCourierTipEarning.mockResolvedValue(undefined)
  position.deleteCourierPositionForMission.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('P7 — machine d’états PATCH /api/orders/[id]/status pour une commande DELIVERY (côté resto)', () => {

  it('[PASS-ACTUEL] ready → picked_up accepté (200) pour le resto propriétaire', async () => {
    const res = await patchStatus('o1', { status: 'picked_up' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ orderId: 'o1', status: 'picked_up' })
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'picked_up' } })
  })

  it('[PASS-ACTUEL] picked_up → delivered accepté (200) — delivered EST atteignable côté resto via l’API (écart avec le verdict audit)', async () => {
    // The audit verdict says "delivered never reachable on the restaurant side";
    // at the API level the code contradicts it — characterized here, flagged in
    // the run notes. The practical terminality lives in the UI + the missing
    // courier propagation (see the other describes).
    db.order.findUnique.mockResolvedValue(deliveryOrder({ status: 'picked_up' }))
    const res = await patchStatus('o1', { status: 'delivered' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ orderId: 'o1', status: 'delivered' })
  })

  it('[FAIL-ATTENDU: machine d’états aveugle au fulfillmentType — ready → delivered direct accepté pour une commande DELIVERY] le jalon picked_up est sautable', async () => {
    // AUDIT: the TRANSITIONS table comments ready→delivered as "the PICKUP
    // hand-off (no courier leg)" — yet the route never reads order.fulfillmentType,
    // so a DELIVERY order can be marked delivered straight from ready by the
    // restaurant, skipping the picked_up (En route) milestone the client tracking
    // relies on. After the post-arbitrage fix (fulfillment-aware machine or
    // courier-driven propagation), this test must be INVERTED (expect 422 for
    // delivery, or the dedicated courier path).
    const res = await patchStatus('o1', { status: 'delivered' }) // order is 'ready' + delivery
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'delivered' })
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'delivered' } })
  })

  it('[PASS-ACTUEL] delivered est terminal — delivered → picked_up/ready/cancelled refusés (422, « aucune transition possible »)', async () => {
    db.order.findUnique.mockResolvedValue(deliveryOrder({ status: 'delivered' }))
    for (const target of ['picked_up', 'ready', 'cancelled']) {
      const res = await patchStatus('o1', { status: target })
      expect(res.status).toBe(422)
      expect(await res.json()).toMatchObject({ allowed: ['(aucune transition possible)'] })
    }
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] rôle logistics (livreur) → 403 — le livreur ne peut PAS faire avancer Order.status via cette route', async () => {
    // The only route that writes Order.status is restaurant/admin-gated; the
    // courier role is rejected before body parsing and before scoping.
    getToken.mockResolvedValue({ role: 'logistics' })
    const res = await patchStatus('o1', { status: 'delivered' })
    expect(res.status).toBe(403)
    expect(resolveScope).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] le crédit fidélité ne se déclenche QUE sur ce PATCH resto à delivered (upsert + transaction earn idempotente)', async () => {
    // This is the ONLY place in the codebase where a delivery order earns its
    // points — which is why the courier rail never crediting matters (see below).
    db.order.findUnique.mockResolvedValue(deliveryOrder({ status: 'picked_up' }))
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
    db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
  db.loyaltyCustomer.findUnique.mockResolvedValue({ recoveryOffsetPoints: 0 })
      db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]))
  db.$queryRawUnsafe.mockResolvedValue([{ recoveryOffsetPoints: 0 }])
    const res = await patchStatus('o1', { status: 'delivered' })
    expect(res.status).toBe(200)
    expect(db.loyaltyTransaction.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'o1', type: 'earn' }, select: { id: true },
    })
    expect(db.loyaltyCustomer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'lea@x.fr' } }))
    expect(db.loyaltyCustomer.update).toHaveBeenCalledWith({
      where: { id: 'lc1' }, data: expect.objectContaining({ pointsBalance: { increment: 8 } }),
    })
    expect(db.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { customerId: 'lc1', orderId: 'o1', type: 'earn', points: 8 },
    })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('P7 — surface livreur POST /api/logistics/missions/[id]/deliver', () => {

  it('[PASS-ACTUEL] flag LOGISTICS_MISSIONS_ENABLED OFF (défaut) → 404 — la surface livreur n’existe pas aujourd’hui', async () => {
    vi.stubEnv('LOGISTICS_MISSIONS_ENABLED', '') // anything but exactly 'true' = OFF
    const res = await postDeliver('m1')
    expect(res.status).toBe(404)
    expect(getServerSession).not.toHaveBeenCalled() // gate fires before auth
    expect(db.mission.findUnique).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] flag ON : le livreur assigné passe SA mission picked_up → delivered (200, écriture atomique Mission)', async () => {
    vi.stubEnv('LOGISTICS_MISSIONS_ENABLED', 'true')
    const res = await postDeliver('m1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, missionId: 'm1', status: 'delivered' })
    // Atomic guarded transition: WHERE pins expected status + owning courier.
    expect(db.mission.updateMany).toHaveBeenCalledTimes(1)
    expect(db.mission.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'picked_up', courierId: 'cP' },
      data:  expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
    })
  })

  it('[FAIL-ATTENDU: le delivered livreur ne se propage JAMAIS à la commande — Order reste bloquée et la fidélité ne crédite jamais sur ce rail] prisma.order n’est pas touché', async () => {
    // AUDIT: advanceMissionByCourier (REAL implementation under test) writes the
    // Mission model ONLY. On the courier's delivered, the linked consumer Order
    // keeps its previous status (ready/picked_up): the client tracking never
    // reaches 'delivered' and the loyalty credit — gated on Order 'delivered'
    // inside the restaurant PATCH — never fires. Combined with the operator UI
    // offering NO action at ready+delivery, the delivery journey is terminal in
    // practice. After the post-arbitrage fix (mission→order propagation), this
    // test must be INVERTED (expect the Order write / the loyalty credit).
    vi.stubEnv('LOGISTICS_MISSIONS_ENABLED', 'true')
    const res = await postDeliver('m1')
    expect(res.status).toBe(200)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
    expect(db.order.updateMany).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.upsert).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] flag ON : mission d’un autre livreur → 403, aucune écriture (owner-scope, pas d’IDOR)', async () => {
    vi.stubEnv('LOGISTICS_MISSIONS_ENABLED', 'true')
    db.mission.findUnique.mockResolvedValue({ id: 'm1', status: 'picked_up', courierId: 'someone-else' })
    const res = await postDeliver('m1')
    expect(res.status).toBe(403)
    expect(db.mission.updateMany).not.toHaveBeenCalled()
    expect(db.order.update).not.toHaveBeenCalled()
  })
})

describe('P7 — côté resto (UI opérateur) : ready + delivery = aucune action (preuve source)', () => {

  it('[FAIL-ATTENDU: livraison terminale à ready côté resto — l’UI n’offre AUCUNE action à ready pour une commande delivery] le seul bouton du branch ready est gaté isPickup', async () => {
    // AUDIT: source-level characterization of components/orders/order-actions.tsx
    // (the single shared action component of /dashboard live orders and /orders).
    // In the 'ready' branch, a delivery order gets ONLY the waitingCourier label;
    // the single advance button is rendered under `{isPickup && (...)}`. Since no
    // server surface moves a delivery Order past 'ready' either (the courier leg
    // writes Mission only — proven above), the operator screen is where the
    // journey dies. After the fix (courier propagation or an explicit operator
    // hand-off action for delivery), this characterization must be replaced.
    const src = fs.readFileSync(path.join(ROOT, 'components', 'orders', 'order-actions.tsx'), 'utf-8')
    const readyStart = src.indexOf("if (order.status === 'ready')")
    const readyEnd   = src.indexOf("if (order.status === 'picked_up')")
    expect(readyStart).toBeGreaterThan(-1)
    expect(readyEnd).toBeGreaterThan(readyStart)
    const readyBranch = src.slice(readyStart, readyEnd)
    // Delivery path: waiting label only.
    expect(readyBranch).toContain("t('waitingCourier')")
    // Exactly ONE advance call in the whole branch…
    expect(readyBranch.split('advance(').length - 1).toBe(1)
    // …and it sits INSIDE the isPickup guard → nothing for delivery.
    const guardIdx = readyBranch.indexOf('{isPickup && (')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(readyBranch.indexOf('advance(')).toBeGreaterThan(guardIdx)
  })

  it.todo('[NON-TESTABLE: UI navigateur] suivi client /eat/track/[orderId] (carte, ETA, jalon « En route » jamais atteint pour une delivery pilotée UI) — hors harnais node')
})
