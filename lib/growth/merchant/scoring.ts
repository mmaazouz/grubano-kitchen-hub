// ── Growth / merchant — qualification scoring on top of foundation scores ─────────────
//
// PURE. Reuses the foundation `merchantFitScore` / `merchantIntentScore` and layers two
// B2B-specific signals the foundation (correctly) stays agnostic of:
//
//   1. professionalRelevance: is the CONTACT a plausible professional buyer for the role?
//      Checks that the email domain is NOT a personal mailbox AND, when it matches the
//      prospect's domain, that it belongs to the same company. Null when nothing can be
//      asserted (no email yet).
//
//   2. qualificationScore: a composite 0..100 of fit + intent + relevance, with explicit
//      weights. Deterministic by construction.
//
// Every function returns the full component breakdown next to the number so a dashboard
// can display the reasoning without re-running anything.

import {
  merchantFitScore, merchantIntentScore,
  type MerchantFitInput, type MerchantIntentInput,
  type MerchantFitBreakdown, type MerchantIntentBreakdown,
} from '../scoring'
import type { MerchantProspect, GrowthContact } from '../types'
import { normalizeDomain, splitEmail, isPersonalMailboxDomain } from './normalize'

const CLAMP = (n: number) => Math.max(0, Math.min(100, n))

export interface ProfessionalRelevanceInput {
  prospect: Pick<MerchantProspect, 'domain'>
  contactEmail: string | null
}

export interface ProfessionalRelevanceBreakdown {
  /** 0..100. Null when there is no email to score against. */
  score:        number | null
  components:   {
    hasEmail:                 boolean
    hasCompanyDomain:         boolean
    emailDomainMatchesCompany: boolean
    emailDomainIsPersonal:    boolean
  }
}

/**
 * Score the contact's professional relevance against the prospect company.
 *
 *   - +60 the email domain matches the prospect's company domain
 *   - +30 the prospect has a company domain at all (not a personal mailbox) AND the
 *         contact's email domain is not personal (even if the two don't match — the
 *         contact may use their agency's domain etc.)
 *   - -40 the contact's email domain is a known personal mailbox (gmail etc.) AND the
 *         prospect has a company domain → mismatch
 *   - -10 the prospect itself has no company domain → low-confidence professional context
 *
 * Returns null score (not 0) when there is no email at all: 0 would be falsely confident.
 */
export function professionalRelevanceScore(
  input: ProfessionalRelevanceInput,
): ProfessionalRelevanceBreakdown {
  const emailParts = splitEmail(input.contactEmail)
  const prospectDom = normalizeDomain(input.prospect.domain)
  const prospectHasCompanyDomain =
    prospectDom.ok && !isPersonalMailboxDomain(prospectDom.canonical)

  if (!emailParts) {
    return {
      score: null,
      components: {
        hasEmail: false,
        hasCompanyDomain: prospectHasCompanyDomain,
        emailDomainMatchesCompany: false,
        emailDomainIsPersonal: false,
      },
    }
  }

  const emailDomainIsPersonal = isPersonalMailboxDomain(emailParts.domain)
  const emailDomainMatchesCompany =
    prospectDom.ok && !emailDomainIsPersonal &&
    prospectDom.canonical === emailParts.domain

  let raw = 0
  if (emailDomainMatchesCompany) raw += 60
  if (prospectHasCompanyDomain && !emailDomainIsPersonal) raw += 30
  if (prospectHasCompanyDomain && emailDomainIsPersonal) raw -= 40
  if (!prospectHasCompanyDomain) raw -= 10

  return {
    score: CLAMP(raw),
    components: {
      hasEmail: true,
      hasCompanyDomain: prospectHasCompanyDomain,
      emailDomainMatchesCompany,
      emailDomainIsPersonal,
    },
  }
}

// ── Composite qualification score ──────────────────────────────────────────────────────

export interface QualificationScoreInput {
  fit:      MerchantFitInput
  intent:   MerchantIntentInput
  professionalRelevance: ProfessionalRelevanceInput
  /** Optional overrides for the component weights (must sum to 1 ± 0.001; else fallback). */
  weights?: { fit: number; intent: number; relevance: number }
}

export interface QualificationScoreBreakdown {
  score:        number
  fit:          MerchantFitBreakdown
  intent:       MerchantIntentBreakdown
  relevance:    ProfessionalRelevanceBreakdown
  weightsUsed:  { fit: number; intent: number; relevance: number }
}

const DEFAULT_WEIGHTS = { fit: 0.5, intent: 0.3, relevance: 0.2 }

function normaliseWeights(w: { fit: number; intent: number; relevance: number } | undefined) {
  if (!w) return DEFAULT_WEIGHTS
  const sum = w.fit + w.intent + w.relevance
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.001) return DEFAULT_WEIGHTS
  if (w.fit < 0 || w.intent < 0 || w.relevance < 0) return DEFAULT_WEIGHTS
  return w
}

/**
 * Compose the three sub-scores into a 0..100 qualification score. When professional
 * relevance is null (no email known), its weight is redistributed to fit (not intent):
 * fit is a company-identity measurement, relevance is a contact-identity measurement, so
 * absent-relevance should NOT bump a prospect's engagement score.
 */
export function qualificationScore(input: QualificationScoreInput): QualificationScoreBreakdown {
  const fit       = merchantFitScore(input.fit)
  const intent    = merchantIntentScore(input.intent)
  const relevance = professionalRelevanceScore(input.professionalRelevance)
  const w = normaliseWeights(input.weights)

  const relevanceScore = relevance.score
  let composite: number
  if (relevanceScore === null) {
    const wFit = w.fit + w.relevance
    composite = wFit * fit.score + w.intent * intent.score
  } else {
    composite = w.fit * fit.score + w.intent * intent.score + w.relevance * relevanceScore
  }
  return {
    score: CLAMP(Math.round(composite)),
    fit, intent, relevance,
    weightsUsed: w,
  }
}

// ── Qualification thresholds ───────────────────────────────────────────────────────────

/** Minimum fit score required for a prospect to leave `discovered` for `qualified`. */
export const MIN_FIT_FOR_QUALIFIED = 40
/** Minimum composite score required for a prospect to leave `qualified` for `verified`. */
export const MIN_COMPOSITE_FOR_VERIFIED = 55
/** Minimum composite score for a prospect to be eligible for outbound outreach. */
export const MIN_COMPOSITE_FOR_OUTREACH = 60

/**
 * Classify a lead given a composite score. Pure, deterministic.
 */
export function qualificationBand(composite: number): 'cold' | 'warm' | 'hot' {
  if (composite >= 75) return 'hot'
  if (composite >= 50) return 'warm'
  return 'cold'
}

/**
 * Contact-shaped overload: lets callers pass a GrowthContact when they have one. We
 * never read PII beyond the email domain here — contact names and locale are irrelevant
 * for the deterministic qualification lane.
 */
export function professionalRelevanceForContact(
  prospect: Pick<MerchantProspect, 'domain'>,
  contact: Pick<GrowthContact, 'email'>,
): ProfessionalRelevanceBreakdown {
  return professionalRelevanceScore({ prospect, contactEmail: contact.email })
}
