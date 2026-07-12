import { describe, it, expect } from 'vitest'
import { decidePublication } from '@/lib/publication-rule'

// ── B2.4 / SEC2 — restaurant publication rule (Agent 33) ─────────────────────
// The security core: who may flip isActive and when. The SEC1 invariant (an owner
// can never publish a never-approved resto) lives here and is locked by tests.

const APPROVED = new Date('2026-01-01T00:00:00Z')

describe('decidePublication — SEC1 invariant (never-approved not owner-publishable)', () => {
  it('owner publish + approvedAt null → REJECTED, no isActive write', () => {
    const d = decidePublication({ isAdmin: false, requested: true, currentIsActive: false, approvedAt: null })
    expect(d.rejected).toBe(true)
    expect(d.setIsActive).toBe(false)
    expect(d.stampApprovedAt).toBe(false)
  })

  it('owner resume + approvedAt set → allowed (go live), no re-stamp', () => {
    const d = decidePublication({ isAdmin: false, requested: true, currentIsActive: false, approvedAt: APPROVED })
    expect(d).toEqual({ setIsActive: true, stampApprovedAt: false, rejected: false })
  })
})

describe('decidePublication — owner pause (true→false) + pause-capture', () => {
  it('live resto without approvedAt → offline + STAMP approvedAt (catch-up)', () => {
    const d = decidePublication({ isAdmin: false, requested: false, currentIsActive: true, approvedAt: null })
    expect(d).toEqual({ setIsActive: false, stampApprovedAt: true, rejected: false })
  })

  it('already-approved live resto → offline, no re-stamp', () => {
    const d = decidePublication({ isAdmin: false, requested: false, currentIsActive: true, approvedAt: APPROVED })
    expect(d).toEqual({ setIsActive: false, stampApprovedAt: false, rejected: false })
  })

  it('offline→offline never-approved → no stamp (never live ⇒ no false approval)', () => {
    const d = decidePublication({ isAdmin: false, requested: false, currentIsActive: false, approvedAt: null })
    expect(d).toEqual({ setIsActive: false, stampApprovedAt: false, rejected: false })
  })
})

describe('decidePublication — admin can always publish', () => {
  it('admin publish a never-approved resto → live + STAMP approvedAt (admin go-live = approval)', () => {
    const d = decidePublication({ isAdmin: true, requested: true, currentIsActive: false, approvedAt: null })
    expect(d).toEqual({ setIsActive: true, stampApprovedAt: true, rejected: false })
  })

  it('admin publish an already-approved resto → live, no re-stamp', () => {
    const d = decidePublication({ isAdmin: true, requested: true, currentIsActive: false, approvedAt: APPROVED })
    expect(d).toEqual({ setIsActive: true, stampApprovedAt: false, rejected: false })
  })

  it('admin offline a live unstamped resto → offline + stamp (pause-capture applies to admin too)', () => {
    const d = decidePublication({ isAdmin: true, requested: false, currentIsActive: true, approvedAt: null })
    expect(d).toEqual({ setIsActive: false, stampApprovedAt: true, rejected: false })
  })
})
