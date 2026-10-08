// ── Growth / business-engine — deterministic scoring ───────────────────────────────────
//
// PURE. No I/O, no clock reads. All inputs explicit. Rules first; AI second. AI (future
// lot) can EXPLAIN or DRAFT around these numbers but never override them.
//
//   - merchantFitScore / merchantIntentScore  → B2B pipeline ordering
//   - consumerRFM / consumerLifecycleState    → B2C sequence targeting
//   - churnRisk                               → winback trigger
//   - reorderWindowDays                       → next-order expectation
//
// Everything returns the inputs that fed the number alongside the number, so a dashboard
// can show WHY a contact scored where they did without re-running the computation.

import type { MerchantProspect, MerchantRole } from './types'

// ── Merchant fit score (0..100) ────────────────────────────────────────────────────────
//
// Deterministic match against our ideal customer profile. Component scores are summed
// into a 100-point envelope. The ICP is role-specific; defaults below cover restaurants —
// others ride on reasonable fallbacks until we tune them per role.

export interface MerchantFitInput {
  prospect:   Pick<MerchantProspect, 'role' | 'siren' | 'legalName' | 'domain' | 'city' | 'cuisineTags' | 'sizeSignals' | 'countryIso2'>
  /** Cities we currently serve or want to serve (lowercased). Empty = don't score city. */
  targetCities?:   readonly string[]
  /** Cuisines we currently serve or want to serve (lowercased). Empty = don't score cuisine. */
  targetCuisines?: readonly string[]
}

export interface MerchantFitBreakdown {
  score:            number
  components:       Record<string, number>
}

const CLAMP = (n: number) => Math.max(0, Math.min(100, n))

const ROLE_PRIORS: Record<MerchantRole, number> = {
  restaurant:  20,
  supplier:    15,
  creator:     15,
  franchise:   15,
  affiliate:   10,
  logistics:   10,
  prestataire: 10,
}

export function merchantFitScore(input: MerchantFitInput): MerchantFitBreakdown {
  const p = input.prospect
  const components: Record<string, number> = {}

  // 1. role prior (10..20)
  components.role = ROLE_PRIORS[p.role] ?? 10

  // 2. verified identity (0 or 20) — SIREN present AND legal name present
  components.verified_identity = p.siren && p.legalName ? 20 : 0

  // 3. domain presence (0 or 10)
  components.has_domain = p.domain ? 10 : 0

  // 4. country gate — we only sell in FR today. UNKNOWN (null) must be penalised, not
  //    silently defaulted to 'FR': otherwise an un-enriched prospect gets a free FR bonus
  //    and can rank above a verified FR competitor, and could be fed into FR-only cold B2B
  //    sequences. Fail-closed: cannot prove in-territory ⇒ score as out-of-territory.
  components.country_match = p.countryIso2 === 'FR' ? 10 : -40

  // 5. city match (0 or 15) — only scored when target list is provided
  if (input.targetCities && input.targetCities.length > 0) {
    const city = (p.city ?? '').toLowerCase()
    components.city_match = city && input.targetCities.includes(city) ? 15 : 0
  }

  // 6. cuisine match (0 or 15) — restaurant only, only when target list is provided
  if (p.role === 'restaurant' && input.targetCuisines && input.targetCuisines.length > 0) {
    const tags = (p.cuisineTags ?? []).map((t) => t.toLowerCase())
    const hit = tags.some((t) => input.targetCuisines!.includes(t))
    components.cuisine_match = hit ? 15 : 0
  }

  // 7. size signals (0..10) — generic completeness bonus; interpretation is role-specific
  const sig = p.sizeSignals ?? {}
  const sigKnown = Object.values(sig).filter((v) => v !== null && v !== undefined && v !== '').length
  components.size_signals = Math.min(10, sigKnown * 3)

  const score = CLAMP(Object.values(components).reduce((a, b) => a + b, 0))
  return { score, components }
}

// ── Merchant intent score (0..100) ─────────────────────────────────────────────────────
//
// Time-decayed engagement with Grubano assets + outreach replies.
//   - visits to /business within last 30d
//   - email open / click within last 30d
//   - reply within last 30d (strongest)
//   - form started but abandoned (last 30d)
// Half-life = 7 days by default: a signal 7 days old counts half as much as one today.

export interface MerchantIntentSignals {
  /** Timestamps (ms) of /business visits by this prospect. */
  visitsMs:        readonly number[]
  /** Timestamps (ms) of email opens. */
  opensMs:         readonly number[]
  /** Timestamps (ms) of email clicks. */
  clicksMs:        readonly number[]
  /** Timestamps (ms) of replies. */
  repliesMs:       readonly number[]
  /** Timestamps (ms) of abandoned forms. */
  formAbandonsMs:  readonly number[]
}

export interface MerchantIntentInput {
  nowMs:           number
  signals:         MerchantIntentSignals
  halfLifeDays?:   number
}

export interface MerchantIntentBreakdown {
  score:           number
  components:      Record<string, number>
}

function decayedSum(timestampsMs: readonly number[], nowMs: number, halfLifeMs: number, perSignalWeight: number): number {
  if (halfLifeMs <= 0) return 0
  const WINDOW_MS = 30 * 86_400_000
  let sum = 0
  for (const t of timestampsMs) {
    const age = nowMs - t
    if (age < 0 || age > WINDOW_MS) continue
    sum += perSignalWeight * Math.pow(0.5, age / halfLifeMs)
  }
  return sum
}

export function merchantIntentScore(input: MerchantIntentInput): MerchantIntentBreakdown {
  const halfLifeMs = (input.halfLifeDays ?? 7) * 86_400_000
  const components: Record<string, number> = {
    visits:   decayedSum(input.signals.visitsMs,       input.nowMs, halfLifeMs, 8),
    opens:    decayedSum(input.signals.opensMs,        input.nowMs, halfLifeMs, 4),
    clicks:   decayedSum(input.signals.clicksMs,       input.nowMs, halfLifeMs, 15),
    replies:  decayedSum(input.signals.repliesMs,      input.nowMs, halfLifeMs, 40),
    abandons: decayedSum(input.signals.formAbandonsMs, input.nowMs, halfLifeMs, 25),
  }
  const score = CLAMP(Math.round(Object.values(components).reduce((a, b) => a + b, 0)))
  return { score, components }
}

// ── Consumer RFM ───────────────────────────────────────────────────────────────────────

export interface ConsumerOrderPoint {
  /** Order creation timestamp (ms). */
  atMs:        number
  /** Net value in cents (after discount, before tips). */
  valueCents:  number
}

export interface ConsumerRFMInput {
  nowMs:           number
  orders:          readonly ConsumerOrderPoint[]
  /** Window in days over which to compute F and M. Default 365 days. */
  windowDays?:     number
}

export interface ConsumerRFM {
  /** days since most recent order; Infinity if no order */
  recencyDays:     number
  /** order count inside the window */
  frequency:       number
  /** net spend in cents inside the window */
  monetaryCents:   number
  /** composite 0..100 — higher is better */
  score:           number
}

export function consumerRFM(input: ConsumerRFMInput): ConsumerRFM {
  const windowMs = (input.windowDays ?? 365) * 86_400_000
  const windowStart = input.nowMs - windowMs
  const inWindow = input.orders.filter((o) => o.atMs >= windowStart && o.atMs <= input.nowMs)
  const latest = input.orders.reduce<number | null>((acc, o) => (acc === null || o.atMs > acc ? o.atMs : acc), null)
  const recencyDays = latest === null ? Number.POSITIVE_INFINITY : Math.max(0, (input.nowMs - latest) / 86_400_000)
  const frequency = inWindow.length
  const monetaryCents = inWindow.reduce((a, o) => a + Math.max(0, o.valueCents), 0)

  // Normalise each dimension to 0..1 using soft caps calibrated for restaurant data.
  const rNorm = recencyDays === Number.POSITIVE_INFINITY ? 0 : Math.max(0, 1 - recencyDays / 60)      // 0 after 60d
  const fNorm = Math.min(1, frequency / 12)                                                            // caps at 12/yr
  const mNorm = Math.min(1, monetaryCents / 30_000)                                                    // caps at 300€/yr
  const score = Math.round(100 * (0.5 * rNorm + 0.3 * fNorm + 0.2 * mNorm))

  return { recencyDays, frequency, monetaryCents, score }
}

// ── Consumer lifecycle state ───────────────────────────────────────────────────────────

export const CONSUMER_LIFECYCLE_STATES = ['new', 'active', 'at_risk', 'dormant', 'lost'] as const
export type ConsumerLifecycleState = (typeof CONSUMER_LIFECYCLE_STATES)[number]

/**
 * Deterministic state mapping. Uses the ratio of recencyDays to a reorderMedian baseline:
 *   - new       : frequency <= 1
 *   - active    : recency ≤ 1× baseline
 *   - at_risk   : 1×..2× baseline
 *   - dormant   : 2×..4× baseline
 *   - lost      : > 4× baseline
 */
export function consumerLifecycleState(
  rfm: ConsumerRFM, reorderMedianDays: number,
): ConsumerLifecycleState {
  if (rfm.frequency <= 1) return 'new'
  if (!Number.isFinite(rfm.recencyDays) || reorderMedianDays <= 0) return 'lost'
  const r = rfm.recencyDays / reorderMedianDays
  if (r <= 1) return 'active'
  if (r <= 2) return 'at_risk'
  if (r <= 4) return 'dormant'
  return 'lost'
}

/**
 * Reorder-median estimator from a contact's own order history. Returns a sensible fallback
 * when there are fewer than 2 orders. Pure.
 */
export function reorderWindowDays(orders: readonly ConsumerOrderPoint[], fallbackDays = 21): number {
  if (orders.length < 2) return fallbackDays
  const sorted = [...orders].sort((a, b) => a.atMs - b.atMs)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const dt = (sorted[i].atMs - sorted[i - 1].atMs) / 86_400_000
    if (dt > 0 && dt < 365) gaps.push(dt)
  }
  if (gaps.length === 0) return fallbackDays
  const g = [...gaps].sort((a, b) => a - b)
  const mid = Math.floor(g.length / 2)
  const median = g.length % 2 === 0 ? (g[mid - 1] + g[mid]) / 2 : g[mid]
  return Math.max(1, Math.round(median))
}

// ── Churn risk ─────────────────────────────────────────────────────────────────────────

/**
 * Churn risk 0..1 — monotone in `(recencyDays / reorderMedianDays)`. Pure, deterministic.
 * Returns 1 for a `lost` state and ~0 for an `active` one.
 */
export function churnRisk(rfm: ConsumerRFM, reorderMedianDays: number): number {
  if (rfm.frequency <= 0) return 1
  if (!Number.isFinite(rfm.recencyDays) || reorderMedianDays <= 0) return 1
  const r = rfm.recencyDays / reorderMedianDays
  // sigmoid-ish piecewise: 0.1 at r=1, 0.5 at r=2, 0.9 at r=4
  if (r <= 1) return Math.max(0, 0.1 * r)
  if (r <= 2) return 0.1 + 0.4 * (r - 1)
  if (r <= 4) return 0.5 + 0.2 * (r - 2)
  return 1
}
