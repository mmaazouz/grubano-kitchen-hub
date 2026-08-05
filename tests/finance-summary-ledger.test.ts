import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── V3-2 — GET /api/finance/summary lit la commission ESTAMPILLÉE au ledger ──
// L'écran /finance montrait un 10 % forfaitaire (caBrut × constante) alors que
// le prélèvement réel suit la grille par canal (12/8/5/0) + overrides via
// lib/commission, estampillée sur chaque LedgerEntry.applicationFeeAmount.
// Ces tests verrouillent : (1) la commission affichée = Σ des montants
// estampillés, jamais un pourcentage recalculé ; (2) le cas 0 % ; (3) le
// nettage des refunds (lignes négatives) ; (4) le scope de lecture du ledger.

const { db, sessionMock } = vi.hoisted(() => ({
  db: {
    restaurant:  { findMany: vi.fn() },
    order:       { findMany: vi.fn() },
    dishSale:    { aggregate: vi.fn() },
    ledgerEntry: { findMany: vi.fn() },
  },
  sessionMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET } from '@/app/api/finance/summary/route'

const asRestaurateur = () =>
  sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'restaurant' } })

// Une commande simple: 100 € de panier, pas de remise, pas de referral.
const order = (id: string, subtotal = 100) => ({
  id, subtotal, deliveryFee: 0, total: subtotal, referralOrder: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  asRestaurateur()
  db.restaurant.findMany.mockResolvedValue([{ id: 'r1' }])
  db.order.findMany.mockResolvedValue([order('o1')])
  db.dishSale.aggregate.mockResolvedValue({ _sum: { creatorEarning: null } })
  db.ledgerEntry.findMany.mockResolvedValue([])
})

describe('GET /api/finance/summary — commission lue au ledger (V3-2)', () => {
  it('affiche la commission ESTAMPILLÉE (12 % livraison), pas 10 % du CA', async () => {
    // 100 € de CA, ligne ledger estampillée 1200 cents (grille delivery 12 %).
    db.ledgerEntry.findMany.mockResolvedValue([{ applicationFeeAmount: 1200 }])
    const res = await GET()
    const j = await res.json()
    expect(j.caBrut).toBe(100)
    expect(j.commissionGrubano).toBe(12)   // le montant du ledger…
    expect(j.commissionGrubano).not.toBe(10) // …pas l'ancien forfait 10 %
    expect(j.netResto).toBe(88)
  })

  it('cas 0 % (offre fondateurs / réservation) : commission 0, net = brut', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 0 },
      { applicationFeeAmount: 0 },
    ])
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
    expect(j.netResto).toBe(100)
  })

  it('aucune ligne ledger (ex. flux cash) : aucune commission affichée', async () => {
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
  })

  it('nette les refunds (lignes négatives, sémantique A7)', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 1200 },   // payment
      { applicationFeeAmount: -1200 },  // refund total → fee rendue
    ])
    const j = await (await GET()).json()
    expect(j.commissionGrubano).toBe(0)
  })

  it('agrège plusieurs canaux estampillés (12 % + 8 % + 0 %) au centime', async () => {
    db.order.findMany.mockResolvedValue([order('o1'), order('o2'), order('o3')])
    db.ledgerEntry.findMany.mockResolvedValue([
      { applicationFeeAmount: 1200 }, // delivery 12 % de 100 €
      { applicationFeeAmount: 800 },  // pickup 8 % de 100 €
      { applicationFeeAmount: 0 },    // founders 0 %
    ])
    const j = await (await GET()).json()
    expect(j.caBrut).toBe(300)
    expect(j.commissionGrubano).toBe(20)
    expect(j.netResto).toBe(280)
  })

  it('lit le ledger scoppé aux restos de l’opérateur, fenêtre bornée, types payment/deposit_capture/refund', async () => {
    await GET()
    expect(db.ledgerEntry.findMany).toHaveBeenCalledTimes(1)
    const arg = db.ledgerEntry.findMany.mock.calls[0][0]
    expect(arg.where.restaurantId).toEqual({ in: ['r1'] })
    expect(arg.where.type).toEqual({ in: ['payment', 'deposit_capture', 'refund'] })
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date)
    expect(arg.where.createdAt.lte).toBeInstanceOf(Date)
    expect(arg.select).toEqual({ applicationFeeAmount: true })
  })

  it('ne recalcule JAMAIS : la source du fichier ne contient plus de taux constant', async () => {
    // Garde anti-régression : aucun 0.10/0.12 forfaitaire ne doit revenir dans
    // la route — la commission vient du ledger, point.
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/api/finance/summary/route.ts', 'utf8')
    expect(src).not.toMatch(/GRUBANO_FEE_PCT/)
    expect(src).not.toMatch(/caBrut\s*\*\s*0\./)
  })
})
