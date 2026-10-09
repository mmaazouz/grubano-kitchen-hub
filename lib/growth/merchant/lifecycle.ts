// ── Growth / merchant — qualification lifecycle state machine ─────────────────────────
//
// PURE. Deterministic transitions, no I/O. The B2B pipeline moves a prospect through
// explicit stages; this module declares the ONLY legal transitions and the guards each
// transition requires.
//
// States (strict ordering with branches):
//
//   discovered
//      │
//      ▼  (guard: minimum identity + minimum fit score)
//   qualified
//      │
//      ▼  (guard: verified identity: SIREN + legal name OR confirmed company domain)
//   verified
//      │
//      ▼  (guard: supported jurisdiction + composite score threshold + at least one
//           contact with a professional email + no suppression)
//   outreach_eligible
//      │
//      ▼  (external: policy.canSend == allow AND a touchpoint has been dispatched)
//   contacted
//      │
//      ▼  (external: inbound reply received)
//   replied
//      │
//      ▼  (external: meeting scheduled)
//   meeting
//      │
//      ├── won  → active   (external: operator onboarding completed)
//      └── lost
//
// `active` is the ONLY terminal success state. `lost` is terminal failure. All other
// transitions are reversible only via `disqualify` which lands on `lost`.
//
// Illegal transitions return { ok: false, reason: 'illegal_transition:<from>→<to>' }
// without mutating anything. Guards return a REASON when they fail, never silently refuse.

import type { MerchantProspect } from '../types'
import { normalizeSiren, normalizeDomain, isPersonalMailboxDomain, isSupportedColdB2BJurisdiction } from './normalize'
import { MIN_FIT_FOR_QUALIFIED, MIN_COMPOSITE_FOR_VERIFIED, MIN_COMPOSITE_FOR_OUTREACH } from './scoring'

export const MERCHANT_LIFECYCLE_STATES = [
  'discovered',
  'qualified',
  'verified',
  'outreach_eligible',
  'contacted',
  'replied',
  'meeting',
  'won',
  'lost',
  'active',
] as const

export type MerchantLifecycleState = (typeof MERCHANT_LIFECYCLE_STATES)[number]

/** Legal forward transitions. Every entry is one-way; a backward move needs `disqualify`. */
const ALLOWED_TRANSITIONS: Readonly<Record<MerchantLifecycleState, readonly MerchantLifecycleState[]>> = {
  discovered:        ['qualified', 'lost'],
  qualified:         ['verified', 'lost'],
  verified:          ['outreach_eligible', 'lost'],
  outreach_eligible: ['contacted', 'lost'],
  contacted:         ['replied', 'lost'],
  replied:           ['meeting', 'lost'],
  meeting:           ['won', 'lost'],
  won:               ['active', 'lost'],
  active:            [],
  lost:              [],
}

export interface TransitionGuardInput {
  prospect:      Pick<MerchantProspect, 'siren' | 'legalName' | 'domain' | 'countryIso2'>
  fitScore:      number
  compositeScore: number
  /** True if at least one contact has a professional (non-personal-mailbox) email. */
  hasProfessionalContact: boolean
  /** True iff NO suppression blocks every channel this prospect's contacts use. */
  hasAnyReachableContact: boolean
}

export type TransitionResult =
  | { ok: true;  nextState: MerchantLifecycleState }
  | { ok: false; reason: string }

/** Does the prospect carry a verified identity? SIREN valid + legal name, OR a company domain. */
export function hasVerifiedIdentity(p: Pick<MerchantProspect, 'siren' | 'legalName' | 'domain'>): boolean {
  const siren = normalizeSiren(p.siren)
  if (siren && typeof p.legalName === 'string' && p.legalName.trim().length > 0) return true
  const dom = normalizeDomain(p.domain)
  return dom.ok && !isPersonalMailboxDomain(dom.canonical)
}

/** Guards for each legal forward transition. */
export function checkGuard(
  from: MerchantLifecycleState,
  to:   MerchantLifecycleState,
  input: TransitionGuardInput,
): TransitionResult {
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (!allowed.includes(to)) {
    return { ok: false, reason: `illegal_transition:${from}->${to}` }
  }
  // Any state → 'lost' is always allowed (disqualify) and carries its own reason upstream.
  if (to === 'lost') return { ok: true, nextState: 'lost' }

  switch (`${from}->${to}` as const) {
    case 'discovered->qualified': {
      if (!input.prospect.legalName && !input.prospect.domain) {
        return { ok: false, reason: 'guard_qualified:no_identity_at_all' }
      }
      if (input.fitScore < MIN_FIT_FOR_QUALIFIED) {
        return { ok: false, reason: `guard_qualified:fit_below_${MIN_FIT_FOR_QUALIFIED}` }
      }
      return { ok: true, nextState: 'qualified' }
    }
    case 'qualified->verified': {
      if (!hasVerifiedIdentity(input.prospect)) {
        return { ok: false, reason: 'guard_verified:identity_unverified' }
      }
      if (input.compositeScore < MIN_COMPOSITE_FOR_VERIFIED) {
        return { ok: false, reason: `guard_verified:composite_below_${MIN_COMPOSITE_FOR_VERIFIED}` }
      }
      return { ok: true, nextState: 'verified' }
    }
    case 'verified->outreach_eligible': {
      if (!isSupportedColdB2BJurisdiction(input.prospect.countryIso2)) {
        return { ok: false, reason: 'guard_outreach_eligible:jurisdiction_unsupported' }
      }
      if (input.compositeScore < MIN_COMPOSITE_FOR_OUTREACH) {
        return { ok: false, reason: `guard_outreach_eligible:composite_below_${MIN_COMPOSITE_FOR_OUTREACH}` }
      }
      if (!input.hasProfessionalContact) {
        return { ok: false, reason: 'guard_outreach_eligible:no_professional_contact' }
      }
      if (!input.hasAnyReachableContact) {
        return { ok: false, reason: 'guard_outreach_eligible:all_contacts_suppressed' }
      }
      return { ok: true, nextState: 'outreach_eligible' }
    }
    // Transitions beyond outreach_eligible are driven by external events (touchpoints,
    // webhook receipts, operator confirmation). They have no local guard other than
    // the ALLOWED_TRANSITIONS map; the pipeline supplies the event.
    case 'outreach_eligible->contacted':
    case 'contacted->replied':
    case 'replied->meeting':
    case 'meeting->won':
    case 'won->active':
      return { ok: true, nextState: to }
  }
  return { ok: false, reason: `illegal_transition:${from}->${to}` }
}

/** Non-mutating helper: list of legal next states from a given state. */
export function legalNextStates(from: MerchantLifecycleState): readonly MerchantLifecycleState[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}

export function isTerminal(state: MerchantLifecycleState): boolean {
  return state === 'active' || state === 'lost'
}
