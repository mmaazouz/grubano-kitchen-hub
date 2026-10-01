import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Mission CA — the two NAMED OUTPUTS of Contract v1.1 ──────────────────────
//
// Scope of this file: ONLY `prepared` (PRÉPARÉ) and `cardReady` (CARTE PRÊTE).
// Opérationnel / Approuvé / Publié / Encaissement / Retrait are deliberately NOT
// covered here: mission CA does not produce them (arbitrations B3/B4, ambiguity
// on the approval act, and conditions deferred to the financial model).
//
// The existing step list, its order, its gates and progressPct are asserted
// UNCHANGED here too — the named outputs must not disturb them.

const base: ChecklistSignals = {
  accountActive:   true,
  hasBrand:        false,
  hasRestaurant:   false,
  menuItemCount:   0,
  isActive:        false,
  stripeConnected: false,
}

describe('PRÉPARÉ — Contract v1.1 §2, founder arbitration B2', () => {
  it('is false while the operator has no establishment', () => {
    expect(buildActivationChecklist('restaurant', base).prepared).toBe(false)
  })

  it('is true as soon as the establishment exists — the BRAND is not a condition', () => {
    // B2 is explicit: « Préparé = l'établissement est créé ». The atomic brand
    // creation must NOT be used to tighten this definition.
    const c = buildActivationChecklist('restaurant', { ...base, hasRestaurant: true, hasBrand: false })
    expect(c.prepared).toBe(true)
  })

  it('does not depend on the brand in either direction', () => {
    const withBrandOnly = buildActivationChecklist('restaurant', { ...base, hasBrand: true })
    expect(withBrandOnly.prepared).toBe(false)

    const withBoth = buildActivationChecklist('restaurant', { ...base, hasBrand: true, hasRestaurant: true })
    expect(withBoth.prepared).toBe(true)
  })
})

describe('CARTE PRÊTE — D11 (attachment is constitutive), founder scope: per establishment', () => {
  const withEstab: ChecklistSignals = { ...base, hasRestaurant: true, hasBrand: true }

  it('is NOT emitted when the caller did not measure the per-establishment signals', () => {
    // Unmeasured must never be rendered as a fabricated `false`.
    const c = buildActivationChecklist('restaurant', withEstab)
    expect(c.cardReady).toBeUndefined()
  })

  it('is NOT emitted when only one of the two signals is measured', () => {
    expect(buildActivationChecklist('restaurant', { ...withEstab, attachedBrandCount: 1 }).cardReady).toBeUndefined()
    expect(buildActivationChecklist('restaurant', { ...withEstab, availableDishCount: 3 }).cardReady).toBeUndefined()
  })

  it('reports no_establishment when there is no establishment to carry a menu', () => {
    const c = buildActivationChecklist('restaurant', {
      ...base, hasRestaurant: false, attachedBrandCount: 0, availableDishCount: 0,
    })
    expect(c.cardReady).toEqual({ value: false, reason: 'no_establishment' })
  })

  it('reports no_attached_brand when the establishment has zero ATTACHED brand', () => {
    // The operator may well own brands — an orphan brand does not count (D11).
    const c = buildActivationChecklist('restaurant', {
      ...withEstab, menuItemCount: 12, attachedBrandCount: 0, availableDishCount: 0,
    })
    expect(c.cardReady).toEqual({ value: false, reason: 'no_attached_brand' })
  })

  it('reports no_available_dish when attached brands carry no AVAILABLE dish', () => {
    // menuItemCount counts dishes across ALL the operator's brands, available or
    // not: it must not be enough to declare the card ready.
    const c = buildActivationChecklist('restaurant', {
      ...withEstab, menuItemCount: 9, attachedBrandCount: 2, availableDishCount: 0,
    })
    expect(c.cardReady).toEqual({ value: false, reason: 'no_available_dish' })
  })

  it('holds, with a null reason, when an attached brand carries an available dish', () => {
    const c = buildActivationChecklist('restaurant', {
      ...withEstab, menuItemCount: 1, attachedBrandCount: 1, availableDishCount: 1,
    })
    expect(c.cardReady).toEqual({ value: true, reason: null })
  })

  it('is stricter than the legacy menu step — the divergence the contract asked to close', () => {
    // Legacy signal says "1 dish exists somewhere"; the contract asks for a
    // publishable dish attached to THIS establishment.
    const s: ChecklistSignals = {
      ...withEstab, menuItemCount: 1, attachedBrandCount: 0, availableDishCount: 0,
    }
    const c = buildActivationChecklist('restaurant', s)
    expect(c.steps.find((st) => st.id === 'menu')?.state).toBe('done') // unchanged legacy behaviour
    expect(c.cardReady?.value).toBe(false)                            // contract-conform capacity
  })
})

describe('the named outputs disturb nothing else', () => {
  const measured: ChecklistSignals = {
    ...base, hasBrand: true, hasRestaurant: true, menuItemCount: 3,
    attachedBrandCount: 1, availableDishCount: 2,
  }

  it('keeps the six steps, their order and their gates', () => {
    const c = buildActivationChecklist('restaurant', measured)
    expect(c.steps.map((s) => s.id)).toEqual([
      'account', 'establishment', 'menu', 'publish', 'payments', 'payouts',
    ])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 1, 2, 3, 4])
  })

  it('keeps progressPct computed on the six steps only', () => {
    const withOutputs = buildActivationChecklist('restaurant', measured)
    const { attachedBrandCount: _a, availableDishCount: _b, ...unmeasured } = measured
    const withoutOutputs = buildActivationChecklist('restaurant', unmeasured)
    expect(withOutputs.progressPct).toBe(withoutOutputs.progressPct)
  })

  it('emits neither output for the other roles', () => {
    for (const role of ['affiliate', 'creator', 'supplier', 'prestataire', 'franchisor']) {
      const c = buildActivationChecklist(role, measured)
      expect(c.prepared).toBeUndefined()
      expect(c.cardReady).toBeUndefined()
    }
  })

  it('emits neither output for an unknown role', () => {
    const c = buildActivationChecklist('unknown-role', measured)
    expect(c.prepared).toBeUndefined()
    expect(c.cardReady).toBeUndefined()
    expect(c.steps).toEqual([])
  })
})
