// tests/claims-r13-trigger.test.ts — T-49 round 13, slice W2: J-M18 (C2, D2 (3)), J-M11 (B7, B12), J-M19 (C3),
// and the T1 halves of J-M21 (C4) and J-M47 (G9).
//
// T1 claims ONE attempt on the exact pre-image with a token unique to the attempt. T2 re-derives the proof on
// fresh reads immediately before the engine, and every branch that does not call the engine writes by CAS on
// that token. T3 reads identity three-way: a failed read is 'unknown', never « n’appartient PAS ».
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, engine202, HOURS, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { triggerClaimRefund, reconcileRequiredMarker, RECONCILE_REQUIRED } from '@/lib/claims'
import { reconcileMarkerAge, MARKERS, LOCKED_CLOSE, AWAITING_CLOSE, HEAD_A, LIST_OVER_CAP_CLAUSE } from '@/lib/claim-action-rules'
import { approvalToast } from '@/lib/claim-approval-toast'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const FR = JSON.parse(read('messages/fr.json')) as { claims: { admin: Record<string, string> } }
const v13 = (instant: Date) => `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`
const alerts = (kind: string) => (alertMock.mock.calls as Array<[{ kind: string; dedupeKey: string; facts: Record<string, unknown> }]>).map((c) => c[0]).filter((a) => a.kind === kind)
const blockedCauses = () => alerts('claim_payment_blocked').map((a) => a.facts.cause)

let w: World
const setWorld = (next: World) => { w = next; wireWorld(w, db, stripeMock) }
/** The token T1 wrote. */
const M = () => String(w.writes[0].data.refundError)

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, refundsFlag]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  execMock.mockResolvedValue(engineOk())
  setWorld(payableWorld())
})

// ══ J-M18 — T1 ═══════════════════════════════════════════════════════════════════════════════════
describe('J-M18 — the attempt token M and T1 (C2, D2 (3))', () => {
  it('two markers built at the same instant differ; the ISO comes first and reconcileMarkerAge reads it, never the nonce', () => {
    const at = new Date(Date.now() - 60_000)
    const a = reconcileRequiredMarker(at, globalThis.crypto.randomUUID())
    const b = reconcileRequiredMarker(at, globalThis.crypto.randomUUID())
    expect(a).not.toBe(b)
    expect(a.indexOf(at.toISOString())).toBeGreaterThan(0)
    expect(a.indexOf(at.toISOString())).toBeLessThan(a.indexOf('(tentative '))
    expect(reconcileMarkerAge(a, at.getTime() + 60_000)).toBe(60_000)
  })

  it('a null pre-image and a v13 proof past its instant → ONE CAS on the pre-image, data {refunding, true, M}', async () => {
    for (const pre of [null, v13(new Date(Date.now() - 1000))]) {
      setWorld(payableWorld({ refundError: pre }))
      await triggerClaimRefund('cl1')
      expect(w.writes[0].where, String(pre)).toEqual({ id: 'cl1', status: 'approved', refundAttempted: false, refundId: null, refundError: pre })
      expect(w.writes[0].data).toMatchObject({ status: 'refunding', refundAttempted: true })
      expect(M()).toMatch(new RegExp(`^${RECONCILE_REQUIRED}: tentative de remboursement démarrée à \\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z \\(tentative [0-9a-f-]{36}\\) `))
      expect(execMock).toHaveBeenCalledTimes(1)
      execMock.mockClear()
    }
  })

  it('J-M47 / J-M21 — every other pre-image → already_handled, 0 writes, the engine never called (every lock prefix, before or without an instant)', async () => {
    const future = new Date(Date.now() + 10 * 60_000)
    const REFUSED: Array<[string, Record<string, unknown> | null]> = [
      ['v13 before its instant', { refundError: v13(future) }],
      ['v13 with an unreadable instant', { refundError: `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A}` }],
      ['v13 with an unparsable instant', { refundError: `${MARKERS.PROOF_PAYABLE_V13} payable au plus tôt le 2026-13-45T99:99:99.000Z (UTC).` }],
      ['AWAITING', { refundError: `${MARKERS.AWAITING_FINALIZATION} ${HEAD_A}` }],
      ['RAIL_LOCKED', { refundError: `no_refund_proven_rail_locked: ${HEAD_A}` }],
      ['legacy proof', { refundError: 'no_refund_proven: aucun remboursement …' }],
      ['SAFETY_HOLD', { refundError: `${MARKERS.SAFETY_HOLD} Aucun remboursement …`, refundAttempted: true }],
      ['stripe_failed', { refundError: 'stripe_failed: …' }],
      ['refundId set', { refundId: 'rf1' }],
      ['refundAttempted true, no error', { refundAttempted: true }],
      ['not approved', { status: 'arbitration' }],
      ['missing claim', null],
    ]
    for (const [name, pre] of REFUSED) {
      const world = payableWorld(pre ?? {})
      if (pre === null) world.claims = []
      setWorld(world)
      expect(await triggerClaimRefund('cl1'), name).toEqual({ state: 'already_handled' })
      expect(w.writes, name).toEqual([])
      expect(execMock, name).not.toHaveBeenCalled()
    }
  })

  it('a concurrent change of refundError between the read and the CAS → count 0 → already_handled, nothing else written', async () => {
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = 'no_refund_proven_rail_locked: écrit entre-temps' }
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'already_handled' })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundError: 'no_refund_proven_rail_locked: écrit entre-temps' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — a v13 proof that also quotes a unique-nonce marker is still refused before its instant', async () => {
    const marker = reconcileRequiredMarker(new Date(Date.now() - 2 * HOURS), globalThis.crypto.randomUUID())
    setWorld(payableWorld({ refundError: `${MARKERS.PROOF_PAYABLE_V13} ${marker} … Elle est payable au plus tôt le ${new Date(Date.now() + 60_000).toISOString()} (UTC).` }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'already_handled' })
    expect(w.writes).toEqual([])
  })

  it('no shipped copy says that closing the REFUNDS lease stops an attempt already in flight', () => {
    const files = [...readdirSync('lib').filter((f) => f.endsWith('.ts')).map((f) => `lib/${f}`), 'messages/fr.json']
    const re = /ferm\w+ .*(bail|remboursements).*arr[êe]t/i
    const hits = files.flatMap((f) => stripComments(read(f)).split('\n').filter((l) => re.test(l)).map((l) => `${f}: ${l.trim().slice(0, 80)}`))
    expect(hits).toEqual([])
    expect(re.test('fermer la fenêtre des remboursements arrête la tentative')).toBe(true) // the scan can fail
  })
})

// ══ J-M11 — T3, three-way identity after the engine ════════════════════════════════════════════════
describe('J-M11 — identity after the engine is three-way (B7, B12)', () => {
  /** The engine returns a row that it (and not the fixture before T2) put in the base. */
  const engineReturns = (result: Record<string, unknown>, row?: Record<string, unknown>) => {
    execMock.mockImplementation(async () => { if (row) w.refunds.push(row); return result })
  }

  it('(a) ok resumed:false → refunded, and the identity is never read', async () => {
    const r = await triggerClaimRefund('cl1')
    expect(r).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(db.refund.findUnique).not.toHaveBeenCalled()
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_new', refundError: null, activeOrderKey: null })
  })

  it('(b)(d) ok resumed:true with a rejecting read, or no row → identity_unverified: CAS on M, the B7 text, refundId unchanged, ALERT-B', async () => {
    for (const variant of ['rejects', 'row null'] as const) {
      setWorld(payableWorld())
      engineReturns(engineOk({ resumed: true, refundId: 'rf9' }))
      if (variant === 'rejects') w.fail.refundFindUnique = true
      const r = await triggerClaimRefund('cl1')
      expect(r, variant).toEqual({ state: 'failed', error: 'identity_unverified' })
      const last = w.writes.at(-1)!
      expect(last.where).toEqual({ id: 'cl1', status: 'refunding', refundError: M() })
      expect(last.count).toBe(1)
      const text = String(claimOf(w).refundError)
      expect(text.startsWith(M())).toBe(true)
      expect(text).toContain('n’a pas pu être relue')
      expect(text).toContain('a abouti chez Stripe')
      expect(claimOf(w).refundId).toBeNull()
      // NEGATIVE CONTROL: an unread identity is never a negative one.
      expect(text).not.toMatch(/n[’']appartient PAS/)
      expect(text).not.toContain('mais pas au titre de cette réclamation')
      expect(blockedCauses()).toEqual(['identity_unverified'])
      alertMock.mockClear()
    }
  })

  it('(c) 202 with a rejecting read → the same, with « reste en attente »', async () => {
    engineReturns(engine202({ refundId: 'rf9' }))
    w.fail.refundFindUnique = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'identity_unverified' })
    expect(String(claimOf(w).refundError)).toContain('a été accepté par Stripe et reste en attente')
    expect(claimOf(w).refundId).toBeNull()
  })

  it('(e) ok resumed:true on a row stamped claim:OTHER, (f) 202 on it → the resume_mismatch texts, ALERT-B resume_mismatch', async () => {
    engineReturns(engineOk({ resumed: true, refundId: 'rf9' }), refundRow('rf9', { reason: 'claim:OTHER', status: 'succeeded' }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'resume_mismatch' })
    expect(String(claimOf(w).refundError)).toMatch(/^resume_mismatch: le moteur a abouti sur un remboursement \(rf9\) qui n'appartient PAS/)
    expect(claimOf(w).refundId).toBe('rf9')
    expect(blockedCauses()).toEqual(['resume_mismatch'])

    setWorld(payableWorld())
    alertMock.mockClear()
    engineReturns(engine202({ refundId: 'rf9' }), refundRow('rf9', { reason: 'claim:OTHER', status: 'pending' }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'resume_mismatch' })
    expect(String(claimOf(w).refundError)).toMatch(/^resume_mismatch: le moteur a repris un remboursement \(rf9\) qui n'appartient PAS .*encore en attente chez Stripe/)
    expect(blockedCauses()).toEqual(['resume_mismatch'])
  })

  it('(g) the row carries claim:<this> → refunded on ok, bound pending on 202', async () => {
    engineReturns(engineOk({ resumed: true, refundId: 'rf_own' }), refundRow('rf_own', { reason: 'claim:cl1' }))
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'refunded', refundId: 'rf_own' })
    setWorld(payableWorld())
    engineReturns(engine202({ refundId: 'rf_own' }), refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'pending', reason: 'stripe_pending', refundId: 'rf_own' })
    expect(claimOf(w)).toMatchObject({ status: 'refunding', refundId: 'rf_own', refundError: null })
  })

  it('source scan — « n’appartient PAS » occurs in lib/claims.ts only inside the two not_ours resume_mismatch literals', () => {
    const src = stripComments(read('lib/claims.ts'))
    expect((src.match(/n[’']appartient PAS/g) ?? []).length).toBe(2)
    const literals = src.match(/refundError: `resume_mismatch:[^`]*`/g) ?? []
    expect(literals.filter((l) => /n[’']appartient PAS/.test(l)).length).toBe(2)
  })
})

// ══ J-M19 — T2, step by step ═══════════════════════════════════════════════════════════════════════
describe('J-M19 — T2: every branch writes by CAS on M and never calls the engine (C3)', () => {
  const T2_WHERE = () => ({ id: 'cl1', status: 'refunding', refundAttempted: true, refundError: M() })
  const noEngine = () => { expect(execMock).not.toHaveBeenCalled(); expect(stripeMock.refunds.create).not.toHaveBeenCalled() }

  /** A-S30e-2 facts: another claim's pending row rf_A whose refund SUCCEEDED at Stripe, no clawback; cl_A its settled binder. */
  const awaitingWorld = () => {
    const x = payableWorld()
    x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
    x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
    x.pis.pi_1.latest_charge.amount_refunded = 300
    x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
    return x
  }

  it('(a) an own stamped row → own_row_exists « Vérification avant moteur », where {refunding, true, M}, ALERT-B', async () => {
    w.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
    expect(w.writes[1].where).toEqual(T2_WHERE())
    expect(String(claimOf(w).refundError)).toBe(`${M()} Vérification avant moteur : la ligne rf_own porte déjà l’identité de cette réclamation ; aucun nouveau remboursement n’a été lancé. Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé.`)
    expect(blockedCauses()).toEqual(['own_row_exists'])
    noEngine()
  })

  it('(b) transient unreadability → the pre-image EXACTLY (null, and v13), refundAttempted false, cause safety_check_unreadable, success tone', async () => {
    for (const pre of [null, v13(new Date(Date.now() - 1000))]) {
      setWorld(payableWorld({ refundError: pre }))
      w.fail.piRetrieve = true
      alertMock.mockClear()
      const r = await triggerClaimRefund('cl1')
      expect(r).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
      expect(w.writes[1].where).toEqual(T2_WHERE())
      expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null, refundError: pre })
      expect(blockedCauses()).toEqual(['safety_check_unreadable'])
      expect(approvalToast(r)).toEqual({ key: 'approvedNotSent', tone: 'success' })
      noEngine()
    }
  })

  it('(b) a rejecting read anywhere in the loader is transient too (list, royalty, a row retrieve)', async () => {
    for (const fail of [{ refundList: true }, { royaltyFindFirst: true }, { refundRetrieve: { re_S: 'throw' as const } }]) {
      setWorld(payableWorld())
      w.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S', idempotencyKey: 'refund:o1:x' }))
      w.stripeRefunds.push(stripeRefund('re_S'))
      w.pis.pi_1.latest_charge.amount_refunded = 300
      w.fail = fail
      expect(await triggerClaimRefund('cl1'), JSON.stringify(fail)).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
      noEngine()
    }
  })

  it('(b\') no charge → SAFETY_HOLD with the FIRST refusal refund.ts reaches (E1, E2, E1b, E1c), refundAttempted stays true, error tone', async () => {
    const hold = (clause: string) => `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : le paiement Stripe de cette commande n’a pas de charge : aucune vérification ne peut être lue, et le moteur refuserait${clause} Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`
    const cases: Array<[string, (x: World) => void, string]> = [
      ['E1c', () => {}, ' (« Charge introuvable sur le paiement. »).'],
      ['E1b', (x) => { x.pis.pi_1.status = 'requires_capture' }, ' (« Paiement non débité — rien à rembourser. »).'],
      ['E1', (x) => { x.orders[0].paymentStatus = 'refunded'; x.pis.pi_1.status = 'requires_capture' }, ' (« Commande non payée — rien à rembourser. »).'],
      ['E2 precedes E1b', (x) => { x.pis.pi_1.status = 'requires_capture'; x.refunds.push(refundRow('rf_F', { status: 'failed', stripeRefundId: 're_F' })) },
        ' : la ligne rf_F est ÉCHOUÉE avec un identifiant Stripe, et le moteur refuse tout remboursement sur une commande qui porte une telle ligne ; aucune action des réclamations ne modifie cette ligne.'],
    ]
    for (const [name, mutate, clause] of cases) {
      const x = payableWorld()
      x.pis.pi_1.latest_charge = null
      mutate(x)
      setWorld(x)
      const r = await triggerClaimRefund('cl1')
      expect(r, name).toEqual({ state: 'failed', error: 'safety_hold' })
      expect(claimOf(w), name).toMatchObject({ status: 'approved', refundAttempted: true, refundError: hold(clause) })
      expect(approvalToast(r)).toEqual({ key: 'approvedNotSent', tone: 'error' })
      noEngine()
    }
  })

  it('(b\') a refund list over the page cap → SAFETY_HOLD list_over_cap', async () => {
    w.fail.listOverCap = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_hold' })
    expect(claimOf(w).refundError).toBe(`${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : ${LIST_OVER_CAP_CLAUSE} Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`)
    noEngine()
  })

  it('(c) H1 reverted (+ ROUTED), H2, H3 and H5 → SAFETY_HOLD with the G8 hold sentences', async () => {
    const cases: Array<[string, (x: World) => void, string[]]> = [
      ['H1 reverted, routed', (x) => {
        x.pis.pi_1.transfer_data = { destination: 'acct_1' }
        x.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S', idempotencyKey: 'refund:o1:0' }))
        x.stripeRefunds.push(stripeRefund('re_S', { status: 'failed' }))
      }, ['la ligne rf_S est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_S est « failed » chez Stripe)', 'Ce paiement est routé : un remboursement échoué a pu laisser le transfert du restaurant inversé']],
      ['H2', (x) => {
        x.pis.pi_1.transfer_data = { destination: 'acct_1' }
        x.stripeRefunds.push(stripeRefund('re_D', { status: 'failed' }))
      }, ['sur ce paiement routé, Stripe rapporte un remboursement « failed » (re_D) qui ne correspond à aucune ligne de notre base']],
      ['H3 + another claim’s pending row', (x) => {
        x.refunds.push(refundRow('rf_C', { status: 'pending', stripeRefundId: 're_C', reason: 'claim:cl_OTHER' }))
        x.fail.refundRetrieve = { re_C: 'missing' }
      }, ['la ligne rf_C (« pending » dans notre base) enregistre un remboursement dont la lecture chez Stripe se contredit']],
      ['H5 disputed', (x) => { x.pis.pi_1.latest_charge.disputed = true }, ['Stripe rapporte un litige sur la charge ch_1 de ce paiement']],
      ['H5 captured', (x) => { x.pis.pi_1.latest_charge.amount_captured = 300 }, ['dépasse ce qui reste remboursable sur le montant capturé de ce paiement (300 c)']],
    ]
    for (const [name, mutate, parts] of cases) {
      const x = payableWorld()
      mutate(x)
      setWorld(x)
      alertMock.mockClear()
      expect(await triggerClaimRefund('cl1'), name).toEqual({ state: 'failed', error: 'safety_hold' })
      const text = String(claimOf(w).refundError)
      expect(text.startsWith(`${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : `), name).toBe(true)
      for (const p of parts) expect(text, name).toContain(p)
      expect(claimOf(w).refundAttempted).toBe(true)
      expect(blockedCauses(), name).toEqual(['safety_hold'])
      noEngine()
    }
  })

  it('(c) G5/G8 IMPLEMENTATION NOTE (W2) — H5 captured only where the engine would insert its row: a fully captured charge with requested > refundable is the E5 lock, never an H5 hold', async () => {
    setWorld(payableWorld({ requestedAmountCents: 2500 }))
    const r = await triggerClaimRefund('cl1')
    expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
    const text = String(claimOf(w).refundError)
    expect(text.startsWith('no_refund_proven_rail_locked: ')).toBe(true)
    expect(text).toContain('le montant de cette réclamation (2500 c) dépasse ce qui reste remboursable sur ce paiement (2000 c) ; le moteur refuserait (« Montant invalide »).')
    expect(text).not.toContain('enregistrerait sa ligne avant que Stripe refuse')
    expect(blockedCauses()).toEqual(['no_refund_proven_rail_locked:'])
    noEngine()
    // NEGATIVE CONTROL: a partial capture the engine accepts (E5 passes on the charge amount) keeps the H5 captured hold.
    const x = payableWorld()
    x.pis.pi_1.latest_charge.amount_captured = 300
    setWorld(x)
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_hold' })
    expect(String(claimOf(w).refundError)).toContain('dépasse ce qui reste remboursable sur le montant capturé de ce paiement (300 c)')
  })

  it('(e\') A-S30e-1 a dead pending row of another claim → the LOCKED proof is WRITTEN, never a revert to null', async () => {
    w.refunds.push(refundRow('rf_D', { status: 'pending', reason: 'claim:cl_OTHER', createdAt: new Date(Date.now() - 30 * HOURS) }))
    const r = await triggerClaimRefund('cl1')
    expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
    expect(w.writes[1].where).toEqual(T2_WHERE())
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(c.refundError).not.toBeNull()
    expect(String(c.refundError)).toBe(`no_refund_proven_rail_locked: ${HEAD_A} MAIS une nouvelle approbation ne paierait pas cette réclamation : la plus ancienne ligne en attente de la commande, rf_D (identité claim:cl_OTHER), est reprise par le moteur avant tout nouveau remboursement : Stripe ne connaît aucun remboursement pour elle et le moteur ne la créera plus (fenêtre d’idempotence expirée) ; il refuse donc sa reprise (« Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré… ») ; aucun code de l’application ne retire cette ligne. ${LOCKED_CLOSE}`)
    expect(blockedCauses()).toEqual(['no_refund_proven_rail_locked:'])
    expect(approvalToast(r)).toEqual({ key: 'approvedNotSent', tone: 'error' })
    noEngine()
  })

  it('(e\') A-S30e-2 → the AWAITING proof (temporary lock) is written', async () => {
    setWorld(awaitingWorld())
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'proof_stale' })
    const text = String(claimOf(w).refundError)
    expect(text.startsWith(`${MARKERS.AWAITING_FINALIZATION} Stripe rapporte 300 c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation`)).toBe(true)
    expect(text).toContain('tant que la plus ancienne ligne en attente de la commande, rf_A (identité claim:cl_A), est reprise par le moteur avant tout nouveau remboursement : son remboursement Stripe re_A est ABOUTI')
    expect(text.endsWith(AWAITING_CLOSE)).toBe(true)
    expect(blockedCauses()).toEqual([MARKERS.AWAITING_FINALIZATION])
    noEngine()
  })

  it('(e\') A-S30e-4 a refund of another claim still pending at Stripe → FINANCIAL VERIFICATION through enterFinancialVerification, expect {refunding, M}', async () => {
    w.refunds.push(refundRow('rf_P', { status: 'pending', stripeRefundId: 're_P', reason: 'claim:cl_Z' }))
    w.stripeRefunds.push(stripeRefund('re_P', { status: 'pending' }))
    w.pis.pi_1.latest_charge.amount_refunded = 300
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'proof_stale' })
    expect(w.writes[1].where).toEqual({ id: 'cl1', status: 'refunding', refundError: M() })
    expect(claimOf(w).status).toBe('financial_verification')
    expect(String(claimOf(w).refundError).startsWith('financial_verification:refund_moved_unattributed:')).toBe(true)
    expect(alerts('claim_financial_verification')).toHaveLength(1)
    noEngine()
  })

  it('(e\') A-S30e-3 a pending row within its window → the pre-image restored, cause unconfirmed_within_window, « Conclusion possible à partir du »', async () => {
    w.refunds.push(refundRow('rf_W', { status: 'pending', reason: 'claim:cl_OTHER', createdAt: new Date(Date.now() - 1 * HOURS) }))
    const r = await triggerClaimRefund('cl1')
    expect(r).toMatchObject({ state: 'failed', error: 'unconfirmed_within_window' })
    expect(typeof (r as { until?: string }).until).toBe('string')
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundError: null })
    expect(blockedCauses()).toEqual(['unconfirmed_within_window'])
    const toast = approvalToast(r)
    expect(toast).toMatchObject({ key: 'approvedNotSentUntil', tone: 'success' })
    expect(FR.claims.admin.approvedNotSentUntil).toContain('Conclusion possible à partir du {date}')
    noEngine()
  })

  it('overlaps resolve in the order a < b < b\' < c < e\'', async () => {
    // own stamped row + Stripe unreadable → (a), and Stripe is never read
    w.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
    w.fail.piRetrieve = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
    // transient + H1 → (b)
    setWorld(payableWorld())
    w.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S' }))
    w.stripeRefunds.push(stripeRefund('re_S', { status: 'failed' }))
    w.fail.piRetrieve = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
    // no charge + H1 → (b')
    setWorld(payableWorld())
    w.pis.pi_1.latest_charge = null
    w.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S' }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_hold' })
    expect(String(claimOf(w).refundError)).toContain('n’a pas de charge')
    // H5 + a dead pending row → (c)
    setWorld(payableWorld())
    w.pis.pi_1.latest_charge.disputed = true
    w.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) }))
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_hold' })
    noEngine()
  })

  it('every T2 write whose CAS matches nothing → attempt_superseded, no further write, no alert', async () => {
    const fixtures: Array<[string, (x: World) => void]> = [
      ['(a)', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' })) }],
      ['(b)', (x) => { x.fail.piRetrieve = true }],
      ['(b\')', (x) => { x.pis.pi_1.latest_charge = null }],
      ['(c)', (x) => { x.pis.pi_1.latest_charge.disputed = true }],
      ['(e\') lock', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }],
      ['(e\') park', (x) => { x.refunds.push(refundRow('rf_P', { status: 'pending', stripeRefundId: 're_P', reason: 'claim:cl_Z' })); x.stripeRefunds.push(stripeRefund('re_P', { status: 'pending' })); x.pis.pi_1.latest_charge.amount_refunded = 300 }],
      ['(e\') window', (x) => { x.refunds.push(refundRow('rf_W', { status: 'pending', createdAt: new Date(Date.now() - HOURS) })) }],
    ]
    for (const [name, mutate] of fixtures) {
      const x = payableWorld()
      mutate(x)
      setWorld(x)
      alertMock.mockClear()
      w.beforeClaimWrite = (n) => { if (n === 2) claimOf(w).refundError = 'financial_verification:stripe_unreadable: écrit par une réconciliation' }
      expect(await triggerClaimRefund('cl1'), name).toEqual({ state: 'failed', error: 'attempt_superseded' })
      expect(w.writes.map((wr) => wr.count), name).toEqual([1, 0])
      expect(alertMock, name).not.toHaveBeenCalled()
      noEngine()
    }
  })

  it('(f) the claim changed just before the engine → attempt_superseded, no write, engine not called', async () => {
    w.beforeClaimRead = (n) => { if (n === 2) Object.assign(claimOf(w), { status: 'financial_verification', refundError: 'financial_verification:x: y' }) }
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(w.writes).toHaveLength(1)
    noEngine()
  })

  it('(f) the token changed while the status stays refunding → attempt_superseded, no write, engine not called (C3 (f); certification audit c32d8d3, P1)', async () => {
    // Another attempt's T1 now holds the claim: same status, a different token. Only the token half of (f) refuses it.
    w.beforeClaimRead = (n) => { if (n === 2) claimOf(w).refundError = reconcileRequiredMarker(new Date(), globalThis.crypto.randomUUID()) }
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(claimOf(w).status).toBe('refunding')
    expect(w.writes).toHaveLength(1)
    noEngine()
  })

  it('« awaiting_other_row » no longer exists in lib/ or messages/', () => {
    const files = [...readdirSync('lib').filter((f) => f.endsWith('.ts')).map((f) => `lib/${f}`), ...['fr', 'en', 'es', 'it', 'ar'].map((l) => `messages/${l}.json`)]
    for (const f of files) expect(read(f), f).not.toContain('awaiting_other_row')
  })

  it('NEGATIVE CONTROL — the baseline payable facts: executeRefund once with the claim reason, no T2 write (T1 then T4 only)', async () => {
    const r = await triggerClaimRefund('cl1')
    expect(r).toMatchObject({ state: 'refunded' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
    expect(w.writes.map((x) => x.where)).toEqual([
      { id: 'cl1', status: 'approved', refundAttempted: false, refundId: null, refundError: null },
      { id: 'cl1', status: 'refunding', refundError: M() },
    ])
  })
})
