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
  // ── P0-06 — racines de RÔLE (doctrine Q8). Les 4 rôles masqués ont désormais un
  // flag racine (404 serveur quand OFF). Toute capacité d'un rôle exige le rôle :
  // une capacité ON avec le rôle OFF = surface qui répond alors que le rôle
  // « n'existe pas » côté serveur (incohérence de doctrine ; pour les rails
  // argent : des fonds qui bougent pour un rôle indisponible).
  { flag: 'CREATOR_CONNECT_ENABLED',              requires: 'CREATOR_ENABLED',   why: 'onboarding Connect créateur alors que le rôle créateur est masqué (404)' },
  { flag: 'CREATOR_PAYOUT_ENABLED',               requires: 'CREATOR_ENABLED',   why: 'payout créateur alors que le rôle créateur est masqué (404)' },
  { flag: 'SUPPLIER_CONNECT_ENABLED',             requires: 'SUPPLIER_ENABLED',  why: 'paiements B2B fournisseur alors que le rôle fournisseur est masqué (404, webhook compris)' },
  { flag: 'FRANCHISE_CONNECT_ENABLED',            requires: 'FRANCHISE_ENABLED', why: 'onboarding Connect franchiseur alors que le rôle franchise est masqué (404)' },
  { flag: 'FRANCHISE_ROYALTY_ENABLED',            requires: 'FRANCHISE_ENABLED', why: 'royalties accumulées pour un rôle franchise masqué (404)' },
  { flag: 'FRANCHISE_POS_TAGGING_ENABLED',        requires: 'FRANCHISE_ENABLED', why: 'attribution POS des commandes pour un rôle franchise masqué (404)' },
  { flag: 'LOGISTICS_CONNECT_ENABLED',            requires: 'LOGISTICS_ENABLED', why: 'onboarding Connect livreur alors que le rôle livreur est masqué (404)' },
  { flag: 'LOGISTICS_MISSIONS_ENABLED',           requires: 'LOGISTICS_ENABLED', why: 'missions livreur alors que le rôle livreur est masqué (404)' },
  { flag: 'LOGISTICS_COURIER_ACTIVATION_ENABLED', requires: 'LOGISTICS_ENABLED', why: 'activation de comptes livreurs alors que le rôle livreur est masqué (404)' },
  { flag: 'LOGISTICS_AVAILABILITY_ENABLED',       requires: 'LOGISTICS_ENABLED', why: 'statut en ligne livreur alors que le rôle livreur est masqué (404)' },
  { flag: 'LOGISTICS_TRACKING_ENABLED',           requires: 'LOGISTICS_ENABLED', why: 'géoloc livreur (capture) alors que le rôle livreur est masqué (404)' },
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
