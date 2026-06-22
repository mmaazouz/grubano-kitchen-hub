import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 105 — franchisor definition + EQUIVALENCE ×5 ─────────────────────────────────
// The franchisor journey is a PURE function of read-only signals (Operator KYB verified? a brand
// opened to franchising? franchise payout active?). MONEY-ADJACENT role, but the definition reads
// no royalty value. The company (SIREN/KYB) step is Grubano/server-side → it carries NO CTA (it
// mirrors the restaurant "publish — awaiting validation" step). The "receive royalties" step is
// DEFERRED (non-blocking todo). We also re-lock states of the 5 existing roles to prove the
// 'franchisor' addition changes nothing.

const fsBase: ChecklistSignals = {
  accountActive:                 true,
  hasBrand:                      false,
  hasRestaurant:                 false,
  menuItemCount:                 0,
  isActive:                      false,
  stripeConnected:               false,
  franchisorCompanyVerified:     false,
  franchisorFranchiseConfigured: false,
  franchisorPayoutReady:         false,
}
const buildFr = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('franchisor', { ...fsBase, ...over })
const byId = (c: ReturnType<typeof buildFr>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — franchisor definition', () => {
  it('yields the 4 ordered steps mapped to gates 0..3', () => {
    const c = buildFr({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'franchisorCompany', 'franchisorFranchise', 'franchisorPayout'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 2, 3])
  })

  it('fresh franchisor → company current (NO cta, Grubano-side), franchise current+cta, payout deferred todo', () => {
    const c = buildFr({})
    expect(byId(c, 'account').state).toBe('done')

    const comp = byId(c, 'franchisorCompany')
    expect(comp.state).toBe('current')
    expect(comp.ctaHref).toBeUndefined()        // Grubano-side verification → never an owner CTA
    expect(comp.ctaKey).toBeUndefined()
    expect(comp.blockedReasonKey).toBeUndefined() // no new blocked i18n key

    const fr = byId(c, 'franchisorFranchise')
    expect(fr.state).toBe('current')
    expect(fr.ctaHref).toBe('/franchise/dashboard/etablissements')

    const pay = byId(c, 'franchisorPayout')
    expect(pay.state).toBe('todo')               // deferred, never locked/current
    expect(pay.ctaHref).toBe('/franchise/dashboard/finances')

    // currentStepId = first 'current' = company; isDiscovery; 25% (only account done)
    expect(c.currentStepId).toBe('franchisorCompany')
    expect(c.isDiscovery).toBe(true)
    expect(c.progressPct).toBe(Math.round((1 / 4) * 100))
  })

  it('company verified, franchise not configured → franchise is the actionable frontier (50%)', () => {
    const c = buildFr({ franchisorCompanyVerified: true })
    expect(byId(c, 'franchisorCompany').state).toBe('done')
    expect(byId(c, 'franchisorFranchise').state).toBe('current')
    expect(c.currentStepId).toBe('franchisorFranchise')
    expect(c.progressPct).toBe(Math.round((2 / 4) * 100))
  })

  it('company + franchise done, not payout-ready → payout is the deferred todo frontier (75%)', () => {
    const c = buildFr({ franchisorCompanyVerified: true, franchisorFranchiseConfigured: true })
    expect(byId(c, 'franchisorFranchise').state).toBe('done')
    expect(byId(c, 'franchisorPayout').state).toBe('todo')
    expect(c.currentStepId).toBe('franchisorPayout')
    expect(c.progressPct).toBe(Math.round((3 / 4) * 100))
  })

  it('the company step is NEVER actionable (no CTA) and the payout step is NEVER locked/current', () => {
    for (const over of [{}, { franchisorCompanyVerified: true }, { franchisorCompanyVerified: true, franchisorFranchiseConfigured: true }]) {
      const c = buildFr(over)
      expect(byId(c, 'franchisorCompany').ctaHref).toBeUndefined()
      expect(['todo', 'done']).toContain(byId(c, 'franchisorPayout').state)
    }
  })

  it('all ready → 100%, journey complete', () => {
    const c = buildFr({ franchisorCompanyVerified: true, franchisorFranchiseConfigured: true, franchisorPayoutReady: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(byId(c, 'franchisorPayout').descriptionKey).toBe('steps.franchisorPayout.descReady')
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    expect(c.currentStepId).toBeNull()
  })
})

// ── EQUIVALENCE ×5 — adding 'franchisor' must not perturb the 5 existing definitions ──
describe('existing definitions are unchanged by the franchisor addition', () => {
  it('restaurant still yields its 6 ordered steps; account-only → establishment current, menu locked', () => {
    const c = buildActivationChecklist('restaurant', {
      accountActive: true, emailVerified: true, hasBrand: false, hasRestaurant: false,
      menuItemCount: 0, isActive: false, stripeConnected: false, stripeStatus: null,
    })
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(c.steps.find((s) => s.id === 'establishment')!.state).toBe('current')
    expect(c.steps.find((s) => s.id === 'menu')!.state).toBe('locked')
  })

  it('affiliate + creator unchanged', () => {
    const a = buildActivationChecklist('affiliate', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false, affiliateActive: true, affiliateWithdrawReady: false,
    })
    expect(a.steps.map((s) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    expect(a.progressPct).toBe(Math.round((2 / 3) * 100))

    const cr = buildActivationChecklist('creator', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false, creatorProfileComplete: false, creatorPayoutReady: false,
    })
    expect(cr.steps.map((s) => s.id)).toEqual(['account', 'creatorProfile', 'creatorPayout'])
    expect(cr.steps.find((s) => s.id === 'creatorProfile')!.state).toBe('current')
  })

  it('supplier (catalogue LOCKED until verified) + prestataire (company todo, not locked) unchanged', () => {
    const sup = buildActivationChecklist('supplier', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false,
      supplierCompanyVerified: false, supplierCatalogueReady: false, supplierPayoutReady: false,
    })
    expect(sup.steps.map((s) => s.id)).toEqual(['account', 'supplierCompany', 'supplierCatalogue', 'supplierPayout'])
    expect(sup.steps.find((s) => s.id === 'supplierCatalogue')!.state).toBe('locked')

    const pre = buildActivationChecklist('prestataire', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false,
      prestataireProfileComplete: false, prestataireCompanyVerified: false, prestatairePayoutReady: false,
    })
    expect(pre.steps.map((s) => s.id)).toEqual(['account', 'prestataireProfile', 'prestataireCompany', 'prestatairePayout'])
    expect(pre.steps.find((s) => s.id === 'prestataireCompany')!.state).toBe('todo')   // NOT locked (distinct from supplier)
  })
})
