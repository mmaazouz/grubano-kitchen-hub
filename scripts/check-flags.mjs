// ── WP-GUARD-01 — feature-flag coupling guard ─────────────────────────────────
// FAILs (exit 1) on incoherent feature-flag combinations that would create a
// money / trust hazard in production (a flag ON whose required counterpart is OFF).
// This is a CI / deploy / go-live-checklist check — it has ZERO effect on the app
// runtime (the app never imports it). Every flag defaults OFF, so it is a clean
// no-op unless someone sets a dangerous combo. Only the exact string 'true' enables
// a flag (mirrors isTipsEnabled / isRefundsEnabled etc.).
//
// Usage:  node scripts/check-flags.mjs        (checks process.env)
//         npm run check:flags

const on = (env, k) => env[k] === 'true'

/** The couplings. Flag names verified against the Phase-1 flag audit. */
export const COUPLING_RULES = [
  { flag: 'CLAIMS_ENABLED',              requires: 'REFUNDS_ENABLED',             why: 'un claim approuvé sans REFUNDS = approuvé-mais-non-remboursé (risque chargeback)' },
  // P0-04 (vague 1) : REFUNDS_ENABLED ne gouverne plus que l'OUTIL ADMIN ; l'auto-refund
  // ghost-order du webhook a son propre flag (défaut OFF, peut rester OFF toute la bêta).
  // S'il est allumé, il réutilise le moteur admin → exiger la cohérence du couple.
  { flag: 'GHOST_ORDER_AUTO_REFUND_ENABLED', requires: 'REFUNDS_ENABLED',         why: 'l\'auto-refund ghost-order réutilise le moteur admin (lib/refund) — l\'activer avec le moteur déclaré OFF est incohérent' },
  // P0-25 (vague 1) : la route d'auto-approbation des réclamations (sweep auto_timeout,
  // rembourse SANS humain) a son propre kill-switch, défaut OFF toute la bêta.
  { flag: 'CLAIMS_AUTO_APPROVE_ENABLED',     requires: 'CLAIMS_ENABLED',           why: 'l\'auto-approbation balaye des réclamations — sans le cycle réclamations actif elle n\'a aucun sens (et via CLAIMS⇒REFUNDS elle exige transitivement le moteur)' },
  // ── Rail livreur P4.3 (ÉTAPE 6) — remplace l'ANCIEN couplage fantôme TIPS⇒TIP_PAYOUT_ENABLED
  // (flag no-op supprimé). Le pourboire encaissé (TIPS) ET la course cas B retenue
  // (LOGISTICS_COURIER_ACCRUAL) sont des fonds tiers : sans rail de reversement (LOGISTICS_PAYOUT)
  // ils sont retenus indéfiniment (le bug D-1 de l'audit). Et un reversement exige un compte
  // Connect livreur onboardé (LOGISTICS_CONNECT). Ces dépendances sont RÉELLES (lues au runtime).
  { flag: 'TIPS_ENABLED',                    requires: 'LOGISTICS_PAYOUT_ENABLED',  why: 'pourboire encaissé sans rail de reversement livreur = fonds tiers retenus indéfiniment (D-1)' },
  { flag: 'LOGISTICS_COURIER_ACCRUAL_ENABLED', requires: 'LOGISTICS_PAYOUT_ENABLED', why: 'course cas B retenue (deliveryFee dans l\'application_fee) sans reversement = fonds livreur retenus (D-1 symétrique)' },
  { flag: 'LOGISTICS_PAYOUT_ENABLED',        requires: 'LOGISTICS_CONNECT_ENABLED',  why: 'reversement livreur sans compte Stripe Connect onboardé' },
  { flag: 'FRANCHISE_ROYALTY_ENABLED',   requires: 'FRANCHISE_SETTLEMENT_ENABLED', why: 'royalties accumulées sans reversement au franchiseur' },
  { flag: 'FRANCHISE_SETTLEMENT_ENABLED', requires: 'FRANCHISE_CONNECT_ENABLED',  why: 'settlement franchiseur sans compte Stripe Connect onboardé' },
  { flag: 'CREATOR_PAYOUT_ENABLED',      requires: 'CREATOR_CONNECT_ENABLED',     why: 'payout créateur sans compte Stripe Connect onboardé' },
]

/** Pure — returns { ok, errors[] } for a given env map. */
export function checkFlagCoupling(env) {
  const errors = []
  for (const r of COUPLING_RULES) {
    if (on(env, r.flag) && !on(env, r.requires)) {
      errors.push(`${r.flag}=true exige ${r.requires}=true — ${r.why}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

// CLI runner — guarded so an `import` (tests) never triggers process.exit.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-flags.mjs')) {
  const { ok, errors } = checkFlagCoupling(process.env)
  if (!ok) {
    console.error('❌ Couplage de feature-flags INCOHÉRENT :')
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
  console.log('✅ Couplage de feature-flags cohérent.')
}
