// ── Growth / consumer — dry-run planner (REVIEW / ELIGIBLE / NO_SEND) ─────────────────
//
// PURE. No I/O. Composes money → RFM → NBA → policy gates → soft-opt-in to produce ONE
// verdict for ONE contact. Never calls a provider, never writes anything.
//
// Doctrine:
//   - ELIGIBLE: the NBA passes every gate — the engine would send if plumbed.
//   - REVIEW: at least one condition requires a human decision (defer, missing proof,
//     ambiguous consent, unknown source). The record is handed to an operator queue.
//   - NO_SEND: a hard block or an intentional silence (wait / lost / holdout / erased
//     / all-sends-disabled). The engine must NOT send.
//
// The verdict is the ONLY thing a caller is allowed to act on. The internal fields
// (policy decision, soft-opt-in decision, NBA) are kept for the audit trail.

import type { Consent, PolicyDecision, Suppression } from '../types'
import { canSend, type FrequencyCap, type QuietHoursWindow } from '../policy'
import { buildRFMSnapshot, type ConsumerRFMOptions, type ConsumerRFMSnapshot } from './rfm'
import { decideNBA, type NBADraft, type NBAOptions } from './decisions'
import { evaluateSoftOptIn, type SoftOptInDecision } from './soft-opt-in'
import type { ConsumerOrderInput } from './money'
import { normaliseOrderBatch } from './money'

export type PlanVerdict = 'ELIGIBLE' | 'REVIEW' | 'NO_SEND'

export interface DryRunContact {
  id:               string
  audienceType:     'b2c'
  timezone:         string | null
}

export interface DryRunInput {
  contact:            DryRunContact
  tenantRestaurantId: string
  nowMs:              number
  orders:             readonly ConsumerOrderInput[]
  consents:           readonly Consent[]
  suppressions:       readonly Suppression[]
  /** Successful sends to this contact on the NBA's chosen channel (ms). */
  recentSendTimestampsMs: readonly number[]
  frequencyCaps:      readonly FrequencyCap[]
  quietHours:         QuietHoursWindow | null
  /** Claimed collection source for soft-opt-in evaluation. */
  softOptInSource:    string | null
  /** GDPR Art. 17 — fail-closed. */
  gdprErased:         boolean
  /** Operational kill switch: if true, every record resolves NO_SEND / reason='all_sends_disabled'. */
  allSendsDisabled:   boolean
  rfmOptions?:        ConsumerRFMOptions
  nbaOptions?:        NBAOptions
}

export interface DryRunRecord {
  verdict:           PlanVerdict
  reason:            string
  retryAfterMs?:     number
  contactId:         string
  tenantRestaurantId: string
  nba:               NBADraft
  snapshot:          ConsumerRFMSnapshot
  policy:            PolicyDecision | null
  softOptIn:         SoftOptInDecision | null
  idempotencyKey:    string
}

export function planDryRun(input: DryRunInput): DryRunRecord {
  // ── Fail-closed on an UNKNOWN gdprErased value. The TypeScript signature says boolean,
  //    but a JS caller (API route handler, cron job) might pass undefined/null/'false'/0.
  //    We accept ONLY the strict literal `false`; anything else is treated as erased so a
  //    schema drift or a caller refactor cannot accidentally produce ELIGIBLE. ──
  const isAuthoritativelyNotErased = input.gdprErased === false
  const gdprErased = !isAuthoritativelyNotErased

  const rfmOptions = { ...(input.rfmOptions ?? {}), gdprErased }
  const snapshot = buildRFMSnapshot(
    { tenantRestaurantId: input.tenantRestaurantId, contactId: input.contact.id },
    input.orders,
    input.nowMs,
    rfmOptions,
  )
  const nba = decideNBA(snapshot, input.nbaOptions)

  // ── Short-circuit NO_SEND cases that bypass policy ──
  //
  // Order matters: GDPR > kill switch > wait/holdout. GDPR must be first so an erased
  // contact is reported with reason 'gdpr_erased' regardless of whether the kill switch
  // is on, which prevents reporting-channel confusion in the audit log.
  if (gdprErased) {
    return finish('NO_SEND', 'gdpr_erased', { snapshot, nba, policy: null, softOptIn: null, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
  }
  if (input.allSendsDisabled) {
    return finish('NO_SEND', 'all_sends_disabled', { snapshot, nba, policy: null, softOptIn: null, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
  }
  if (nba.holdout) {
    return finish('NO_SEND', 'holdout_control', { snapshot, nba, policy: null, softOptIn: null, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
  }
  if (nba.kind === 'wait' || nba.channel === null) {
    return finish('NO_SEND', `wait:${snapshot.cohort}`, { snapshot, nba, policy: null, softOptIn: null, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
  }

  // ── Soft-opt-in check for COMMERCIAL purposes ──
  //
  // Commercial purposes to a b2c contact only pass if there is an active consent row OR
  // the soft-opt-in derogation applies (prior similar purchase + documented source). The
  // policy gate below will consult `consents`; here we build an INFORMATIONAL soft-opt-in
  // decision used to tip ambiguous cases into REVIEW rather than silent NO_SEND.
  let softOptIn: SoftOptInDecision | null = null
  if (nba.purpose === 'commercial') {
    // We need the NORMALISED orders at the correct scope for the soft-opt-in check.
    // Rebuild on the fly from `snapshot.rejected` + inferred countable rows. Cheaper to
    // normalise once here with the same scope guarantees as the RFM step.
    const normalisedForScope = normalisePreservingScope(input.tenantRestaurantId, input.contact.id, input.orders, input.nowMs)
    softOptIn = evaluateSoftOptIn({
      contactId:          input.contact.id,
      tenantRestaurantId: input.tenantRestaurantId,
      channel:            nba.channel,
      nowMs:              input.nowMs,
      orders:             normalisedForScope,
      suppressions:       input.suppressions,
      consents:           input.consents,
      source:             input.softOptInSource ?? '',
      gdprErased:         gdprErased,
      windowDays:         input.rfmOptions?.windowDays ?? 365,
    })
  }

  // ── Policy gate (suppression → consent → quiet hours → caps) ──
  const policy = canSend({
    contact:  { id: input.contact.id, audienceType: input.contact.audienceType, timezone: input.contact.timezone },
    channel:  nba.channel,
    purpose:  nba.purpose,
    nowMs:    input.nowMs,
    consents: input.consents,
    suppressions: input.suppressions,
    recentSendTimestampsMs: input.recentSendTimestampsMs,
    frequencyCaps:          input.frequencyCaps,
    quietHours:             input.quietHours,
  })

  if (policy.outcome === 'block') {
    // Commercial block + eligible soft-opt-in → REVIEW (operator can authorise under the
    // derogation after confirming the collection source).
    if (nba.purpose === 'commercial' && softOptIn && softOptIn.eligible) {
      return finish('REVIEW', `soft_opt_in_candidate:${policy.reason}`, { snapshot, nba, policy, softOptIn, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
    }
    return finish('NO_SEND', `blocked:${policy.reason}`, { snapshot, nba, policy, softOptIn, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
  }
  if (policy.outcome === 'defer') {
    return finish('REVIEW', `defer:${policy.reason}`, { snapshot, nba, policy, softOptIn, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId }, policy.retryAfterMs)
  }

  // policy.outcome === 'allow' → eligible to send.
  return finish('ELIGIBLE', `ok:${snapshot.cohort}`, { snapshot, nba, policy, softOptIn, contact: input.contact, tenantRestaurantId: input.tenantRestaurantId })
}

// ── Internal plumbing ─────────────────────────────────────────────────────────────────

interface FinishParts {
  snapshot:          ConsumerRFMSnapshot
  nba:               NBADraft
  policy:            PolicyDecision | null
  softOptIn:         SoftOptInDecision | null
  contact:           DryRunContact
  tenantRestaurantId: string
}

function finish(verdict: PlanVerdict, reason: string, parts: FinishParts, retryAfterMs?: number): DryRunRecord {
  return {
    verdict,
    reason,
    retryAfterMs,
    contactId:         parts.contact.id,
    tenantRestaurantId: parts.tenantRestaurantId,
    nba:               parts.nba,
    snapshot:          parts.snapshot,
    policy:            parts.policy,
    softOptIn:         parts.softOptIn,
    idempotencyKey:    parts.nba.idempotencyKey,
  }
}

function normalisePreservingScope(tenant: string, contact: string, rows: readonly ConsumerOrderInput[], nowMs: number) {
  return normaliseOrderBatch({ tenantRestaurantId: tenant, contactId: contact }, rows, nowMs)
}
