import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/affiliate/apply — PRE-LOGIN affiliate signup (Agent 118, incr. 1/3) ──
// The route only orchestrates: flag gate (404) + anti-bot (honeypot / too-fast) + zod +
// lowercased email → ensureAffiliateApplicant (the provisioning + Affiliate creation, mocked
// here). NO money mechanics are referenced. The session-only /api/affiliate/join is untouched.

const { ensureFn, enabledFn } = vi.hoisted(() => ({ ensureFn: vi.fn(), enabledFn: vi.fn() }))
vi.mock('@/lib/affiliate-signup', () => ({ ensureAffiliateApplicant: ensureFn }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled: enabledFn }))

import { POST } from '@/app/api/affiliate/apply/route'

let ipSeq = 0
const post = (body: unknown) =>
  POST(new Request('http://x/api/affiliate/apply', {
    method: 'POST',
    // distinct IP per call so the per-IP rate-limit never accumulates across tests
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipSeq}` },
    body: JSON.stringify(body),
  }))
const BASE = { name: 'Jean Dupont', email: 'jean@exemple.fr', consent: true }

beforeEach(() => {
  vi.clearAllMocks()
  enabledFn.mockReturnValue(true)
  ensureFn.mockResolvedValue({ ok: true, created: true, roleAdded: true, affiliate: { operatorId: 'op1', referralCode: 'JEANX', referralLinkSlug: 'jeanx', status: 'active' } })
})

describe('pre-login affiliate signup', () => {
  it('a fresh visitor (name+email+consent) → 200 ok, provisions via ensureAffiliateApplicant', async () => {
    const res = await post(BASE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ensureFn).toHaveBeenCalledTimes(1)
    expect(ensureFn).toHaveBeenCalledWith('jean@exemple.fr', 'Jean Dupont')
  })

  it('lowercases + trims the email before provisioning', async () => {
    await post({ ...BASE, email: '  Jean@Exemple.FR  ' })
    expect(ensureFn.mock.calls[0][0]).toBe('jean@exemple.fr')
  })

  it('FLAG OFF (AFFILIATE_ENABLED) → 404, never provisions', async () => {
    enabledFn.mockReturnValue(false)
    const res = await post(BASE)
    expect(res.status).toBe(404)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('honeypot filled → neutral 200 ok, NEVER provisions (no write)', async () => {
    const res = await post({ ...BASE, website: 'http://spam.bot' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('too-fast submit (< 2 s) → neutral 200 ok, NEVER provisions', async () => {
    const res = await post({ ...BASE, formStartedAt: Date.now() })
    expect(res.status).toBe(200)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('rejects a missing consent → 400, never provisions', async () => {
    const res = await post({ ...BASE, consent: false })
    expect(res.status).toBe(400)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('rejects an invalid email → 400', async () => {
    const res = await post({ ...BASE, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('rejects a too-short name → 400', async () => {
    const res = await post({ ...BASE, name: 'J' })
    expect(res.status).toBe(400)
    expect(ensureFn).not.toHaveBeenCalled()
  })

  it('stays neutral 200 even if provisioning best-effort-fails (anti-enumeration)', async () => {
    ensureFn.mockResolvedValue({ ok: false, reason: 'error' })
    const res = await post(BASE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
