// tests/refund-row-void.test.ts — MODE B commit B : la PORTE qui manquait, et ses onze gardes.
//
// LE DÉFAUT RÉPARÉ. `lib/refund.ts:808` insère une ligne `Refund` 'pending' AVANT d'appeler Stripe.
// Si Stripe ne crée jamais rien (processus tué, rejet terminal), la ligne reste 'pending' à vie —
// `markRefundRowFailed` exige un objet Stripe Refund réel, rien n'est jamais supprimé — et sa clé
// @unique `refund:<orderId>:<cumul>` reste prise : toute tentative ultérieure meurt sur P2002, pour
// TOUT montant et TOUT rail. Le rail de remboursement de la COMMANDE est mort.
//
// CE QUE CE FICHIER PROUVE : on ne libère QUE sur preuve, la preuve ne passe jamais par le montant,
// l'écriture est un compare-and-set unique, et chaque refus n'écrit RIEN.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { db } = vi.hoisted(() => ({
  db: {
    refund: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    claim:  { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { truthMock } = vi.hoisted(() => ({ truthMock: vi.fn() }))
vi.mock('@/lib/claims', () => ({ refundRowTruth: truthMock }))

const { guardMock } = vi.hoisted(() => ({ guardMock: vi.fn() }))
vi.mock('@/lib/refund-dispute-guard', () => ({ assertChargeNotDisputed: guardMock }))

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { proveRowStranded, voidStrandedRefundRow, isReleasedRow, voidedKey, VOID_MIN_AGE_MS, VOID_KEY_MARK } from '@/lib/refund-row-void'
import { RESUME_CREATE_WINDOW_MS } from '@/lib/refund'

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0)
const OLD_ENOUGH = new Date(NOW - VOID_MIN_AGE_MS - 60_000)
const row = (over: Record<string, unknown> = {}) => ({
  id: 'rf_1', orderId: 'o1', status: 'pending', stripeRefundId: null,
  idempotencyKey: 'refund:o1:0', amountCents: 500, createdAt: OLD_ENOUGH, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.refund.findUnique.mockResolvedValue(row())
  db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
  db.refund.findMany.mockResolvedValue([])
  db.claim.findMany.mockResolvedValue([])
  db.refund.updateMany.mockResolvedValue({ count: 1 })
  guardMock.mockResolvedValue({ ok: true })
  truthMock.mockResolvedValue({ kind: 'absent_dead', until: new Date(NOW - 1), windowEnd: new Date(NOW - 2) })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: { id: 'ch_1', amount_refunded: 0 } })
})

const prove = () => proveRowStranded({ rowId: 'rf_1', orderId: 'o1', nowMs: NOW })
const release = (key = 'refund:o1:0') => voidStrandedRefundRow({ rowId: 'rf_1', orderId: 'o1', expectedIdempotencyKey: key, nowMs: NOW })

describe('MODE B — le seuil d’âge est dérivé, jamais choisi au hasard', () => {
  it('26 h ≥ fenêtre de reprise (20 h) + marge moteur (1 h) + 4 h, et > 24 h', async () => {
    // les DEUX constantes sont lues à la source (module réel), jamais recopiées ici : si l'une bouge,
    // ce test le dit au lieu de mentir.
    const real = await vi.importActual<typeof import('@/lib/claims')>('@/lib/claims')
    expect(VOID_MIN_AGE_MS).toBeGreaterThanOrEqual(RESUME_CREATE_WINDOW_MS + real.ENGINE_DEAD_MARGIN_MS + 4 * 3600_000)
    // au-delà du plancher de rétention d'idempotence documenté par Stripe (« au moins 24 h »)
    expect(VOID_MIN_AGE_MS).toBeGreaterThan(24 * 3600_000)
  })

  it('les trois discriminants d’une ligne libérée', () => {
    expect(isReleasedRow({ status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o1:0:void:2026' })).toBe(true)
    expect(isReleasedRow({ status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o1:0' })).toBe(false)   // ⭐ ligne historique
    expect(isReleasedRow({ status: 'failed', stripeRefundId: 're_1', idempotencyKey: 'refund:o1:0:void:x' })).toBe(false)
    expect(isReleasedRow({ status: 'pending', stripeRefundId: null, idempotencyKey: 'refund:o1:0:void:x' })).toBe(false)
    expect(isReleasedRow(null)).toBe(false)
    expect(voidedKey('refund:o1:0', new Date(NOW))).toContain(VOID_KEY_MARK)
  })
})

describe('MODE B — proveRowStranded : chaque refus n’écrit RIEN', () => {
  const refuses = async (code: string) => {
    const r = await prove()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe(code)
    expect(db.refund.updateMany).not.toHaveBeenCalled()
    return r
  }

  it('ligne introuvable → 404', async () => { db.refund.findUnique.mockResolvedValue(null); await refuses('not_found') })

  it('commande qui ne correspond pas → 400 (recoupement anti-faute de frappe)', async () => {
    db.refund.findUnique.mockResolvedValue(row({ orderId: 'autre' }))
    await refuses('order_mismatch')
  })

  it('ligne déjà LIBÉRÉE → 409 explicite, pas une erreur obscure', async () => {
    db.refund.findUnique.mockResolvedValue(row({ status: 'failed', idempotencyKey: 'refund:o1:0:void:2026' }))
    const r = await refuses('not_pending')
    expect(r.error).toMatch(/DÉJÀ été libérée/)
  })

  it('ligne succeeded → 409', async () => { db.refund.findUnique.mockResolvedValue(row({ status: 'succeeded' })); await refuses('not_pending') })

  it('ligne portant un id Stripe → 409 : le moteur A atteint Stripe', async () => {
    db.refund.findUnique.mockResolvedValue(row({ stripeRefundId: 're_1' }))
    await refuses('has_stripe_id')
  })

  it('clé déjà marquée → 409 : ce n’est plus un curseur', async () => {
    db.refund.findUnique.mockResolvedValue(row({ idempotencyKey: 'refund:o1:0:failed:re_9' }))
    await refuses('key_not_cursor')
  })

  it('trop jeune → 409 et l’instant exact est nommé', async () => {
    db.refund.findUnique.mockResolvedValue(row({ createdAt: new Date(NOW - 60_000) }))
    const r = await refuses('too_young')
    expect(r.error).toContain(new Date(NOW - 60_000 + VOID_MIN_AGE_MS).toISOString())
  })

  it('date de création FUTURE → 409 : un instant illisible n’est jamais lu comme ancien', async () => {
    db.refund.findUnique.mockResolvedValue(row({ createdAt: new Date(NOW + 3600_000) }))
    await refuses('too_young')
  })

  it('charge CONTESTÉE → 409 (garde partagée)', async () => {
    guardMock.mockResolvedValue({ ok: false, status: 409, error: 'contesté' })
    await refuses('disputed')
  })

  it('litige illisible → 502 fail-closed', async () => {
    guardMock.mockResolvedValue({ ok: false, status: 502, error: 'illisible' })
    await refuses('unreadable')
  })

  it('vérité Stripe illisible ou liste TRONQUÉE → 502 : l’absence n’est pas prouvable', async () => {
    truthMock.mockResolvedValue({ kind: 'unreadable' })
    await refuses('unreadable')
  })

  it('un remboursement Stripe porte l’identité de la ligne → 409, JAMAIS une libération', async () => {
    truthMock.mockResolvedValue({ kind: 'at_stripe', refund: { id: 're_7', status: 'succeeded' } })
    const r = await refuses('at_stripe')
    expect(r.error).toContain('re_7')
  })

  it('contradiction → 409, le détail du prouveur est transmis', async () => {
    truthMock.mockResolvedValue({ kind: 'contradiction', detail: 'Anomalie X.' })
    const r = await refuses('contradiction')
    expect(r.error).toContain('Anomalie X.')
  })

  it('encore dans la fenêtre de reprise → 409 : le moteur peut encore la reprendre', async () => {
    truthMock.mockResolvedValue({ kind: 'absent_within_window', until: new Date(NOW + 3600_000), windowEnd: new Date(NOW) })
    await refuses('absent_within_window')
  })

  it('cumul Stripe DÉPLACÉ → 409 : de l’argent a bougé, réconciliation manuelle', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', latest_charge: { id: 'ch_1', amount_refunded: 500 } })
    const r = await refuses('cursor_moved')
    expect(r.error).toContain('500')
  })

  it('réclamation affichant « Remboursée » sur cette ligne → 409', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', status: 'refunded', refundError: null }])
    await refuses('claim_shows_refunded')
  })

  it('commande sans PaymentIntent → 409, rien n’est prouvable', async () => {
    db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: null })
    await refuses('unreadable')
  })

  it('cas nominal → preuve complète, et TOUJOURS aucune écriture', async () => {
    db.refund.findMany.mockResolvedValue([{ id: 'rf_2' }])
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', status: 'approved', refundError: 'engine_row_dead: …' }])
    const r = await prove()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.proof).toMatchObject({
      rowId: 'rf_1', orderId: 'o1', amountCents: 500, cursorCents: 0,
      stripeAmountRefundedCents: 0, truthKind: 'absent_dead',
      otherPendingRowIds: ['rf_2'], boundClaimIds: ['cl1'],
    })
    expect(db.refund.updateMany).not.toHaveBeenCalled()
    // l'identité est prouvée par le prouveur du dépôt, jamais par le montant
    expect(truthMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'rf_1' }), 'o1', {}, 'pi_1')
  })
})

describe('MODE B — voidStrandedRefundRow : une seule écriture, en compare-and-set', () => {
  it('clé rejouée ≠ clé lue → 409, aucune écriture', async () => {
    const r = await release('refund:o1:999')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('key_echo_mismatch')
    expect(db.refund.updateMany).not.toHaveBeenCalled()
  })

  it('libération : CAS sur la pré-image exacte, et data ne porte QUE deux clés', async () => {
    const r = await release()
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(db.refund.updateMany).toHaveBeenCalledTimes(1)
    const call = db.refund.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'rf_1', status: 'pending', stripeRefundId: null, idempotencyKey: 'refund:o1:0' })
    expect(Object.keys(call.data).sort()).toEqual(['idempotencyKey', 'status'])
    expect(call.data.status).toBe('failed')
    expect(call.data.idempotencyKey).toContain(VOID_KEY_MARK)
    // JAMAIS : un id Stripe (ce serait forger le verrou E2), ni reason (écrit une seule fois), ni settledAt
    expect(call.data).not.toHaveProperty('stripeRefundId')
    expect(call.data).not.toHaveProperty('reason')
    expect(call.data).not.toHaveProperty('settledAt')
    expect(r.keyBefore).toBe('refund:o1:0')
    expect(r.keyAfter).toContain(':void:')
  })

  it('CAS perdue (count 0) → 409, et on ne réessaie pas', async () => {
    db.refund.updateMany.mockResolvedValue({ count: 0 })
    const r = await release()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('changed_during_read')
    expect(db.refund.updateMany).toHaveBeenCalledTimes(1)
  })

  it('un refus de preuve empêche l’écriture même si la clé est correcte', async () => {
    truthMock.mockResolvedValue({ kind: 'unreadable' })
    const r = await release()
    expect(r.ok).toBe(false)
    expect(db.refund.updateMany).not.toHaveBeenCalled()
  })
})

describe('MODE B — ce module ne fait QUE cela (pin de source)', () => {
  const src = () => fs.readFileSync(path.join(__dirname, '..', 'lib', 'refund-row-void.ts'), 'utf8')

  it('un seul écrivain, aucune création, aucune suppression', () => {
    const s = src()
    expect((s.match(/prisma\.refund\.updateMany\(/g) || []).length).toBe(1)
    expect(s).not.toMatch(/prisma\.refund\.create\(|\.delete\(|\.deleteMany\(/)
    expect(s).not.toMatch(/prisma\.claim\.update|prisma\.ledgerEntry|loyalty/i)
    expect(s).not.toMatch(/refunds\.create\(/)          // ne crée JAMAIS de remboursement
  })

  it('le moteur gelé n’est pas touché et n’importe pas ce module', () => {
    const engine = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refund.ts'), 'utf8')
    expect(engine).not.toMatch(/refund-row-void|refund-void-state|voidStrandedRefundRow/)
  })

  it('l’état vit dans une FEUILLE sans import — sinon lib/claims.ts créerait un cycle', () => {
    const leaf = fs.readFileSync(path.join(__dirname, '..', 'lib', 'refund-void-state.ts'), 'utf8')
    expect(leaf).not.toMatch(/^import /m)
    const claims = fs.readFileSync(path.join(__dirname, '..', 'lib', 'claims.ts'), 'utf8')
    expect(claims).toMatch(/from '@\/lib\/refund-void-state'/)
    expect(claims).not.toMatch(/from '@\/lib\/refund-row-void'/)
  })
})
