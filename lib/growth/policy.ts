// ── Growth / business-engine — policy gates (consent, suppression, quiet hours, caps) ─
//
// PURE. No I/O, no clock reads, no env reads. All inputs are explicit. These functions
// enforce the legal + operational envelope every outbound action must traverse. See
// docs/ops/BUSINESS-ENGINE-FOUNDATION.md §3.6 for the composition rule.
//
// Doctrine:
//   - Suppression is a HARD BLOCK and overrides consent (bounces, complaints, user
//     requests). It never defers; it blocks.
//   - Consent must match (channel × purpose) and use a legal basis acceptable for that
//     (purpose × audienceType) combination.
//   - Quiet hours DEFER (never block). We return the minimum delay in ms to leave the
//     caller's quiet-hours window. Transactional + security purposes IGNORE quiet hours.
//   - Frequency caps DEFER (never block). The oldest in-window send sets the retry delay.
//   - AI is a user, not a lawmaker: an AI-drafted message is subject to the same gate.

import type {
  AudienceType, Consent, GrowthChannel, GrowthContact, GrowthPurpose,
  LegalBasis, PolicyDecision, Suppression,
} from './types'

// ── Legal basis acceptability matrix ───────────────────────────────────────────────────
//
// Row = (purpose, audienceType), column = legalBasis that is ACCEPTABLE. Any basis not
// listed is REJECTED. This is intentionally conservative; callers can widen it only by
// documenting the broader interest-balance test in the growth doc.

type Matrix = Partial<Record<GrowthPurpose, Partial<Record<AudienceType, readonly LegalBasis[]>>>>

export const ACCEPTABLE_LEGAL_BASES: Matrix = {
  transactional:   { b2c: ['contract'], b2b: ['contract'] },
  security:        { b2c: ['contract', 'legal_obligation'], b2b: ['contract', 'legal_obligation'] },
  lifecycle:       { b2c: ['consent', 'soft_opt_in'], b2b: ['legitimate_interest', 'consent'] },
  commercial:      { b2c: ['consent', 'soft_opt_in'], b2b: ['consent', 'legitimate_interest'] },
  cold_b2b:        { b2b: ['legitimate_interest'] },  // never for b2c, by law
  operational_b2b: { b2b: ['contract'] },
}

export function isLegalBasisAcceptable(purpose: GrowthPurpose, audience: AudienceType, basis: LegalBasis): boolean {
  const bases = ACCEPTABLE_LEGAL_BASES[purpose]?.[audience]
  return !!bases && bases.includes(basis)
}

// ── Suppression ────────────────────────────────────────────────────────────────────────

/**
 * Return the suppression that applies to this (contact × channel × purpose), or null.
 *
 * - `scope: 'all'` suppressions always apply.
 * - `scope: 'commercial'` suppressions apply ONLY to commercial / lifecycle / cold_b2b
 *   purposes; transactional / security / operational_b2b are contractual/legal and the
 *   user remains entitled to them even after a complaint or an unsubscribe click.
 *
 * Fail-closed on malformed input: an empty / non-string contactId never matches, even
 * against a row whose contactId is also empty. The persistence schema does not yet enforce
 * non-empty UUIDs — see `types.ts` — so this gate is the only defence against a `'' === ''`
 * cross-tenant collision.
 */
export function isSuppressed(
  suppressions: readonly Suppression[],
  contactId: string,
  channel: GrowthChannel,
  purpose: GrowthPurpose,
): Suppression | null {
  if (typeof contactId !== 'string' || contactId.length === 0) return null
  const isContractFamily = purpose === 'transactional' || purpose === 'security' || purpose === 'operational_b2b'
  for (const s of suppressions) {
    if (!s || typeof s.contactId !== 'string' || s.contactId.length === 0) continue
    if (s.contactId !== contactId) continue
    if (s.channel !== channel) continue
    if (s.scope === 'commercial' && isContractFamily) continue
    return s
  }
  return null
}

// ── Consent ────────────────────────────────────────────────────────────────────────────

/**
 * Parse an ISO instant to ms, or null on malformed input. Explicit so that lex-vs-chrono
 * mistakes (e.g. '…+02:00' > '…+00:00' at the same instant) can never slip into the
 * comparison path below.
 */
function parseInstantMs(s: unknown): number | null {
  if (typeof s !== 'string' || s.length === 0) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/**
 * The *active* consent for (contact × channel × purpose), or null.
 *
 * Doctrine: a revocation DOMINATES every grant for the same (contact × channel × purpose)
 * that happened AT OR BEFORE the revocation instant. A row whose own `revokedAt` is set
 * can never win on its own. Earlier grants are not resurrected just because a later-but-
 * revoked opt-in exists. Only a grant strictly after the latest revocation instant counts.
 *
 * Fail-closed on ambiguity:
 *   - A row with a malformed `grantedAt` is rejected as a candidate.
 *   - A row with a `revokedAt` set but malformed is treated as a revocation at
 *     +Infinity (i.e. revokes every past grant). The caller cannot prove when the user
 *     revoked, so we must assume now.
 *   - Comparisons are chronological (Date.parse → ms), never lexical.
 */
export function activeConsent(
  consents: readonly Consent[], contactId: string, channel: GrowthChannel, purpose: GrowthPurpose,
): Consent | null {
  if (typeof contactId !== 'string' || contactId.length === 0) return null

  type Parsed = { c: Consent; grantedMs: number | null; revokedMs: number | null; revokedAmbiguous: boolean }
  const matches: Parsed[] = []

  for (const c of consents) {
    if (!c) continue
    if (c.contactId !== contactId) continue
    if (c.channel !== channel) continue
    if (c.purpose !== purpose) continue

    const grantedMs = parseInstantMs(c.grantedAt)
    if (c.grantedAt != null && grantedMs === null) continue  // malformed grant → row rejected

    let revokedMs: number | null = null
    let revokedAmbiguous = false
    if (c.revokedAt != null) {
      revokedMs = parseInstantMs(c.revokedAt)
      if (revokedMs === null) revokedAmbiguous = true   // malformed revoke → treat as +∞
    }

    matches.push({ c, grantedMs, revokedMs, revokedAmbiguous })
  }

  // Latest revocation across ALL matches dominates every earlier grant for this
  // (channel × purpose). A malformed revoke contributes +Infinity.
  let latestRevokeMs = Number.NEGATIVE_INFINITY
  for (const m of matches) {
    if (m.revokedAmbiguous) { latestRevokeMs = Number.POSITIVE_INFINITY; break }
    if (m.revokedMs !== null && m.revokedMs > latestRevokeMs) latestRevokeMs = m.revokedMs
  }

  // Winner = latest row whose grant is strictly AFTER latestRevokeMs and whose own
  // revokedAt is not set.
  let winner: Parsed | null = null
  for (const m of matches) {
    if (m.grantedMs === null) continue
    if (m.revokedMs !== null || m.revokedAmbiguous) continue
    if (m.grantedMs <= latestRevokeMs) continue
    if (!winner || m.grantedMs > (winner.grantedMs ?? Number.NEGATIVE_INFINITY)) winner = m
  }
  return winner ? winner.c : null
}

/**
 * Does this contact have a valid consent to receive (channel × purpose), given their
 * audienceType? Transactional/security purposes don't require explicit consent — the
 * contractual relationship is the basis — but suppression still applies elsewhere.
 */
export function hasPermission(
  contact: Pick<GrowthContact, 'id' | 'audienceType'>,
  channel: GrowthChannel,
  purpose: GrowthPurpose,
  consents: readonly Consent[],
): { ok: boolean; basis: LegalBasis | null; reason?: string } {
  // Transactional and security are contract/legal_obligation — no explicit consent row needed.
  if (purpose === 'transactional' || purpose === 'security') {
    return { ok: true, basis: purpose === 'security' ? 'legal_obligation' : 'contract' }
  }
  // operational_b2b is also contract-based but is only for b2b.
  if (purpose === 'operational_b2b') {
    if (contact.audienceType !== 'b2b') return { ok: false, basis: null, reason: 'operational_b2b_requires_b2b' }
    return { ok: true, basis: 'contract' }
  }
  // Every other purpose needs an active consent row with an acceptable legal basis.
  const consent = activeConsent(consents, contact.id, channel, purpose)
  if (!consent) return { ok: false, basis: null, reason: 'no_consent' }
  if (!isLegalBasisAcceptable(purpose, contact.audienceType, consent.legalBasis)) {
    return { ok: false, basis: consent.legalBasis, reason: 'legal_basis_not_acceptable' }
  }
  return { ok: true, basis: consent.legalBasis }
}

// ── Quiet hours ────────────────────────────────────────────────────────────────────────

export interface QuietHoursWindow {
  /** 0..23 inclusive — start of the quiet window in the contact's local timezone. */
  startHour: number
  /** 0..23 inclusive — end of the quiet window (exclusive). May be smaller than start (wraps midnight). */
  endHour:   number
}

export const DEFAULT_QUIET_HOURS: QuietHoursWindow = { startHour: 21, endHour: 9 }

/**
 * Compute the local hour (0..23) at `nowMs` for the given IANA timezone. Uses
 * `Intl.DateTimeFormat` so it is pure and deterministic from inputs. Falls back to UTC if
 * the environment refuses the timezone.
 */
export function localHour(nowMs: number, timezone: string | null): number {
  const d = new Date(nowMs)
  if (!timezone) return d.getUTCHours()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).formatToParts(d)
    const h = parts.find((p) => p.type === 'hour')?.value
    if (!h) return d.getUTCHours()
    const n = Number.parseInt(h, 10)
    // Intl returns "24" at midnight on some engines — normalise.
    return n === 24 ? 0 : n
  } catch { return d.getUTCHours() }
}

/** True if the current local hour is inside the quiet window (handles wrap-around midnight). */
export function isInQuietHours(hour: number, w: QuietHoursWindow): boolean {
  if (w.startHour === w.endHour) return false
  if (w.startHour < w.endHour) return hour >= w.startHour && hour < w.endHour
  // wrap: e.g. 21..9 means 21,22,23,0,1,…,8 are quiet
  return hour >= w.startHour || hour < w.endHour
}

/**
 * Milliseconds into the local hour at `nowMs` for the given IANA timezone. Pure, uses
 * `Intl.DateTimeFormat`. Falls back to UTC minute/second/ms if the timezone is refused
 * or the engine returns bogus values. Zones with sub-hour offsets (e.g. Asia/Kolkata)
 * are handled correctly via Intl.
 */
function localMsIntoHour(nowMs: number, timezone: string | null): number {
  const d = new Date(nowMs)
  const utcFallback = d.getUTCMinutes() * 60_000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds()
  if (!timezone) return utcFallback
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d)
    const minute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10)
    const second = Number.parseInt(parts.find((p) => p.type === 'second')?.value ?? '', 10)
    if (!Number.isFinite(minute) || !Number.isFinite(second)) return utcFallback
    return minute * 60_000 + second * 1000 + d.getUTCMilliseconds()
  } catch { return utcFallback }
}

/**
 * Milliseconds until the next local hour that leaves the quiet window.
 *
 * DST correctness: we probe forward in UTC-hour steps and ask what the real LOCAL hour is
 * at each step via `Intl.DateTimeFormat`. A nominal `(h+1)%24` counter mis-counts across
 * spring-forward (over-defers by ~1h, safe but suboptimal) and across fall-back
 * (UNDER-defers by ~1h and sends during quiet hours — the regression we fix here).
 *
 * Bounded: at most 25 UTC-hour probes. Pure: deterministic from (nowMs, timezone, w).
 * No clock reads, no infinite loops.
 */
export function msUntilQuietHoursEnd(nowMs: number, timezone: string | null, w: QuietHoursWindow): number {
  // Fail-closed on a non-null but invalid IANA timezone string. `localHour` silently falls
  // back to `getUTCHours()` when `Intl.DateTimeFormat` throws, which would authorise a send
  // at 02:00 Honolulu (= 12:00 UTC) because the UTC clock reads "noon". The gate cannot
  // prove non-quiet without a valid local hour, so defer 24h. `null` keeps its documented
  // "treat as UTC quiet" contract — a producer that stores `null` opted in to UTC gating.
  if (timezone !== null) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { return 24 * 3_600_000 }
  }
  if (!isInQuietHours(localHour(nowMs, timezone), w)) return 0
  const HOUR = 3_600_000
  for (let k = 1; k <= 25; k++) {
    const t = nowMs + k * HOUR
    if (!isInQuietHours(localHour(t, timezone), w)) {
      // Snap to the start of the local hour at `t`. `localMsIntoHour` is < HOUR, so
      // `topOfHour` >= nowMs by construction (we advanced ≥ one UTC hour and only
      // subtract <1h back).
      const topOfHour = t - localMsIntoHour(t, timezone)
      const delay = topOfHour - nowMs
      if (delay > 0) return delay
      // Edge: timezone with sub-hour offset making snapped top land ≤ nowMs. Advance.
    }
  }
  // Pathological: 25 contiguous quiet UTC hours. The quiet window is at most 23 local
  // hours (startHour !== endHour), so this is unreachable given a well-formed window.
  // Return a conservative 24h defer instead of 0 — fail CLOSED.
  return 24 * HOUR
}

// ── Frequency caps ─────────────────────────────────────────────────────────────────────

export interface FrequencyCap {
  channel:   GrowthChannel
  windowMs:  number        // rolling window length
  max:       number        // allowed sends in that window
}

/**
 * Decide if sending now would breach ANY applicable cap. `recentSendTimestampsMs` is the
 * list of previous *successful* sends to this contact on this channel. Returns
 * `{ allowed: true }` iff every applicable cap holds; otherwise returns the LONGEST
 * `retryAfterMs` across all breached caps so the next attempt satisfies all of them.
 *
 * Early-returning on the first breached cap would schedule retries too soon when a longer
 * cap also applies (e.g. a short 2/day cap says "wait 1h" while a 3/week cap says
 * "wait 2d"; the caller must honour the longer).
 */
export function checkFrequencyCap(
  nowMs: number,
  channel: GrowthChannel,
  recentSendTimestampsMs: readonly number[],
  caps: readonly FrequencyCap[],
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  let worstRetryMs = -1
  for (const cap of caps) {
    if (cap.channel !== channel) continue
    if (cap.max <= 0) {
      // Hard-block cap: a conservative 24h defer. Keep accumulating in case another cap is longer.
      if (24 * 3_600_000 > worstRetryMs) worstRetryMs = 24 * 3_600_000
      continue
    }
    // Fail-closed on malformed window: NaN/negative/non-finite silently makes `t > NaN`
    // false for every timestamp and the cap disappears. Treat as hard-block equivalent.
    if (!Number.isFinite(cap.windowMs) || cap.windowMs <= 0) {
      if (24 * 3_600_000 > worstRetryMs) worstRetryMs = 24 * 3_600_000
      continue
    }
    const windowStart = nowMs - cap.windowMs
    const inWindow = recentSendTimestampsMs.filter((t) => t > windowStart)
    if (inWindow.length >= cap.max) {
      // retry when the oldest in-window send falls out of the window
      const oldest = Math.min(...inWindow)
      const retry  = Math.max(0, oldest + cap.windowMs - nowMs)
      if (retry > worstRetryMs) worstRetryMs = retry
    }
  }
  if (worstRetryMs < 0) return { allowed: true }
  return { allowed: false, retryAfterMs: worstRetryMs }
}

// ── Composite gate ─────────────────────────────────────────────────────────────────────

export interface CanSendInput {
  contact:      Pick<GrowthContact, 'id' | 'audienceType' | 'timezone'>
  channel:      GrowthChannel
  purpose:      GrowthPurpose
  nowMs:        number
  consents:     readonly Consent[]
  suppressions: readonly Suppression[]
  /** Successful sends to this contact on this channel, newest or oldest order irrelevant. */
  recentSendTimestampsMs: readonly number[]
  frequencyCaps: readonly FrequencyCap[]
  /** Nullable → use DEFAULT_QUIET_HOURS. Transactional/security IGNORE quiet hours. */
  quietHours:   QuietHoursWindow | null
}

export function canSend(input: CanSendInput): PolicyDecision {
  // 1. Suppression — hard block (purpose-aware: a 'commercial'-scope suppression lets
  //    transactional / security / operational_b2b pass; the user is still contractually
  //    entitled to those sends even after a complaint).
  const sup = isSuppressed(input.suppressions, input.contact.id, input.channel, input.purpose)
  if (sup) return { outcome: 'block', reason: `suppressed:${sup.reason}` }

  // 2. Consent / legal basis
  const perm = hasPermission(input.contact, input.channel, input.purpose, input.consents)
  if (!perm.ok) return { outcome: 'block', reason: `no_permission:${perm.reason ?? 'unknown'}` }

  // 3. Quiet hours — defer unless transactional/security
  const bypassQuietHours = input.purpose === 'transactional' || input.purpose === 'security'
  if (!bypassQuietHours) {
    const w = input.quietHours ?? DEFAULT_QUIET_HOURS
    const defer = msUntilQuietHoursEnd(input.nowMs, input.contact.timezone, w)
    if (defer > 0) return { outcome: 'defer', reason: 'quiet_hours', retryAfterMs: defer }
  }

  // 4. Frequency caps — defer
  const cap = checkFrequencyCap(input.nowMs, input.channel, input.recentSendTimestampsMs, input.frequencyCaps)
  if (!cap.allowed) return { outcome: 'defer', reason: 'frequency_cap', retryAfterMs: cap.retryAfterMs }

  return { outcome: 'allow', reason: 'ok' }
}
