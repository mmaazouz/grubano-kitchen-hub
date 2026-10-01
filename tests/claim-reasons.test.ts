// tests/claim-reasons.test.ts — CLAIMS batch 2: the canonical taxonomy and, above all,
// the AUTHORITY SCOPE each reason carries. A reason whose semantics name specific items
// must name them; a reason whose semantics are order-level may legitimately reach the
// whole order. Safety changes triage and visibility ONLY — never financial authority.
import { describe, it, expect } from 'vitest'
import {
  CLAIM_REASONS, ACCEPTED_REASONS, LEGACY_REASON_ALIASES, canonicalReason, authorityScope,
  requiresItemSelection, isSafetyReason, reasonLabel,
} from '@/lib/claim-reasons'

describe('the ten canonical reasons exist and are distinct', () => {
  it('covers the founder taxonomy exactly', () => {
    expect([...CLAIM_REASONS].sort()).toEqual([
      'allergen_safety', 'excessive_wait', 'missing_item', 'not_received', 'other',
      'payment_issue', 'quality', 'restaurant_closed', 'wrong_item', 'wrong_quantity',
    ])
    expect(new Set(CLAIM_REASONS).size).toBe(CLAIM_REASONS.length)
  })

  it('every reason has a French operator label', () => {
    for (const r of CLAIM_REASONS) expect(reasonLabel(r)).toMatch(/\S/)
    expect(reasonLabel('allergen_safety')).toBe('Allergène / sécurité')
  })
})

describe('legacy values keep working and normalise to a canonical reason', () => {
  it('wrong_order → wrong_item, not_delivered → not_received', () => {
    expect(canonicalReason('wrong_order')).toBe('wrong_item')
    expect(canonicalReason('not_delivered')).toBe('not_received')
    expect(Object.keys(LEGACY_REASON_ALIASES)).toEqual(['wrong_order', 'not_delivered'])
  })

  it('the API accepts canonical AND legacy values, and nothing else', () => {
    for (const r of [...CLAIM_REASONS, 'wrong_order', 'not_delivered']) expect(ACCEPTED_REASONS).toContain(r)
    for (const bad of ['', 'refund_me', 'MISSING_ITEM', 'autre', '../../etc']) {
      expect(canonicalReason(bad)).toBeNull()
      expect(authorityScope(bad)).toBeNull()
    }
  })

  it('a legacy value inherits the scope of its canonical successor', () => {
    expect(authorityScope('wrong_order')).toBe('ITEM_REQUIRED')   // like wrong_item
    expect(authorityScope('not_delivered')).toBe('ORDER_LEVEL')   // like not_received
  })
})

describe('AUTHORITY SCOPE — the mapping is explicit, not inferred', () => {
  it('item-specific reasons REQUIRE a line selection', () => {
    for (const r of ['missing_item', 'wrong_item', 'wrong_quantity']) {
      expect(authorityScope(r)).toBe('ITEM_REQUIRED')
      expect(requiresItemSelection(r)).toBe(true)
    }
  })

  it('order-level reasons legitimately reach the whole order', () => {
    for (const r of ['restaurant_closed', 'excessive_wait', 'not_received', 'payment_issue']) {
      expect(authorityScope(r)).toBe('ORDER_LEVEL')
      expect(requiresItemSelection(r)).toBe(false)
    }
  })

  it('reasons that can be either stay optional (a quality problem may affect the whole order)', () => {
    for (const r of ['quality', 'allergen_safety', 'other']) {
      expect(authorityScope(r)).toBe('ITEM_OPTIONAL')
      expect(requiresItemSelection(r)).toBe(false)
    }
  })

  it('every canonical reason has exactly one scope — none is left undefined', () => {
    for (const r of CLAIM_REASONS) expect(['ITEM_REQUIRED', 'ITEM_OPTIONAL', 'ORDER_LEVEL']).toContain(authorityScope(r))
  })
})

describe('SAFETY — priority is visibility, never money', () => {
  it('only allergen_safety is a safety reason', () => {
    expect(isSafetyReason('allergen_safety')).toBe(true)
    for (const r of CLAIM_REASONS.filter((x) => x !== 'allergen_safety')) expect(isSafetyReason(r)).toBe(false)
  })

  it('a safety reason grants NO extra financial authority — its scope is the ordinary optional one', () => {
    expect(authorityScope('allergen_safety')).toBe(authorityScope('quality'))
    expect(requiresItemSelection('allergen_safety')).toBe(false)
  })
})
