// tests/claim-attribution-identity.test.ts — T-49 round 13, B1 / B2 / B3 identity predicates
//
// The only things that ever prove a Refund row belongs to a claim are its stamp (reason claim:<id>) and a
// binding the engine did not disown. A Stripe refund belongs to whatever its SINGLE owner row belongs to.
// These predicates live in lib/claim-attribution-rules (IMPLEMENTATION NOTE (W1) on B3).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stampedClaimId, ownersOf, identityProof, claimStamp } from '@/lib/claim-attribution-rules'
import { claimRefundReason } from '@/lib/claims'

describe('B1 — stampedClaimId', () => {
  it('reads the claim a stamp names', () => {
    expect(stampedClaimId('claim:cl1')).toBe('cl1')
    expect(stampedClaimId(claimStamp('cl_42'))).toBe('cl_42')
  })

  it('an unstamped reason, a look-alike and a missing reason name no claim', () => {
    for (const r of [null, undefined, '', 'admin:partial', 'Claim:cl1', ' claim:cl1', 'ghost_order:o1']) {
      expect(stampedClaimId(r), String(r)).toBeNull()
    }
  })

  it('the stamp builder equals the one lib/claims writes (claimRefundReason)', () => {
    expect(claimStamp('cl1')).toBe(claimRefundReason('cl1'))
  })
})

describe('B3 — ownersOf(refund, rows): by recorded id or engine tag, whatever the row status', () => {
  const rows = [
    { id: 'rf1', stripeRefundId: 're_1', status: 'succeeded' },
    { id: 'rf2', stripeRefundId: null, status: 'pending' },
    { id: 'rf3', stripeRefundId: 're_3', status: 'failed' },
  ]

  it('a recorded Stripe id makes the row the owner', () => {
    expect(ownersOf({ id: 're_1' }, rows).map((r) => r.id)).toEqual(['rf1'])
  })

  it('the engine tag grubano_refund_row makes the row the owner, without a recorded id', () => {
    expect(ownersOf({ id: 're_2', metadata: { grubano_refund_row: 'rf2' } }, rows).map((r) => r.id)).toEqual(['rf2'])
  })

  it('a FAILED row is still an owner (N3 reads its status to find the contradiction)', () => {
    expect(ownersOf({ id: 're_3' }, rows).map((r) => r.id)).toEqual(['rf3'])
  })

  it('zero owners: a rowless Dashboard refund, or a tag naming no row of the order', () => {
    expect(ownersOf({ id: 're_D' }, rows)).toEqual([])
    expect(ownersOf({ id: 're_D', metadata: { grubano_refund_row: 'rf_elsewhere' } }, rows)).toEqual([])
    expect(ownersOf({ id: 're_D', metadata: null }, rows)).toEqual([])
  })

  it('two owners: the recorded id on one row and the tag on another — the refund belongs to no claim', () => {
    expect(ownersOf({ id: 're_1', metadata: { grubano_refund_row: 'rf2' } }, rows).map((r) => r.id)).toEqual(['rf1', 'rf2'])
  })

  it('NEGATIVE CONTROL — a null recorded id never matches, and a null tag never matches a row id', () => {
    const nullRows = [{ id: 'rfA', stripeRefundId: null }, { id: 'rfB', stripeRefundId: null }]
    expect(ownersOf({ id: 're_X', metadata: { grubano_refund_row: null } }, nullRows)).toEqual([])
  })

  it('lib/claim-action-rules imports the identity predicates from here, never from lib/claims (no import cycle)', () => {
    const src = readFileSync('lib/claim-action-rules.ts', 'utf8')
    expect(src).toContain("import { ownersOf, stampedClaimId } from '@/lib/claim-attribution-rules'")
    expect(src).not.toMatch(/from '@\/lib\/claims'/)
  })
})

describe('B2 — identityProof(row, claim)', () => {
  it('stamp: the row carries this claim’s reason — whatever the binding says (B8: identity established)', () => {
    expect(identityProof({ id: 'rf1', reason: 'claim:cl1' }, { id: 'cl1', refundId: null, refundError: null })).toBe('stamp')
    expect(identityProof({ id: 'rf1', reason: 'claim:cl1' }, { id: 'cl1', refundId: 'rf1', refundError: 'resume_mismatch: x' })).toBe('stamp')
  })

  it('bind: the claim is bound to an UNSTAMPED row and the engine did not disown the binding', () => {
    expect(identityProof({ id: 'rf1', reason: null }, { id: 'cl1', refundId: 'rf1', refundError: null })).toBe('bind')
    expect(identityProof({ id: 'rf1', reason: 'admin:partial' }, { id: 'cl1', refundId: 'rf1', refundError: 'stripe_failed: x' })).toBe('bind')
  })

  it('a foreign stamp proves nothing for this claim, even with a binding to that row', () => {
    expect(identityProof({ id: 'rf1', reason: 'claim:cl2' }, { id: 'cl1', refundId: 'rf1', refundError: null })).toBeNull()
  })

  it('a resume_mismatch binding proves nothing (the engine disowned it)', () => {
    expect(identityProof({ id: 'rf1', reason: null }, { id: 'cl1', refundId: 'rf1', refundError: 'resume_mismatch: le moteur a repris …' })).toBeNull()
  })

  it('NEGATIVE CONTROL — no stamp and no binding: amount, order or timing never stand in for identity', () => {
    expect(identityProof({ id: 'rf1', reason: null }, { id: 'cl1', refundId: 'rf9', refundError: null })).toBeNull()
    expect(identityProof({ id: 'rf1', reason: undefined }, { id: 'cl1' })).toBeNull()
  })
})
