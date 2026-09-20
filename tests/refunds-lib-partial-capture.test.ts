// tests/refunds-lib-partial-capture.test.ts — PRE-MODE-B, rail EMPREINTE (lib/refunds.ts, PLURIEL).
//
// CE FICHIER N'EXISTAIT PAS : tous les consommateurs de `refundPayment` le MOQUAIENT, donc le
// second moteur de remboursement du projet n'avait aucun test direct. Il sert
// /api/tickets/[id]/refund et /api/reservations/[id]/refund-deposit — deux routes ouvertes par le
// MÊME bail REFUNDS_ENABLED que le rail commande, donc par la même fenêtre que Mode B.
//
// TROIS DÉFAUTS ÉPINGLÉS ICI :
//  1. le plafond se calculait sur charge.amount (AUTORISÉ) alors que l'empreinte est la SEULE
//     capture partielle du projet (capture_method 'manual' + amount_to_capture) → la route
//     demandait à Stripe de rendre le hold entier ; rail mort pour tout no-show partiel ;
//  2. refund_application_fee était envoyé même sans commission (les empreintes sont créées avec
//     applicationFeeCents: 0, donc sans application_fee_amount du tout) ;
//  3. aucune garde litige : un chargeback sort l'argent sans toucher amount_refunded.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { refundPayment } from '@/lib/refunds'

type ChargeOver = Record<string, unknown>
const pi = (chargeOver: ChargeOver = {}, piOver: Record<string, unknown> = {}) => ({
  id: 'pi_1', status: 'succeeded',
  latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, ...chargeOver },
  ...piOver,
})
const ROUTED = { transfer_data: { destination: 'acct_1' } }

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.paymentIntents.retrieve.mockResolvedValue(pi())
  stripeMock.refunds.create.mockResolvedValue({ id: 're_1', status: 'succeeded' })
})

describe('PRE-MODE-B — le plafond du rail empreinte est le CAPTURÉ, jamais l’AUTORISÉ', () => {
  it('empreinte 20 € autorisée, 5 € capturés (no-show) → le remboursement intégral demande 500 c, pas 2000 c', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ amount: 2000, amount_captured: 500 }))
    const r = await refundPayment({ paymentIntentId: 'pi_1' })   // aucun montant = « rends tout »
    expect(r.ok).toBe(true)
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ amount: 500 })
  })

  it('un montant supérieur au CAPTURÉ est refusé 400, et le message annonce le vrai remboursable', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ amount: 2000, amount_captured: 500 }))
    const r = await refundPayment({ paymentIntentId: 'pi_1', amountCents: 600 })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(400)
    expect(r.error).toContain('5.00')      // 500 c capturés — et surtout pas « 20.00 »
    expect(r.error).not.toContain('20.00')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('capture TOTALE : comportement inchangé (amount === amount_captured)', async () => {
    const r = await refundPayment({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(true)
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ amount: 2000 })
  })

  it('le cumul déjà remboursé se retranche du CAPTURÉ', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ amount: 2000, amount_captured: 1500, amount_refunded: 500 }))
    const r = await refundPayment({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(true)
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ amount: 1000 })
  })
})

describe('PRE-MODE-B — la commission n’est réclamée que s’il y en a une', () => {
  it('charge routée SANS commission (empreinte) → reverse_transfer OUI, refund_application_fee ABSENT', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({}, ROUTED))
    await refundPayment({ paymentIntentId: 'pi_1' })
    const params = stripeMock.refunds.create.mock.calls[0][0]
    expect(params.reverse_transfer).toBe(true)
    expect('refund_application_fee' in params).toBe(false)
  })

  it('charge routée AVEC commission → les deux drapeaux', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ application_fee_amount: 600 }, ROUTED))
    await refundPayment({ paymentIntentId: 'pi_1' })
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ reverse_transfer: true, refund_application_fee: true })
  })

  it('charge NON routée → aucun des deux drapeaux', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ application_fee_amount: 600 }))
    await refundPayment({ paymentIntentId: 'pi_1' })
    const params = stripeMock.refunds.create.mock.calls[0][0]
    expect('reverse_transfer' in params).toBe(false)
    expect('refund_application_fee' in params).toBe(false)
  })
})

describe('PRE-MODE-B V1 — une charge contestée échoue fermée sur ce rail aussi', () => {
  it('charge CONTESTÉE → 409 et AUCUN appel à Stripe refunds.create', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ disputed: true }))
    const r = await refundPayment({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)
    expect(r.error).toMatch(/contesté/)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('le refus litige passe AVANT le calcul du plafond (une charge contestée et déjà remboursée reste un refus litige)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ disputed: true, amount_refunded: 2000 }))
    const r = await refundPayment({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.error).toMatch(/contesté/)
  })

  it('PI non « succeeded » (empreinte non capturée) → 409 avant tout, inchangé', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({}, { status: 'requires_capture' }))
    const r = await refundPayment({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })
})
