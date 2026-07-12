import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── B1.2 — activation checklist engine (Agent 28) ────────────────────────────
// The derivation is a PURE function of already-loaded signals, so it is fully
// unit-testable in node-only env. These tests lock the restaurateur journey and
// the SEC1-honest behaviour (no owner publish action; admin-gated go-live).

const base: ChecklistSignals = {
  accountActive:   true,
  emailVerified:   true,
  hasBrand:        false,
  hasRestaurant:   false,
  menuItemCount:   0,
  isActive:        false,
  stripeConnected: false,
  stripeStatus:    null,
}
const build = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('restaurant', { ...base, ...over })
const byId = (c: ReturnType<typeof build>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — restaurateur', () => {
  it('always yields the 6 ordered steps mapped to gates 0..4', () => {
    const c = build({})
    expect(c.steps.map((s) => s.id)).toEqual(
      ['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'],
    )
    // account P0 · establishment P1 · menu P1→P2 (counted at gate 1) · publish P2 · payments P3 · payouts P4
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 1, 2, 3, 4])
  })

  it('account-only (no brand/resto) → establishment is the current step, menu locked', () => {
    const c = build({})
    expect(byId(c, 'account').state).toBe('done')
    expect(byId(c, 'establishment').state).toBe('current')
    expect(byId(c, 'establishment').ctaHref).toBe('/business/onboarding')
    expect(byId(c, 'menu').state).toBe('locked')
    expect(byId(c, 'menu').blockedReasonKey).toBe('blocked.needEstablishment')
    expect(c.currentStepId).toBe('establishment')
    expect(c.isDiscovery).toBe(true)
  })

  it('brand+resto but no menu → menu current, publish locked (complete menu first)', () => {
    const c = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 0 })
    expect(byId(c, 'establishment').state).toBe('done')
    expect(byId(c, 'menu').state).toBe('current')
    expect(byId(c, 'menu').ctaHref).toBe('/menu')
    expect(byId(c, 'publish').state).toBe('locked')
    expect(byId(c, 'publish').blockedReasonKey).toBe('blocked.completeMenuFirst')
    expect(c.currentStepId).toBe('menu')
  })

  it('complete but NOT approved → publish is a waiting state with NO publish CTA (SEC1)', () => {
    const c = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 3, isActive: false })
    const pub = byId(c, 'publish')
    expect(pub.state).toBe('current')
    expect(pub.blockedReasonKey).toBe('blocked.awaitingApproval')
    expect(pub.ctaKey).toBeUndefined()   // owner cannot self-publish
    expect(pub.ctaHref).toBeUndefined()
    expect(c.currentStepId).toBe('publish')
    expect(c.isDiscovery).toBe(true)
  })

  it('published (isActive) → publish done', () => {
    const c = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 3, isActive: true })
    expect(byId(c, 'publish').state).toBe('done')
    expect(byId(c, 'publish').descriptionKey).toBe('steps.publish.descOnline')
  })

  it('payments/payouts reflect Stripe status (read-only mirror)', () => {
    const notConnected = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 1, isActive: true, stripeConnected: false })
    expect(byId(notConnected, 'payments').state).toBe('current') // published, not connected
    expect(byId(notConnected, 'payments').ctaHref).toBe('/finance')
    expect(byId(notConnected, 'payouts').state).toBe('locked')
    expect(byId(notConnected, 'payouts').blockedReasonKey).toBe('blocked.activatePaymentsFirst')

    const connected = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 1, isActive: true, stripeConnected: true })
    expect(byId(connected, 'payments').state).toBe('done')
    expect(byId(connected, 'payouts').state).toBe('done')
  })

  it('payments is "todo" (not current) while the resto is not yet online', () => {
    const c = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 2, isActive: false })
    expect(byId(c, 'payments').state).toBe('todo')
  })

  it('progressPct is the rounded share of done steps; isDiscovery clears only when all done', () => {
    const fresh = build({})
    expect(fresh.progressPct).toBe(Math.round((1 / 6) * 100)) // only account done

    const fullyLive = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 5, isActive: true, stripeConnected: true })
    expect(fullyLive.steps.every((s) => s.state === 'done')).toBe(true)
    expect(fullyLive.progressPct).toBe(100)
    expect(fullyLive.isDiscovery).toBe(false)
    expect(fullyLive.currentStepId).toBeNull()
  })

  it('at most one step is "current" in every reachable state', () => {
    const states: Partial<ChecklistSignals>[] = [
      {},
      { hasBrand: true, hasRestaurant: true },
      { hasBrand: true, hasRestaurant: true, menuItemCount: 2 },
      { hasBrand: true, hasRestaurant: true, menuItemCount: 2, isActive: true },
      { hasBrand: true, hasRestaurant: true, menuItemCount: 2, isActive: true, stripeConnected: true },
    ]
    for (const s of states) {
      const c = build(s)
      expect(c.steps.filter((x) => x.state === 'current').length).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildActivationChecklist — generic core', () => {
  it('unknown role → empty, non-discovery checklist (safe default)', () => {
    const c = buildActivationChecklist('martian', base)
    expect(c.steps).toEqual([])
    expect(c.isDiscovery).toBe(false)
    expect(c.progressPct).toBe(100)
    expect(c.currentStepId).toBeNull()
  })
})
