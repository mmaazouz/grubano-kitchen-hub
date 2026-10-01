import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/prestataire-coherence — the anti-abuse coherence check MOVED to publication ──────
// Calque of lib/supplier-coherence. vetPrestataire no longer runs at signup; it runs at the
// "ready to publish" transition (offer filled + ≥1 service listing), on the prestataire's REAL
// data, BEFORE the prestataire becomes visible to restaurants. 'legit' → visible; 'doubt'/'bad'
// → stays hidden + admin queue. An atomic DB-level claim makes it run AT MOST ONCE (quota-safe).

const { db, vet } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
  vet: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-vetting', () => ({ vetPrestataire: vet }))

import { maybeRunPrestataireCoherenceCheck } from '@/lib/prestataire-coherence'

// An eligible (ready-to-publish) prestataire: SIREN-verified (active), still hidden (pending),
// never auto-vetted (verdict null), offer filled (serviceCategories) + ≥1 service listing.
const READY = {
  id: 'pp1', status: 'active', marketplaceCoherencePending: true, vettingVerdict: null,
  companyName: 'Elec Pro', contactName: 'Sami', city: 'Lyon',
  serviceCategories: ['electricity'], coverageZones: ['Lyon'], indicativeRate: 'dès 80€/h',
  _count: { serviceOfferings: 1 },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.prestataireProfile.update.mockResolvedValue({})
  // Default: this request WINS the atomic claim (count 1) → proceeds to vet.
  db.prestataireProfile.updateMany.mockResolvedValue({ count: 1 })
})

describe('maybeRunPrestataireCoherenceCheck — anti-abuse MOVED to the publication transition', () => {
  it("'legit' → clears the flag (VISIBLE) + persists the verdict, vetting the REAL offer", async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'cohérent' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).toHaveBeenCalledTimes(1)
    expect(vet.mock.calls[0][0]).toMatchObject({ companyName: 'Elec Pro', serviceCategories: ['electricity'], coverageZones: ['Lyon'] })
    // updateMany[0] = the atomic claim; updateMany[1] = the guarded final write.
    expect(db.prestataireProfile.updateMany.mock.calls[1][0].data).toMatchObject({
      vettingVerdict: 'legit', marketplaceCoherencePending: false,
    })
  })

  it("'doubt' → STAYS hidden (pending=true) + queued for admin", async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'activité peu claire' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(db.prestataireProfile.updateMany.mock.calls[1][0].data).toMatchObject({
      vettingVerdict: 'doubt', marketplaceCoherencePending: true,
    })
  })

  it("'bad' → STAYS hidden (pending=true) — an incoherent prestataire NEVER becomes visible", async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'bad', reason: 'incohérent' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(db.prestataireProfile.updateMany.mock.calls[1][0].data).toMatchObject({ marketplaceCoherencePending: true })
  })

  it('ATOMIC CLAIM: vetting is gated by a conditional updateMany on the unclaimed/unvetted state', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'ok' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(db.prestataireProfile.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'pp1', status: 'active', marketplaceCoherencePending: true, vettingVerdict: null, vettingAt: null,
    })
  })

  it('GUARDED FINAL WRITE: the verdict write is gated on pending:true + verdict:null, so a concurrent admin override is NEVER clobbered', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'x' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    // If an admin cleared the flag during the vet call, the row is pending=false → this where
    // matches 0 rows → the admin decision wins (no silent re-hide).
    expect(db.prestataireProfile.updateMany.mock.calls[1][0].where).toMatchObject({
      id: 'pp1', marketplaceCoherencePending: true, vettingVerdict: null,
    })
  })

  it('CONCURRENCY: a LOST claim (count 0 — a concurrent request already claimed) → no vet, no quota burn, no final write', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY })
    db.prestataireProfile.updateMany.mockResolvedValue({ count: 0 })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.prestataireProfile.updateMany).toHaveBeenCalledTimes(1) // only the claim, no final write
  })

  it('IDEMPOTENT: already cleared (pending=false) → no vet, no update', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY, marketplaceCoherencePending: false })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.prestataireProfile.updateMany).not.toHaveBeenCalled()
  })

  it('IDEMPOTENT: already auto-vetted (verdict set) → no re-vet (doubt/bad stays for the admin)', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY, vettingVerdict: 'doubt' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.prestataireProfile.updateMany).not.toHaveBeenCalled()
  })

  it('not operational (status !== active) → no-op', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY, status: 'pending' })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
  })

  it('offer not filled (no serviceCategories) → waits (no vet)', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY, serviceCategories: [] })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
    expect(db.prestataireProfile.updateMany).not.toHaveBeenCalled()
  })

  it('no service listing yet → waits (no vet)', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ ...READY, _count: { serviceOfferings: 0 } })
    await maybeRunPrestataireCoherenceCheck('pp1')
    expect(vet).not.toHaveBeenCalled()
  })

  it('best-effort: a DB error never throws (the prestataire stays safely hidden)', async () => {
    db.prestataireProfile.findUnique.mockRejectedValue(new Error('db down'))
    await expect(maybeRunPrestataireCoherenceCheck('pp1')).resolves.toBeUndefined()
    expect(db.prestataireProfile.updateMany).not.toHaveBeenCalled()
  })

  it('profile not found → no-op', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue(null)
    await maybeRunPrestataireCoherenceCheck('missing')
    expect(vet).not.toHaveBeenCalled()
  })
})
