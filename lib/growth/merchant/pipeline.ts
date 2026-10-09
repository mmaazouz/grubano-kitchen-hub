// ── Growth / merchant — DRY-RUN pipeline ──────────────────────────────────────────────
//
// PURE. End-to-end dry-run: takes a batch of prospects + their contacts + policy context,
// runs normalization → dedup → scoring → lifecycle guards → next-action, and returns a
// consolidated report. NO SENDS. NO NETWORK. NO PROVIDER CALLS. Not even an adapter dispatch
// — this is the lot that proves the pipeline makes correct DECISIONS before any adapter
// is wired up.
//
// Measured metrics only. The report counts things that actually happened in-run (prospects
// processed, duplicates merged, decisions by kind, suppressed contacts). It does NOT emit
// forecast revenue, imagined conversion rates, or "projected ROI" — those are modelled
// elsewhere once we have real cohort data to anchor them.

import type { Consent, GrowthContact, Suppression } from '../types'
import type { MerchantProspect } from '../types'
import type { FrequencyCap, QuietHoursWindow } from '../policy'
import { dedupKeyForProspect, type DedupKey } from './dedup'
import { qualificationScore, type QualificationScoreInput } from './scoring'
import { decideNextAction, type NextActionDecision, type MerchantNextActionKind } from './next-action'
import type { MerchantLifecycleState } from './lifecycle'

export interface PipelineProspectInput {
  prospect:  MerchantProspect
  state:     MerchantLifecycleState
  /** Contacts linked to this prospect, pre-isolated by tenant. */
  contactIds: readonly string[]
  /** Optional targeting hints for fit scoring. */
  targeting?: { targetCities?: readonly string[]; targetCuisines?: readonly string[] }
  /** Intent signals (ms timestamps) collected per prospect. */
  intent:    QualificationScoreInput['intent']['signals']
  halfLifeDays?: number
  /** Minutes since last touchpoint (null = never contacted). */
  minutesSinceLastTouchpoint: number | null
}

export interface PipelineInput {
  nowMs:        number
  tenantOperatorId: string | null
  prospects:    readonly PipelineProspectInput[]
  contacts:     readonly GrowthContact[]
  consents:     readonly Consent[]
  suppressions: readonly Suppression[]
  recentSendTimestampsMs: Readonly<Record<string, readonly number[]>>
  frequencyCaps: readonly FrequencyCap[]
  quietHours:   QuietHoursWindow | null
  minFollowupGapMinutes: number
}

export interface PipelineRowReport {
  prospectId:  string
  dedupKey:    DedupKey
  state:       MerchantLifecycleState
  compositeScore: number
  decisionKind: MerchantNextActionKind
  decisionReasonCode: string
  decisionRationale:  string
  /** Dispatch is ALWAYS false in a dry-run. Kept explicit so downstream code can't miss it. */
  dispatched:  false
}

export interface PipelineReport {
  nowMs:        number
  tenantOperatorId: string | null
  processedProspects: number
  uniqueCompanies:    number
  duplicateGroups:    number
  reviewOnlyGroups:   number
  decisionCounts:    Record<MerchantNextActionKind, number>
  blockedByPolicy:   number
  outreachProposals: number
  rows:              readonly PipelineRowReport[]
  /** Hard assertion present in the output so downstream parsers can fail-closed if missing. */
  dryRun:            true
  /** Non-fictitious metrics only. See docs/ops/GROWTH-MERCHANT-B2B-NEXT.md §7. */
  measuredOnly:      true
}

const EMPTY_DECISION_COUNTS: Record<MerchantNextActionKind, number> = {
  wait: 0, enrich: 0, request_review: 0, propose_outreach: 0,
  followup: 0, request_meeting: 0, disqualify: 0, none: 0,
}

export function runMerchantDryRun(input: PipelineInput): PipelineReport {
  const contactsById = new Map<string, GrowthContact>()
  for (const c of input.contacts) contactsById.set(c.id, c)

  const rows: PipelineRowReport[] = []
  const decisionCounts: Record<MerchantNextActionKind, number> = { ...EMPTY_DECISION_COUNTS }
  const dedupBuckets = new Map<string, string[]>()  // dedupKey → prospectIds
  let outreachProposals = 0
  let blockedByPolicy = 0

  for (const row of input.prospects) {
    const p = row.prospect
    // Tenant isolation: skip anything that doesn't belong to the requested tenant.
    // A null tenant input scopes to "central Grubano prospects" (tenantOperatorId null).
    // Operator-scoped prospects don't exist in the foundation Prospect type yet (tenant key
    // lives on the Contact row), so tenant isolation here is a hard FILTER on contacts.
    const prospectContacts = row.contactIds
      .map((id) => contactsById.get(id))
      .filter((c): c is GrowthContact => !!c)
      .filter((c) => c.tenantOperatorId === input.tenantOperatorId)

    const dedupKey = dedupKeyForProspect(p)
    const bucketKey = dedupKey ?? `review:${p.id}`
    const bucket = dedupBuckets.get(bucketKey)
    if (bucket) bucket.push(p.id)
    else dedupBuckets.set(bucketKey, [p.id])

    const scoreInput: QualificationScoreInput = {
      fit: {
        prospect: {
          role: p.role, siren: p.siren, legalName: p.legalName, domain: p.domain,
          city: p.city, cuisineTags: p.cuisineTags, sizeSignals: p.sizeSignals, countryIso2: p.countryIso2,
        },
        targetCities: row.targeting?.targetCities,
        targetCuisines: row.targeting?.targetCuisines,
      },
      intent: { nowMs: input.nowMs, signals: row.intent, halfLifeDays: row.halfLifeDays },
      professionalRelevance: {
        prospect: { domain: p.domain },
        contactEmail: prospectContacts[0]?.email ?? null,
      },
    }
    const score = qualificationScore(scoreInput)

    const decision: NextActionDecision = decideNextAction({
      nowMs: input.nowMs,
      prospect: p,
      state: row.state,
      contacts: prospectContacts,
      consents: input.consents,
      suppressions: input.suppressions,
      recentSendTimestampsMs: input.recentSendTimestampsMs,
      frequencyCaps: input.frequencyCaps,
      quietHours: input.quietHours,
      score: scoreInput,
      minutesSinceLastTouchpoint: row.minutesSinceLastTouchpoint,
      minFollowupGapMinutes: input.minFollowupGapMinutes,
    })

    decisionCounts[decision.kind] += 1
    if (decision.kind === 'request_review' && decision.reasonCode.startsWith('policy_block:')) {
      blockedByPolicy += 1
    }
    if (decision.kind === 'propose_outreach' || decision.kind === 'followup') outreachProposals += 1

    rows.push({
      prospectId: p.id,
      dedupKey,
      state: row.state,
      compositeScore: score.score,
      decisionKind: decision.kind,
      decisionReasonCode: decision.reasonCode,
      decisionRationale: decision.rationale,
      dispatched: false,
    })
  }

  const uniqueCompanies = dedupBuckets.size
  const duplicateGroups = [...dedupBuckets.values()].filter((v) => v.length > 1).length
  const reviewOnlyGroups = [...dedupBuckets.keys()].filter((k) => k.startsWith('review:')).length

  return {
    nowMs: input.nowMs,
    tenantOperatorId: input.tenantOperatorId,
    processedProspects: input.prospects.length,
    uniqueCompanies,
    duplicateGroups,
    reviewOnlyGroups,
    decisionCounts,
    blockedByPolicy,
    outreachProposals,
    rows,
    dryRun: true,
    measuredOnly: true,
  }
}
