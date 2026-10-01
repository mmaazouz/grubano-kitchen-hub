import { describe, it, expect, afterEach } from 'vitest'
import {
  decideNudgeLevel, resolveNudgeLocale, isOnboardingNudgeEnabled,
  mintUnsubscribeToken, verifyUnsubscribeToken, NUDGE_AGE_MS,
} from '@/lib/onboarding-nudge'

// ── Nudge decision + unsubscribe token (Agent 95) — PURE ──────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_000_000_000_000

describe('decideNudgeLevel — cadence + STOP conditions', () => {
  const base = { nowMs: NOW, sentLevels: [] as number[], unsubscribed: false, isComplete: false }

  it('level 1 is due at ~J+1, not before', () => {
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - (DAY - 1) })).toBeNull()       // 23h59 → not yet
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - DAY })).toBe(1)                 // exactly J+1
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 5 * DAY })).toBe(1)             // overdue → still level 1
  })

  it('level 2 at ~J+3, level 3 at ~J+7 (monotonic, after the prior level was sent)', () => {
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 2 * DAY, sentLevels: [1] })).toBeNull() // 2d < J+3
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 3 * DAY, sentLevels: [1] })).toBe(2)
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 5 * DAY, sentLevels: [1, 2] })).toBeNull() // 5d < J+7
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 7 * DAY, sentLevels: [1, 2] })).toBe(3)
  })

  it('⚠️ STOP — completed onboarding → never nudge', () => {
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 9 * DAY, isComplete: true })).toBeNull()
  })
  it('⚠️ STOP — unsubscribed → never nudge', () => {
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 9 * DAY, unsubscribed: true })).toBeNull()
  })
  it('⚠️ STOP — level 3 already sent → never a 4th', () => {
    expect(decideNudgeLevel({ ...base, createdAtMs: NOW - 30 * DAY, sentLevels: [1, 2, 3] })).toBeNull()
  })

  it('cadence constants are J+1 / J+3 / J+7', () => {
    expect(NUDGE_AGE_MS).toEqual({ 1: DAY, 2: 3 * DAY, 3: 7 * DAY })
  })
})

describe('resolveNudgeLocale', () => {
  it('keeps a supported locale, falls back to fr otherwise', () => {
    for (const l of ['fr', 'en', 'es', 'it', 'ar']) expect(resolveNudgeLocale(l)).toBe(l)
    expect(resolveNudgeLocale('de')).toBe('fr')
    expect(resolveNudgeLocale(null)).toBe('fr')
    expect(resolveNudgeLocale(undefined)).toBe('fr')
    expect(resolveNudgeLocale('')).toBe('fr')
  })
})

describe('unsubscribe token — unguessable, account-bound, constant-time', () => {
  afterEach(() => { delete process.env.NEXTAUTH_SECRET })

  it('round-trips a valid token back to the operator id', () => {
    process.env.NEXTAUTH_SECRET = 'test-secret'
    const tok = mintUnsubscribeToken('op_123')
    expect(tok.startsWith('op_123.')).toBe(true)
    expect(verifyUnsubscribeToken(tok)).toBe('op_123')
  })

  it('⚠️ rejects a tampered mac, a swapped operator id, and garbage (no forgery)', () => {
    process.env.NEXTAUTH_SECRET = 'test-secret'
    const tok = mintUnsubscribeToken('op_123')
    const [id, mac] = tok.split('.')
    expect(verifyUnsubscribeToken(`${id}.${mac.slice(0, -2)}00`)).toBeNull()  // flipped mac
    expect(verifyUnsubscribeToken(`op_999.${mac}`)).toBeNull()                // mac doesn't bind op_999
    expect(verifyUnsubscribeToken('not-a-token')).toBeNull()
    expect(verifyUnsubscribeToken('')).toBeNull()
  })

  it('⚠️ a different server secret cannot validate the token (key isolation)', () => {
    process.env.NEXTAUTH_SECRET = 'secret-A'
    const tok = mintUnsubscribeToken('op_123')
    process.env.NEXTAUTH_SECRET = 'secret-B'
    expect(verifyUnsubscribeToken(tok)).toBeNull()
  })

  it('no secret configured → verify always fails (fail-safe)', () => {
    delete process.env.NEXTAUTH_SECRET
    expect(verifyUnsubscribeToken('op_123.deadbeef')).toBeNull()
  })
})

describe('isOnboardingNudgeEnabled — flag', () => {
  afterEach(() => { delete process.env.ONBOARDING_NUDGE_ENABLED })
  it('only the exact string true enables it', () => {
    expect(isOnboardingNudgeEnabled()).toBe(false)
    process.env.ONBOARDING_NUDGE_ENABLED = 'true'
    expect(isOnboardingNudgeEnabled()).toBe(true)
    process.env.ONBOARDING_NUDGE_ENABLED = '1'
    expect(isOnboardingNudgeEnabled()).toBe(false)
  })
})
