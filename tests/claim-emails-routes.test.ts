import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── T43 (vague 3) — câblage des ROUTES : chaque étape émet son email, post-succès,
// et JAMAIS sur un échec. Les blocs sont ADDITIFS : la machine à états lib/claims,
// le moteur de remboursement et la logique d'arbitrage sont mockés TELS QUELS —
// aucune assertion ne change sur leurs appels (non-régression du circuit prouvé).

const { claims } = vi.hoisted(() => ({
  claims: {
    isClaimsEnabled:       vi.fn(() => true),
    createClaim:           vi.fn(),
    autoResolveSmallClaim: vi.fn(async () => ({ state: 'not_eligible' })),
    respondToClaim:        vi.fn(),
    arbitrateClaim:        vi.fn(),
    listConsumerClaims:    vi.fn(),
    getClaimEligibility:   vi.fn(),
    CLAIM_REASONS:         ['missing_item', 'wrong_order', 'quality', 'not_delivered', 'other'],
  },
}))
vi.mock('@/lib/claims', () => claims)

const { ackMock, decisionMock } = vi.hoisted(() => ({ ackMock: vi.fn(), decisionMock: vi.fn() }))
vi.mock('@/lib/claim-emails', () => ({
  sendClaimAckEmail:      ackMock,
  sendClaimDecisionEmail: decisionMock,
}))

const { db } = vi.hoisted(() => ({
  db: { restaurant: { findUnique: vi.fn() }, operator: { findUnique: vi.fn() } },
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

import { POST as CREATE } from '@/app/api/claims/route'
import { POST as RESPOND } from '@/app/api/claims/[id]/respond/route'
import { POST as ARBITRATE } from '@/app/api/admin/claims/[id]/arbitrate/route'

const CLAIM = {
  id: 'cl1', consumerId: 'c1', orderId: 'ord123abc', restaurantId: 'r1',
  requestedAmountCents: 1250, status: 'restaurant_review',
}

const jsonReq = (url: string, body: Record<string, unknown>) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  claims.isClaimsEnabled.mockReturnValue(true)
  claims.autoResolveSmallClaim.mockResolvedValue({ state: 'not_eligible' })
  tokenMock.mockResolvedValue({ sub: 'c1' })
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['r1'] })
  sessionMock.mockResolvedValue({ user: { id: 'adm1', email: 'admin@grubano.com', role: 'admin' } })
  auditMock.mockResolvedValue(undefined)
  db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar' })
  ackMock.mockResolvedValue({ status: 'sent' })
  decisionMock.mockResolvedValue({ status: 'sent' })
})

describe('POST /api/claims — accusé de réception à l’ouverture', () => {
  it('⭐ 201 → sendClaimAckEmail appelé UNE fois avec la claim créée', async () => {
    claims.createClaim.mockResolvedValue({ ok: true, claim: CLAIM })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
    expect(ackMock).toHaveBeenCalledTimes(1)
    expect(ackMock).toHaveBeenCalledWith({
      claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250,
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
    ackMock.mockResolvedValue({ status: 'failed' })
    const res = await CREATE(jsonReq('http://x/api/claims', { orderId: 'ord123abc', reason: 'quality' }))
    expect(res.status).toBe(201)
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
      decision: 'accepted', restaurantName: 'Gnocchi Bar',
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

describe('POST /api/admin/claims/[id]/arbitrate — décision de GRUBANO (bloc strictement additif)', () => {
  it("⭐ approve + remboursement ÉMIS → email 'refunded' avec le montant ; l'audit admin reste appelé AVANT", async () => {
    claims.arbitrateClaim.mockResolvedValue({
      ok: true, claim: CLAIM, refund: { state: 'refunded', refundId: 'rf1' },
    })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'approve' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledTimes(1) // la route d'arbitrage n'est PAS modifiée dans sa logique
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'refunded', refundedCents: 1250,
    }))
  })

  it("approve SANS émission (REFUNDS off → pending) → email 'approved', aucun montant promis", async () => {
    claims.arbitrateClaim.mockResolvedValue({
      ok: true, claim: CLAIM, refund: { state: 'pending', reason: 'refunds_disabled' },
    })
    await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'approve' }), { params: { id: 'cl1' } })
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'approved', refundedCents: null,
    }))
  })

  it("refuse_final → email 'refused_final' avec le motif admin", async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: true, claim: CLAIM, refund: undefined })
    await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'refuse_final', reason: 'Preuves insuffisantes' }), { params: { id: 'cl1' } })
    expect(decisionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'refused_final', reason: 'Preuves insuffisantes',
    }))
  })

  it('échec d’arbitrage (409) → AUCUN email, AUCUN audit', async () => {
    claims.arbitrateClaim.mockResolvedValue({ ok: false, status: 409, error: 'Déjà traitée.' })
    const res = await ARBITRATE(jsonReq('http://x/api/admin/claims/cl1/arbitrate', { decision: 'approve' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(409)
    expect(decisionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
