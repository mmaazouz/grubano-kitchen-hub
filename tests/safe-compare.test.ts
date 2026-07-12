import { describe, it, expect, afterEach } from 'vitest'
import { safeEqual, isInternalCronRequest } from '@/lib/safe-compare'

// ── ADM7 — constant-time compare + internal-cron guard ───────────────────────────
// safeEqual must be a behavioural drop-in for `===` (same true/false) while being
// constant-time; isInternalCronRequest must fail closed on an unset/empty secret and
// reject a missing/wrong header.

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('a1b2c3', 'a1b2c3')).toBe(true)
    expect(safeEqual('Bearer secret-token', 'Bearer secret-token')).toBe(true)
  })

  it('returns false for different same-length strings', () => {
    expect(safeEqual('a1b2c3', 'a1b2c4')).toBe(false)
  })

  it('returns false for different-length strings (no throw)', () => {
    expect(safeEqual('short', 'a-much-longer-token')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
    expect(safeEqual('x', '')).toBe(false)
  })

  it('two empty strings are equal (callers must guard empty secrets separately)', () => {
    expect(safeEqual('', '')).toBe(true)
  })

  it('handles unicode without throwing', () => {
    expect(safeEqual('clé-😀', 'clé-😀')).toBe(true)
    expect(safeEqual('clé-😀', 'cle-😀')).toBe(false)
  })
})

describe('isInternalCronRequest', () => {
  const ORIG = process.env.INTERNAL_CRON_TOKEN
  afterEach(() => { process.env.INTERNAL_CRON_TOKEN = ORIG })

  const reqWith = (token?: string) =>
    new Request('https://x/api', { headers: token == null ? {} : { 'x-internal-token': token } })

  it('accepts the exact token', () => {
    process.env.INTERNAL_CRON_TOKEN = 'deadbeefdeadbeef'
    expect(isInternalCronRequest(reqWith('deadbeefdeadbeef'))).toBe(true)
  })

  it('rejects a wrong token', () => {
    process.env.INTERNAL_CRON_TOKEN = 'deadbeefdeadbeef'
    expect(isInternalCronRequest(reqWith('nope'))).toBe(false)
  })

  it('rejects a missing header', () => {
    process.env.INTERNAL_CRON_TOKEN = 'deadbeefdeadbeef'
    expect(isInternalCronRequest(reqWith(undefined))).toBe(false)
  })

  it('fails closed when the env secret is unset or empty', () => {
    delete process.env.INTERNAL_CRON_TOKEN
    expect(isInternalCronRequest(reqWith('anything'))).toBe(false)
    process.env.INTERNAL_CRON_TOKEN = '   '
    expect(isInternalCronRequest(reqWith('anything'))).toBe(false)
    expect(isInternalCronRequest(reqWith(''))).toBe(false)
  })
})
