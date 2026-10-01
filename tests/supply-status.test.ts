import { describe, it, expect } from 'vitest'
import { canTransition, allowedTransitions, canRestoCancel } from '@/lib/marketplace'

// ── Supply order state machine (B2B Slice 3, Agent 14) ────────────────────────
// placed → confirmed → preparing → delivered (supplier); resto cancel (placed
// only); supplier decline (placed only). Only valid transitions are permitted.

describe('supplier transitions', () => {
  it('accepts the valid forward path', () => {
    expect(canTransition('supplier', 'placed', 'confirmed')).toBe(true)
    expect(canTransition('supplier', 'placed', 'declined')).toBe(true)
    expect(canTransition('supplier', 'confirmed', 'preparing')).toBe(true)
    expect(canTransition('supplier', 'preparing', 'delivered')).toBe(true)
  })
  it('refuses skips, backwards, terminal, and the resto-only cancel', () => {
    expect(canTransition('supplier', 'placed', 'delivered')).toBe(false)   // skip
    expect(canTransition('supplier', 'confirmed', 'placed')).toBe(false)    // backwards
    expect(canTransition('supplier', 'delivered', 'preparing')).toBe(false) // terminal
    expect(canTransition('supplier', 'cancelled', 'confirmed')).toBe(false) // terminal
    expect(canTransition('supplier', 'placed', 'cancelled')).toBe(false)    // cancel is resto-only
  })
})

describe('operator (resto) transitions', () => {
  it('may cancel ONLY while placed; never confirm/advance', () => {
    expect(canTransition('operator', 'placed', 'cancelled')).toBe(true)
    expect(canTransition('operator', 'confirmed', 'cancelled')).toBe(false)
    expect(canTransition('operator', 'preparing', 'cancelled')).toBe(false)
    expect(canTransition('operator', 'placed', 'confirmed')).toBe(false) // resto can't advance
    expect(canRestoCancel('placed')).toBe(true)
    expect(canRestoCancel('confirmed')).toBe(false)
    expect(canRestoCancel('delivered')).toBe(false)
  })
})

describe('allowedTransitions', () => {
  it('lists the valid next states per actor + status', () => {
    expect(allowedTransitions('supplier', 'placed')).toEqual(['confirmed', 'declined'])
    expect(allowedTransitions('supplier', 'confirmed')).toEqual(['preparing'])
    expect(allowedTransitions('supplier', 'preparing')).toEqual(['delivered'])
    expect(allowedTransitions('supplier', 'delivered')).toEqual([])
    expect(allowedTransitions('operator', 'placed')).toEqual(['cancelled'])
    expect(allowedTransitions('operator', 'confirmed')).toEqual([])
  })
})
