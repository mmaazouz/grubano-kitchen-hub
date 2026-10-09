// ── Growth / consumer — deterministic next-best-action (NBA) ──────────────────────────
//
// PURE. No I/O, no clock reads, no RNG. Given an RFM snapshot, returns the recommended
// NBA for THIS contact, a bounded confidence score, an explainable rationale, and a
// stable idempotency key. A seeded holdout partition is included so experiment lift can
// be measured without the engine ever sending to the control arm.
//
// Doctrine:
//   - Rules first, AI later. This file never fabricates offers, points, or copy. It only
//     chooses (kind × channel × purpose) and names a template key — the executor renders.
//   - Every decision carries a REASON string that reproduces from the inputs (no clock,
//     no randomness in the reason).
//   - Idempotency key is COMPOSITE: all identifying fields in canonical order (same
//     doctrine as events.ts `deriveIdempotencyKey`). A collision across (contact × cohort
//     × anchor-day × restaurant) is intentional: it is the SAME decision replayed, which
//     the executor dedupes on. A collision across tenants would be a bug and is excluded
//     by including tenantRestaurantId in the key.
//   - Holdout: a stable string hash on `(seed × tenant × contact)` is bucketed into 1000
//     slots so a 10 % holdout keeps the SAME contacts out across the whole experiment —
//     no churn. The holdout decision is 'wait' with reason 'holdout_control'.

import type { GrowthChannel, GrowthPurpose, NextActionKind } from '../types'
import type { ConsumerCohort, ConsumerRFMSnapshot } from './rfm'

export interface NBADraft {
  tenantRestaurantId: string
  contactId:          string
  cohort:             ConsumerCohort
  kind:               NextActionKind
  channel:            GrowthChannel | null
  purpose:            GrowthPurpose
  /** Stable identifier a template renderer can resolve. The engine does NOT render here. */
  templateKey:        string | null
  /** 0..1 bounded confidence. Rules → 1.0 - cohort_penalty; AI will later override lower. */
  confidence:         number
  /** Human-readable rationale, deterministic from (snapshot, options). No timestamps. */
  rationale:          string
  /** Composite stable idempotency key — the executor dedupes on this. */
  idempotencyKey:     string
  /** True iff this contact landed in the deterministic holdout slice for `holdoutSeed`. */
  holdout:            boolean
}

export interface NBAOptions {
  /** Experiment seed string. Required for a reproducible holdout. Default 'default'. */
  holdoutSeed?:   string
  /** 0..1 fraction of the audience to KEEP OUT of this NBA. Default 0 (no holdout). */
  holdoutPct?:    number
  /** Day anchor for the idempotency key. If omitted, derived from snapshot.nowMs truncated
   *  to the start of the UTC day. Pass an explicit value for a custom cadence (e.g. weekly). */
  anchorKey?:     string
}

// ── Cohort → action matrix ─────────────────────────────────────────────────────────────
//
// NEVER fabricate money. A cohort that would call for an "offer" produces a 'reactivation_offer'
// kind with a lifecycle PURPOSE and a template key the restaurant has to populate. The engine
// does not invent discounts.

interface CohortAction {
  kind:       NextActionKind
  channel:    GrowthChannel | null
  purpose:    GrowthPurpose
  templateKey: string | null
  /** Rules-side confidence. The executor can lower it; it may NEVER raise it beyond 1.0. */
  confidence: number
}

const COHORT_MATRIX: Record<ConsumerCohort, CohortAction> = {
  // No countable orders yet — never send cold marketing. See soft-opt-in.ts.
  none:       { kind: 'wait',               channel: null,    purpose: 'lifecycle',    templateKey: null,                 confidence: 1.00 },
  // Within post-order window: a lifecycle welcome is permitted ONLY if the contact has consented.
  new:        { kind: 'send_one_off',       channel: 'email', purpose: 'lifecycle',    templateKey: 'consumer.new.welcome',          confidence: 0.90 },
  // Single order, aged past the welcome window — invite the 2nd order (still lifecycle, no promo).
  first_time: { kind: 'send_one_off',       channel: 'email', purpose: 'lifecycle',    templateKey: 'consumer.first_time.invite_2nd', confidence: 0.80 },
  // Habitual, inside their reorder cadence — a referral prompt (consent-based commercial).
  regular:    { kind: 'referral_prompt',    channel: 'email', purpose: 'commercial',   templateKey: 'consumer.regular.referral',      confidence: 0.70 },
  // Habitual + spends well — explicit referral push.
  high_value: { kind: 'referral_prompt',    channel: 'email', purpose: 'commercial',   templateKey: 'consumer.high_value.referral',   confidence: 0.75 },
  // Cadence slipped — "we miss you" lifecycle. The restaurant decides whether to attach an offer.
  at_risk:    { kind: 'reactivation_offer', channel: 'email', purpose: 'lifecycle',    templateKey: 'consumer.at_risk.reactivation',  confidence: 0.65 },
  // Deep slip — one more lifecycle message, still no fabricated promo.
  dormant:    { kind: 'reactivation_offer', channel: 'email', purpose: 'lifecycle',    templateKey: 'consumer.dormant.reactivation',  confidence: 0.50 },
  // Last reachable window — soft-opt-in territory, caller must gate on prior similar purchase.
  winback:    { kind: 'reactivation_offer', channel: 'email', purpose: 'commercial',   templateKey: 'consumer.winback.commercial',    confidence: 0.40 },
  // Beyond the winback horizon — do not solicit via commercial channels.
  lost:       { kind: 'wait',               channel: null,    purpose: 'lifecycle',    templateKey: null,                 confidence: 1.00 },
}

// ── Entry point ────────────────────────────────────────────────────────────────────────

export function decideNBA(snapshot: ConsumerRFMSnapshot, opts: NBAOptions = {}): NBADraft {
  const action = COHORT_MATRIX[snapshot.cohort]

  const anchorKey = opts.anchorKey ?? utcDayKey(snapshot.nowMs)
  const idempotencyKey = buildIdempotencyKey({
    tenantRestaurantId: snapshot.tenantRestaurantId,
    contactId:          snapshot.contactId,
    cohort:             snapshot.cohort,
    kind:               action.kind,
    channel:            action.channel,
    purpose:            action.purpose,
    anchorKey,
  })

  const holdoutPct  = clamp01(opts.holdoutPct ?? 0)
  const holdoutSeed = (opts.holdoutSeed ?? 'default').toString()
  const holdout     = isInHoldout(holdoutSeed, snapshot.tenantRestaurantId, snapshot.contactId, holdoutPct)

  const kind    = holdout ? 'wait' : action.kind
  const channel = holdout ? null   : action.channel

  const rationale = [
    `cohort=${snapshot.cohort}`,
    `rules=${action.kind}`,
    `confidence=${action.confidence.toFixed(2)}`,
    `holdout=${holdout ? `yes:${holdoutSeed}:${(holdoutPct * 100).toFixed(2)}%` : 'no'}`,
    ...snapshot.cohortReasons.map((r) => `rfm:${r}`),
  ].join(' | ')

  return {
    tenantRestaurantId: snapshot.tenantRestaurantId,
    contactId:          snapshot.contactId,
    cohort:             snapshot.cohort,
    kind,
    channel,
    purpose:            action.purpose,
    templateKey:        holdout ? null : action.templateKey,
    confidence:         clamp01(action.confidence),
    rationale,
    idempotencyKey,
    holdout,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** YYYY-MM-DD anchored to UTC. Pure. */
export function utcDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear().toString().padStart(4, '0')
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = d.getUTCDate().toString().padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Build the idempotency key from all identifying fields in canonical order. This mirrors
 * `events.ts.deriveIdempotencyKey` doctrine: multiple fields, never first-match, so two
 * legitimately-distinct NBAs (e.g. same contact, different cohort day) do not collide
 * and two producers of the SAME NBA always converge on the SAME key.
 */
export function buildIdempotencyKey(parts: {
  tenantRestaurantId: string
  contactId:          string
  cohort:             string
  kind:               string
  channel:            GrowthChannel | null
  purpose:            string
  anchorKey:          string
}): string {
  return [
    'nba',
    `tenant=${parts.tenantRestaurantId}`,
    `contact=${parts.contactId}`,
    `cohort=${parts.cohort}`,
    `kind=${parts.kind}`,
    `channel=${parts.channel ?? 'none'}`,
    `purpose=${parts.purpose}`,
    `day=${parts.anchorKey}`,
  ].join('|')
}

/**
 * Deterministic holdout bucketing.
 *
 * - Hash `(seed × tenant × contact)` with FNV-1a 32-bit. 1000 buckets.
 * - A contact is in the holdout iff `bucket < pct × 1000` (floor), using integer compare
 *   so a 10 % holdout keeps buckets 0..99 and leaves 100..999 untouched.
 * - Property: for a fixed `(seed, pct)` the holdout partition is STABLE across time;
 *   bumping `pct` from 10 % to 20 % adds buckets 100..199 but never removes 0..99.
 *   Changing the seed re-randomises the entire partition — bump the seed to re-shuffle.
 *
 * The RNG-free property means a test can pin exactly which contactIds land in holdout.
 */
export function isInHoldout(seed: string, tenant: string, contact: string, pct: number): boolean {
  const p = clamp01(pct)
  if (p <= 0) return false
  if (p >= 1) return true
  const bucket = fnv1a32(`${seed}|${tenant}|${contact}`) % 1000
  const cutoff = Math.floor(p * 1000)
  return bucket < cutoff
}

/** FNV-1a 32-bit. Pure, deterministic. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // h *= 0x01000193, kept in 32-bit range via Math.imul
    h = Math.imul(h, 0x01000193)
  }
  // Normalise to unsigned 32-bit.
  return h >>> 0
}
