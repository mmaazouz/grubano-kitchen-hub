import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Money step-up guard (Phase 3 — Agent 88) ─────────────────────────────────────
// OFF → always ok (guarded action byte-identical). ON → fresh single-use email code
// required; missing → stepup_required, wrong/expired → stepup_invalid. The code is
// verified via the (constant-time, single-use) verifyEmailOtp — mocked here to isolate
// the guard's dispatch.

const { otp } = vi.hoisted(() => ({ otp: { verifyEmailOtp: vi.fn(), isMoneyStepUpEnabled: vi.fn() } }))
vi.mock('@/lib/email-otp', () => otp)

import { requireStepUp } from '@/lib/step-up'

beforeEach(() => vi.clearAllMocks())

describe('requireStepUp', () => {
  it('OFF → ALWAYS ok, never even checks a code (byte-identical action)', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(false)
    expect(await requireStepUp('u@x.fr', 'stepup:withdraw', null)).toEqual({ ok: true })
    expect(await requireStepUp('u@x.fr', 'stepup:withdraw', '424242')).toEqual({ ok: true })
    expect(otp.verifyEmailOtp).not.toHaveBeenCalled()
  })

  it('ON + NO code → stepup_required (401), no verify', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(true)
    expect(await requireStepUp('u@x.fr', 'stepup:withdraw', null)).toEqual({ ok: false, status: 401, reason: 'stepup_required' })
    expect(otp.verifyEmailOtp).not.toHaveBeenCalled()
  })

  it('ON + VALID code → ok; verifies with the exact (email, purpose, code)', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(true)
    otp.verifyEmailOtp.mockResolvedValue(true)
    expect(await requireStepUp('u@x.fr', 'stepup:withdraw', '424242')).toEqual({ ok: true })
    expect(otp.verifyEmailOtp).toHaveBeenCalledWith('u@x.fr', 'stepup:withdraw', '424242')
  })

  it('ON + WRONG/expired code → stepup_invalid (401)', async () => {
    otp.isMoneyStepUpEnabled.mockReturnValue(true)
    otp.verifyEmailOtp.mockResolvedValue(false)
    expect(await requireStepUp('u@x.fr', 'stepup:withdraw', '000000')).toEqual({ ok: false, status: 401, reason: 'stepup_invalid' })
  })
})
