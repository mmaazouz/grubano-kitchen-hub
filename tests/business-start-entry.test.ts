import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ── business/start entry redesign (Agent 119, unification "recommander" incr. 2/3) ──
// The page is an async SERVER component (getTranslations + isAffiliateEnabled +
// isPrestataireEnabled) → the node test harness can't render it. We assert the ROUTING
// wiring at the SOURCE level: the affiliate "recommander" card points to /affiliate/apply
// and is gated by AFFILIATE_ENABLED; "Groupe & Franchise" points to the real /franchise/apply;
// the misleading influencer teaser to the creator wizard is GONE; the other cards are unchanged.

const SRC = readFileSync(path.join(process.cwd(), 'app/[locale]/business/start/page.tsx'), 'utf8')

describe('business/start entry routing', () => {
  it('the affiliate "recommander" card points to /affiliate/apply', () => {
    expect(SRC).toContain("href: '/affiliate/apply'")
  })

  it('the affiliate card is gated by AFFILIATE_ENABLED (conditional → no dead link when OFF)', () => {
    expect(SRC).toContain('isAffiliateEnabled')
    expect(SRC).toContain("from '@/lib/affiliate-account'")
    // shown ONLY when the flag is on (mirrors the prestataire gating)
    expect(SRC).toMatch(/if\s*\(\s*isAffiliateEnabled\(\)\s*\)\s*partners\.push\(AFFILIATE_PARTNER\)/)
  })

  it('"Groupe & Franchise" points to the REAL /franchise/apply (not the franchise-soon teaser)', () => {
    expect(SRC).toContain('href="/franchise/apply"')
    expect(SRC).not.toContain('/business/franchise-soon')
  })

  it('the misleading influencer teaser to the creator wizard is REMOVED', () => {
    expect(SRC).not.toContain('/creators/apply?type=influencer')
    expect(SRC).not.toContain("t('influencerTeaser')")
  })

  it('the other partner routes are UNCHANGED (no money/registration touched)', () => {
    expect(SRC).toContain('href="/business/register"')          // Restaurateur (featured)
    expect(SRC).toContain("href: '/supplier/register'")         // Fournisseur
    expect(SRC).toContain("href: '/creators/apply'")            // Chef & Créateur (base, no ?type)
    expect(SRC).toContain("href: '/business/logistics/register'") // Logistique
    expect(SRC).toContain("href: '/business/prestataire/register'") // Prestataire (gated, unchanged)
    expect(SRC).toContain('isPrestataireEnabled')               // prestataire gating preserved
    expect(SRC).toContain('href="/auth/magic"')                 // Se connecter
  })
})
