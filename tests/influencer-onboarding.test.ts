import { describe, it, expect } from 'vitest'
import { deriveInfluencerUpgrade } from '@/lib/influencer-onboarding'
import { buildActivationChecklist, type ChecklistSignals } from '@/lib/activation-checklist'

// ── Agent 99 — influencer onboarding upgrade (OPTIONAL, hors-progression) ─────────────
// The upgrade is a PURE mapping of the EXISTING verification state to a UI variant; it lives
// OUTSIDE the affiliate checklist, so a normal affiliate stays byte-identically complete. The
// admin-only approval / audienceVerified flip is untouched (this module never writes).

describe('deriveInfluencerUpgrade — state → variant (read-only)', () => {
  it('verified audience → "verified" (best rate unlocked; number stays the Agent 90 display)', () => {
    expect(deriveInfluencerUpgrade({ verified: true, request: null }).variant).toBe('verified')
  })

  it('pending request → "pending" (awaiting admin review)', () => {
    expect(deriveInfluencerUpgrade({ verified: false, request: { status: 'pending' } }).variant).toBe('pending')
  })

  it('no request → "invite" (optional upgrade nudge)', () => {
    expect(deriveInfluencerUpgrade({ verified: false, request: null }).variant).toBe('invite')
  })

  it('rejected / decided-without-verification → "invite" (can re-apply)', () => {
    expect(deriveInfluencerUpgrade({ verified: false, request: { status: 'rejected' } }).variant).toBe('invite')
    expect(deriveInfluencerUpgrade({ verified: false, request: { status: 'approved' } }).variant).toBe('invite')
  })

  it('verified takes precedence over a stale pending request', () => {
    expect(deriveInfluencerUpgrade({ verified: true, request: { status: 'pending' } }).variant).toBe('verified')
  })

  it('null/undefined state → "invite" (safe default) and never mutates its input', () => {
    expect(deriveInfluencerUpgrade(null).variant).toBe('invite')
    expect(deriveInfluencerUpgrade(undefined).variant).toBe('invite')
    const input = { verified: false, request: { status: 'pending' } } as const
    const snapshot = JSON.stringify(input)
    deriveInfluencerUpgrade(input)
    expect(JSON.stringify(input)).toBe(snapshot) // pure, read-only
  })
})

// ── A normal affiliate stays COMPLETE — the upgrade never enters the checklist ─────────
describe('affiliate checklist is unchanged by the influencer upgrade', () => {
  const affSignals: ChecklistSignals = {
    accountActive: true, hasBrand: false, hasRestaurant: false, menuItemCount: 0,
    isActive: false, stripeConnected: false,
    affiliateActive: true, affiliateWithdrawReady: true, // fully done base journey
  }

  it('a fully-set-up affiliate who does NOT pursue the tier is 100% complete (3 steps, no influencer step)', () => {
    const c = buildActivationChecklist('affiliate', affSignals)
    expect(c.steps.map((s) => s.id)).toEqual(['account', 'affiliateLink', 'affiliateWithdraw'])
    expect(c.progressPct).toBe(100)
    expect(c.isDiscovery).toBe(false)
    // No checklist step references the influencer/audience tier — it lives OUTSIDE the progression.
    const ids = c.steps.map((s) => s.id.toLowerCase()).join(' ')
    const keys = c.steps.map((s) => s.titleKey.toLowerCase()).join(' ')
    expect(ids).not.toMatch(/influenc|audience|verif/)
    expect(keys).not.toMatch(/influenc|audience|verif/)
  })
})
