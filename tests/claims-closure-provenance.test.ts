// tests/claims-closure-provenance.test.ts — T-49 round 13, J-C07 (F02, H03, H05 constants)
//
// How a terminal claim was closed decides the customer's line and the e-mail kind. The kind is read
// from provenance only: a reversal marker is not a closure, a declaration is never a refusal, and
// « Refus confirmé » needs the restaurant's own refusal on record.
import { describe, it, expect } from 'vitest'
import {
  claimClosureKind, CLOSURE_TRIGGER, refusalEmailKind, CLOSURE_RECORD_TRIGGER, closureRecordKey, MARKERS,
  type ClaimFacts, type ClosureKind,
} from '@/lib/claim-action-rules'

const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf1…`
const DECLARED = 'declared_settled_after_revert: déclaration admin : payé autrement…'
const STATUSES = ['refunded', 'refused_final', 'approved']
const ERRORS: Array<string | null> = [null, 'engine_failed: x', REVERTED, DECLARED, 'no_refund_proven:v13: x']
const DECISIONS: Array<string | null> = ['refused_final', 'approved', null]
const RESPONSES: Array<string | null | undefined> = ['refused', 'accepted', null, undefined]

/** The J-C07 assertion list, stated case by case (not a copy of the function body). */
function expectedKind(c: ClaimFacts): ClosureKind | null {
  if (c.status === 'refunded') {
    if (c.refundError === REVERTED) return null
    if (c.refundError === null) return 'refunded'
    return 'settled_by_declaration'
  }
  if (c.status === 'refused_final') {
    if (c.arbitrationDecision !== 'refused_final') return 'closed_by_declaration'
    if (c.restaurantResponse === 'refused') return 'refused_confirmed'
    return 'refused_by_grubano'
  }
  return null
}

const GRID: ClaimFacts[] = STATUSES.flatMap((status) => ERRORS.flatMap((refundError) => DECISIONS.flatMap((arbitrationDecision) =>
  RESPONSES.map((restaurantResponse) => ({ status, refundError, arbitrationDecision, restaurantResponse })))))

describe('J-C07 — claimClosureKind over the provenance grid', () => {
  it('every combination classifies as stated, and the grid reaches every kind', () => {
    const seen = new Set<string>()
    for (const c of GRID) {
      const got = claimClosureKind(c)
      expect(got, JSON.stringify(c)).toBe(expectedKind(c))
      seen.add(String(got))
    }
    expect(Array.from(seen).sort()).toEqual(['closed_by_declaration', 'null', 'refunded', 'refused_by_grubano', 'refused_confirmed', 'settled_by_declaration'])
  })

  it('refunded + REVERTED → null; a declaration after the reversal → settled_by_declaration', () => {
    expect(claimClosureKind({ status: 'refunded', refundError: REVERTED })).toBeNull()
    expect(claimClosureKind({ status: 'refunded', refundError: DECLARED })).toBe('settled_by_declaration')
    expect(claimClosureKind({ status: 'refunded', refundError: 'engine_failed: x' })).toBe('settled_by_declaration')
    expect(claimClosureKind({ status: 'refunded', refundError: null })).toBe('refunded')
  })

  it('non-terminal statuses are never a closure', () => {
    for (const status of ['approved', 'refunding', 'financial_verification', 'arbitration', 'restaurant_review', 'refused']) {
      expect(claimClosureKind({ status, refundError: null, arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }), status).toBeNull()
    }
  })

  it('NEGATIVE CONTROL — the silent restaurant is not a confirmed refusal; DECLARED_AFTER_REVERT is not null', () => {
    expect(claimClosureKind({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: null })).not.toBe('refused_confirmed')
    expect(claimClosureKind({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: undefined })).not.toBe('refused_confirmed')
    expect(claimClosureKind({ status: 'refunded', refundError: DECLARED })).not.toBeNull()
    // the two mutants the break/restore controls name would each flip one of these rows
    const includesRevert = (c: ClaimFacts) => (typeof c.refundError === 'string' && c.refundError.includes('revert') ? null : 'x')
    expect(includesRevert({ status: 'refunded', refundError: DECLARED })).toBeNull() // ← mutant (1) misreads the declaration
    const notAccepted = (c: ClaimFacts) => c.restaurantResponse !== 'accepted'
    expect(notAccepted({ status: 'refused_final', restaurantResponse: null })).toBe(true) // ← mutant (2) confirms a silence
  })
})

describe('J-C07 — CLOSURE_TRIGGER, refusalEmailKind and the H05 constants', () => {
  it('CLOSURE_TRIGGER is exactly F02', () => {
    expect(CLOSURE_TRIGGER).toEqual({
      refunded: 'claim_decision_refunded',
      settled_by_declaration: 'claim_closed_by_support',
      closed_by_declaration: 'claim_closed_by_support',
      refused_confirmed: 'claim_decision_refused_final',
      refused_by_grubano: 'claim_decision_refused_final',
    })
  })

  it('refusalEmailKind: refused_final only for a confirmed refusal', () => {
    expect(refusalEmailKind(null)).toBe('refused_by_grubano')
    expect(refusalEmailKind(undefined)).toBe('refused_by_grubano')
    expect(refusalEmailKind({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' })).toBe('refused_final')
    expect(refusalEmailKind({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' })).toBe('refused_by_grubano')
    expect(refusalEmailKind({ status: 'refused_final', arbitrationDecision: 'approved', restaurantResponse: 'refused' })).toBe('refused_by_grubano')
  })

  it('H05 constants', () => {
    expect(CLOSURE_RECORD_TRIGGER).toBe('claim_closure_record')
    expect(closureRecordKey('x')).toBe('claim:x')
  })
})
