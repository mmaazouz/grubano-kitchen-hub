// tests/refund-preflight.test.ts — MODE B commit A : refuser AVANT la première écriture du moteur.
//
// POURQUOI CE FICHIER EXISTE. `lib/refund.ts:808` insère une ligne Refund 'pending' AVANT d'appeler
// Stripe (:355). Un rejet TERMINAL de Stripe laisse cette ligne 'pending' à vie (seul
// `markRefundRowFailed` écrit 'failed', et il exige un objet Stripe Refund réel), et sa clé
// `refund:<orderId>:<cumul>` @unique reste prise ⇒ toute tentative ultérieure meurt sur P2002, pour
// TOUT montant et TOUT rail. La seule cause de rejet terminal que le dépôt PROUVE est structurelle :
// une charge routée vers Connect sans commission, sur laquelle le moteur gelé envoie quand même
// `refund_application_fee: true` (lib/refund.ts:359), alors que lib/stripe.ts omet
// `application_fee_amount` dès que la commission vaut 0 et que lib/refunds.ts, lui, conditionne
// déjà le drapeau. Ce préflight ferme cette cause chez les appelants — le moteur reste gelé.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { create: vi.fn() }, balance: { retrieve: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { preflightRefundFunding, routedWithoutFee, ROUTED_WITHOUT_FEE_REFUSAL } from '@/lib/refund-preflight'

const ROUTED = { transfer_data: { destination: 'acct_1' } }
const pi = (chargeOver: Record<string, unknown> | null = {}, piOver: Record<string, unknown> = {}) => ({
  id: 'pi_1', status: 'succeeded',
  latest_charge: chargeOver === null ? null : { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, ...chargeOver },
  ...piOver,
})

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ application_fee_amount: 200 }, ROUTED))
})

describe('MODE B commit A — preflightRefundFunding', () => {
  it('charge ROUTÉE avec commission → ok (cas nominal de la répétition)', async () => {
    await expect(preflightRefundFunding({ paymentIntentId: 'pi_1' })).resolves.toEqual({ ok: true })
  })

  it('charge ROUTÉE SANS commission (commission omise) → 409 AVANT toute écriture', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({}, ROUTED))   // pas de application_fee_amount du tout
    const r = await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)
    expect(r.cause).toBe('routed_without_fee')
    expect(r.error).toBe(ROUTED_WITHOUT_FEE_REFUSAL)
    // le message dit ce qui N'A PAS eu lieu — c'est toute la valeur du refus
    expect(r.error).toMatch(/Aucune ligne n’a été créée/)
    expect(r.error).toMatch(/aucune clé de cumul n’a été prise/)
  })

  it('charge ROUTÉE avec commission à ZÉRO → 409 (offre fondateurs / crédit fidélité ≥ commission)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({ application_fee_amount: 0 }, ROUTED))
    const r = await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)
  })

  it('charge NON routée sans commission → ok : le moteur n’envoie aucun drapeau Connect', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({}))
    await expect(preflightRefundFunding({ paymentIntentId: 'pi_1' })).resolves.toEqual({ ok: true })
  })

  it('Stripe ILLISIBLE → 502 fail-closed', async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
    const r = await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(502)
    expect(r.cause).toBe('unreadable')
  })

  it('charge renvoyée en CHAÎNE (expansion perdue) → 502 : sans la charge on ne prouve rien', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: 'ch_1', ...ROUTED })
    const r = await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(502)
  })

  it('l’expansion de la charge est DEMANDÉE explicitement', async () => {
    await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] })
  })

  it('PaymentIntent SANS charge → ok : c’est le moteur qui refuse, et il refuse avant d’insérer', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi(null, ROUTED))
    await expect(preflightRefundFunding({ paymentIntentId: 'pi_1' })).resolves.toEqual({ ok: true })
  })

  it('le préflight ne DÉPLACE rien : aucune création Stripe, aucune lecture de solde', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi({}, ROUTED))
    await preflightRefundFunding({ paymentIntentId: 'pi_1' })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    // décision explicite : PAS de contrôle de solde connecté (balance_insufficient n'est pas prouvé
    // dans ce dépôt, le seuil BRUT est une convention maison, et un 409 à tort arrêterait la répétition)
    expect(stripeMock.balance.retrieve).not.toHaveBeenCalled()
  })

  it('routedWithoutFee est un prédicat pur et tolérant', () => {
    expect(routedWithoutFee({ transfer_data: { destination: 'a' } } as never, null)).toBe(false)
    expect(routedWithoutFee({} as never, { application_fee_amount: 0 } as never)).toBe(false)
    expect(routedWithoutFee({ transfer_data: { destination: 'a' } } as never, { application_fee_amount: 0 } as never)).toBe(true)
    expect(routedWithoutFee({ transfer_data: { destination: 'a' } } as never, {} as never)).toBe(true)
    expect(routedWithoutFee({ transfer_data: { destination: 'a' } } as never, { application_fee_amount: 1 } as never)).toBe(false)
  })

  it('⭐ CONTRÔLE NÉGATIF — le préflight ne touche NI la base NI le moteur', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refund-preflight.ts'), 'utf8')
    expect(src).not.toMatch(/@\/lib\/prisma/)
    expect(src).not.toMatch(/\.create\(|\.update\(|\.updateMany\(/)
    expect(src).not.toMatch(/@\/lib\/refund'/)      // jamais un import du moteur gelé
  })
})
