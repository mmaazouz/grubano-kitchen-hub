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
  // ── NARROWED 2026-09-10 (founder decision, gate §19) — was an ERROR, now a WARNING ────
  // ORIGINAL REASON: « un claim approuvé sans REFUNDS = approuvé-mais-non-remboursé (risque
  // chargeback) » — a customer told their claim was approved, no money following, a chargeback.
  // That reason was sound when the state was INVISIBLE. It no longer is:
  //   • Claims batch 2 added the 'approved_not_driven' money state and surfaced it in the admin
  //     money list, ungated, so an approved-but-unpaid claim is now counted and visible;
  //   • the customer copy no longer promises a delay or says the refund is on its way;
  //   • T-49 adds a durable, ungated FINANCIAL VERIFICATION queue with an alert on entry.
  // Meanwhile the rule FORBADE the only safe way to rehearse the claims workflow: claims open,
  // refunds shut, no money able to move. Keeping it as a hard error would have forced a
  // money-capable rehearsal to test a non-money flow — strictly less safe.
  // It stays a WARNING because the underlying product concern is real for a LIVE beta: shipping
  // claims to real customers with no refund rail behind them is still a bad idea, and an
  // operator should be told. It is no longer an automatic failure.
  // P0-04 (vague 1) : REFUNDS_ENABLED ne gouverne plus que l'OUTIL ADMIN ; l'auto-refund
  // ghost-order du webhook a son propre flag (défaut OFF, peut rester OFF toute la bêta).
  // S'il est allumé, il réutilise le moteur admin → exiger la cohérence du couple.
  { flag: 'GHOST_ORDER_AUTO_REFUND_ENABLED', requires: 'REFUNDS_ENABLED',         why: 'l\'auto-refund ghost-order réutilise le moteur admin (lib/refund) — l\'activer avec le moteur déclaré OFF est incohérent' },
  // P0-25 (vague 1) : la route d'auto-approbation des réclamations (sweep auto_timeout,
  // rembourse SANS humain) a son propre kill-switch, défaut OFF toute la bêta.
  { flag: 'CLAIMS_AUTO_APPROVE_ENABLED',     requires: 'CLAIMS_ENABLED',           why: 'l\'auto-approbation balaye des réclamations — sans le cycle réclamations actif elle n\'a aucun sens (et via CLAIMS⇒REFUNDS elle exige transitivement le moteur)' },
  // P0-27 (vague 1) : l'auto-résolution des PETITES réclamations (auto_small — le dernier
  // chemin qui remboursait sans humain) a désormais son propre verrou fail-safe, défaut
  // OFF toute la bêta ; son plafond CLAIM_AUTO_APPROVE_MAX_CENTS vaut 0 par défaut.
  { flag: 'CLAIM_AUTO_RESOLVE_ENABLED',      requires: 'CLAIMS_ENABLED',           why: 'l\'auto-résolution des petites réclamations (auto_small) rembourse sans validation humaine — sans le cycle réclamations actif elle n\'a aucun sens (et via CLAIMS⇒REFUNDS elle exige transitivement le moteur)' },
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

// ── LOT C — WARNINGS (jamais bloquants : combos LÉGAUX mais à signaler) ────────
// Contrairement aux COUPLING_RULES (exit 1), un WARNING laisse le check passer
// (exit 0) : il signale un réglage risqué que le go-live doit voir en face.
export const WARNING_RULES = [
  // AUDIT FIX (T-49 audit): a lease BEYOND the compiled ceiling is REFUSED, not clamped — the one
  // fail-closed reason an operator is most likely to misread as "open for longer". Say it.
  { when: (env) => { const raw = String(env.CLAIMS_WINDOW_UNTIL || '').trim(); if (!on(env, 'CLAIMS_ENABLED') || !raw) return false; const t = Date.parse(raw); return Number.isFinite(t) && t - Date.now() > 60 * 60 * 1000 },
    msg: 'CLAIMS_WINDOW_UNTIL depasse le plafond compile (60 min) : le bail est REFUSE, pas rogne — la porte reclamations est FERMEE.' },
  { when: (env) => { const raw = String(env.REFUNDS_WINDOW_UNTIL || '').trim(); if (!on(env, 'REFUNDS_ENABLED') || !raw) return false; const t = Date.parse(raw); return Number.isFinite(t) && t - Date.now() > 30 * 60 * 1000 },
    msg: 'REFUNDS_WINDOW_UNTIL depasse le plafond compile (30 min) : le bail est REFUSE, pas rogne — la porte remboursements est FERMEE.' },
  // (T-53) Same shape as T-48, for the claims surface: the flag alone is inert without a live
  // lease. Say it, or an operator will believe a window is open while every call is refused.
  { when: (env) => on(env, 'CLAIMS_ENABLED') && !String(env.CLAIMS_WINDOW_UNTIL || '').trim(),
    msg: 'CLAIMS_ENABLED=true SANS CLAIMS_WINDOW_UNTIL : la porte réclamations est FERMÉE (T-53 — le drapeau seul n autorise rien). Aucune réclamation ne passera.' },
  { when: (env) => { if (!on(env, 'CLAIMS_ENABLED')) return false; const raw = String(env.CLAIMS_WINDOW_UNTIL || '').trim(); if (!raw) return false; const t = Date.parse(raw); return !Number.isFinite(t) || t <= Date.now() },
    msg: 'CLAIMS_ENABLED=true avec un CLAIMS_WINDOW_UNTIL illisible ou EXPIRÉ : la porte réclamations est FERMÉE (fail-closed T-53).' },
  // (gate §19, 2026-09-10) Claims open with refunds shut is the SAFE rehearsal configuration
  // (no money can move: lib/claims triggerClaimRefund returns before the only writer of
  // 'refunding'). It is NOT a good LIVE configuration, so say so instead of failing.
  { when: (env) => on(env, 'CLAIMS_ENABLED') && !on(env, 'REFUNDS_ENABLED'),
    msg: 'CLAIMS_ENABLED=true avec REFUNDS_ENABLED=false : configuration de RÉPÉTITION (aucun argent ne peut bouger). Sûre pour un test borné ; en bêta réelle une réclamation approuvée resterait non remboursée — visible dans la file « Remboursements à traiter », mais non payée.' },
  // (T-48) Le drapeau seul n'autorise PLUS rien : une fenêtre de remboursement est un BAIL
  // qui expire (REFUNDS_ENABLED=true ET REFUNDS_WINDOW_UNTIL valide, ≤ 30 min, revérifié par
  // l'application à chaque appel). Un drapeau vrai sans bail est inerte — c'est le
  // comportement fail-closed voulu, mais il faut le DIRE, sinon un opérateur croira la
  // fenêtre ouverte alors qu'aucun remboursement ne peut passer.
  { when: (env) => on(env, 'REFUNDS_ENABLED') && !String(env.REFUNDS_WINDOW_UNTIL || '').trim(),
    msg:  'REFUNDS_ENABLED=true sans REFUNDS_WINDOW_UNTIL — (T-48) le drapeau seul n\'autorise AUCUN remboursement : la porte reste FERMÉE tant qu\'un bail valide n\'est pas écrit' },
  { when: (env) => on(env, 'REFUNDS_ENABLED') && !!String(env.REFUNDS_WINDOW_UNTIL || '').trim() && !(Date.parse(String(env.REFUNDS_WINDOW_UNTIL)) > Date.now()),
    msg:  'REFUNDS_ENABLED=true avec un REFUNDS_WINDOW_UNTIL expiré ou illisible — (T-48) porte FERMÉE ; nettoyer le drapeau' },
  // (a) Le moteur de remboursement actif sans la trace d'audit admin : chaque
  // remboursement admin devrait laisser sa ligne AdminAuditLog ('refund.run').
  { when: (env) => on(env, 'REFUNDS_ENABLED') && !on(env, 'ADMIN_AUDIT_ENABLED'),
    msg:  'REFUNDS_ENABLED=true sans ADMIN_AUDIT_ENABLED=true — refunds sans trace d\'audit (aucune ligne AdminAuditLog pour les remboursements admin)' },
  // (b) Escape-hatch QA : encaisser sur le compte plateforme quand la destination
  // Connect manque. Toléré UNIQUEMENT pour la QA — jamais avec de l'argent réel.
  { when: (env) => on(env, 'ALLOW_PLATFORM_FALLBACK'),
    msg:  '🔴 ALLOW_PLATFORM_FALLBACK=true — QA uniquement — JAMAIS en production' },
]

/** Pure — returns warnings[] (possibly empty) for a given env map. */
export function checkFlagWarnings(env) {
  return WARNING_RULES.filter((r) => r.when(env)).map((r) => r.msg)
}

// CLI runner — guarded so an `import` (tests) never triggers process.exit.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-flags.mjs')) {
  const { ok, errors } = checkFlagCoupling(process.env)
  if (!ok) {
    console.error('❌ Couplage de feature-flags INCOHÉRENT :')
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
  const warnings = checkFlagWarnings(process.env)
  for (const w of warnings) console.warn('⚠️  ' + w)
  console.log('✅ Couplage de feature-flags cohérent.' + (warnings.length ? ` (${warnings.length} avertissement(s) ci-dessus)` : ''))
}
