import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

// ── T43 (vague 3) — câblage des ROUTES : chaque étape émet son email, post-succès,
// et JAMAIS sur un échec. Les blocs sont ADDITIFS : la machine à états lib/claims,
// le moteur de remboursement et la logique d'arbitrage sont mockés TELS QUELS —
// aucune assertion ne change sur leurs appels (non-régression du circuit prouvé).
//
// ROUND 13 (slice W6): J-C22 (H03 — the arbitrate e-mail kind by provenance, the lease read at send time) and J-C47
// (E-17 — a non-terminal e-mail skipped as claims_disabled when the lease closes mid-request). The closure send sites
// of J-M38 run in tests/claim-emails-routes-closure.test.ts.
//
// D′ L2 (spec v2 S-02/S-13): an approve is a DECISION only — the arbitrate route sends 'approved' with refundedCents
// null on EVERY approve (never 'refunded': that e-mail belongs to the financial rail, on the engine's amount, D′ L5),
// reports no `refund` field and audits moneyMoved:false. POST /api/claims sends the ack ONLY: the former auto_small
// decision e-mail is gone with the machine approval path (autoResolveSmallClaim is inert; the route ignores its result).
//
// D′ L1 (spec v2 §3, FIN-EMAIL-01): the routes no longer read a gate from lib/claims — they read lib/claim-flags, which
// reads process.env ONLY. So the gate is opened HERE the way the operator opens it (the legacy lease, S-12) and a
// « closed mid-request » is played by closing the env INSIDE the engine mock, between the entry gate and the send.
// The ack and decision e-mails are PRE-MONEY notices: claimsOpen = claimNoticeGate('pre_money') = the surface at send time.

const { claims } = vi.hoisted(() => ({
  claims: {
    createClaim:           vi.fn(),
    // W6: the auto-resolution result carries refundId / amountCents / reason on some shapes — typed loosely for the fixtures.
    autoResolveSmallClaim: vi.fn(async (): Promise<Record<string, unknown>> => ({ state: 'not_eligible' })),
    respondToClaim:        vi.fn(),
    arbitrateClaim:        vi.fn(),
    listConsumerClaims:    vi.fn(),
    getClaimEligibility:   vi.fn(),
    reconcileClaimEvidence: vi.fn(),
    // CLAIMS BATCH 2 — canonical taxonomy plus the two legacy aliases the route accepts.
    CLAIM_REASONS:         ['missing_item', 'wrong_item', 'wrong_quantity', 'quality', 'restaurant_closed', 'excessive_wait', 'not_received', 'payment_issue', 'allergen_safety', 'other'],
    ACCEPTED_REASONS:      ['missing_item', 'wrong_item', 'wrong_quantity', 'quality', 'restaurant_closed', 'excessive_wait', 'not_received', 'payment_issue', 'allergen_safety', 'other', 'wrong_order', 'not_delivered'],
  },
}))
vi.mock('@/lib/claims', () => claims)

const { ackMock, decisionMock, closureMock } = vi.hoisted(() => ({ ackMock: vi.fn(), decisionMock: vi.fn(), closureMock: vi.fn() }))
vi.mock('@/lib/claim-emails', () => ({
  sendClaimAckEmail:      ackMock,
  sendClaimDecisionEmail: decisionMock,
  sendClaimClosureEmail:  closureMock,
}))

const { mail } = vi.hoisted(() => ({ mail: { sendTransactional: vi.fn(), logEmailSkipped: vi.fn() } }))
vi.mock('@/lib/transactional-emails', () => mail)
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/onboarding-nudge', () => ({ resolveNudgeLocale: () => 'fr' }))

const { db } = vi.hoisted(() => ({
  db: {
    restaurant: { findUnique: vi.fn() },
    operator:   { findUnique: vi.fn() },
    claim:      { findUnique: vi.fn() },
    emailLog:   { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

vi.mock('@/lib/dish-photo', () => ({
  processDishImage: vi.fn(), ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
}))
const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn(() => null) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: limitMock }))
// ROUND-8 AUDIT FIX (P2): the arbitrate route authorises through resolveAdmin (role set re-read from
// the DB), not the session JWT. Only the arbitrate route among those imported here uses it.
const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: vi.fn(() => true) }))
// D′ L4 (S-27): the arbitrate route's APPROVE branch answers 503 schema_not_ready when the D′ columns are
// not usable. This file is about the E-MAIL WIRING, so the probe is stated READY and the one test that is
// about readiness drives this same double to « not ready » itself — nothing here hides a real not-ready state.
const { schemaMock } = vi.hoisted(() => ({ schemaMock: { fn: vi.fn() } }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: (...a: unknown[]) => schemaMock.fn(...a) }
})
const SCHEMA_READY = { ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null }

import { POST as CREATE } from '@/app/api/claims/route'
import { POST as RESPOND } from '@/app/api/claims/[id]/respond/route'
import { POST as ARBITRATE } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { POST as CLOSURE_NOTICE } from '@/app/api/admin/claims/[id]/closure-notice/route'
import { DECISION_TRIGGER } from '../lib/claim-emails'
import { APPROVE_CONFIRM_WORD } from '@/lib/claim-action-rules'

const CLAIM = {
  id: 'cl1', consumerId: 'c1', orderId: 'ord123abc', restaurantId: 'r1',
  requestedAmountCents: 1250, status: 'restaurant_review',
}
/** D′ L4 (T-07): the shape an approve must now carry — a validated amount and the typed confirmation. */
const APPROVE_BODY = { decision: 'approve', approvedAmountCents: 1250, confirm: APPROVE_CONFIRM_WORD }
/** The decided row the engine hands back: the amount the e-mail must name is RE-READ from it (D-11). */
const DECIDED_AT = new Date('2026-09-23T10:00:00.000Z')
const APPROVED_CLAIM = { ...CLAIM, status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 1250, arbitratedAt: DECIDED_AT }

const jsonReq = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

/** The sender doubles answer like the real ones: claims closed → a claims_disabled skip. */
const byLease = async (p: { claimsOpen: boolean }) => (p.claimsOpen ? { status: 'sent' } : { status: 'skipped', why: 'claims_disabled' })

/**
 * D′ L1 — « the lease closes MID-REQUEST »: the engine mock closes the lease while it runs, so the entry gate
 * (claimsSurfaceOpen) read it OPEN and the send-time gate (claimNoticeGate('pre_money')) reads it CLOSED.
 */
const closingDuring = <T>(m: { mockImplementation: (f: () => Promise<T>) => unknown }, result: T) =>
  m.mockImplementation(async () => { closeClaimsWindow(); return result })

const PRODUCT_FLAGS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'] as const

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [ackMock, decisionMock, closureMock, mail.sendTransactional, mail.logEmailSkipped, execMock, claims.createClaim, claims.respondToClaim, claims.arbitrateClaim]) m.mockReset()
  // D′ L1: the gate is the REAL lib/claim-flags on the REAL env — opened as Mode A/B opened it (legacy lease, S-12).
  for (const k of PRODUCT_FLAGS) delete process.env[k]
  openClaimsWindow()
  claims.autoResolveSmallClaim.mockResolvedValue({ state: 'not_eligible' })
  tokenMock.mockResolvedValue({ sub: 'c1' })
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['r1'] })
  sessionMock.mockResolvedValue({ user: { id: 'adm1', email: 'admin@grubano.com', role: 'admin' } })
  adminMock.mockResolvedValue({ id: 'adm1', email: 'admin@grubano.com', role: 'admin', name: 'Admin' })
  auditMock.mockResolvedValue(undefined)
  schemaMock.fn.mockReset(); schemaMock.fn.mockResolvedValue(SCHEMA_READY)
  db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  ackMock.mockImplementation(byLease)
  decisionMock.mockImplementation(byLease)
})
afterEach(() => { closeClaimsWindow(); for (const k of PRODUCT_FLAGS) delete process.env[k] })

describe('POST /api/claims — accusé de réception à l’ouverture', () => {
  it('⭐ 201 → sendClaimAckEmail appelé UNE fois avec la claim créée et le bail lu à l’envoi', async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
    expect(ackMock).toHaveBeenCalledTimes(1)
    expect(ackMock).toHaveBeenCalledWith({
      claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250, claimsOpen: true,
    })
  })

  it('échec de création (409 doublon) → AUCUN email', async () => {
    claims.createClaim.mockResolvedValue({ ok: false, status: 409, error: 'Une réclamation est déjà en cours.' })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'o1', reason: 'quality' }))
    expect(res.status).toBe(409)
    expect(ackMock).not.toHaveBeenCalled()
  })

  it('le 201 SURVIT à un sender en échec interne (best-effort — le sender ne throw jamais, contrat épinglé côté lib)', async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    ackMock.mockResolvedValue({ status: 'failed', why: 'sender_error' })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
  })

  it("⭐ D′ L2 — chemin MACHINE auto_small SUPPRIMÉ : même si l'auto-résolution (mockée) rendait le VIEUX shape 'refunded', la route n'envoie AUCUN email de décision — ack SEUL, la fonction consultée une fois, son résultat ignoré", async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    // NEGATIVE-SHAPE CONTROL: the shape that USED to make this route send { decision:'refunded', refundedCents:1000 }.
    // Under D′ the real function can never return it (inert by construction); the route must not react to it either.
    claims.autoResolveSmallClaim.mockResolvedValue({ state: 'refunded', refundId: 'rf1', amountCents: 1000 })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
    expect(ackMock).toHaveBeenCalledTimes(1)
    expect(decisionMock).not.toHaveBeenCalled()
    expect(claims.autoResolveSmallClaim).toHaveBeenCalledTimes(1) // consultée une fois (pin « la route la consulte »), jamais re-déclenchée
    expect(claims.autoResolveSmallClaim).toHaveBeenCalledWith(expect.objectContaining({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 1250, status: 'restaurant_review' }))
    expect(await res.json()).toMatchObject({ claim: CLAIM, photoAccepted: false })
  })

  it("D′ L2 — quel que soit le shape rendu par l'auto-résolution ('pending', 'failed', 'not_eligible') → ack SEUL, jamais d'email de décision, 201", async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    for (const shape of [
      { state: 'pending', reason: 'refunds_disabled' },
      { state: 'pending', reason: 'stripe_pending', refundId: 'rf1' },
      { state: 'failed', error: 'resume_mismatch' },
      { state: 'not_eligible' },
    ]) {
      ackMock.mockClear(); decisionMock.mockClear()
      claims.autoResolveSmallClaim.mockResolvedValue(shape)
      const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
      expect(res.status, JSON.stringify(shape)).toBe(201)
      expect(ackMock, JSON.stringify(shape)).toHaveBeenCalledTimes(1)
      expect(decisionMock, JSON.stringify(shape)).not.toHaveBeenCalled()
    }
  })

  it('STATIC PIN — app/api/claims/route.ts imports no decision sender and names no decision kind', () => {
    const src = readFileSync('app/api/claims/route.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(src).not.toMatch(/sendClaimDecisionEmail/)
    expect(src).not.toMatch(/'refunded'|'approved'|refundedCents/)
    expect(src).toMatch(/sendClaimAckEmail/)
  })
})

describe('POST /api/claims/[id]/respond — décision du RESTAURANT', () => {
  it("⭐ accept → email 'accepted' avec le NOM du restaurant (dit PAR QUI)", async () => {
    claims.respondToClaim.mockResolvedValue({ ok: true, claim: { ...CLAIM, status: 'arbitration' } })
    const res = await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action: 'accept' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(decisionMock).toHaveBeenCalledTimes(1)
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc',
      decision: 'accepted', restaurantName: 'Gnocchi Bar', claimsOpen: true,
    }))
  })

  it("refuse → email 'refused' avec le motif du restaurateur", async () => {
    claims.respondToClaim.mockResolvedValue({ ok: true, claim: { ...CLAIM, status: 'refused' } })
    await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action: 'refuse', reason: 'Plat conforme' }), { params: { id: 'cl1' } })
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'refused', reason: 'Plat conforme',
    }))
  })

  it('échec (404 anti-IDOR / 409 déjà traitée) → AUCUN email', async () => {
    claims.respondToClaim.mockResolvedValue({ ok: false, status: 404, error: 'Réclamation introuvable.' })
    const res = await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action: 'accept' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(404)
    expect(decisionMock).not.toHaveBeenCalled()
  })

  it('la résolution du nom de resto est BEST-EFFORT : une panne DB n’empêche ni le 200 ni l’email (repli traduit)', async () => {
    claims.respondToClaim.mockResolvedValue({ ok: true, claim: { ...CLAIM, status: 'refused' } })
    db.restaurant.findUnique.mockRejectedValue(new Error('db down'))
    const res = await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action: 'refuse' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({ restaurantName: null }))
  })
})

describe('POST /api/admin/claims/[id]/arbitrate — décision de GRUBANO (D′ L2 : approuver ≠ rembourser)', () => {
  it("⭐ D′ L2/L4 — approve → email 'approved' avec le montant APPROUVÉ (jamais un montant remboursé), audit { decision:'approve', moneyMoved:false, approvedAmountCents } appelé AVANT, pas de champ refund ; CONTRÔLE NÉGATIF : même le vieux shape { refund: refunded 1000 } (qui produisait 'refunded') est ignoré", async () => {
    claims.arbitrateClaim.mockResolvedValue({
      ok: true, claim: APPROVED_CLAIM, refund: { state: 'refunded', refundId: 'rf1', amountCents: 1000 }, // legacy dab754d shape — the route must not read it
    })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledTimes(1)
    // D′ L4: the audit names WHAT was decided — the amount RE-READ from the row, and the motive of a reduction.
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'claim.arbitrate', targetId: 'cl1',
      metadata: { decision: 'approve', moneyMoved: false, approvedAmountCents: 1250, reduceReason: null },
    }))
    expect(auditMock.mock.invocationCallOrder[0]).toBeLessThan(decisionMock.mock.invocationCallOrder[0]) // l'audit AVANT l'email
    expect(decisionMock).toHaveBeenCalledTimes(1)
    // D-11: approvedCents comes from the DECIDED row, refundedCents stays null (nothing was paid), and the
    // notice is stamped with THIS decision's instant so a later re-decision is not deduped against it.
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', decision: 'approved',
      refundedCents: null, approvedCents: 1250, decisionStamp: DECIDED_AT, claimsOpen: true,
    }))
    expect(decisionMock.mock.calls[0][0].decision).not.toBe('refunded')
    // NEGATIVE CONTROL — 1000 is the legacy refund shape's amount: it must appear NOWHERE in the notice.
    expect(JSON.stringify(decisionMock.mock.calls[0][0])).not.toContain('1000')
    const body = await res.json() as Record<string, unknown>
    expect(body).toEqual({ claim: { ...APPROVED_CLAIM, arbitratedAt: DECIDED_AT.toISOString() }, customerEmail: { status: 'sent' } })
    expect(body).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()
  })

  it("approve sur le shape RÉEL de D′ (ok + claim, sans refund) → email 'approved', le montant APPROUVÉ nommé, aucun montant remboursé promis", async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: APPROVED_CLAIM })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approved', refundedCents: null, approvedCents: 1250,
    }))
    expect(await res.json()).not.toHaveProperty('refund')
  })

  it("D′ L4 — un approve RÉDUIT : le montant transmis au moteur et celui nommé dans l'avis sont le montant APPROUVÉ, jamais le montant DEMANDÉ ; le motif de réduction est audité", async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: { ...APPROVED_CLAIM, approvedAmountCents: 800 } })
    await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', {
      ...APPROVE_BODY, approvedAmountCents: 800, reduceReason: 'deux articles reçus sur trois',
    }), { params: { id: 'cl1' } })
    expect(claims.arbitrateClaim).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approve', approvedAmountCents: 800, confirm: APPROVE_CONFIRM_WORD, reduceReason: 'deux articles reçus sur trois',
    }))
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({ approvedCents: 800 }))
    // 1250 is the REQUESTED amount: it is never what the customer is told was approved.
    expect(decisionMock.mock.calls[0][0].approvedCents).not.toBe(CLAIM.requestedAmountCents)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { decision: 'approve', moneyMoved: false, approvedAmountCents: 800, reduceReason: 'deux articles reçus sur trois' },
    }))
  })

  it('D′ L4 (S-27) — schéma D′ pas prêt → 503 schema_not_ready sur un approve : AUCUN arbitrage, AUCUN audit, AUCUN email ; CONTRÔLE NÉGATIF : un refus est gaté PAREIL (arbitrateClaim LIT la colonne), et passe dès que la sonde est prête', async () => {
    schemaMock.fn.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: APPROVED_CLAIM })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ reason: 'schema_not_ready', schemaReady: false })
    expect(claims.arbitrateClaim).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
    expect(decisionMock).not.toHaveBeenCalled()
    // A REFUSAL IS NOT EXEMPT (corrected by the D′ L4 adversarial review). It writes none of the new
    // columns, but arbitrateClaim READS them: its single findUnique selects approvedAmountCents before
    // either branch, and a client that does not know the column rejects that query. Gating only the
    // approval would have left a refusal to crash with a 500 instead of answering « not right now ».
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: { ...CLAIM, status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: null } })
    const refusedWhileNotReady = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'refuse_final', reason: 'hors périmètre' }), { params: { id: 'cl1' } })
    expect(refusedWhileNotReady.status).toBe(503)
    expect(await refusedWhileNotReady.json()).toMatchObject({ reason: 'schema_not_ready' })
    expect(claims.arbitrateClaim).not.toHaveBeenCalled()
    expect(decisionMock).not.toHaveBeenCalled()
    // NEGATIVE CONTROL (a) — the SAME refusal on a ready probe goes through and notifies.
    schemaMock.fn.mockResolvedValue(SCHEMA_READY)
    expect((await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'refuse_final', reason: 'hors périmètre' }), { params: { id: 'cl1' } })).status).toBe(200)
    expect(decisionMock).toHaveBeenCalledTimes(1)
    decisionMock.mockClear(); claims.arbitrateClaim.mockClear()
    schemaMock.fn.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    // NEGATIVE CONTROL (b) — the SAME approve on a ready probe goes through: the 503 is the probe, not the fixture.
    schemaMock.fn.mockResolvedValue(SCHEMA_READY)
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: APPROVED_CLAIM })
    expect((await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })).status).toBe(200)
  })

  it("refuse_final sans refus du restaurant au dossier → email 'refused_by_grubano' (ROUND 13, H03: « Refus confirmé » exige le refus du restaurant) avec le motif admin", async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: CLAIM, refund: undefined })
    await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'refuse_final', reason: 'Preuves insuffisantes' }), { params: { id: 'cl1' } })
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'refused_by_grubano', reason: 'Preuves insuffisantes',
    }))
  })

  it('échec d’arbitrage (409) → AUCUN email, AUCUN audit', async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: false, status: 409, error: 'Déjà traitée.' })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(409)
    expect(decisionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

// ══ ROUND 13 — J-C22 (re-pinned under D′ L2) ══════════════════════════════════════════════════════
describe('J-C22 (D′ L2) — arbitrate decision e-mail: refusal kind by provenance; every approve is \'approved\' with no amount, never \'refunded\'', () => {
  const arbitrate = async (decision: string, result: Record<string, unknown>, reason?: string) => {
    claims.arbitrateClaim.mockResolvedValue({ ok: true, ...result })
    // D′ L4 (T-07): an approve carries its validated amount and the typed confirmation word.
    const body = { decision, ...(reason ? { reason } : {}), ...(decision === 'approve' ? APPROVE_BODY : {}) }
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', body), { params: { id: 'cl1' } })
    return { status: res.status, body: await res.json() as Record<string, unknown>, arg: decisionMock.mock.calls.at(-1)?.[0] as Record<string, unknown> }
  }
  const refusedClaim = (restaurantResponse: string | null) => ({ ...CLAIM, status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse })

  it('(a) refuse_final with restaurantResponse refused → refused_final; (b) with null → refused_by_grubano, trigger claim_decision_refused_final', async () => {
    const a = await arbitrate('refuse_final', { claim: refusedClaim('refused') }, 'x')
    expect(a.arg).toMatchObject({ decision: 'refused_final', refundedCents: null, reason: 'x', claimsOpen: true })
    const b = await arbitrate('refuse_final', { claim: refusedClaim(null) })
    expect(b.arg).toMatchObject({ decision: 'refused_by_grubano', refundedCents: null, reason: null })
    const actual = await vi.importActual<typeof import('@/lib/claim-emails')>('@/lib/claim-emails')
    expect(actual.DECISION_TRIGGER.refused_by_grubano).toBe('claim_decision_refused_final')
  })

  it('(c) INVERTED (D′ L2) — approve on the real shape (no refund field) → approved with refundedCents null, no refund in the body; NEGATIVE CONTROL: the legacy {refund: refunded 1250} shape that USED to yield refunded/1250 yields the same approved/null', async () => {
    const real = await arbitrate('approve', { claim: { ...CLAIM, status: 'approved', arbitrationDecision: 'approved' } })
    expect(real.arg).toMatchObject({ decision: 'approved', refundedCents: null })
    expect(real.body).not.toHaveProperty('refund')
    const legacy = await arbitrate('approve', { claim: CLAIM, refund: { state: 'refunded', refundId: 'rf1', amountCents: 1250 } })
    expect(legacy.arg).toMatchObject({ decision: 'approved', refundedCents: null })
    expect(legacy.arg.decision).not.toBe('refunded')
    expect(legacy.body).not.toHaveProperty('refund')
  })

  it('(d)(e) every other legacy approval shape — failed with each error, pending — → approved with refundedCents null; never refunded', async () => {
    const shapes = [
      ...['attempt_superseded', 'identity_unverified', 'resume_mismatch', 'safety_hold', 'proof_locked', 'refunds_disabled'].map((error) => ({ state: 'failed', error })),
      { state: 'pending', reason: 'refunds_disabled' },
      { state: 'pending', reason: 'stripe_pending', refundId: 'rf1' },
    ]
    for (const refund of shapes) {
      const r = await arbitrate('approve', { claim: CLAIM, refund })
      expect(r.arg, JSON.stringify(refund)).toMatchObject({ decision: 'approved', refundedCents: null })
      expect(r.arg.decision, JSON.stringify(refund)).not.toBe('refunded')
      expect(r.body, JSON.stringify(refund)).not.toHaveProperty('refund')
    }
  })

  it('(f) the lease open at the gate, closed at send (D′ L1: closed inside the CAS) → claimsOpen false passed; the response carries customerEmail.why claims_disabled', async () => {
    closingDuring(claims.arbitrateClaim, { ok: true, claim: CLAIM, refund: { state: 'pending', reason: 'refunds_disabled' } })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(200) // the entry gate was open: the decision was played
    expect(claims.arbitrateClaim).toHaveBeenCalledTimes(1)
    expect(decisionMock.mock.calls.at(-1)?.[0]).toMatchObject({ decision: 'approved', claimsOpen: false })
    expect((await res.json() as Record<string, unknown>).customerEmail).toEqual({ status: 'skipped', why: 'claims_disabled' })
  })

  it('(f′) D′ L1 — the same closure under the PRODUCT surface (CLAIMS_SURFACE_ENABLED flipped to false mid-request) skips the decision e-mail too; NEGATIVE CONTROL: the INTAKE flag flipping does NOT (a decision never needs the intake)', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'true'
    claims.arbitrateClaim.mockImplementation(async () => { process.env.CLAIMS_SURFACE_ENABLED = 'false'; return { ok: true, claim: CLAIM } })
    let res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(decisionMock.mock.calls.at(-1)?.[0]).toMatchObject({ claimsOpen: false })
    expect((await res.json() as Record<string, unknown>).customerEmail).toEqual({ status: 'skipped', why: 'claims_disabled' })
    // NEGATIVE CONTROL — surface stays true, only the intake closes: sent.
    process.env.CLAIMS_SURFACE_ENABLED = 'true'
    claims.arbitrateClaim.mockImplementation(async () => { process.env.CLAIMS_INTAKE_ENABLED = 'false'; return { ok: true, claim: CLAIM } })
    res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })
    expect(decisionMock.mock.calls.at(-1)?.[0]).toMatchObject({ claimsOpen: true })
    expect((await res.json() as Record<string, unknown>).customerEmail).toEqual({ status: 'sent' })
  })

  it('the response is exactly { claim, customerEmail } (no refund field); a sender that throws keeps the 200 with sender_error; the route never calls the engine (source pinned: no engine import, no \'refunded\', refundedCents: null, moneyMoved: false)', async () => {
    const approved = { ...CLAIM, status: 'approved', arbitrationDecision: 'approved' }
    const ok = await arbitrate('approve', { claim: approved })
    expect(ok.body).toEqual({ claim: approved, customerEmail: { status: 'sent' } })
    decisionMock.mockRejectedValueOnce(new Error('boom'))
    const thrown = await arbitrate('refuse_final', { claim: refusedClaim(null) })
    expect(thrown).toMatchObject({ status: 200, body: { customerEmail: { status: 'failed', why: 'sender_error' } } })
    expect(execMock).not.toHaveBeenCalled()
    const src = readFileSync('app/api/admin/claims/[id]/arbitrate/route.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(src).not.toMatch(/executeRefund|triggerClaimRefund|@\/lib\/refund['"]/)
    expect(src).not.toMatch(/'refunded'/)
    expect(src).toMatch(/refundedCents:\s*null/)
    expect(src).toMatch(/moneyMoved:\s*false/)
    expect(src).not.toMatch(/refund:\s*result/)
  })
})

// ══ ROUND 13 — J-C47 ══════════════════════════════════════════════════════════════════════════════
describe('J-C47 — a non-terminal e-mail skipped as claims_disabled when the lease closes mid-request', () => {
  beforeEach(async () => {
    // The REAL senders on a mocked mail rail; logEmailSkipped writes its real row on the mocked Prisma.
    const actual = await vi.importActual<typeof import('@/lib/claim-emails')>('@/lib/claim-emails')
    const rail = await vi.importActual<typeof import('@/lib/transactional-emails')>('@/lib/transactional-emails')
    ackMock.mockImplementation(actual.sendClaimAckEmail)
    decisionMock.mockImplementation(actual.sendClaimDecisionEmail)
    mail.logEmailSkipped.mockImplementation(rail.logEmailSkipped)
    mail.sendTransactional.mockResolvedValue({ status: 'sent' })
    db.emailLog.create.mockReset().mockResolvedValue({ id: 'l1' })
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa', locale: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  const rows = () => db.emailLog.create.mock.calls.map((c) => c[0].data)

  it('POST /api/claims: the create ran, the sender got claimsOpen false, one skipped row, no send, 201', async () => {
    closingDuring(claims.createClaim, { ok: true, claim: CLAIM }) // D′ L1: the lease closes inside the create
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
    // J-C44 / I-08 (W6 fixer): a consumer route never returns the operator e-mail result.
    expect(await res.json()).not.toHaveProperty('customerEmail')
    expect(claims.createClaim).toHaveBeenCalledTimes(1)
    expect(ackMock).toHaveBeenCalledWith(expect.objectContaining({ claimsOpen: false }))
    expect(rows()).toEqual([{ recipient: '(non envoyé : claims_disabled)', subject: 'claim cl1', trigger: 'claim_ack', status: 'skipped' }])
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })

  it('POST respond accept / refuse: the CAS ran, one skipped row each, no send, 200', async () => {
    for (const [action, trigger] of [['accept', 'claim_decision_accepted'], ['refuse', 'claim_decision_refused']]) {
      openClaimsWindow() // open at the entry gate of EACH call …
      closingDuring(claims.respondToClaim, { ok: true, claim: { ...CLAIM, status: action === 'accept' ? 'arbitration' : 'refused' } }) // … closed inside the CAS
      db.emailLog.create.mockClear()
      const res = await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action }), { params: { id: 'cl1' } })
      expect(res.status, action).toBe(200)
      // J-C44 / I-08 (W6 fixer): a restaurant route never returns the operator e-mail result.
      expect(await res.json(), action).not.toHaveProperty('customerEmail')
      expect(decisionMock, action).toHaveBeenLastCalledWith(expect.objectContaining({ claimsOpen: false }))
      expect(rows(), action).toEqual([{ recipient: '(non envoyé : claims_disabled)', subject: 'claim cl1', trigger, status: 'skipped' }])
    }
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL (J-C44) — the operator arbitrate route, same mid-request lease closure, DOES return customerEmail (claims_disabled)', async () => {
    closingDuring(claims.arbitrateClaim, { ok: true, claim: { ...CLAIM, status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: null } })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'refuse_final' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty('customerEmail')
    expect(body.customerEmail).toMatchObject({ status: 'skipped', why: 'claims_disabled' })
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })

  it('no resend route accepts a non-terminal claim: closure-notice → 409', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', refundError: null, arbitrationDecision: null, restaurantResponse: 'accepted' })
    const res = await CLOSURE_NOTICE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(409)
    expect(closureMock).not.toHaveBeenCalled()
  })

  it('D′ L1 INVERTED (FIN-EMAIL-01, S-25) — every gate CLOSED (no lease, product flags false): the closure-notice resend still passes claimsOpen TRUE; NEGATIVE CONTROL: the pre-money ack and decision senders, same state, are skipped claims_disabled', async () => {
    // Everything closed — the kill-switch state, explicitly.
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'false'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    closureMock.mockResolvedValue({ status: 'sent', kind: 'refused_by_grubano' })
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'refused_final', refundError: null, arbitrationDecision: 'refused_final', restaurantResponse: null })
    const res = await CLOSURE_NOTICE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(closureMock).toHaveBeenCalledTimes(1)
    expect(closureMock).toHaveBeenCalledWith({ claimId: 'cl1', evidence: undefined, claimsOpen: true }) // ← was false (skipped claims_disabled) before D′ L1
    // D′ L8: `restaurantEmail` is null — this is a REFUSAL, so no money moved and no financial notice was
    // due. The restaurant notice's own kill-switch independence is pinned in the L8 suite (§19).
    expect(await res.json()).toEqual({ customerEmail: { status: 'sent', kind: 'refused_by_grubano' }, restaurantEmail: null })
    // NEGATIVE CONTROL — the pre-money senders in the SAME state: the routes are gated at entry (403), and a lease that
    // closes mid-request still hands them claimsOpen false (the J-C47 pins above). Here, the entry gate itself:
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    expect((await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))).status).toBe(403)
    expect(ackMock).not.toHaveBeenCalled()
    claims.respondToClaim.mockResolvedValue({ ok: true, claim: { ...CLAIM, status: 'refused' } })
    expect((await RESPOND(jsonReq('http://x/api/claims/cl1/respond', { action: 'refuse' }), { params: { id: 'cl1' } })).status).toBe(403)
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    expect((await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', APPROVE_BODY), { params: { id: 'cl1' } })).status).toBe(403)
    expect(decisionMock).not.toHaveBeenCalled()
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the lease open at the gate and at the send → one send', async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
    expect(mail.sendTransactional).toHaveBeenCalledTimes(1)
    expect(mail.sendTransactional).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'claim_ack', dedupeKey: 'claim:cl1' }))
    expect(rows()).toEqual([])
  })
})
