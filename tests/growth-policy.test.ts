// tests/growth-policy.test.ts — business-engine Phase 0/1 policy gates.
// Exercises the pure gates in lib/growth/policy.ts: suppression (hard block), consent +
// legal basis, quiet hours (defer with ms-precise retry), frequency caps (defer with
// retry window), and the composite canSend decision. No I/O, no mocks — every input is
// explicit per the gate's "pure, deterministic from inputs" contract.

import { describe, it, expect } from 'vitest'
import {
  isLegalBasisAcceptable, hasPermission,
  isSuppressed, activeConsent,
  isInQuietHours, localHour, msUntilQuietHoursEnd, DEFAULT_QUIET_HOURS,
  checkFrequencyCap,
  canSend, type CanSendInput,
} from '@/lib/growth/policy'
import type { Consent, GrowthContact, Suppression } from '@/lib/growth/types'

const b2bContact: Pick<GrowthContact, 'id' | 'audienceType' | 'timezone'> = {
  id: 'c_b2b', audienceType: 'b2b', timezone: 'Europe/Paris',
}
const b2cContact: Pick<GrowthContact, 'id' | 'audienceType' | 'timezone'> = {
  id: 'c_b2c', audienceType: 'b2c', timezone: 'Europe/Paris',
}

const consent = (over: Partial<Consent>): Consent => ({
  contactId: 'c_b2c', channel: 'email', purpose: 'commercial',
  legalBasis: 'consent', grantedAt: '2026-10-01T00:00:00+00:00',
  revokedAt: null, source: 'signup_checkbox', ...over,
})

// ── legal basis matrix ─────────────────────────────────────────────────────────────────

describe('isLegalBasisAcceptable', () => {
  it('cold_b2b accepts legitimate_interest only, and only for b2b', () => {
    expect(isLegalBasisAcceptable('cold_b2b', 'b2b', 'legitimate_interest')).toBe(true)
    expect(isLegalBasisAcceptable('cold_b2b', 'b2b', 'consent')).toBe(false)
    expect(isLegalBasisAcceptable('cold_b2b', 'b2c', 'legitimate_interest')).toBe(false)
  })
  it('commercial b2c accepts consent and soft_opt_in', () => {
    expect(isLegalBasisAcceptable('commercial', 'b2c', 'consent')).toBe(true)
    expect(isLegalBasisAcceptable('commercial', 'b2c', 'soft_opt_in')).toBe(true)
    expect(isLegalBasisAcceptable('commercial', 'b2c', 'legitimate_interest')).toBe(false)
  })
  it('transactional accepts contract', () => {
    expect(isLegalBasisAcceptable('transactional', 'b2c', 'contract')).toBe(true)
    expect(isLegalBasisAcceptable('transactional', 'b2b', 'contract')).toBe(true)
  })
})

// ── suppression — hard block ───────────────────────────────────────────────────────────

describe('isSuppressed', () => {
  it('finds the matching suppression row for a commercial purpose', () => {
    const s: Suppression[] = [{ contactId: 'c_b2c', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }]
    expect(isSuppressed(s, 'c_b2c', 'email', 'commercial')?.reason).toBe('bounce_hard')
    expect(isSuppressed(s, 'c_b2c', 'sms',   'commercial')).toBeNull()
    expect(isSuppressed(s, 'c_other', 'email', 'commercial')).toBeNull()
  })

  it("scope='all' blocks EVERY purpose, including transactional", () => {
    const s: Suppression[] = [{ contactId: 'c_b2c', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }]
    expect(isSuppressed(s, 'c_b2c', 'email', 'commercial')).not.toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'transactional')).not.toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'security')).not.toBeNull()
  })

  it('does NOT match rows with a different contactId (tenant/contact isolation)', () => {
    // Contacts belong to tenants (operator or restaurant); the policy function trusts the
    // caller to pass contact-filtered rows, but ANY contactId mismatch MUST still be
    // rejected here as a defensive second line.
    const s: Suppression[] = [{ contactId: 'c_tenant_A', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }]
    expect(isSuppressed(s, 'c_tenant_B', 'email', 'commercial')).toBeNull()
  })

  it('rejects empty or non-string contactId inputs (fail closed on malformed caller state)', () => {
    const s: Suppression[] = [{ contactId: '' as unknown as string, channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }]
    // Empty-string collision would be a tenant-leak if `'' === ''` were allowed to match.
    expect(isSuppressed(s, '' as unknown as string, 'email', 'commercial')).toBeNull()
  })

  it("scope='commercial' blocks commercial/lifecycle/cold_b2b, but lets transactional/security/operational_b2b through", () => {
    const s: Suppression[] = [{ contactId: 'c_b2c', channel: 'email', reason: 'complaint', scope: 'commercial', since: '2026-10-01T00:00:00+00:00' }]
    expect(isSuppressed(s, 'c_b2c', 'email', 'commercial')).not.toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'lifecycle')).not.toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'cold_b2b')).not.toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'transactional')).toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'security')).toBeNull()
    expect(isSuppressed(s, 'c_b2c', 'email', 'operational_b2b')).toBeNull()
  })
})

// ── consent selection ──────────────────────────────────────────────────────────────────

describe('activeConsent', () => {
  // Doctrine: a revocation DOMINATES every grant for the same (contact × channel × purpose)
  // that happened at or before the revocation instant. Earlier grants are not resurrected
  // just because a later-but-revoked opt-in exists; only an opt-in STRICTLY AFTER the
  // latest revocation re-authorises sends.
  it('revocation dominates every earlier grant for the same contact/channel/purpose', () => {
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-01T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-05T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T01:00:00+00:00' }),
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
  })

  it('a NEWER grant strictly after the latest revocation re-authorises sends', () => {
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-01T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-05T00:00:00+00:00', revokedAt: '2026-10-05T01:00:00+00:00' }),
      consent({ grantedAt: '2026-10-10T00:00:00+00:00' }),  // re-opt-in AFTER the revoke
    ]
    const c = activeConsent(consents, 'c_b2c', 'email', 'commercial')
    expect(c?.grantedAt).toBe('2026-10-10T00:00:00+00:00')
  })

  it('a grant simultaneous with the latest revocation does NOT re-authorise (strict after)', () => {
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-05T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T12:00:00+00:00' }),
      consent({ grantedAt: '2026-10-07T12:00:00+00:00' }),  // exactly at the revoke instant
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
  })

  it('revocation does NOT cross channels — email revoke leaves sms consent intact', () => {
    const consents: Consent[] = [
      consent({ channel: 'email', grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T01:00:00+00:00' }),
      consent({ channel: 'sms',   grantedAt: '2026-10-01T00:00:00+00:00' }),
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
    expect(activeConsent(consents, 'c_b2c', 'sms',   'commercial')?.grantedAt).toBe('2026-10-01T00:00:00+00:00')
  })

  it('revocation does NOT cross purposes — commercial revoke leaves lifecycle consent intact', () => {
    const consents: Consent[] = [
      consent({ purpose: 'commercial', grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T01:00:00+00:00' }),
      consent({ purpose: 'lifecycle',  grantedAt: '2026-10-01T00:00:00+00:00' }),
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
    expect(activeConsent(consents, 'c_b2c', 'email', 'lifecycle')?.grantedAt).toBe('2026-10-01T00:00:00+00:00')
  })

  it('compares CHRONOLOGICAL instants across offset-varying ISO timestamps, not lexical strings', () => {
    // Oct 5 00:00 UTC vs Oct 5 02:00 +02:00 are the SAME instant.
    // Oct 7 06:00 UTC vs Oct 7 08:00 +02:00 are the SAME instant.
    // Revocation at Oct 7 06:00 UTC MUST dominate a grant written as Oct 5 02:00+02:00.
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-05T02:00:00+02:00' }),   // = Oct 5 00:00 UTC
      consent({ grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T08:00:00+02:00' }), // revoke = Oct 7 06:00 UTC
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()

    // A grant strictly after the revoke, written in a different offset, must still win.
    const consents2: Consent[] = [
      consent({ grantedAt: '2026-10-07T06:00:00+00:00', revokedAt: '2026-10-07T08:00:00+02:00' }),  // revoke = Oct 7 06:00 UTC
      consent({ grantedAt: '2026-10-07T09:00:00+02:00' }),   // = Oct 7 07:00 UTC — after revoke
    ]
    const c = activeConsent(consents2, 'c_b2c', 'email', 'commercial')
    expect(c?.grantedAt).toBe('2026-10-07T09:00:00+02:00')
  })

  it('malformed grant timestamp FAILS CLOSED (row rejected)', () => {
    const consents: Consent[] = [
      consent({ grantedAt: 'not-a-date' as unknown as string }),
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
  })

  it('malformed revoke timestamp FAILS CLOSED (row treated as blocking, no older grant resurrects)', () => {
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-01T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: 'not-a-date' as unknown as string }),
    ]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
  })

  it('channel + purpose scope is strict', () => {
    const consents: Consent[] = [consent({ channel: 'sms' })]
    expect(activeConsent(consents, 'c_b2c', 'email', 'commercial')).toBeNull()
  })

  it('empty/falsy contactId never matches, even against malformed rows', () => {
    const consents: Consent[] = [consent({ contactId: '' as unknown as string })]
    expect(activeConsent(consents, '', 'email', 'commercial')).toBeNull()
  })

  it('hasPermission propagates revocation dominance (no silent resurrection)', () => {
    const consents: Consent[] = [
      consent({ grantedAt: '2026-10-01T00:00:00+00:00' }),
      consent({ grantedAt: '2026-10-07T00:00:00+00:00', revokedAt: '2026-10-07T01:00:00+00:00' }),
    ]
    const perm = hasPermission(b2cContact, 'email', 'commercial', consents)
    expect(perm.ok).toBe(false)
    expect(perm.reason).toBe('no_consent')
  })
})

// ── hasPermission ──────────────────────────────────────────────────────────────────────

describe('hasPermission', () => {
  it('transactional + security pass without an explicit consent row', () => {
    expect(hasPermission(b2cContact, 'email', 'transactional', []).ok).toBe(true)
    expect(hasPermission(b2cContact, 'email', 'security',      []).ok).toBe(true)
  })
  it('operational_b2b is denied for b2c contacts', () => {
    const r = hasPermission(b2cContact, 'email', 'operational_b2b', [])
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('operational_b2b_requires_b2b')
  })
  it('commercial b2c without consent is denied', () => {
    expect(hasPermission(b2cContact, 'email', 'commercial', []).ok).toBe(false)
  })
  it('commercial b2c with soft_opt_in is accepted', () => {
    const ok = hasPermission(b2cContact, 'email', 'commercial', [consent({ legalBasis: 'soft_opt_in' })])
    expect(ok.ok).toBe(true)
    expect(ok.basis).toBe('soft_opt_in')
  })
  it('cold_b2b requires b2b + legitimate_interest', () => {
    const ok = hasPermission(b2bContact, 'email', 'cold_b2b', [consent({ contactId: 'c_b2b', purpose: 'cold_b2b', legalBasis: 'legitimate_interest' })])
    expect(ok.ok).toBe(true)
    const no = hasPermission(b2bContact, 'email', 'cold_b2b', [consent({ contactId: 'c_b2b', purpose: 'cold_b2b', legalBasis: 'consent' })])
    expect(no.ok).toBe(false)
    expect(no.reason).toBe('legal_basis_not_acceptable')
  })
})

// ── quiet hours ────────────────────────────────────────────────────────────────────────

describe('isInQuietHours', () => {
  it('wraps midnight — 21..9 includes 23 and 2 but not 10', () => {
    const w = { startHour: 21, endHour: 9 }
    expect(isInQuietHours(23, w)).toBe(true)
    expect(isInQuietHours(2,  w)).toBe(true)
    expect(isInQuietHours(10, w)).toBe(false)
  })
  it('contiguous — 9..18 includes 10, excludes 20', () => {
    const w = { startHour: 9, endHour: 18 }
    expect(isInQuietHours(10, w)).toBe(true)
    expect(isInQuietHours(20, w)).toBe(false)
  })
  it('empty window — startHour === endHour never matches', () => {
    expect(isInQuietHours(0, { startHour: 5, endHour: 5 })).toBe(false)
  })
})

describe('localHour', () => {
  it('respects the timezone', () => {
    // 2026-01-01T00:30Z = 01:30 Europe/Paris (winter)
    const ms = Date.UTC(2026, 0, 1, 0, 30)
    expect(localHour(ms, 'Europe/Paris')).toBe(1)
    expect(localHour(ms, null)).toBe(0)
  })
})

describe('msUntilQuietHoursEnd', () => {
  it('returns 0 when outside the quiet window', () => {
    const ms = Date.UTC(2026, 5, 1, 12, 0)  // 14:00 Paris in June (DST)
    expect(msUntilQuietHoursEnd(ms, 'Europe/Paris', DEFAULT_QUIET_HOURS)).toBe(0)
  })
  it('returns ms until end of window when inside', () => {
    // 03:00 UTC on 2026-06-01 = 05:00 Paris (summer, UTC+2). Default quiet 21..9 → still inside.
    // Expected delay = until 09:00 Paris = 07:00 UTC → 4h.
    const ms = Date.UTC(2026, 5, 1, 3, 0)
    const delay = msUntilQuietHoursEnd(ms, 'Europe/Paris', DEFAULT_QUIET_HOURS)
    expect(delay).toBeGreaterThan(3.9 * 3_600_000)
    expect(delay).toBeLessThan(4.1 * 3_600_000)
  })

  // Europe/Paris DST transitions in 2026:
  //   - Spring forward: Sun 2026-03-29, 02:00 CET (UTC+1) → 03:00 CEST (UTC+2)
  //   - Fall back:      Sun 2026-10-25, 03:00 CEST (UTC+2) → 02:00 CET  (UTC+1)
  // Nominal-hour counting over UTC steps misstates the delay across these boundaries.
  // The gate MUST use the real local hour at nowMs + k*hour, not a nominal increment.

  it('SPRING-FORWARD: 01:30 Paris local (00:30 UTC on 2026-03-29) → 09:00 Paris local = 6h30 real time', () => {
    // 2026-03-29 00:30 UTC = 01:30 CET. Default quiet 21..9. Local hour 1 → quiet.
    // Clock jumps 02:00 CET → 03:00 CEST at 2026-03-29 01:00 UTC.
    // 09:00 CEST on 2026-03-29 = 07:00 UTC. Delay = 07:00 - 00:30 = 6h30m exactly.
    const nowMs = Date.UTC(2026, 2, 29, 0, 30)
    const expected = 6.5 * 3_600_000
    expect(msUntilQuietHoursEnd(nowMs, 'Europe/Paris', DEFAULT_QUIET_HOURS)).toBe(expected)
  })

  it('FALL-BACK: 02:30 Paris local (00:30 UTC on 2026-10-25) → 09:00 Paris local = 7h30 real time (not 6h30)', () => {
    // 2026-10-25 00:30 UTC = 02:30 CEST. Default quiet 21..9. Local hour 2 → quiet.
    // Clock rewinds 03:00 CEST → 02:00 CET at 2026-10-25 01:00 UTC.
    // 09:00 CET on 2026-10-25 = 08:00 UTC. Delay = 08:00 - 00:30 = 7h30m.
    // The nominal-hour algorithm UNDER-estimates by 1h here (returns 6h30), releasing
    // one quiet hour early — i.e. sending inside quiet. That is the regression.
    const nowMs = Date.UTC(2026, 9, 25, 0, 30)
    const expected = 7.5 * 3_600_000
    expect(msUntilQuietHoursEnd(nowMs, 'Europe/Paris', DEFAULT_QUIET_HOURS)).toBe(expected)
  })

  it('is deterministic from (nowMs, timezone, window) — no clock reads, 24 bounded steps', () => {
    // Calling twice with the same inputs must give the same answer; test harness runs with
    // a fake system clock set elsewhere and the gate must ignore it.
    const nowMs = Date.UTC(2026, 9, 25, 0, 30)
    const a = msUntilQuietHoursEnd(nowMs, 'Europe/Paris', DEFAULT_QUIET_HOURS)
    const b = msUntilQuietHoursEnd(nowMs, 'Europe/Paris', DEFAULT_QUIET_HOURS)
    expect(a).toBe(b)
  })

  it('INVALID timezone string FAILS CLOSED — defer 24h, not silent-send using UTC hour', () => {
    // A contact row whose timezone column is a typo (`'Not/A/Zone'`) or a removed IANA zone
    // would make Intl.DateTimeFormat throw. The gate must NOT quietly fall back to
    // getUTCHours() and send: a Honolulu user at local 02:00 is at 12:00 UTC — UTC fallback
    // would say "noon, not quiet" and we'd blast at 02:00 their time. Doctrine: unknown
    // timezone ⇒ cannot prove non-quiet ⇒ defer. Null is a distinct, documented contract.
    const nowMs = Date.UTC(2026, 9, 8, 12, 0)
    const delay = msUntilQuietHoursEnd(nowMs, 'Not/A/Zone', DEFAULT_QUIET_HOURS)
    expect(delay).toBeGreaterThan(0)
  })
})

// ── frequency caps ─────────────────────────────────────────────────────────────────────

describe('checkFrequencyCap', () => {
  const nowMs = Date.UTC(2026, 9, 8, 12, 0)
  const twoCapsPerDay = [{ channel: 'email' as const, windowMs: 86_400_000, max: 2 }]

  it('passes under cap', () => {
    const r = checkFrequencyCap(nowMs, 'email', [nowMs - 3_600_000], twoCapsPerDay)
    expect(r.allowed).toBe(true)
  })
  it('defers at cap, retryAfter = oldest + window - now', () => {
    const oldest = nowMs - 20 * 3_600_000
    const r = checkFrequencyCap(nowMs, 'email', [oldest, nowMs - 3_600_000], twoCapsPerDay)
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.retryAfterMs).toBe(oldest + 86_400_000 - nowMs)
    }
  })
  it('ignores sends on a different channel', () => {
    const r = checkFrequencyCap(nowMs, 'email', [], twoCapsPerDay)
    expect(r.allowed).toBe(true)
  })
  it('max=0 blocks hard with a 1-day retry', () => {
    const r = checkFrequencyCap(nowMs, 'email', [], [{ channel: 'email', windowMs: 86_400_000, max: 0 }])
    expect(r.allowed).toBe(false)
  })

  it('with multiple applicable caps, returns the LONGEST retry across ALL violators', () => {
    // Early-returning on the first breached cap schedules the next attempt too soon when a
    // longer cap also applies. The caller must defer until EVERY breached cap would clear.
    const DAY = 86_400_000, HOUR = 3_600_000, WEEK = 7 * DAY
    const now = Date.UTC(2026, 9, 8, 12, 0)
    const caps = [
      { channel: 'email' as const, windowMs: DAY,  max: 2 },  // short cap: oldest=now-3h → retry 21h
      { channel: 'email' as const, windowMs: WEEK, max: 3 },  // long cap:  oldest=now-5d → retry 2d
    ]
    const sends = [now - 5 * DAY, now - 3 * HOUR, now - 2 * HOUR]
    const r = checkFrequencyCap(now, 'email', sends, caps)
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      // MUST take the longer retry (2 days), not the shorter one (21h).
      expect(r.retryAfterMs).toBe(2 * DAY)
    }
  })

  it('non-applicable caps (different channel) do not drag the retry up', () => {
    const DAY = 86_400_000, HOUR = 3_600_000
    const now = Date.UTC(2026, 9, 8, 12, 0)
    const caps = [
      { channel: 'email' as const, windowMs: DAY, max: 1 },  // violated → retry 23h
      { channel: 'sms'   as const, windowMs: 30 * DAY, max: 0 },  // hard-block cap on OTHER channel
    ]
    const sends = [now - 1 * HOUR]
    const r = checkFrequencyCap(now, 'email', sends, caps)
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.retryAfterMs).toBe(23 * HOUR)
    }
  })

  it('malformed cap config (NaN / negative windowMs) FAILS CLOSED — defer', () => {
    // A broken admin config must NOT silently bypass the cap. The naive implementation
    // computes `windowStart = nowMs - NaN = NaN` and `t > NaN` is false for every send,
    // leaving `inWindow` empty and returning `allowed: true` — i.e. the admin's hard cap
    // disappears. Fail-closed: refuse this cap by deferring 24h, same as `max<=0`.
    const now = Date.UTC(2026, 9, 8, 12, 0)
    const sends = [now - 3_600_000, now - 2 * 3_600_000, now - 3 * 3_600_000]
    const nan = checkFrequencyCap(now, 'email', sends, [{ channel: 'email', windowMs: Number.NaN, max: 1 }])
    expect(nan.allowed).toBe(false)
    const neg = checkFrequencyCap(now, 'email', sends, [{ channel: 'email', windowMs: -1_000, max: 1 }])
    expect(neg.allowed).toBe(false)
  })
})

// ── composite canSend ──────────────────────────────────────────────────────────────────

describe('canSend', () => {
  const base: CanSendInput = {
    contact:        b2cContact,
    channel:        'email',
    purpose:        'commercial',
    nowMs:          Date.UTC(2026, 9, 8, 12, 0),  // 14:00 Paris — outside default quiet
    consents:       [consent({})],
    suppressions:   [],
    recentSendTimestampsMs: [],
    frequencyCaps:  [],
    quietHours:     null,
  }

  it('allows under happy path', () => {
    expect(canSend(base).outcome).toBe('allow')
  })

  it('suppression blocks even when consent is present', () => {
    const r = canSend({ ...base, suppressions: [{ contactId: 'c_b2c', channel: 'email', reason: 'complaint', scope: 'commercial', since: '2026-10-07T00:00:00+00:00' }] })
    expect(r.outcome).toBe('block')
    expect(r.reason).toMatch(/suppressed/)
  })

  it("scope='commercial' suppression does NOT block transactional sends", () => {
    const r = canSend({
      ...base, purpose: 'transactional',
      suppressions: [{ contactId: 'c_b2c', channel: 'email', reason: 'complaint', scope: 'commercial', since: '2026-10-07T00:00:00+00:00' }],
    })
    expect(r.outcome).toBe('allow')
  })

  it("scope='all' suppression DOES block transactional sends (bad address)", () => {
    const r = canSend({
      ...base, purpose: 'transactional',
      suppressions: [{ contactId: 'c_b2c', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-07T00:00:00+00:00' }],
    })
    expect(r.outcome).toBe('block')
    expect(r.reason).toMatch(/suppressed/)
  })

  it('missing consent blocks', () => {
    const r = canSend({ ...base, consents: [] })
    expect(r.outcome).toBe('block')
    expect(r.reason).toMatch(/no_permission/)
  })

  it('quiet hours DEFER for commercial, with ms-precise retry', () => {
    // 03:00 UTC = 05:00 Paris → inside default quiet 21..9
    const r = canSend({ ...base, nowMs: Date.UTC(2026, 5, 1, 3, 0) })
    expect(r.outcome).toBe('defer')
    expect(r.reason).toBe('quiet_hours')
    expect(r.retryAfterMs ?? 0).toBeGreaterThan(0)
  })

  it('transactional purpose bypasses quiet hours', () => {
    const r = canSend({ ...base, purpose: 'transactional', nowMs: Date.UTC(2026, 5, 1, 3, 0) })
    expect(r.outcome).toBe('allow')
  })

  it('frequency cap DEFERS with a positive retry', () => {
    const now = base.nowMs
    const r = canSend({
      ...base,
      frequencyCaps: [{ channel: 'email', windowMs: 86_400_000, max: 1 }],
      recentSendTimestampsMs: [now - 3_600_000],
    })
    expect(r.outcome).toBe('defer')
    expect(r.reason).toBe('frequency_cap')
    expect(r.retryAfterMs ?? 0).toBeGreaterThan(0)
  })

  it('AI drafts receive the same gate — purpose rules do not change by producer', () => {
    // The gate is agnostic to who drafted. If no consent, AI-drafted still blocks.
    const r = canSend({ ...base, consents: [] })
    expect(r.outcome).toBe('block')
  })
})
