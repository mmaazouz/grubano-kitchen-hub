import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/auth/step-up/request (Phase 3 — Agent 88) ──────────────────────────
// Sends a step-up code bound to the SESSION email + a valid purpose. Gated 404 OFF;
// 401 without a session; 400 on an unknown purpose; 429 when throttled. The code is
// emailed (never in the response). nodemailer + email-otp are mocked.

const { sendMail, session, otp } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  session: vi.fn(),
  otp: { issueEmailOtp: vi.fn(), isMoneyStepUpEnabled: vi.fn() },
}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/email-otp', () => otp)

import { POST } from '@/app/api/auth/step-up/request/route'

const post = (body?: unknown) => POST(new Request('http://x/api/auth/step-up/request', {
  method: 'POST', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTH_MONEY_STEPUP_ENABLED = 'true'
  process.env.SMTP_PASS = 'x'
  otp.isMoneyStepUpEnabled.mockReturnValue(true)
  session.mockResolvedValue({ user: { id: 'op1', email: 'u@x.fr' } })
  otp.issueEmailOtp.mockResolvedValue({ ok: true, code: '424242' })
})
afterEach(() => { delete process.env.AUTH_MONEY_STEPUP_ENABLED; delete process.env.SMTP_PASS })

it('flag OFF → 404, no work', async () => {
  otp.isMoneyStepUpEnabled.mockReturnValue(false)
  expect((await post({ purpose: 'stepup:withdraw' })).status).toBe(404)
  expect(session).not.toHaveBeenCalled()
  expect(otp.issueEmailOtp).not.toHaveBeenCalled()
})

it('no session → 401', async () => {
  session.mockResolvedValue(null)
  expect((await post({ purpose: 'stepup:withdraw' })).status).toBe(401)
  expect(otp.issueEmailOtp).not.toHaveBeenCalled()
})

it('unknown purpose → 400, no code issued', async () => {
  expect((await post({ purpose: 'login' })).status).toBe(400)           // login is not a step-up purpose
  expect((await post({ purpose: 'stepup:hack' })).status).toBe(400)
  expect(otp.issueEmailOtp).not.toHaveBeenCalled()
})

it('valid purpose → issues a code bound to the SESSION email + purpose, emails it (not in response)', async () => {
  const res = await post({ purpose: 'stepup:withdraw' })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ ok: true })                                    // code NEVER returned
  expect(otp.issueEmailOtp).toHaveBeenCalledWith('u@x.fr', 'stepup:withdraw')
  expect(sendMail).toHaveBeenCalledTimes(1)
  // the emailed body carries the code, addressed to the session email
  const mail = sendMail.mock.calls[0][0]
  expect(mail.to).toBe('u@x.fr')
  expect(String(mail.text) + String(mail.html)).toContain('424242')
})

it('throttled → 429, no email', async () => {
  otp.issueEmailOtp.mockResolvedValue({ ok: false, reason: 'throttled' })
  const res = await post({ purpose: 'stepup:bank' })
  expect(res.status).toBe(429)
  expect(sendMail).not.toHaveBeenCalled()
})
