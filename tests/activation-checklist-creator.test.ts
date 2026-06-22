import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 100 — creator definition + RESTAURANT + AFFILIATE EQUIVALENCE ───────────────
// The creator journey is a PURE function of read-only signals (Creator entity: bio filled?
// payout Connect active?). The "get paid" step is DEFERRED: a non-blocking 'todo' that never
// gates the start. We also re-lock a few restaurant + affiliate states to prove the new
// definition left both existing definitions unchanged.

const crBase: ChecklistSignals = {
  accountActive:          true,
  hasBrand:               false,
  hasRestaurant:          false,
  menuItemCount:          0,
  isActive:               false,
  stripeConnected:        false,
  creatorProfileComplete: false,
  creatorPayoutReady:     false,
}
const buildCr = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('creator', { ...crBase, ...over })
const byId = (c: ReturnType<typeof buildCr>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — creator definition', () => {
  it('yields the 3 ordered steps mapped to gates 0..2', () => {
    const c = buildCr({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'creatorProfile', 'creatorPayout'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 2])
  })

  it('fresh creator (empty profile) → account done, profile is the CURRENT step, payout a DEFERRED todo', () => {
    const c = buildCr({})
    expect(byId(c, 'account').state).toBe('done')
    expect(byId(c, 'creatorProfile').state).toBe('current')
    expect(byId(c, 'creatorProfile').ctaHref).toBe('/creators/dashboard/parametres')
    const p = byId(c, 'creatorPayout')
    expect(p.state).toBe('todo')                       // deferred, NEVER locked/current
    expect(p.ctaHref).toBe('/creators/dashboard/revenus')
    expect(p.blockedReasonKey).toBeUndefined()         // not blocked — activity is not gated
    expect(c.currentStepId).toBe('creatorProfile')
    expect(c.isDiscovery).toBe(true)
    expect(c.progressPct).toBe(Math.round((1 / 3) * 100)) // 33% — only account done
  })

  it('profile complete (not payout-ready) → profile done, payout is the deferred todo frontier', () => {
    const c = buildCr({ creatorProfileComplete: true })
    expect(byId(c, 'creatorProfile').state).toBe('done')
    expect(byId(c, 'creatorPayout').state).toBe('todo')
    expect(c.currentStepId).toBe('creatorPayout')
    expect(c.progressPct).toBe(Math.round((2 / 3) * 100)) // 67%
  })

  it('the payout step is NEVER locked or current (must not block the start)', () => {
    for (const over of [{}, { creatorProfileComplete: true }, { accountActive: false }]) {
      expect(['todo', 'done']).toContain(byId(buildCr(over), 'creatorPayout').state)
    }
  })

  it('payout-ready + profile complete → all done, 100%, journey complete', () => {
    const c = buildCr({ creatorProfileComplete: true, creatorPayoutReady: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(byId(c, 'creatorPayout').descriptionKey).toBe('steps.creatorPayout.descReady')
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    expect(c.currentStepId).toBeNull()
  })

  it('inactive account → account is the current step', () => {
    expect(byId(buildCr({ accountActive: false }), 'account').state).toBe('current')
  })
})

// ── RESTAURANT + AFFILIATE EQUIVALENCE — adding 'creator' must not perturb either ──────
describe('existing definitions are unchanged by the creator addition', () => {
  it('restaurant still yields its 6 ordered steps; account-only → establishment current, menu locked', () => {
    const r: ChecklistSignals = {
      accountActive: true, emailVerified: true, hasBrand: false, hasRestaurant: false,
      menuItemCount: 0, isActive: false, stripeConnected: false, stripeStatus: null,
    }
    const c = buildActivationChecklist('restaurant', r)
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(c.steps.find((s) => s.id === 'establishment')!.state).toBe('current')
    expect(c.steps.find((s) => s.id === 'menu')!.state).toBe('locked')
    expect(c.progressPct).toBe(Math.round((1 / 6) * 100))
  })

  it('affiliate still yields its 3 steps; fresh affiliate → withdraw deferred todo, 67%', () => {
    const c = buildActivationChecklist('affiliate', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false, affiliateActive: true, affiliateWithdrawReady: false,
    })
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    expect(c.steps.find((s) => s.id === 'affiliateWithdraw')!.state).toBe('todo')
    expect(c.progressPct).toBe(Math.round((2 / 3) * 100))
  })
})
