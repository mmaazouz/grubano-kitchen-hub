// lib/cgv-version.ts — PRE-L11 (founder arbitration T-79): what version of the terms this is, and whether it
// is in force at all.
//
// THE DECISION, VERBATIM. « VERSION CGV STAGING : 0.1-beta · DATE DE MISE À JOUR : 2026-09-28 · Mais : NE PAS
// inventer une date d'entrée en vigueur juridique. Tant que CGV_COUNSEL_REVIEWED = false le contrat doit
// distinguer lastUpdated / version / effectiveDate = null et rendre clairement le sens « Projet / version bêta
// — non entrée en vigueur ». »
//
// SO THE THREE FACTS ARE THREE FIELDS, and the third is `null`. That is the whole point: a page that printed
// one date would invite the reader — and us — to treat it as the date the terms took effect. `lastUpdated` says
// when the TEXT changed; `version` names WHICH text; `effectiveDate` says whether it BINDS anyone, and until a
// lawyer has read it the honest value is « not yet ». A date is the easiest legal fact to invent by accident,
// because every document has one.
//
// PRODUCTION GATE. `cgvProductionReadiness()` is the single answer to « may these terms be treated as ready for
// production? », and it answers NO while any of three things holds: counsel has not reviewed the text, there is
// no effective date, or a legal fact the existing contract requires is still a placeholder. It is deliberately
// impossible to satisfy today, and the reasons are enumerated rather than collapsed into a boolean so an
// operator reading the refusal knows what is missing.
//
// NOT A LEGAL OPINION. Nothing here judges whether the text is CORRECT — only whether the repository holds the
// facts and the sign-off the publication contract requires. The review itself stays a human obligation.

import { CGV_COUNSEL_REVIEWED, isLegalInfoComplete, LEGAL_INFO, isPlaceholder } from '@/lib/legal-info'

/** The version of the terms this build serves. A name, not a number line: staging is explicitly a beta. */
export const CGV_VERSION = '0.1-beta'

/** When the TEXT last changed. ISO date, no time: a legal document changes on a day, not at an instant. */
export const CGV_LAST_UPDATED = '2026-09-28'

/**
 * When the terms ENTER INTO FORCE — `null` until counsel has reviewed them and the founder sets it.
 *
 * Typed as `string | null` and shipped `null` on purpose: a real date here is a legal fact, and the founder's
 * ruling is that it « ne sera renseignée qu'avant production, après validation juridique ».
 */
export const CGV_EFFECTIVE_DATE: string | null = null

/** Everything a surface needs to describe the state of the terms, without deciding anything itself. */
export interface CgvState {
  version: string
  lastUpdated: string
  effectiveDate: string | null
  /** true only when the terms are in force: an effective date exists AND counsel has reviewed the text. */
  inForce: boolean
}

export function cgvState(): CgvState {
  return {
    version: CGV_VERSION,
    lastUpdated: CGV_LAST_UPDATED,
    effectiveDate: CGV_EFFECTIVE_DATE,
    // BOTH conditions. An effective date set without a review would be a date on an unreviewed document, which
    // is the failure mode this exists to prevent; a review without a date binds nobody.
    inForce: CGV_EFFECTIVE_DATE !== null && CGV_COUNSEL_REVIEWED,
  }
}

/** Why the terms are not production-ready. Each value is a MISSING FACT, never a judgement of the text. */
export type CgvProductionBlocker =
  /** No lawyer has reviewed `legal.cgv.*`. */
  | 'counsel_not_reviewed'
  /** No date of entry into force — the terms bind nobody. */
  | 'no_effective_date'
  /** At least one company / host / mediation / privacy fact the legal pages require is still a placeholder. */
  | 'legal_info_incomplete'
  /** The consumer mediator is not configured — a French consumer-terms requirement the repo cannot fake. */
  | 'no_mediator'

export interface CgvProductionReadiness {
  /** true only when NOTHING is missing. Today, unreachable by construction. */
  ready: boolean
  blockers: CgvProductionBlocker[]
}

/**
 * THE PRODUCTION GATE, enumerated.
 *
 * `no_mediator` is listed separately from `legal_info_incomplete` although `isLegalInfoComplete()` already
 * covers the mediation fields: the founder's ruling names it specifically (« Si aucun médiateur réel n'est
 * configuré : ne pas en inventer ; afficher/traiter le champ comme non renseigné ; conserver la production
 * bloquée »), and a blocker that is only implied by another is a blocker that gets waived by accident.
 */
export function cgvProductionReadiness(): CgvProductionReadiness {
  const blockers: CgvProductionBlocker[] = []
  if (!CGV_COUNSEL_REVIEWED) blockers.push('counsel_not_reviewed')
  if (CGV_EFFECTIVE_DATE === null) blockers.push('no_effective_date')
  if (!isLegalInfoComplete()) blockers.push('legal_info_incomplete')
  const m = LEGAL_INFO.mediation
  if (isPlaceholder(m.nom) || isPlaceholder(m.url) || isPlaceholder(m.adresse)) blockers.push('no_mediator')
  return { ready: blockers.length === 0, blockers }
}
