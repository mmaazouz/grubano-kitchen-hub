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

export interface LegalInfo {
  editor: LegalEditor
  host: LegalHost
  mediation: LegalMediation
}

// ── LES VALEURS — toutes en placeholder jusqu'à la prod ──────────────────────
// Indice (NON contraignant) : l'app tourne sur o2switch — mais NE PAS présumer
// l'hébergeur ici ; Mohammed confirmera et remplira les coordonnées exactes.
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
    nom:     '[[À COMPLÉTER — nom de l’hébergeur]]',
    adresse: '[[À COMPLÉTER — adresse de l’hébergeur]]',
    contact: '[[À COMPLÉTER — contact de l’hébergeur]]',
  },
  mediation: {
    nom:     '[[À COMPLÉTER — nom du médiateur de la consommation]]',
    url:     '[[À COMPLÉTER — URL de saisine du médiateur]]',
    adresse: '[[À COMPLÉTER — adresse du médiateur]]',
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
  const { editor: e, host: h, mediation: m } = info
  return [
    e.raisonSociale, e.formeJuridique, e.capitalSocial, e.siren, e.siret,
    e.rcsVille, e.siegeAdresse, e.email, e.directeurPublication,
    h.nom, h.adresse, h.contact,
    m.nom, m.url, m.adresse,
  ]
}

/**
 * Returns false while AT LEAST one required field is still a placeholder (or
 * empty) — drives the "en cours de finalisation" banner. Returns true only once
 * every required company / host / mediation fact has been filled in.
 */
export function isLegalInfoComplete(info: LegalInfo = LEGAL_INFO): boolean {
  return requiredValues(info).every((v) => !isPlaceholder(v))
}
