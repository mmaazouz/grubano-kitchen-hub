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

  // P0-04 (vague 1) — scission REFUNDS (outil admin) / auto-refund ghost-order (webhook).
  it('GHOST_ORDER_AUTO_REFUND without REFUNDS → incoherent (le chemin auto réutilise le moteur admin)', () => {
    const r = checkFlagCoupling({ GHOST_ORDER_AUTO_REFUND_ENABLED: 'true' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('GHOST_ORDER_AUTO_REFUND_ENABLED') && e.includes('REFUNDS_ENABLED'))).toBe(true)
  })
  it('GHOST_ORDER_AUTO_REFUND with REFUNDS → coherent', () => {
    expect(checkFlagCoupling({ GHOST_ORDER_AUTO_REFUND_ENABLED: 'true', REFUNDS_ENABLED: 'true' }).ok).toBe(true)
  })
  // Set bêta Q3 : le garde-fou de flags accepte CLAIMS+REFUNDS sans exiger le flag
  // d'auto-refund → ouvrir les réclamations n'allume plus le chemin WEBHOOK ghost-order.
  // ⚠️ Portée exacte : ceci ne dit RIEN du chemin claims-accept (un restaurateur qui
  // accepte une réclamation rembourse encore, partiellement) — défaut signalé hors
  // périmètre P0-03/P0-04, cf. docs/ops/flags.md note Q3.
  it('set bêta CLAIMS+REFUNDS ON → cohérent, et n\'implique PAS le flag d\'auto-refund webhook', () => {
    expect(checkFlagCoupling({ CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' })).toEqual({ ok: true, errors: [] })
  })

  // P0-25 (vague 1) — route d'auto-approbation derrière son propre kill-switch.
  it('CLAIMS_AUTO_APPROVE without CLAIMS → incoherent', () => {
    const r = checkFlagCoupling({ CLAIMS_AUTO_APPROVE_ENABLED: 'true' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('CLAIMS_AUTO_APPROVE_ENABLED') && e.includes('CLAIMS_ENABLED'))).toBe(true)
  })
  it('CLAIMS_AUTO_APPROVE + CLAIMS sans REFUNDS → incoherent (transitif via CLAIMS⇒REFUNDS)', () => {
    expect(checkFlagCoupling({ CLAIMS_AUTO_APPROVE_ENABLED: 'true', CLAIMS_ENABLED: 'true' }).ok).toBe(false)
  })
  it('chaîne complète AUTO+CLAIMS+REFUNDS → coherent (config post-bêta)', () => {
    expect(checkFlagCoupling({ CLAIMS_AUTO_APPROVE_ENABLED: 'true', CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' }).ok).toBe(true)
  })
  it('⭐ set bêta (CLAIMS+REFUNDS, auto-approve ABSENT) → cohérent : la route reste inopérante sans que check:flags proteste', () => {
    expect(checkFlagCoupling({ CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' })).toEqual({ ok: true, errors: [] })
  })

  // P0-27 (vague 1) — auto-résolution auto_small derrière son propre verrou fail-safe.
  it('CLAIM_AUTO_RESOLVE without CLAIMS → incoherent', () => {
    const r = checkFlagCoupling({ CLAIM_AUTO_RESOLVE_ENABLED: 'true' })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e: string) => e.includes('CLAIM_AUTO_RESOLVE_ENABLED') && e.includes('CLAIMS_ENABLED'))).toBe(true)
  })
  it('CLAIM_AUTO_RESOLVE + CLAIMS sans REFUNDS → incoherent (transitif via CLAIMS⇒REFUNDS)', () => {
    expect(checkFlagCoupling({ CLAIM_AUTO_RESOLVE_ENABLED: 'true', CLAIMS_ENABLED: 'true' }).ok).toBe(false)
  })
  it('chaîne complète AUTO_RESOLVE+CLAIMS+REFUNDS → coherent (config post-pilote)', () => {
    expect(checkFlagCoupling({ CLAIM_AUTO_RESOLVE_ENABLED: 'true', CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' }).ok).toBe(true)
  })
  it('⭐ set bêta (CLAIMS+REFUNDS, auto-resolve ABSENT) → cohérent : l\'auto-résolution reste inopérante sans que check:flags proteste', () => {
    expect(checkFlagCoupling({ CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' })).toEqual({ ok: true, errors: [] })
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
      // P0-06 : la chaîne courier exige désormais le rôle livreur OUVERT (racine).
      LOGISTICS_ENABLED: 'true',
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
      // P0-06 : les capacités ci-dessus exigent leurs racines de rôle.
      LOGISTICS_ENABLED: 'true', FRANCHISE_ENABLED: 'true', CREATOR_ENABLED: 'true',
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

  it('COUPLING_RULES documents the 21 known couplings (courier ÉTAPE 6 + scission P0-04 + auto-approve P0-25 + auto-resolve P0-27 + 11 racines de rôle P0-06)', () => {
    expect(COUPLING_RULES).toHaveLength(21)
  })
})
