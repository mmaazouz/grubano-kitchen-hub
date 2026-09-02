import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-42 (vague 2) — rattrapage SERVEUR des confirmations de commande ─────────
// Constat d'exécution fondateur : order_confirmation + resto_order_received ne
// partaient que via le POLL navigateur (/confirm, 2 pages clientes, toutes les
// 2 s). Onglet fermé avant le webhook ⇒ personne n'est notifié. Le sweep
// (lib/order-email-sweep + POST /api/admin/orders/confirm-sweep, cron 20 min)
// garantit l'émission côté serveur. Idempotence de bout en bout : MÊMES senders
// sendOnce, MÊMES (trigger, dedupeKey=order:<id>) que /confirm.

const { db } = vi.hoisted(() => ({
  db: {
    order:         { findMany: vi.fn(), findUnique: vi.fn() },
    operator:      { findUnique: vi.fn() },
    emailDispatch: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { consumerMock, restoMock } = vi.hoisted(() => ({ consumerMock: vi.fn(), restoMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({
  sendOrderConfirmation:       consumerMock,
  sendRestaurantNewOrderEmail: restoMock,
}))

import { sweepUnconfirmedPaidOrders } from '@/lib/order-email-sweep'

const paidOrder = (id: string, over: Record<string, unknown> = {}) => ({
  id, consumerId: 'c1', total: 21.99, fulfillmentType: 'delivery',
  items: [{ itemId: 'i1', name: 'Gnocchi maison', qty: 2, price: 10 }],
  restaurant: { name: 'Gnocchi Bar', operator: { email: 'resto@x.fr' } },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.order.findMany.mockResolvedValue([paidOrder('ord123abc')])
  db.emailDispatch.findMany.mockResolvedValue([])
  db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa' })
  consumerMock.mockResolvedValue({ status: 'sent' })
  restoMock.mockResolvedValue({ status: 'sent' })
})

describe('lib/order-email-sweep — le chemin « onglet fermé » (aucun dispatch existant)', () => {
  it('⭐ commande payée sans AUCUN email parti → les DEUX partent, avec les MÊMES triggers/dedupeKey que /confirm', async () => {
    const r = await sweepUnconfirmedPaidOrders()
    expect(r).toMatchObject({ scanned: 1, consumerSent: 1, restoSent: 1, alreadyDone: 0, errors: 0 })
    expect(restoMock).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'ord123abc', to: 'resto@x.fr', restaurantName: 'Gnocchi Bar',
      orderRef: 'GR-123ABC', fulfillmentType: 'delivery',
      items: [{ name: 'Gnocchi maison', qty: 2 }], totalCents: 2199,
    }))
    expect(consumerMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lea@x.fr', customerName: 'Léa', orderRef: 'GR-123ABC',
      paidCents: 2199, dedupeKey: 'order:ord123abc',
    }))
  })

  it('ne balaye QUE les commandes payées récentes NON-fantômes, lot borné (where + take asserté)', async () => {
    await sweepUnconfirmedPaidOrders()
    const q = db.order.findMany.mock.calls[0][0]
    expect(q.where.paymentStatus).toBe('paid')
    // Revue P0-42 : une commande FANTÔME (status 'expired') transitoirement
    // 'paid' pendant le traitement webhook ne doit JAMAIS recevoir de
    // « commande confirmée ».
    expect(q.where.status).toEqual({ not: 'expired' })
    expect(q.where.updatedAt.gte).toBeInstanceOf(Date)
    expect(q.take).toBeLessThanOrEqual(500)
  })
})

describe('lib/order-email-sweep — idempotence (le poll a déjà réussi)', () => {
  it('⭐ les deux dispatchs existent → AUCUN envoi, compté alreadyDone', async () => {
    db.emailDispatch.findMany.mockResolvedValue([
      { trigger: 'order_confirmation',   dedupeKey: 'order:ord123abc' },
      { trigger: 'resto_order_received', dedupeKey: 'order:ord123abc' },
    ])
    const r = await sweepUnconfirmedPaidOrders()
    expect(r).toMatchObject({ scanned: 1, consumerSent: 0, restoSent: 0, alreadyDone: 1 })
    expect(consumerMock).not.toHaveBeenCalled()
    expect(restoMock).not.toHaveBeenCalled()
  })

  it('seul le consumer est parti → SEUL le resto est rattrapé (rattrapage partiel)', async () => {
    db.emailDispatch.findMany.mockResolvedValue([
      { trigger: 'order_confirmation', dedupeKey: 'order:ord123abc' },
    ])
    const r = await sweepUnconfirmedPaidOrders()
    expect(r).toMatchObject({ consumerSent: 0, restoSent: 1 })
    expect(consumerMock).not.toHaveBeenCalled()
    expect(restoMock).toHaveBeenCalledTimes(1)
  })

  it("la CORRECTION anti-doublon ne dépend pas du pré-filtre : les senders passent par sendOnce (dedupeKey transmis au consumer, orderId au resto — clés @@unique)", async () => {
    await sweepUnconfirmedPaidOrders()
    expect(consumerMock.mock.calls[0][0].dedupeKey).toBe('order:ord123abc')
    expect(restoMock.mock.calls[0][0].orderId).toBe('ord123abc') // sendOnce('resto_order_received', `order:${orderId}`)
  })
})

describe('lib/order-email-sweep — robustesse', () => {
  it('resto sans email → resto skippé tracé, le consumer part quand même', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.order.findMany.mockResolvedValue([
      paidOrder('ord123abc', { restaurant: { name: 'Gnocchi Bar', operator: { email: null } } }),
    ])
    const r = await sweepUnconfirmedPaidOrders()
    expect(r).toMatchObject({ restoSent: 0, skippedNoEmail: 1, consumerSent: 1 })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0-42]'))
    warnSpy.mockRestore()
  })

  it('un échec SMTP sur une commande ne bloque pas le reste du lot (best-effort compté errors)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.order.findMany.mockResolvedValue([paidOrder('ord111aaa'), paidOrder('ord222bbb')])
    restoMock.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sweepUnconfirmedPaidOrders()
    expect(r.errors).toBe(1)
    expect(r.restoSent).toBe(1)     // la 2e commande est passée
    expect(r.consumerSent).toBe(2)  // les deux consumers sont passés
    errSpy.mockRestore()
  })

  it('aucune commande payée récente → no-op total, zéro lecture dispatch', async () => {
    db.order.findMany.mockResolvedValue([])
    const r = await sweepUnconfirmedPaidOrders()
    expect(r.scanned).toBe(0)
    expect(db.emailDispatch.findMany).not.toHaveBeenCalled()
  })
})

describe('invariants source (règle d’or + périmètre)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('GOLDEN RULE — le webhook Stripe n’importe TOUJOURS aucun sender (le sweep est une route séparée)', () => {
    const wh = read('app/api/webhooks/stripe/route.ts')
    expect(/transactional-emails|sendOnce|order-email-sweep|sendOrderConfirmation|sendRestaurantNewOrderEmail/.test(wh)).toBe(false)
  })

  it('la route /confirm est INTOUCHÉE par P0-42 (ses invariants verrouillés tiennent tels quels)', () => {
    const c = read('app/api/orders/[id]/confirm/route.ts')
    expect(/order-email-sweep/.test(c)).toBe(false) // pas de refactor — byte-identique
  })

  it('le cron sweep appelle bien la route (cron.yml) et la lib est bornée', () => {
    const y = read('.github/workflows/cron.yml')
    expect(/orders\/confirm-sweep/.test(y)).toBe(true)
    expect(/X-Internal-Token/.test(y)).toBe(true)
  })
})
