import { describe, it, expect } from 'vitest'
import { checkFlagCoupling, checkFlagWarnings, COUPLING_RULES } from '../scripts/check-flags.mjs'

// ── WP-GUARD-01 — flag-coupling guard ─────────────────────────────────────────
// A CI/deploy-time guard (zero app-runtime effect) that FAILs on incoherent
// feature-flag combos. Every flag OFF (the default) is coherent → no-op.

describe('checkFlagCoupling', () => {
  it('all flags OFF (default) → coherent', () => {
    expect(checkFlagCoupling({})).toEqual({ ok: true, errors: [] })
  })

  // GATE §19 CONTRACT CHANGE (2026-09-10, founder decision). This used to assert that claims
  // open with refunds shut is INCOHERENT. That rule forbade the only safe way to rehearse the
  // claims workflow — claims open, refunds shut, no money able to move — and would have forced
  // a money-capable rehearsal to test a non-money flow. Its original concern (an approved claim
  // with no money behind it) is now visible rather than silent, so it is a WARNING, not an error.
  it('[§19] CLAIMS without REFUNDS is ALLOWED — and warned about, not failed', () => {
    const r = checkFlagCoupling({ CLAIMS_ENABLED: 'true' })
    expect(r.ok).toBe(true) // ← the change: no longer an automatic failure
    const w = checkFlagWarnings({ CLAIMS_ENABLED: 'true' })
    expect(w.some((m: string) => m.includes('CLAIMS_ENABLED') && m.includes('REFUNDS_ENABLED'))).toBe(true)
  })

  it('[§19] the warning is silent when both are on, so it cannot become background noise', () => {
    expect(checkFlagWarnings({ CLAIMS_ENABLED: 'true', REFUNDS_ENABLED: 'true' })
      .some((m: string) => m.includes('configuration de RÉPÉTITION'))).toBe(false)
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
  // §19: the transitive CLAIMS⇒REFUNDS error is gone, so auto-approve with claims open and
  // refunds shut is no longer an automatic failure. Auto-approve still REQUIRES claims.
  it('[§19] AUTO_APPROVE + CLAIMS without REFUNDS → allowed by coupling (auto-approve still needs CLAIMS)', () => {
    expect(checkFlagCoupling({ CLAIMS_AUTO_APPROVE_ENABLED: 'true', CLAIMS_ENABLED: 'true' }).ok).toBe(true)
    expect(checkFlagCoupling({ CLAIMS_AUTO_APPROVE_ENABLED: 'true' }).ok).toBe(false)
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
  it('[§19] AUTO_RESOLVE + CLAIMS without REFUNDS → allowed by coupling (auto-resolve still needs CLAIMS)', () => {
    expect(checkFlagCoupling({ CLAIM_AUTO_RESOLVE_ENABLED: 'true', CLAIMS_ENABLED: 'true' }).ok).toBe(true)
    expect(checkFlagCoupling({ CLAIM_AUTO_RESOLVE_ENABLED: 'true' }).ok).toBe(false)
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
    // TIPS⇒LOGISTICS_PAYOUT and LOGISTICS_PAYOUT⇒LOGISTICS_CONNECT both fire.
    const r = checkFlagCoupling({ TIPS_ENABLED: 'true', LOGISTICS_PAYOUT_ENABLED: 'true' })
    expect(r.errors).toHaveLength(1)
    const r2 = checkFlagCoupling({ TIPS_ENABLED: 'true', CLAIM_AUTO_RESOLVE_ENABLED: 'true' })
    expect(r2.errors).toHaveLength(2)
  })

  it('COUPLING_RULES documents the 20 known couplings (CLAIMS⇒REFUNDS narrowed to a warning, gate §19 2026-09-10)', () => {
    expect(COUPLING_RULES).toHaveLength(20)
    expect(COUPLING_RULES.some((r: { flag: string; requires: string }) =>
      r.flag === 'CLAIMS_ENABLED' && r.requires === 'REFUNDS_ENABLED')).toBe(false)
  })
})

// ── LOT C — WARNINGS (non bloquants : le check reste exit 0, mais signale) ──────
describe('checkFlagWarnings — LOT C', () => {
  it('all flags OFF (default) → zéro warning', () => {
    expect(checkFlagWarnings({})).toEqual([])
  })

  // T-48 : le drapeau seul n'autorise plus rien — une fenêtre est un BAIL qui expire.
  // Un REFUNDS_ENABLED=true sans bail est donc INERTE, et doit être dit à l'opérateur.
  const lease = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

  it('REFUNDS_ENABLED sans ADMIN_AUDIT_ENABLED → WARNING « refunds sans trace d\'audit » (mais couplage OK)', () => {
    const env = { REFUNDS_ENABLED: 'true', REFUNDS_WINDOW_UNTIL: lease(10) }
    expect(checkFlagCoupling(env).ok).toBe(true) // légal — jamais un exit 1
    const warnings = checkFlagWarnings(env)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('refunds sans trace d\'audit')
  })

  it('REFUNDS_ENABLED + ADMIN_AUDIT_ENABLED + bail valide → zéro warning (set bêta D3 complet)', () => {
    expect(checkFlagWarnings({ REFUNDS_ENABLED: 'true', ADMIN_AUDIT_ENABLED: 'true', REFUNDS_WINDOW_UNTIL: lease(10) })).toEqual([])
  })

  it('(T-48) REFUNDS_ENABLED=true SANS bail → warning explicite : la porte reste FERMÉE', () => {
    const warnings = checkFlagWarnings({ REFUNDS_ENABLED: 'true', ADMIN_AUDIT_ENABLED: 'true' })
    expect(warnings.some((w: string) => w.includes('sans REFUNDS_WINDOW_UNTIL'))).toBe(true)
  })

  it('(T-48) REFUNDS_ENABLED=true avec un bail EXPIRÉ ou illisible → warning « porte FERMÉE »', () => {
    for (const until of [new Date(Date.now() - 60_000).toISOString(), 'bientôt']) {
      const warnings = checkFlagWarnings({ REFUNDS_ENABLED: 'true', ADMIN_AUDIT_ENABLED: 'true', REFUNDS_WINDOW_UNTIL: until })
      expect(warnings.some((w: string) => w.includes('expiré ou illisible'))).toBe(true)
    }
  })

  it('ALLOW_PLATFORM_FALLBACK=true → WARNING rouge « QA uniquement — JAMAIS en production »', () => {
    const warnings = checkFlagWarnings({ ALLOW_PLATFORM_FALLBACK: 'true' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('QA uniquement — JAMAIS en production')
  })

  it('only exact "true" triggers a warning (not "1" / "TRUE")', () => {
    expect(checkFlagWarnings({ ALLOW_PLATFORM_FALLBACK: 'TRUE', REFUNDS_ENABLED: '1' })).toEqual([])
  })
})
