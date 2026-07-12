import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── CredentialsProvider OTP branch (Phase 3 — Agent 88) ──────────────────────────
// The 6-digit login code is an ADDITIVE, GATED sign-in path. Proves: it runs ONLY
// when AUTH_EMAIL_OTP_ENABLED, yields the same user shape, and the magic-link path is
// untouched (still dispatches to authorizeMagicLink). email-otp + magic-link are mocked
// to isolate the provider dispatch.

const { otp, magic, roles } = vi.hoisted(() => ({
  otp:   { authorizeEmailOtpLogin: vi.fn(), isEmailOtpEnabled: vi.fn() },
  magic: { authorizeMagicLink: vi.fn() },
  roles: vi.fn(),
}))
vi.mock('@/lib/email-otp', () => otp)
vi.mock('@/lib/magic-link', () => magic)
vi.mock('@/lib/operator-roles', () => ({ readOperatorRoles: roles }))
vi.mock('@/lib/prisma', () => ({ prisma: { operator: { findUnique: vi.fn() } } }))

import { authOptions } from '@/lib/auth'

const authorize = (authOptions.providers[0] as unknown as {
  options: { authorize: (c: Record<string, string> | undefined) => Promise<unknown> }
}).options.authorize

beforeEach(() => {
  vi.clearAllMocks()
  roles.mockResolvedValue(['creator'])
})
afterEach(() => { delete process.env.AUTH_EMAIL_OTP_ENABLED })

describe('OTP branch — gated', () => {
  it('flag OFF → an {email, otp} credential is IGNORED (no OTP authorize, falls through)', async () => {
    delete process.env.AUTH_EMAIL_OTP_ENABLED
    const u = await authorize({ email: 'x@x.fr', otp: '424242' })
    expect(otp.authorizeEmailOtpLogin).not.toHaveBeenCalled()
    expect(u).toBeNull() // email w/o password, no magic token → no sign-in
  })

  it('flag ON → {email, otp} → authorizeEmailOtpLogin → returns its user', async () => {
    process.env.AUTH_EMAIL_OTP_ENABLED = 'true'
    otp.isEmailOtpEnabled.mockReturnValue(true)
    otp.authorizeEmailOtpLogin.mockResolvedValue({ id: 'op1', name: 'U', email: 'x@x.fr', role: 'creator', roles: ['creator'] })
    const u = await authorize({ email: 'x@x.fr', otp: '424242' })
    expect(otp.authorizeEmailOtpLogin).toHaveBeenCalledWith('x@x.fr', '424242')
    expect(u).toMatchObject({ id: 'op1', role: 'creator' })
  })

  it('flag ON but a bad code → authorizeEmailOtpLogin null → null', async () => {
    process.env.AUTH_EMAIL_OTP_ENABLED = 'true'
    otp.isEmailOtpEnabled.mockReturnValue(true)
    otp.authorizeEmailOtpLogin.mockResolvedValue(null)
    expect(await authorize({ email: 'x@x.fr', otp: '000000' })).toBeNull()
  })
})

describe('magic-link path untouched', () => {
  it('a magicToken credential still dispatches to authorizeMagicLink (OTP flag irrelevant)', async () => {
    otp.isEmailOtpEnabled.mockReturnValue(true) // even with OTP on, magicToken takes its own branch first
    magic.authorizeMagicLink.mockResolvedValue({ id: 'opM', name: 'M', email: 'm@x.fr', role: 'creator' })
    const u = await authorize({ magicToken: 'opM.secret' })
    expect(magic.authorizeMagicLink).toHaveBeenCalledWith('opM.secret')
    expect(otp.authorizeEmailOtpLogin).not.toHaveBeenCalled()
    expect(u).toMatchObject({ id: 'opM', role: 'creator', roles: ['creator'] })
  })
})
