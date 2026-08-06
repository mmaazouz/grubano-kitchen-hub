import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── P0-08 (vague 4) — createSystemClaim + motif système + email honnête ────────
// La demande de remboursement SYSTÈME entre DIRECTEMENT en 'arbitration' (le
// circuit prouvé le 04/08 la prend ensuite : admin tranche → T43 notifie).
// Q3 absolu : cette lib ne DÉCLENCHE jamais rien — elle CRÉE une demande.

const { db } = vi.hoisted(() => ({
  db: {
    claim:    { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    order:    { findUnique: vi.fn() },
    operator: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn(() => false) }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

import { createSystemClaim, SYSTEM_CLAIM_REASON_ORDER_CANCELLED, CLAIM_REASONS } from '@/lib/claims'

const INPUT = {
  orderId: 'o1', consumerId: 'c1', restaurantId: 'r1',
  requestedAmountCents: 4250, description: 'Annulation par le restaurant.',
}

beforeEach(() => {
  vi.clearAllMocks()
  db.claim.create.mockResolvedValue({ id: 'clsys1' })
})

describe('createSystemClaim — la demande système entre DIRECTEMENT en arbitrage', () => {
  it('⭐ crée la demande : status arbitration, motif système, montant intégral, activeOrderKey posé — et NE déclenche RIEN', async () => {
    const r = await createSystemClaim(INPUT)
    expect(r).toEqual({ created: true, claimId: 'clsys1' })
    const data = db.claim.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      orderId: 'o1', consumerId: 'c1', restaurantId: 'r1',
      reason: SYSTEM_CLAIM_REASON_ORDER_CANCELLED,
      status: 'arbitration',
      requestedAmountCents: 4250,
      activeOrderKey: 'o1',
    })
    expect(data.responseDeadlineAt).toBeInstanceOf(Date) // NOT NULL du modèle
    expect(execMock).not.toHaveBeenCalled()               // Q3 : jamais un remboursement
  })

  it('⭐ REJEU / réclamation déjà active → P2002 = { created:false, already_active }, jamais un doublon ni un throw', async () => {
    db.claim.create.mockRejectedValue({ code: 'P2002' })
    const r = await createSystemClaim(INPUT)
    expect(r).toEqual({ created: false, reason: 'already_active' })
  })

  it('toute AUTRE panne remonte (l’appelant transactionnel doit échouer AVEC l’annulation — atomicité)', async () => {
    db.claim.create.mockRejectedValue(new Error('db down'))
    await expect(createSystemClaim(INPUT)).rejects.toThrow('db down')
  })

  it('⭐ accepte un client de transaction (tx) — la demande s’écrit via TX, pas via le client global', async () => {
    const tx = { claim: { create: vi.fn().mockResolvedValue({ id: 'clsys2' }) } }
    const r = await createSystemClaim({ ...INPUT, tx: tx as never })
    expect(r).toEqual({ created: true, claimId: 'clsys2' })
    expect(tx.claim.create).toHaveBeenCalledTimes(1)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('le motif système est DISTINCT des motifs clients (hors CLAIM_REASONS)', () => {
    expect((CLAIM_REASONS as readonly string[]).includes(SYSTEM_CLAIM_REASON_ORDER_CANCELLED)).toBe(false)
  })
})

describe('P0-08 — le motif système est INACCESSIBLE depuis le schéma public (POST /api/claims)', () => {
  it('⭐ un client qui envoie reason=system_order_cancelled reçoit 400 (z.enum(CLAIM_REASONS)), aucune création', async () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    const { tokenMock } = { tokenMock: vi.fn().mockResolvedValue({ sub: 'c1' }) }
    vi.doMock('next-auth/jwt', () => ({ getToken: tokenMock }))
    vi.doMock('@/lib/dish-photo', () => ({ processDishImage: vi.fn(), ALLOWED_IMAGE_TYPES: ['image/jpeg'] }))
    vi.doMock('@/lib/claim-emails', () => ({ sendClaimAckEmail: vi.fn(), sendClaimDecisionEmail: vi.fn(), sendOrderCancelledPaidEmail: vi.fn() }))
    const { POST } = await import('@/app/api/claims/route')
    const res = await POST(new NextRequest('http://x/api/claims', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'o1', reason: 'system_order_cancelled' }),
    }))
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

// NB : le contrat du sender sendOrderCancelledPaidEmail (trigger order_cancelled,
// dedupeKey order:<id>, contenu honnête) est épinglé dans tests/claim-emails.test.ts
// — le harnais statique des senders localisés (mock dynamique fragile ici).
