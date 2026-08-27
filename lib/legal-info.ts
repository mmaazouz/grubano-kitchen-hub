// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  TODO — À REMPLIR AVANT LA PROD (Mohammed)                                  ║
// ║  Source UNIQUE des données société + hébergeur affichées dans les pages     ║
// ║  légales (/legal/*). Tant qu'un seul champ requis garde son placeholder     ║
// ║  "[[À COMPLÉTER — …]]", isLegalInfoComplete() renvoie false et un bandeau    ║
// ║  « Mentions légales en cours de finalisation » s'affiche en haut des pages. ║
// ║  Quand TOUT est rempli, le bandeau disparaît automatiquement.               ║
// ║                                                                            ║
// ║  ⚠️ CE N'EST PAS UN AVIS JURIDIQUE. La structure ci-dessous est un MODÈLE   ║
// ║  standard à faire valider par un juriste avant publication. NE PAS inventer ║
// ║  les faits : remplacer chaque placeholder par la valeur réelle vérifiée.    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Prefix that marks an unfilled placeholder value. isLegalInfoComplete() treats
 * any REQUIRED field whose value starts with this prefix as "not yet filled".
 */
export const LEGAL_PLACEHOLDER_PREFIX = '[[À COMPLÉTER'

export interface LegalEditor {
  /** Raison sociale (dénomination de la société éditrice). */
  raisonSociale: string
  /** Forme juridique (SAS, SARL, EURL, auto-entrepreneur…). */
  formeJuridique: string
  /** Capital social (ex. "10 000 €"). */
  capitalSocial: string
  /** SIREN (9 chiffres). */
  siren: string
  /** SIRET du siège (14 chiffres). */
  siret: string
  /** Ville du greffe d'immatriculation au RCS. */
  rcsVille: string
  /** N° de TVA intracommunautaire — OPTIONNEL (ne bloque pas la complétude). */
  tvaIntra: string
  /** Adresse complète du siège social. */
  siegeAdresse: string
  /** E-mail de contact public. */
  email: string
  /** Téléphone — OPTIONNEL (ne bloque pas la complétude). */
  telephone: string
  /** Directeur / Directrice de la publication. */
  directeurPublication: string
}

export interface LegalHost {
  /** Nom / raison sociale de l'hébergeur. */
  nom: string
  /** Adresse postale complète de l'hébergeur. */
  adresse: string
  /** Contact de l'hébergeur (téléphone et/ou e-mail / URL). */
  contact: string
}

export interface LegalMediation {
  /** Nom du médiateur de la consommation agréé. */
  nom: string
  /** Site / URL de saisine du médiateur. */
  url: string
  /** Adresse postale du médiateur. */
  adresse: string
}

export interface LegalPrivacy {
  /** DPO / contact RGPD (e-mail ou adresse dédiée aux demandes de droits). */
  dpoContact: string
  /** Durée de conservation des comptes / données d'identité. */
  retentionAccount: string
  /** Durée de conservation des commandes / réservations / factures. */
  retentionOrders: string
  /** Transferts hors UE + garanties (ex. clauses contractuelles types). "Néant"
   *  si aucun, sinon préciser (un sous-traitant LLM peut être hors UE). */
  nonEuTransfer: string
}

export interface LegalInfo {
  editor: LegalEditor
  host: LegalHost
  mediation: LegalMediation
  privacy: LegalPrivacy
}

// ── Sous-traitants / destinataires (RGPD) ─────────────────────────────────────
// Liste FACTUELLE des tiers qui reçoivent des données, déduite du code + des
// dépendances. `confirmed:true` = identité certaine (SDK/import présent) → nom
// réel ; `confirmed:false` = à confirmer → placeholder. `roleKey` mappe vers
// l'i18n legal.privacy.sub_<roleKey>. L'hébergeur n'est PAS listé ici : il vient
// de LEGAL_INFO.host.nom (placeholder, déjà affiché ailleurs).
export interface LegalSubprocessor {
  /** Nom réel si confirmé, sinon placeholder "[[À COMPLÉTER — …]]". */
  name: string
  /** Suffixe de clé i18n pour le rôle : legal.privacy.sub_<roleKey>. */
  roleKey: string
  /** true = identité certaine d'après le code/les dépendances. */
  confirmed: boolean
}

export const LEGAL_SUBPROCESSORS: LegalSubprocessor[] = [
  { name: 'Stripe',                              roleKey: 'payment',  confirmed: true },
  { name: 'Anthropic (Claude)',                  roleKey: 'llm',      confirmed: true },
  { name: 'recherche-entreprises.api.gouv.fr',   roleKey: 'registry', confirmed: true },
  { name: 'Google, Apple',                       roleKey: 'oauth',    confirmed: true },
  { name: '[[À COMPLÉTER — fournisseur e-mail / SMTP]]', roleKey: 'email', confirmed: false },
]

// ── Cookies réellement déposés (inventaire factuel) ───────────────────────────
// Noms techniques = constantes (pas des placeholders). Durée + finalité affichées
// via i18n (legal.cookies.dur_<durationKey> / legal.cookies.purpose_<purposeKey>).
// AUCUN cookie publicitaire / analytics tiers (aucun CMP dans l'app à ce jour).
// Inventaire complété (Lot 7 closed beta) : cookies NextAuth de production
// (__Secure-/__Host- prefixes), grubano_chef (attribution page chef, 24 h) et les
// cookies Stripe (__stripe_mid/__stripe_sid — posés par js.stripe.com uniquement
// lors de l'affichage d'un module de paiement, prévention de la fraude).
// ⚠️ CAVEAT catégorisation : les nouvelles entrées reprennent la catégorie
// 'necessary' des entrées existantes par COHÉRENCE d'affichage — la qualification
// juridique finale (nécessaire vs mesure/attribution) revient au conseil
// juridique avant la sortie de bêta. Les cookies d'attribution (grubano_ref /
// grubano_chef) sont par ailleurs gatés OFF pendant la bêta
// (ATTRIBUTION_COOKIES_ENABLED, cf. lib/attribution-cookies.ts).
export interface LegalCookie {
  name: string
  durationKey: string
  purposeKey: string
  /** 'necessary' (strictement nécessaire) — aucune catégorie marketing à ce jour. */
  categoryKey: string
}

export const LEGAL_COOKIES: LegalCookie[] = [
  { name: 'NEXT_LOCALE',                        durationKey: 'oneYear',    purposeKey: 'locale',   categoryKey: 'necessary' },
  { name: '__Secure-next-auth.session-token',   durationKey: 'thirtyDays', purposeKey: 'session',  categoryKey: 'necessary' },
  { name: '__Host-next-auth.csrf-token',        durationKey: 'session',    purposeKey: 'csrf',     categoryKey: 'necessary' },
  { name: '__Secure-next-auth.callback-url',    durationKey: 'session',    purposeKey: 'callback', categoryKey: 'necessary' },
  { name: 'grubano_estab',                      durationKey: 'oneYear',    purposeKey: 'estab',    categoryKey: 'necessary' },
  { name: 'grubano_ref',                        durationKey: 'ninetyDays', purposeKey: 'ref',      categoryKey: 'necessary' },
  { name: 'grubano_chef',                       durationKey: 'oneDay',     purposeKey: 'chef',     categoryKey: 'necessary' },
  { name: '__stripe_mid / __stripe_sid',        durationKey: 'stripe',     purposeKey: 'stripe',   categoryKey: 'necessary' },
]

// ── LES VALEURS — placeholders jusqu'à la prod (sauf faits confirmés) ─────────
// Hébergeur : FAIT CONFIRMÉ (fourni par l'orchestrateur closed beta) — o2switch,
// 222-224 Boulevard Gustave Flaubert, 63000 Clermont-Ferrand. Seul host.contact
// reste en placeholder : Mohammed doit confirmer le canal de contact à publier.
export const LEGAL_INFO: LegalInfo = {
  editor: {
    raisonSociale:        '[[À COMPLÉTER — raison sociale de la société]]',
    formeJuridique:       '[[À COMPLÉTER — forme juridique (SAS, SARL…)]]',
    capitalSocial:        '[[À COMPLÉTER — capital social]]',
    siren:                '[[À COMPLÉTER — SIREN (9 chiffres)]]',
    siret:                '[[À COMPLÉTER — SIRET du siège (14 chiffres)]]',
    rcsVille:             '[[À COMPLÉTER — ville du greffe RCS]]',
    tvaIntra:             '[[À COMPLÉTER — TVA intracommunautaire (optionnel)]]',
    siegeAdresse:         '[[À COMPLÉTER — adresse du siège social]]',
    email:                '[[À COMPLÉTER — e-mail de contact]]',
    telephone:            '[[À COMPLÉTER — téléphone (optionnel)]]',
    directeurPublication: '[[À COMPLÉTER — directeur/directrice de la publication]]',
  },
  host: {
    nom:     'o2switch',
    adresse: '222-224 Boulevard Gustave Flaubert, 63000 Clermont-Ferrand',
    contact: '[[À COMPLÉTER — contact de l’hébergeur]]',
  },
  mediation: {
    nom:     '[[À COMPLÉTER — nom du médiateur de la consommation]]',
    url:     '[[À COMPLÉTER — URL de saisine du médiateur]]',
    adresse: '[[À COMPLÉTER — adresse du médiateur]]',
  },
  privacy: {
    dpoContact:       '[[À COMPLÉTER — contact DPO / délégué à la protection des données]]',
    retentionAccount: '[[À COMPLÉTER — durée de conservation des comptes]]',
    retentionOrders:  '[[À COMPLÉTER — durée de conservation des commandes/factures]]',
    nonEuTransfer:    '[[À COMPLÉTER — transferts hors UE + garanties (ou « Néant »)]]',
  },
}

/** True when a value is still an unfilled placeholder. */
export function isPlaceholder(value: string): boolean {
  return typeof value !== 'string' || value.trim() === '' || value.startsWith(LEGAL_PLACEHOLDER_PREFIX)
}

// REQUIRED fields that must all be filled for the legal pages to be publishable.
// tvaIntra and telephone are deliberately EXCLUDED (legally optional → they never
// block completion, even if left as a placeholder).
function requiredValues(info: LegalInfo = LEGAL_INFO): string[] {
  const { editor: e, host: h, mediation: m, privacy: p } = info
  return [
    e.raisonSociale, e.formeJuridique, e.capitalSocial, e.siren, e.siret,
    e.rcsVille, e.siegeAdresse, e.email, e.directeurPublication,
    h.nom, h.adresse, h.contact,
    m.nom, m.url, m.adresse,
    // Privacy facts (RGPD) — added by Agent 35 so the banner also reflects the
    // privacy page; DPO contact, retention durations and the non-EU transfer note.
    p.dpoContact, p.retentionAccount, p.retentionOrders, p.nonEuTransfer,
  ]
}

/**
 * Returns false while AT LEAST one required field is still a placeholder (or
 * empty) — drives the "en cours de finalisation" banner across ALL legal pages
 * (mentions légales, confidentialité, cookies). Returns true only once every
 * required company / host / mediation / privacy fact has been filled in.
 */
export function isLegalInfoComplete(info: LegalInfo = LEGAL_INFO): boolean {
  return requiredValues(info).every((v) => !isPlaceholder(v))
}
