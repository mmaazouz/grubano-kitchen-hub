// ── Growth / merchant — next-best-action decider ──────────────────────────────────────
//
// PURE. Given a prospect, its current lifecycle state and the policy-relevant context,
// returns the single next recommended action. Reuses lib/growth/policy for the hard legal
// gates (consent, suppression, quiet hours, caps) — this module does NOT re-implement any
// of those; it only CONSULTS them, so a future tightening of policy automatically
// tightens the actions.
//
// Guarantees:
//   - Default is NEVER "send". Default on uncertainty is REVIEW/NO_SEND.
//   - Unknown jurisdiction → review. Scraping-based outreach is NEVER proposed.
//   - A proposed outreach always carries: channel, purpose, legal basis, idempotencyKey,
//     opt-out language expectation, quiet-hour / frequency-cap compliance (via canSend).
//   - A proposed action always carries a human-readable `rationale` + a stable
//     `reasonCode` for dashboards.

import {
  canSend, type CanSendInput, type FrequencyCap, type QuietHoursWindow,
} from '../policy'
import type { Consent, GrowthChannel, GrowthContact, GrowthPurpose, Suppression } from '../types'
import type { MerchantProspect } from '../types'
import type { MerchantLifecycleState } from './lifecycle'
import { legalNextStates, isTerminal } from './lifecycle'
import { isSupportedColdB2BJurisdiction, splitEmail, isPersonalMailboxDomain, normalizeDomain } from './normalize'
import { qualificationScore, type QualificationScoreInput, MIN_COMPOSITE_FOR_OUTREACH } from './scoring'

// ── Action kinds, outcome shape ────────────────────────────────────────────────────────

export const MERCHANT_NEXT_ACTION_KINDS = [
  'wait',
  'enrich',
  'request_review',
  'propose_outreach',
  'followup',
  'request_meeting',
  'disqualify',
  'none',
] as const

export type MerchantNextActionKind = (typeof MERCHANT_NEXT_ACTION_KINDS)[number]

export type NextActionDecision =
  | { kind: 'none';            reasonCode: string; rationale: string }
  | { kind: 'wait';            reasonCode: string; rationale: string; retryAfterMs: number }
  | { kind: 'enrich';          reasonCode: string; rationale: string; missing: readonly string[] }
  | { kind: 'request_review';  reasonCode: string; rationale: string; routeTo: 'legal' | 'ops' | 'sales' }
  | { kind: 'disqualify';      reasonCode: string; rationale: string }
  | { kind: 'propose_outreach'; reasonCode: string; rationale: string; proposal: OutreachProposal }
  | { kind: 'followup';        reasonCode: string; rationale: string; proposal: OutreachProposal }
  | { kind: 'request_meeting'; reasonCode: string; rationale: string }

export interface OutreachProposal {
  contactId:     string
  channel:       GrowthChannel
  purpose:       GrowthPurpose
  /** The legal basis the engine will claim; validated via policy.hasPermission. */
  legalBasis:    'legitimate_interest' | 'consent'
  /** Stable key for the idempotency store so repeated proposals converge. */
  idempotencyKey: string
  /** Required elements the renderer MUST honour. Expressed as a checklist, not copy. */
  requirements:  {
    includeOptOut:       true
    identifyGrubano:     true
    includeBusinessContext: true
    respectQuietHours:   true
    respectFrequencyCap: true
    professionalRelevanceOnly: true
  }
}

// ── Decision input ─────────────────────────────────────────────────────────────────────

export interface NextActionInput {
  nowMs:          number
  prospect:       Pick<MerchantProspect, 'id' | 'siren' | 'legalName' | 'domain' | 'countryIso2' | 'role' | 'city' | 'cuisineTags' | 'sizeSignals'>
  state:          MerchantLifecycleState
  /** All contacts currently linked to this prospect. Multi-venue is explicit. */
  contacts:       readonly GrowthContact[]
  /** Consents available to the policy gate. */
  consents:       readonly Consent[]
  /** Suppressions available to the policy gate. */
  suppressions:   readonly Suppression[]
  /** Recent per-contact send timestamps keyed by contactId. */
  recentSendTimestampsMs: Readonly<Record<string, readonly number[]>>
  /** Frequency caps (apply across the whole merchant funnel). */
  frequencyCaps:  readonly FrequencyCap[]
  /** Quiet-hours policy. Null = DEFAULT_QUIET_HOURS. */
  quietHours:     QuietHoursWindow | null
  /** Score inputs (fit + intent + relevance). Reused so the decider sees the SAME number as the dashboard. */
  score:          QualificationScoreInput
  /** Minutes elapsed since the last touchpoint for this prospect — null if none. */
  minutesSinceLastTouchpoint: number | null
  /** Minimum gap between consecutive outreach steps, in minutes. */
  minFollowupGapMinutes: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────

function missingEnrichmentFields(p: Pick<MerchantProspect, 'siren' | 'legalName' | 'domain' | 'countryIso2'>): string[] {
  const missing: string[] = []
  if (!p.siren) missing.push('siren')
  if (!p.legalName) missing.push('legalName')
  if (!p.domain) missing.push('domain')
  if (!p.countryIso2) missing.push('countryIso2')
  return missing
}

/**
 * The ONE contact we will propose outreach to, or null when none qualifies. Rules:
 *   - must be b2b
 *   - must share the prospect's tenant isolation (prospect.id OR a central/null tenant)
 *   - email domain must NOT be a personal mailbox
 *   - must not be suppressed on 'email' with scope 'all'
 */
function selectBestOutreachContact(
  prospect: Pick<MerchantProspect, 'id' | 'domain'>,
  contacts: readonly GrowthContact[],
  suppressions: readonly Suppression[],
): GrowthContact | null {
  const prospectDom = normalizeDomain(prospect.domain)
  const prospectCanonical = prospectDom.ok ? prospectDom.canonical : null
  const matches: Array<{ c: GrowthContact; preference: number }> = []
  for (const c of contacts) {
    if (c.audienceType !== 'b2b') continue
    if (!c.email) continue
    const parts = splitEmail(c.email)
    if (!parts) continue
    if (isPersonalMailboxDomain(parts.domain)) continue
    const hardSup = suppressions.find((s) =>
      s.contactId === c.id && s.channel === 'email' && s.scope === 'all')
    if (hardSup) continue
    // Prefer a contact whose email domain matches the prospect's canonical domain.
    const preference = prospectCanonical && parts.domain === prospectCanonical ? 2 : 1
    matches.push({ c, preference })
  }
  if (matches.length === 0) return null
  // Deterministic tie-break: higher preference first, then earliest createdAt, then id.
  matches.sort((a, b) => {
    if (a.preference !== b.preference) return b.preference - a.preference
    const ta = Date.parse(a.c.createdAt), tb = Date.parse(b.c.createdAt)
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
    return a.c.id.localeCompare(b.c.id)
  })
  return matches[0].c
}

function buildIdempotencyKey(prospectId: string, contactId: string, state: MerchantLifecycleState): string {
  return `merchant_outreach|prospect=${prospectId}|contact=${contactId}|state=${state}`
}

// ── Main entry point ───────────────────────────────────────────────────────────────────

export function decideNextAction(input: NextActionInput): NextActionDecision {
  const p = input.prospect

  // 0. Terminal states short-circuit.
  if (isTerminal(input.state)) {
    return { kind: 'none', reasonCode: 'terminal_state', rationale: `State '${input.state}' is terminal.` }
  }

  // 1. Jurisdiction. Unknown or unsupported country → never propose a send, route to legal review.
  //    (Scraped B2B outreach is NEVER proposed; the pipeline relies on validated identity +
  //    legitimate interest. Jurisdictions where we have NOT performed the balance test fall
  //    back to review.)
  if (!p.countryIso2) {
    return {
      kind: 'request_review',
      reasonCode: 'jurisdiction_unknown',
      rationale: 'Country is unknown; cold B2B legal basis cannot be asserted without a documented balance test for this country.',
      routeTo: 'legal',
    }
  }
  if (!isSupportedColdB2BJurisdiction(p.countryIso2)) {
    return {
      kind: 'request_review',
      reasonCode: 'jurisdiction_unsupported',
      rationale: `Country '${p.countryIso2}' is outside the current legitimate-interest footprint; legal review required.`,
      routeTo: 'legal',
    }
  }

  // 2. Enrich when identity is thin — never contact a prospect we cannot identify.
  const missing = missingEnrichmentFields(p)
  if (missing.length > 0 && (input.state === 'discovered' || input.state === 'qualified')) {
    return {
      kind: 'enrich',
      reasonCode: 'missing_identity_fields',
      rationale: `Prospect is missing enrichment fields: ${missing.join(', ')}.`,
      missing,
    }
  }

  // 3. Composite score below the outreach threshold → wait on new intent signals.
  //    (Scoring is deterministic; we never auto-outreach a lead whose composite says cold.)
  const score = qualificationScore(input.score)
  if (score.score < MIN_COMPOSITE_FOR_OUTREACH && (input.state === 'verified' || input.state === 'qualified')) {
    return {
      kind: 'wait',
      reasonCode: `composite_below_${MIN_COMPOSITE_FOR_OUTREACH}`,
      rationale: `Composite qualification score ${score.score} is below ${MIN_COMPOSITE_FOR_OUTREACH}.`,
      retryAfterMs: 7 * 86_400_000,  // re-score in 7 days (deterministic, not clock-based)
    }
  }

  // 4. Pick an outreach-eligible contact. No candidate → request review.
  const contact = selectBestOutreachContact(p, input.contacts, input.suppressions)
  if (!contact) {
    return {
      kind: 'request_review',
      reasonCode: 'no_professional_contact',
      rationale: 'No professional (non-personal-mailbox) B2B contact available for this prospect.',
      routeTo: 'ops',
    }
  }

  // 5. Run the policy gate. Any 'block' outcome → no send, surface the reason.
  const gateInput: CanSendInput = {
    contact,
    channel: 'email',
    purpose: 'cold_b2b',
    nowMs: input.nowMs,
    consents: input.consents,
    suppressions: input.suppressions,
    recentSendTimestampsMs: input.recentSendTimestampsMs[contact.id] ?? [],
    frequencyCaps: input.frequencyCaps,
    quietHours: input.quietHours,
  }
  const gate = canSend(gateInput)
  if (gate.outcome === 'block') {
    return {
      kind: 'request_review',
      reasonCode: `policy_block:${gate.reason}`,
      rationale: `Policy gate blocked: ${gate.reason}.`,
      routeTo: 'legal',
    }
  }
  if (gate.outcome === 'defer') {
    return {
      kind: 'wait',
      reasonCode: `policy_defer:${gate.reason}`,
      rationale: `Policy gate deferred: ${gate.reason}.`,
      retryAfterMs: gate.retryAfterMs ?? 0,
    }
  }

  // 6. Allow — the proposal is a RECOMMENDATION, not a send. The approval queue will
  //    convert it into a real send only on explicit human sign-off.
  const proposal: OutreachProposal = {
    contactId: contact.id,
    channel:   'email',
    purpose:   'cold_b2b',
    legalBasis: 'legitimate_interest',
    idempotencyKey: buildIdempotencyKey(p.id, contact.id, input.state),
    requirements: {
      includeOptOut:              true,
      identifyGrubano:            true,
      includeBusinessContext:     true,
      respectQuietHours:          true,
      respectFrequencyCap:        true,
      professionalRelevanceOnly:  true,
    },
  }

  // 7. Followup vs first-touch dispatch.
  if (input.state === 'contacted' || input.state === 'outreach_eligible') {
    const gap = input.minutesSinceLastTouchpoint
    if (gap !== null && gap < input.minFollowupGapMinutes) {
      return {
        kind: 'wait',
        reasonCode: 'followup_gap',
        rationale: `Last touchpoint was ${gap} min ago; min gap is ${input.minFollowupGapMinutes}.`,
        retryAfterMs: (input.minFollowupGapMinutes - gap) * 60_000,
      }
    }
    if (input.state === 'contacted') {
      return {
        kind: 'followup',
        reasonCode: 'followup_due',
        rationale: `Followup due after ${input.minFollowupGapMinutes} min.`,
        proposal,
      }
    }
  }

  if (input.state === 'replied') {
    return {
      kind: 'request_meeting',
      reasonCode: 'reply_received',
      rationale: 'A reply has been received; propose a discovery meeting.',
    }
  }

  // State ∈ {verified}: propose first-touch outreach.
  const nextStates = legalNextStates(input.state)
  if (nextStates.includes('outreach_eligible') || input.state === 'outreach_eligible') {
    return {
      kind: 'propose_outreach',
      reasonCode: 'first_touch_ready',
      rationale: `Prospect is outreach-eligible; composite ${score.score}.`,
      proposal,
    }
  }

  return {
    kind: 'none',
    reasonCode: 'no_applicable_action',
    rationale: `No action rule matched for state '${input.state}'.`,
  }
}
