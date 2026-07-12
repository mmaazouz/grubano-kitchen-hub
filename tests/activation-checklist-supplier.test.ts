import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 103 — supplier definition + RESTAURANT/AFFILIATE/CREATOR EQUIVALENCE ─────────
// The supplier journey is a PURE function of read-only signals (SupplierProfile: SIREN/KYB
// verified? catalogue has a product? payout active?). Catalogue is LOCKED until the company is
// verified (SIREN d'abord); the "get paid" step is DEFERRED (non-blocking todo). We also re-lock
// a few states of the 3 existing roles to prove they are unchanged by the 'supplier' addition.

const spBase: ChecklistSignals = {
  accountActive:           true,
  hasBrand:                false,
  hasRestaurant:           false,
  menuItemCount:           0,
  isActive:                false,
  stripeConnected:         false,
  supplierCompanyVerified: false,
  supplierCatalogueReady:  false,
  supplierPayoutReady:     false,
}
const buildSup = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('supplier', { ...spBase, ...over })
const byId = (c: ReturnType<typeof buildSup>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — supplier definition', () => {
  it('yields the 4 ordered steps mapped to gates 0..3', () => {
    const c = buildSup({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'supplierCompany', 'supplierCatalogue', 'supplierPayout'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 2, 3])
  })

  it('fresh supplier (unverified) → company is current, catalogue LOCKED, payout deferred todo', () => {
    const c = buildSup({})
    expect(byId(c, 'account').state).toBe('done')
    expect(byId(c, 'supplierCompany').state).toBe('current')
    expect(byId(c, 'supplierCompany').ctaHref).toBe('/supplier/dashboard/profil')
    const cat = byId(c, 'supplierCatalogue')
    expect(cat.state).toBe('locked')                       // SIREN d'abord
    expect(cat.blockedReasonKey).toBe('blocked.supplierVerifyCompanyFirst')
    expect(cat.ctaHref).toBeUndefined()
    const pay = byId(c, 'supplierPayout')
    expect(pay.state).toBe('todo')                         // deferred, never locked/current
    expect(pay.ctaHref).toBe('/supplier/dashboard')
    expect(c.currentStepId).toBe('supplierCompany')
    expect(c.isDiscovery).toBe(true)
    expect(c.progressPct).toBe(Math.round((1 / 4) * 100))  // 25% — only account done
  })

  it('company verified, empty catalogue → catalogue UNLOCKS and becomes current with a CTA', () => {
    const c = buildSup({ supplierCompanyVerified: true })
    expect(byId(c, 'supplierCompany').state).toBe('done')
    expect(byId(c, 'supplierCatalogue').state).toBe('current')
    expect(byId(c, 'supplierCatalogue').ctaHref).toBe('/supplier/catalog')
    expect(c.currentStepId).toBe('supplierCatalogue')
    expect(c.progressPct).toBe(Math.round((2 / 4) * 100))  // 50%
  })

  it('company + catalogue done, not payout-ready → payout is the deferred todo frontier (75%)', () => {
    const c = buildSup({ supplierCompanyVerified: true, supplierCatalogueReady: true })
    expect(byId(c, 'supplierCatalogue').state).toBe('done')
    expect(byId(c, 'supplierPayout').state).toBe('todo')
    expect(c.currentStepId).toBe('supplierPayout')
    expect(c.progressPct).toBe(Math.round((3 / 4) * 100))
  })

  it('the payout step is NEVER locked or current (must not block selling)', () => {
    for (const over of [{}, { supplierCompanyVerified: true }, { supplierCompanyVerified: true, supplierCatalogueReady: true }]) {
      expect(['todo', 'done']).toContain(byId(buildSup(over), 'supplierPayout').state)
    }
  })

  it('all ready → 100%, journey complete', () => {
    const c = buildSup({ supplierCompanyVerified: true, supplierCatalogueReady: true, supplierPayoutReady: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(byId(c, 'supplierPayout').descriptionKey).toBe('steps.supplierPayout.descReady')
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    expect(c.currentStepId).toBeNull()
  })
})

// ── EQUIVALENCE ×3 — adding 'supplier' must not perturb restaurant / affiliate / creator ──
describe('existing definitions are unchanged by the supplier addition', () => {
  it('restaurant still yields its 6 ordered steps; account-only → establishment current, menu locked', () => {
    const c = buildActivationChecklist('restaurant', {
      accountActive: true, emailVerified: true, hasBrand: false, hasRestaurant: false,
      menuItemCount: 0, isActive: false, stripeConnected: false, stripeStatus: null,
    })
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'establishment', 'menu', 'publish', 'payments', 'payouts'])
    expect(c.steps.find((s) => s.id === 'establishment')!.state).toBe('current')
    expect(c.steps.find((s) => s.id === 'menu')!.state).toBe('locked')
  })

  it('affiliate (3 steps, withdraw deferred todo, 67%) + creator (3 steps, profile current, 33%) unchanged', () => {
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
    expect(cr.progressPct).toBe(Math.round((1 / 3) * 100))
  })
})
