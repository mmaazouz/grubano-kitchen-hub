import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 98 — affiliate definition + RESTAURANT EQUIVALENCE ──────────────────────────
// The affiliate journey is a PURE function of read-only signals (Affiliate entity + the
// operator's stored payout/fiscal fields). The "prepare your withdrawals" step is DEFERRED:
// a non-blocking 'todo' that never gates earning. We also re-lock a few RESTAURANT states
// here to prove the role-aware generalisation left the restaurant definition unchanged.

const affBase: ChecklistSignals = {
  accountActive:          true,
  hasBrand:               false,
  hasRestaurant:          false,
  menuItemCount:          0,
  isActive:               false,
  stripeConnected:        false,
  affiliateActive:        true,
  affiliateWithdrawReady: false,
}
const buildAff = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('affiliate', { ...affBase, ...over })
const byId = (c: ReturnType<typeof buildAff>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — affiliate definition', () => {
  it('yields the 3 ordered steps mapped to gates 0..2', () => {
    const c = buildAff({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 2])
  })

  it('fresh affiliate (link live, not withdraw-ready) → account+link done, withdraw is a DEFERRED todo with a CTA', () => {
    const c = buildAff({})
    expect(byId(c, 'account').state).toBe('done')
    expect(byId(c, 'affiliateLink').state).toBe('done')
    const w = byId(c, 'affiliateWithdraw')
    expect(w.state).toBe('todo')                     // deferred, NEVER locked/current
    expect(w.ctaKey).toBe('steps.affiliateWithdraw.cta')
    expect(w.ctaHref).toBe('/affiliate/dashboard')   // opens the EXISTING withdrawal section
    expect(w.blockedReasonKey).toBeUndefined()       // not blocked — earning is not gated
    expect(c.currentStepId).toBe('affiliateWithdraw')
    expect(c.isDiscovery).toBe(true)
    expect(c.progressPct).toBe(Math.round((2 / 3) * 100)) // 67% — 2 of 3 done
  })

  it('the withdraw step is NEVER locked or current (it must not block the start)', () => {
    for (const over of [{}, { affiliateActive: false }, { accountActive: false }]) {
      const w = byId(buildAff(over), 'affiliateWithdraw')
      expect(['todo', 'done']).toContain(w.state)
    }
  })

  it('withdraw-ready → all steps done, 100%, journey complete', () => {
    const c = buildAff({ affiliateWithdrawReady: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(byId(c, 'affiliateWithdraw').descriptionKey).toBe('steps.affiliateWithdraw.descReady')
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    expect(c.currentStepId).toBeNull()
  })

  it('inactive link → affiliateLink becomes the current step with a CTA back to the dashboard', () => {
    const c = buildAff({ affiliateActive: false })
    expect(byId(c, 'affiliateLink').state).toBe('current')
    expect(byId(c, 'affiliateLink').ctaHref).toBe('/affiliate/dashboard')
    expect(byId(c, 'account').state).toBe('done')
  })

  it('inactive account → account is the current step', () => {
    expect(byId(buildAff({ accountActive: false }), 'account').state).toBe('current')
  })
})

// ── RESTAURANT EQUIVALENCE — the role-aware change must not perturb the restaurant path ──
describe('buildActivationChecklist — restaurant equivalence (unchanged)', () => {
  const r: ChecklistSignals = {
    accountActive: true, emailVerified: true, hasBrand: false, hasRestaurant: false,
    menuItemCount: 0, isActive: false, stripeConnected: false, stripeStatus: null,
  }
  const build = (over: Partial<ChecklistSignals>) => buildActivationChecklist('restaurant', { ...r, ...over })

  it('still yields the 6 ordered restaurant steps mapped to gates 0,1,1,2,3,4', () => {
    const c = build({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 1, 2, 3, 4])
  })

  it('account-only → establishment current (/business/onboarding), menu locked — identical to pre-Agent-98', () => {
    const c = build({})
    expect(c.steps.find((s) => s.id === 'establishment')!.state).toBe('current')
    expect(c.steps.find((s) => s.id === 'establishment')!.ctaHref).toBe('/business/onboarding')
    expect(c.steps.find((s) => s.id === 'menu')!.state).toBe('locked')
    expect(c.progressPct).toBe(Math.round((1 / 6) * 100))
  })

  it('fully live restaurant → all done, 100%, not discovery', () => {
    const c = build({ hasBrand: true, hasRestaurant: true, menuItemCount: 5, isActive: true, stripeConnected: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
  })
})
