import { describe, it, expect } from 'vitest'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 104 — prestataire definition + RESTAURANT/AFFILIATE/CREATOR/SUPPLIER EQUIVALENCE ──
// The prestataire journey is a PURE function of read-only signals (PrestataireProfile: at least
// one service category? company verified (SIREN/KYB)? payout active?). Unlike the supplier
// catalogue, the company step is NEVER locked — it is a non-blocking 'todo' until the service
// profile is filled, then 'current'. The "get paid" step is DEFERRED (non-blocking todo). We also
// re-lock a few states of the 4 existing roles to prove they are unchanged by the 'prestataire'
// addition.

const psBase: ChecklistSignals = {
  accountActive:               true,
  hasBrand:                    false,
  hasRestaurant:               false,
  menuItemCount:               0,
  isActive:                    false,
  stripeConnected:             false,
  prestataireProfileComplete:  false,
  prestataireCompanyVerified:  false,
  prestatairePayoutReady:      false,
}
const buildPre = (over: Partial<ChecklistSignals>) =>
  buildActivationChecklist('prestataire', { ...psBase, ...over })
const byId = (c: ReturnType<typeof buildPre>, id: string) => c.steps.find((s) => s.id === id)!

describe('buildActivationChecklist — prestataire definition', () => {
  it('yields the 4 ordered steps mapped to gates 0..3', () => {
    const c = buildPre({})
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'prestataireProfile', 'prestataireCompany', 'prestatairePayout'])
    expect(c.steps.map((s) => s.gate)).toEqual([0, 1, 2, 3])
  })

  it('fresh prestataire → profile is current, company todo (NOT locked), payout deferred todo', () => {
    const c = buildPre({})
    expect(byId(c, 'account').state).toBe('done')
    expect(byId(c, 'prestataireProfile').state).toBe('current')
    expect(byId(c, 'prestataireProfile').ctaHref).toBe('/prestataire/dashboard/profil')
    const comp = byId(c, 'prestataireCompany')
    expect(comp.state).toBe('todo')                        // non-blocking — never 'locked'
    expect(comp.blockedReasonKey).toBeUndefined()          // no blocked i18n key needed
    expect(comp.ctaHref).toBe('/prestataire/dashboard/profil')
    const pay = byId(c, 'prestatairePayout')
    expect(pay.state).toBe('todo')                         // deferred, never locked/current
    expect(pay.ctaHref).toBe('/prestataire/dashboard')
    expect(c.currentStepId).toBe('prestataireProfile')
    expect(c.isDiscovery).toBe(true)
    expect(c.progressPct).toBe(Math.round((1 / 4) * 100))  // 25% — only account done
  })

  it('profile complete, company not verified → company becomes the current frontier (50%)', () => {
    const c = buildPre({ prestataireProfileComplete: true })
    expect(byId(c, 'prestataireProfile').state).toBe('done')
    expect(byId(c, 'prestataireCompany').state).toBe('current')
    expect(byId(c, 'prestataireCompany').ctaHref).toBe('/prestataire/dashboard/profil')
    expect(c.currentStepId).toBe('prestataireCompany')
    expect(c.progressPct).toBe(Math.round((2 / 4) * 100))  // 50%
  })

  it('profile + company done, not payout-ready → payout is the deferred todo frontier (75%)', () => {
    const c = buildPre({ prestataireProfileComplete: true, prestataireCompanyVerified: true })
    expect(byId(c, 'prestataireProfile').state).toBe('done')
    expect(byId(c, 'prestataireCompany').state).toBe('done')
    expect(byId(c, 'prestatairePayout').state).toBe('todo')
    expect(c.currentStepId).toBe('prestatairePayout')
    expect(c.progressPct).toBe(Math.round((3 / 4) * 100))  // 75%
  })

  it('company verified before the profile is filled → company is done, profile stays the frontier', () => {
    // Verification is INDEPENDENT (often passed at registration). It must not pull the journey
    // forward past the profile step, but it is correctly reported as done.
    const c = buildPre({ prestataireCompanyVerified: true })
    expect(byId(c, 'prestataireProfile').state).toBe('current')
    expect(byId(c, 'prestataireCompany').state).toBe('done')
    expect(c.currentStepId).toBe('prestataireProfile')
  })

  it('the company and payout steps are NEVER locked or blocking', () => {
    for (const over of [{}, { prestataireProfileComplete: true }, { prestataireProfileComplete: true, prestataireCompanyVerified: true }]) {
      const c = buildPre(over)
      expect(byId(c, 'prestataireCompany').state).not.toBe('locked')
      expect(['todo', 'done']).toContain(byId(c, 'prestatairePayout').state)
    }
  })

  it('all ready → 100%, journey complete', () => {
    const c = buildPre({ prestataireProfileComplete: true, prestataireCompanyVerified: true, prestatairePayoutReady: true })
    expect(c.steps.every((s) => s.state === 'done')).toBe(true)
    expect(byId(c, 'prestatairePayout').descriptionKey).toBe('steps.prestatairePayout.descReady')
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    expect(c.currentStepId).toBeNull()
  })
})

// ── EQUIVALENCE ×4 — adding 'prestataire' must not perturb restaurant / affiliate / creator / supplier ──
describe('existing definitions are unchanged by the prestataire addition', () => {
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

  it('supplier still yields its 4 steps; fresh → company current, catalogue LOCKED, payout deferred todo', () => {
    const c = buildActivationChecklist('supplier', {
      accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
      isActive: false, stripeConnected: false,
      supplierCompanyVerified: false, supplierCatalogueReady: false, supplierPayoutReady: false,
    })
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'supplierCompany', 'supplierCatalogue', 'supplierPayout'])
    expect(c.steps.find((s) => s.id === 'supplierCompany')!.state).toBe('current')
    expect(c.steps.find((s) => s.id === 'supplierCatalogue')!.state).toBe('locked')   // SIREN d'abord (distinct from prestataire)
    expect(c.steps.find((s) => s.id === 'supplierPayout')!.state).toBe('todo')
  })
})
