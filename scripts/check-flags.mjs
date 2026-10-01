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

import { readFileSync } from 'node:fs'

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
  // D′ L1 (spec v2 §3.1, S-13) : l'INTAKE (dépôt de nouvelles réclamations) n'a aucun sens sans la SURFACE
  // (la fonctionnalité). INTAKE='true' sans SURFACE='true' n'ouvre RIEN dans l'application (fail-closed),
  // mais c'est une configuration incohérente : ERREUR. Aucun couplage à REFUNDS_ENABLED.
  { flag: 'CLAIMS_INTAKE_ENABLED',           requires: 'CLAIMS_SURFACE_ENABLED',   why: 'le dépôt de réclamations (intake) sans la surface réclamations (listes, décisions) n’ouvre rien — configuration incohérente' },
  // P0-25 (vague 1) : la route d'auto-approbation des réclamations (sweep auto_timeout,
  // rembourse SANS humain) a son propre kill-switch, défaut OFF toute la bêta.
  { flag: 'CLAIMS_AUTO_APPROVE_ENABLED',     requires: 'CLAIMS_ENABLED',           why: 'l\'auto-approbation balaye des réclamations — sans le cycle réclamations actif elle n\'a aucun sens' },
  // P0-27 (vague 1) : l'auto-résolution des PETITES réclamations (auto_small — le dernier
  // chemin qui remboursait sans humain) a désormais son propre verrou fail-safe, défaut
  // OFF toute la bêta ; son plafond CLAIM_AUTO_APPROVE_MAX_CENTS vaut 0 par défaut.
  { flag: 'CLAIM_AUTO_RESOLVE_ENABLED',      requires: 'CLAIMS_ENABLED',           why: 'l\'auto-résolution des petites réclamations (auto_small) rembourse sans validation humaine — sans le cycle réclamations actif elle n\'a aucun sens' },
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

// ── T-123 — ARBITRAGE FONDATEUR (2026-09-28) : LES DEUX RAILS MONEY-OUT SONT EXIGÉS FALSE ─────
// « Oui : pendant la bêta, check:flags doit exiger explicitement false pour
//   FRANCHISE_SETTLEMENT_ENABLED et CREATOR_PAYOUT_ENABLED. Je préfère un build qui échoue si
//   l'un de ces rails money-OUT est accidentellement ouvert plutôt qu'une simple surveillance
//   qui laisse compiler. »
//
// CE QUE CES DEUX CLÉS GARDENT, et pourquoi elles seules. Ce sont les uniques serrures sur les deux
// écritures Stripe du dépôt qui PAIENT un tiers au lieu de récupérer chez lui :
//   FRANCHISE_SETTLEMENT_ENABLED → transfers.create (lib/franchise-settlement.ts, règlement franchiseur)
//   CREATOR_PAYOUT_ENABLED       → transfers.create (lib/creator-payout.ts, versement partenaire)
// Un remboursement rend de l'argent au client ; une inversion récupère de l'argent. Ces deux-là seules
// FONT SORTIR des fonds vers un bénéficiaire. C'est le critère, pas « c'est un drapeau argent ».
//
// POURQUOI CETTE LISTE N'EST PAS `MONEY_FLAGS_MUST_BE_FALSE` (scripts/server/env-provenance.js).
// Cette autre liste (14 clés) est la posture RUNTIME que le préflight serveur asserte avant une
// répétition, et elle contient REFUNDS_ENABLED et CLAIMS_ENABLED. Les exiger false ICI rendrait TOUTE
// répétition bornée impossible à compiler — alors qu'un bail REFUNDS de 30 min est précisément le
// mécanisme prévu, décrit par les WARNING_RULES ci-dessous comme une configuration légitime. Les deux
// listes répondent donc à deux questions différentes au même mot « argent », et les fusionner
// casserait le rail que l'autre existe pour encadrer. Elles restent séparées EXPRÈS.
//
// CE QUE CETTE RÈGLE PEUT ET NE PEUT PAS VOIR — à dire, sinon elle rassure à tort. `check:flags` lit
// l'environnement du BUILD. La valeur qui compte en production vit dans le `.env.local` DU SERVEUR,
// que la CI n'écrit jamais (voir deploy-staging.yml : « .env.local is INTENTIONALLY NOT written »).
// Cette règle attrape donc : une clé posée dans l'environnement du runner, dans un fichier env local,
// ou dans une variable de dépôt. Elle ne peut PAS voir le `.env.local` du serveur ni le sélecteur
// Node.js de cPanel — c'est le travail de phase2-preflight.js (T-119). Les deux sont
// COMPLÉMENTAIRES, jamais redondants, et aucun ne dispense de l'autre.
export const BETA_MONEY_OUT_MUST_BE_FALSE = [
  {
    flag: 'FRANCHISE_SETTLEMENT_ENABLED',
    why:  'seule serrure sur transfers.create du règlement franchiseur (lib/franchise-settlement.ts) — un rail qui PAIE un tiers',
  },
  {
    flag: 'CREATOR_PAYOUT_ENABLED',
    why:  'seule serrure sur transfers.create du versement partenaire (lib/creator-payout.ts) — un rail qui PAIE un tiers',
  },
]

/** Pure — returns { ok, errors[] }. A flag ABSENT is OFF (`on` compares to the exact string 'true'),
 *  so the normal state — the key not set at all — passes without a special case. Only an explicit
 *  'true' fails. `sourceOf` is optional and only decorates the message with where the value came from. */
export function checkMoneyOutFrozen(env, sourceOf) {
  const errors = []
  for (const r of BETA_MONEY_OUT_MUST_BE_FALSE) {
    if (!on(env, r.flag)) continue
    const src = sourceOf && sourceOf(r.flag)
    errors.push(
      `${r.flag}=true est INTERDIT pendant la bêta (arbitrage fondateur T-123)`
      + (src ? ` [source : ${src}]` : '')
      + ` — ${r.why}. Fermez-le avant de construire ; ce n'est pas un avertissement.`,
    )
  }
  return { ok: errors.length === 0, errors }
}

// ── LOT C — WARNINGS (jamais bloquants : combos LÉGAUX mais à signaler) ────────
// Contrairement aux COUPLING_RULES (exit 1), un WARNING laisse le check passer
// (exit 0) : il signale un réglage risqué que le go-live doit voir en face.
export const WARNING_RULES = [
  // D′ L1 (spec v2 §3.1) : sous CLAIMS_SURFACE_ENABLED='true', le bail legacy (CLAIMS_ENABLED + CLAIMS_WINDOW_UNTIL,
  // répétitions Mode A/B uniquement) est INERTE. Le laisser à true à côté des flags produit est un résidu de
  // répétition : à signaler, jamais bloquant.
  { when: (env) => on(env, 'CLAIMS_SURFACE_ENABLED') && on(env, 'CLAIMS_ENABLED'),
    msg:  'CLAIMS_SURFACE_ENABLED=true avec CLAIMS_ENABLED=true : le bail legacy (répétitions Mode A/B) est INERTE sous les flags produit — résidu de répétition à nettoyer' },
  // D′ L1 : seul le string exact 'true' active un flag — 'TRUE', '1' ou '' sont OFF (fail-closed). Le dire.
  { when: (env) => ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'].some((k) => env[k] !== undefined && env[k] !== 'true' && env[k] !== 'false' && env[k] !== ''),
    msg:  'CLAIMS_SURFACE_ENABLED / CLAIMS_INTAKE_ENABLED : seule la chaîne exacte « true » active un flag — toute autre valeur (« TRUE », « 1 », …) est OFF' },
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
    msg: 'CLAIMS_ENABLED=true avec REFUNDS_ENABLED=false : configuration de RÉPÉTITION (aucun argent ne peut bouger). Sûre pour un test borné ; en bêta réelle une réclamation approuvée resterait non remboursée — visible dans « Remboursements à traiter » tant que les réclamations sont ouvertes, puis dans « Vérification financière requise » une fois le bail fermé, mais non payée.' },
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

/* T-123 — the CLI also looks at the LOCAL env files, for the two required-false keys ONLY.
   Reading only `process.env` would make the rule almost decorative: nobody exports
   CREATOR_PAYOUT_ENABLED in a shell before `npm run build`; they write it in `.env.local`. In CI the
   files are absent, so this is a no-op there (and CI is covered by the runner's own env). It can only
   ever ADD an error — never remove one — and it never reads a value for any other key, so no other
   rule's input changes. The source is reported, because « which file opened this rail » is the first
   question an operator will ask. */
const ENV_FILES = ['.env.local', '.env.production.local', '.env.production', '.env']
function readMoneyOutFromFiles() {
  const found = {}
  for (const f of ENV_FILES) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const { flag } of BETA_MONEY_OUT_MUST_BE_FALSE) {
      // last assignment wins inside one file, first FILE wins across files (Next's own precedence)
      const m = text.split(/\r?\n/).filter((l) => new RegExp('^\\s*(?:export\\s+)?' + flag + '\\s*=').test(l)).pop()
      if (m === undefined || found[flag] !== undefined) continue
      const raw = m.slice(m.indexOf('=') + 1).trim().replace(/^['\"]|['\"]$/g, '')
      found[flag] = { value: raw, file: f }
    }
  }
  return found
}

// CLI runner — guarded so an `import` (tests) never triggers process.exit.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/check-flags.mjs')) {
  /* T-123 — THE MONEY-OUT FREEZE RUNS FIRST, and the order is the point.
     Measured while writing it: with `FRANCHISE_SETTLEMENT_ENABLED=true` and its Connect counterpart
     absent, the COUPLING rule fired first and printed « exige FRANCHISE_CONNECT_ENABLED=true » — advice
     that invites an operator to open MORE flags to go green, when the correct answer is that this rail
     must stay shut. A refusal that can be satisfied by opening a second money flag is worse than no
     refusal. The freeze is unconditional, cannot be satisfied that way, and therefore speaks first. */
  const fromFiles = readMoneyOutFromFiles()
  const moneyOutEnv = { ...process.env }
  for (const [k, v] of Object.entries(fromFiles)) {
    if (process.env[k] === undefined) moneyOutEnv[k] = v.value
  }
  const frozen = checkMoneyOutFrozen(moneyOutEnv, (flag) =>
    process.env[flag] !== undefined ? 'process.env' : (fromFiles[flag] ? fromFiles[flag].file : null))
  if (!frozen.ok) {
    console.error('❌ RAIL MONEY-OUT OUVERT — build refusé (arbitrage fondateur T-123) :')
    for (const e of frozen.errors) console.error('  - ' + e)
    console.error('  → Ne satisfaites PAS ce refus en ouvrant un autre drapeau : refermez celui-ci.')
    process.exit(1)
  }
  const { ok, errors } = checkFlagCoupling(process.env)
  if (!ok) {
    console.error('❌ Couplage de feature-flags INCOHÉRENT :')
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
  const warnings = checkFlagWarnings(process.env)
  for (const w of warnings) console.warn('⚠️  ' + w)
  console.log('✅ Couplage de feature-flags cohérent · rails money-OUT gelés (FRANCHISE_SETTLEMENT_ENABLED, CREATOR_PAYOUT_ENABLED).' + (warnings.length ? ` (${warnings.length} avertissement(s) ci-dessus)` : ''))
}
