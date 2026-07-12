import { describe, it, expect } from 'vitest'
import { checkFlagCoupling, COUPLING_RULES } from '../scripts/check-flags.mjs'

// ── WP-GUARD-01 — flag-coupling guard ─────────────────────────────────────────
// A CI/deploy-time guard (zero app-runtime effect) that FAILs on incoherent
// feature-flag combos. Every flag OFF (the default) is coherent → no-op.

describe('checkFlagCoupling', () => {
  it('all flags OFF (default) → coherent', () => {
    expect(checkFlagCoupling({})).toEqual({ ok: true, errors: [] })
  })

  it('CLAIMS without REFUNDS → incoherent', () => {
    const r = checkFlagCoupling({ CLAIMS_ENABLED: 'true' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('CLAIMS_ENABLED') && e.includes('REFUNDS_ENABLED'))).toBe(true)
  })
  it('CLAIMS with REFUNDS → coherent', () => {
    expect(checkFlagCoupling({ CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' }).ok).toBe(true)
  })

  // P4.3 ÉTAPE 6 — the REAL courier-rail couplings (replaces the phantom TIPS⇒TIP_PAYOUT).
  it('TIPS without LOGISTICS_PAYOUT → incoherent (D-1: tip charged, no reversal rail)', () => {
    const r = checkFlagCoupling({ TIPS_ENABLED: 'true' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('TIPS_ENABLED') && e.includes('LOGISTICS_PAYOUT_ENABLED'))).toBe(true)
  })
  it('LOGISTICS_COURIER_ACCRUAL without LOGISTICS_PAYOUT → incoherent (case-B fee withheld, no reversal)', () => {
    expect(checkFlagCoupling({ LOGISTICS_COURIER_ACCRUAL_ENABLED: 'true' }).ok).toBe(false)
  })
  it('LOGISTICS_PAYOUT without LOGISTICS_CONNECT → incoherent (payout without a Connect account)', () => {
    expect(checkFlagCoupling({ LOGISTICS_PAYOUT_ENABLED: 'true' }).ok).toBe(false)
  })
  it('the full courier chain TIPS+ACCRUAL+PAYOUT+CONNECT → coherent', () => {
    expect(checkFlagCoupling({
      TIPS_ENABLED: 'true', LOGISTICS_COURIER_ACCRUAL_ENABLED: 'true',
      LOGISTICS_PAYOUT_ENABLED: 'true', LOGISTICS_CONNECT_ENABLED: 'true',
    }).ok).toBe(true)
  })
  it('FRANCHISE_ROYALTY without SETTLEMENT → incoherent', () => {
    expect(checkFlagCoupling({ FRANCHISE_ROYALTY_ENABLED: 'true' }).ok).toBe(false)
  })
  it('FRANCHISE_SETTLEMENT without CONNECT → incoherent', () => {
    expect(checkFlagCoupling({ FRANCHISE_ROYALTY_ENABLED: 'true', FRANCHISE_SETTLEMENT_ENABLED: 'true' }).ok).toBe(false)
  })
  it('CREATOR_PAYOUT without CREATOR_CONNECT → incoherent', () => {
    expect(checkFlagCoupling({ CREATOR_PAYOUT_ENABLED: 'true' }).ok).toBe(false)
  })

  it('a fully-coherent enabled set → coherent', () => {
    expect(checkFlagCoupling({
      CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true',
      TIPS_ENABLED: 'true', LOGISTICS_COURIER_ACCRUAL_ENABLED: 'true',
      LOGISTICS_PAYOUT_ENABLED: 'true', LOGISTICS_CONNECT_ENABLED: 'true',
      FRANCHISE_ROYALTY_ENABLED: 'true', FRANCHISE_SETTLEMENT_ENABLED: 'true', FRANCHISE_CONNECT_ENABLED: 'true',
      CREATOR_PAYOUT_ENABLED: 'true', CREATOR_CONNECT_ENABLED: 'true',
    })).toEqual({ ok: true, errors: [] })
  })

  it('only exact "true" enables a flag (not "1" / "TRUE")', () => {
    expect(checkFlagCoupling({ CLAIMS_ENABLED: '1' }).ok).toBe(true)
    expect(checkFlagCoupling({ CLAIMS_ENABLED: 'TRUE' }).ok).toBe(true)
  })

  it('reports EVERY violated coupling at once', () => {
    const r = checkFlagCoupling({ CLAIMS_ENABLED: 'true', TIPS_ENABLED: 'true' })
    expect(r.errors).toHaveLength(2)
  })

  it('COUPLING_RULES documents the 7 known couplings (incl. the real courier rail, ÉTAPE 6)', () => {
    expect(COUPLING_RULES).toHaveLength(7)
  })
})
