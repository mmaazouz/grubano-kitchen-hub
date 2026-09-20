// tests/refund-row-void-terminal.test.ts — MODE B commit B : l'invariant PORTANT de la libération.
//
// Une ligne LIBÉRÉE est la paire (status 'failed', stripeRefundId NULL) + clé marquée. Deux choses
// doivent être vraies pour toujours, sinon la réparation devient un défaut :
//   1. IMMUABILITÉ — elle ne doit JAMAIS acquérir d'identifiant Stripe. Si elle en acquérait un, elle
//      deviendrait la paire (failed, re_…) = le verrou E2, qui tue la commande DÉFINITIVEMENT.
//   2. RÉOUVERTURE — le rail de la commande doit vraiment redevenir utilisable : E2 ne matche pas,
//      RESUME-FIRST ne la sélectionne pas, et la clé de cumul de base est libre.
// Ce fichier fait tourner le VRAI moteur (lib/refund.ts, gelé) contre ces états.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    order:            { findUnique: vi.fn() },
    refund:           { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    franchiseRoyalty: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { create: vi.fn(), list: vi.fn(), retrieve: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { executeRefund, markRefundRowFailed, finalizeRefundRowFromStripe } from '@/lib/refund'

const VOIDED = {
  id: 'rf_void', orderId: 'o1', status: 'failed', stripeRefundId: null,
  idempotencyKey: 'refund:o1:0:void:2026-09-20T12:00:00.000Z', amountCents: 500,
  createdAt: new Date(Date.now() - 30 * 3600_000), reason: 'claim:cl1',
}
const PENDING = { ...VOIDED, id: 'rf_pending', status: 'pending', idempotencyKey: 'refund:o1:0' }
const FAILED_WITH_ID = { ...VOIDED, id: 'rf_dead', status: 'failed', stripeRefundId: 're_dead' }

// Le moteur pose DEUX questions différentes à la même table (E2 : failed + id ; RESUME-FIRST :
// pending). Le mock doit donc répondre à la QUESTION, sinon le test ne prouve rien du `where` réel.
let ROWS: Array<Record<string, unknown>> = []
const answerFindFirst = async ({ where }: { where: Record<string, unknown> }) => {
  const wantId = where.stripeRefundId && typeof where.stripeRefundId === 'object'
  return ROWS.find((r) => r.orderId === where.orderId
    && r.status === where.status
    && (!wantId || r.stripeRefundId !== null)) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  ROWS = []
  process.env.REFUNDS_ENABLED = 'true'
  process.env.REFUNDS_WINDOW_UNTIL = new Date(Date.now() + 10 * 60_000).toISOString()
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
  db.refund.findMany.mockResolvedValue([])
  db.refund.findFirst.mockImplementation(answerFindFirst)
  db.franchiseRoyalty.findUnique.mockResolvedValue(null)
  db.refund.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'rf_new', ...data }))
  db.refund.update.mockResolvedValue({})
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: 'pi_1', status: 'succeeded',
    latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, application_fee_amount: 200 },
  })
  stripeMock.refunds.create.mockResolvedValue({ id: 're_new', status: 'succeeded', amount: 500 })
})

describe('MODE B — une ligne LIBÉRÉE est IMMUABLE : elle ne peut jamais devenir un verrou E2', () => {
  it('markRefundRowFailed sur une ligne libérée n’écrit RIEN (elle n’est plus « pending »)', async () => {
    db.refund.findUnique.mockResolvedValue(VOIDED)
    const out = await markRefundRowFailed(VOIDED.id, { id: 're_late', status: 'failed' } as never)
    expect(out.ok).toBe(false)
    expect(db.refund.update).not.toHaveBeenCalled()      // pas d'id Stripe écrit ⇒ pas de verrou E2 forgé
  })

  it('finalizeRefundRowFromStripe sur une ligne libérée refuse et n’écrit RIEN', async () => {
    db.refund.findUnique.mockResolvedValue(VOIDED)
    const out = await finalizeRefundRowFromStripe(VOIDED.id)
    expect(out.ok).toBe(false)
    expect(db.refund.update).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })
})

describe('MODE B — le rail de la commande est VRAIMENT rouvert', () => {
  it('une ligne libérée ne verrouille pas la commande : un nouveau remboursement est créé sous la clé de base', async () => {
    ROWS = [VOIDED]     // la seule ligne de la commande
    const out = await executeRefund({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
    expect(out.ok).toBe(true)
    expect(db.refund.create).toHaveBeenCalledTimes(1)
    // la clé de base a bien été rendue au cumul
    expect(db.refund.create.mock.calls[0][0].data.idempotencyKey).toBe('refund:o1:0')
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
  })

  it('⭐ E2 N’EST PAS AFFAIBLI — une ligne (failed, re_…) verrouille toujours la commande', async () => {
    ROWS = [VOIDED, FAILED_WITH_ID]
    const out = await executeRefund({ orderId: 'o1', amountCents: 500 })
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.status).toBe(409)
    expect(db.refund.create).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('⭐ RESUME-FIRST reste prioritaire — une ligne « pending » restante est reprise, pas ignorée', async () => {
    ROWS = [VOIDED, PENDING]
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [] })
    await executeRefund({ orderId: 'o1', amountCents: 500 })
    // aucune NOUVELLE ligne : le moteur re-pilote la ligne en attente
    expect(db.refund.create).not.toHaveBeenCalled()
  })
})
