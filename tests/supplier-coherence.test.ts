import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/supplier-coherence — the anti-abuse coherence check MOVED to publication ──────
// vetSupplier no longer runs at signup; it runs at the "ready to publish" transition
// (offer filled + ≥1 catalogue item), on the supplier's REAL data, BEFORE the supplier
// becomes visible to restaurants. 'legit' → visible; 'doubt'/'bad' → stays hidden +
// admin queue. The guard makes it run AT MOST ONCE per supplier (idempotent, quota-safe).

const { db, vet } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  vet: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-vetting', () => ({ vetSupplier: vet }))

import { maybeRunSupplierCoherenceCheck } from '@/lib/supplier-coherence'

// An eligible (ready-to-publish) supplier: SIREN-verified (active), still hidden (pending),
// never auto-vetted (verdict null), offer filled (categories) + ≥1 catalogue item.
const READY = {
  id: 'sp1', status: 'active', marketplaceCoherencePending: true, vettingVerdict: null,
  companyName: 'Primeurs Lyon', contactName: 'Marie', city: 'Lyon',
  categories: ['fresh'], deliveryZones: ['Lyon'], paymentTerms: 'Net 30',
  _count: { catalogItems: 1 },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.update.mockResolvedValue({})
  // Default: this request WINS the atomic claim (count 1) → proceeds to vet.
  db.supplierProfile.updateMany.mockResolvedValue({ count: 1 })
})

describe('maybeRunSupplierCoherenceCheck — anti-abuse MOVED to the publication transition', () => {
  it("'legit' → clears the flag (VISIBLE) + persists the verdict, vetting the REAL offer", async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'cohérent' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).toHaveBeenCalledTimes(1)
    expect(vet.mock.calls[0][0]).toMatchObject({ companyName: 'Primeurs Lyon', categories: ['fresh'], deliveryZones: ['Lyon'] })
    expect(db.supplierProfile.update.mock.calls[0][0].data).toMatchObject({
      vettingVerdict: 'legit', marketplaceCoherencePending: false,
    })
  })

  it('ATOMIC CLAIM: vetting is gated by a conditional updateMany on the unclaimed/unvetted scalar state', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'ok' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(db.supplierProfile.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'sp1', status: 'active', marketplaceCoherencePending: true, vettingVerdict: null, vettingAt: null,
    })
  })

  it('CONCURRENCY: a LOST claim (count 0 — a concurrent request already claimed) → no vet, no quota burn, no write', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY })
    db.supplierProfile.updateMany.mockResolvedValue({ count: 0 }) // lost the race to a concurrent request
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it("'doubt' → STAYS hidden (pending=true) + queued for admin", async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'activité peu claire' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(db.supplierProfile.update.mock.calls[0][0].data).toMatchObject({
      vettingVerdict: 'doubt', marketplaceCoherencePending: true,
    })
  })

  it("'bad' → STAYS hidden (pending=true) — an incoherent supplier NEVER becomes visible", async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'bad', reason: 'incohérent' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(db.supplierProfile.update.mock.calls[0][0].data).toMatchObject({ marketplaceCoherencePending: true })
  })

  it('IDEMPOTENT: already cleared (pending=false) → no vet, no update (no flapping)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY, marketplaceCoherencePending: false })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('IDEMPOTENT: already auto-vetted (verdict set) → no re-vet (doubt/bad stays for the admin, no quota burn)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY, vettingVerdict: 'doubt' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('not operational (status !== active) → no-op', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY, status: 'pending' })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('offer not filled (no categories) → waits (no vet, no update)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY, categories: [] })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('no catalogue item yet → waits (no vet, no update)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...READY, _count: { catalogItems: 0 } })
    await maybeRunSupplierCoherenceCheck('sp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('best-effort: a DB error never throws (the supplier stays safely hidden)', async () => {
    db.supplierProfile.findUnique.mockRejectedValue(new Error('db down'))
    await expect(maybeRunSupplierCoherenceCheck('sp1')).resolves.toBeUndefined()
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('profile not found → no-op', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(null)
    await maybeRunSupplierCoherenceCheck('missing')
    expect(vet).not.toHaveBeenCalled()
  })
})
