// tests/refund-dispute-guard.test.ts — PRE-MODE-B V1 : « une charge contestée échoue FERMÉE ».
//
// LE DÉFAUT. Le moteur lib/refund.ts ne lit jamais `charge.disputed` (il est GELÉ : son empreinte
// SHA-256 est épinglée par tests/claims-r13-engine-closed.test.ts). Le rail RÉCLAMATION est couvert
// avant le moteur par H5 'disputed' (lib/claim-action-rules.ts) ; les rails DIRECTS — dont
// POST /api/admin/refunds/run, le déclencheur de la répétition Mode B — ne l'étaient pas.
// Un chargeback sort l'argent sur un rail que `amount_refunded` n'enregistre pas : rembourser
// en plus du débit du litige paie DEUX fois.
//
// Ce que ce fichier épingle : la garde refuse une charge contestée, échoue FERMÉE quand Stripe est
// illisible, et n'invente pas de refus quand il n'y a pas de litige.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { stripeMock } = vi.hoisted(() => ({
  // `refunds.create` existe ici UNIQUEMENT pour prouver que la garde ne l'appelle jamais.
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { assertChargeNotDisputed, chargeIsDisputed, DISPUTED_REFUND_REFUSAL } from '@/lib/refund-dispute-guard'

const charge = (over: Record<string, unknown> = {}) => ({ id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: charge() })
})

describe('PRE-MODE-B V1 — assertChargeNotDisputed', () => {
  it('charge CONTESTÉE → 409, et le message nomme la sortie humaine', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: charge({ disputed: true }) })
    const r = await assertChargeNotDisputed('pi_1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)
    expect(r.error).toMatch(/bloqué par sécurité/)
    // le refus doit rester vrai sur un litige GAGNÉ (charge.disputed est collant) → la sortie est nommée
    expect(r.error).toMatch(/après la clôture du litige/)
    expect(r.error).toMatch(/Dashboard Stripe/)
    // la reprise manuelle doit COMMENCER par vérifier qu'aucun remboursement n'existe déjà,
    // sinon elle paierait deux fois ce que la garde vient d'empêcher (ligne 'pending' adoptable).
    expect(r.error).toMatch(/aucun remboursement n’existe déjà/)
  })

  it('charge NON contestée → ok, aucun refus inventé', async () => {
    await expect(assertChargeNotDisputed('pi_1')).resolves.toEqual({ ok: true })
  })

  it('le drapeau ABSENT vaut « pas de litige » (jamais un refus par défaut)', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: charge({ disputed: undefined }) })
    await expect(assertChargeNotDisputed('pi_1')).resolves.toEqual({ ok: true })
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: charge({ disputed: false }) })
    await expect(assertChargeNotDisputed('pi_1')).resolves.toEqual({ ok: true })
  })

  it('Stripe ILLISIBLE → 502 : sans lecture on ne peut pas prouver l’absence de litige (fail-closed)', async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error('network'))
    const r = await assertChargeNotDisputed('pi_1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(502)
  })

  it('latest_charge ABSENT → ok : rien à contester, c’est le moteur qui refuse une PI sans charge', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: null })
    await expect(assertChargeNotDisputed('pi_1')).resolves.toEqual({ ok: true })
  })

  // ⭐ LE MODE DE DÉFAILLANCE SILENCIEUX. `expand: ['latest_charge']` est le SEUL argument porteur de
  // ce module : sans lui Stripe renvoie une CHAÎNE 'ch_…', `disputed` n'est jamais lu, et la garde
  // deviendrait un no-op sur les trois rails directs — exactement le défaut qu'elle ferme.
  it('l’expansion de la charge est DEMANDÉE explicitement (sans elle la garde serait un no-op)', async () => {
    await assertChargeNotDisputed('pi_1')
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] })
  })

  it('une charge renvoyée en CHAÎNE (expansion perdue) → 502 : on n’a pas lu le litige, donc on refuse', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: 'ch_str' })
    const r = await assertChargeNotDisputed('pi_1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(502)
  })

  it('⭐ CONTRÔLE — un mock qui HONORE l’argument : sans expansion la garde refuse, avec expansion elle voit le litige', async () => {
    // le mock se comporte comme Stripe : il n'étend que si on le lui demande
    stripeMock.paymentIntents.retrieve.mockImplementation(async (_id: string, opts?: { expand?: string[] }) =>
      (opts?.expand?.includes('latest_charge')
        ? { id: 'pi_1', latest_charge: charge({ disputed: true }) }
        : { id: 'pi_1', latest_charge: 'ch_1' }))
    const r = await assertChargeNotDisputed('pi_1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.status).toBe(409)          // l'expansion est bien demandée ⇒ le litige est VU
    expect(r.error).toMatch(/contesté/)
  })

  it('la garde LIT seulement : elle ne crée jamais de remboursement', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: charge({ disputed: true }) })
    await assertChargeNotDisputed('pi_1')
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledTimes(1)
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('chargeIsDisputed est un prédicat pur, tolérant au null', () => {
    expect(chargeIsDisputed(null)).toBe(false)
    expect(chargeIsDisputed({ disputed: true } as never)).toBe(true)
    expect(chargeIsDisputed({ disputed: false } as never)).toBe(false)
    expect(chargeIsDisputed({} as never)).toBe(false)
  })

  it('un seul message de refus est partagé par tous les rails, et il n’affirme RIEN sur Stripe', () => {
    expect(DISPUTED_REFUND_REFUSAL).toMatch(/Paiement contesté chez Stripe/)
    // Le projet n'a mesuré NI que Stripe refuserait, NI qu'il accepterait : le message ne doit
    // affirmer ni l'un ni l'autre. Il dit seulement ce que nous savons : le montant n'est plus prouvable.
    expect(DISPUTED_REFUND_REFUSAL).not.toMatch(/Stripe (refuse|rejette|refusera|accepte|accepterait)/i)
    expect(DISPUTED_REFUND_REFUSAL).not.toMatch(/s’ajouterait au débit|s'ajouterait au débit/)
    expect(DISPUTED_REFUND_REFUSAL).toMatch(/n’est plus prouvable/)
  })
})
