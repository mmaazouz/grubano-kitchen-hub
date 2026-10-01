import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { sha256 } from '@/lib/partner-verification'

// ── Account email change (Agent 147) — flag-gated identifier mutation ───────────
// The security core is lib/email-change (atomic + race-safe mutation, scope guards, token
// validation); the 3 routes orchestrate it. Money engine + lib/email-otp are untouched (proven
// in contre-épreuves). Here: lib unit tests + route behaviour + no-requireStepUp/no-money scans.

const db = vi.hoisted(() => ({
  operator:           { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  supplierProfile:    { findUnique: vi.fn() },
  logisticsProfile:   { findUnique: vi.fn() },
  prestataireProfile: { findUnique: vi.fn() },
  account:            { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const otp = vi.hoisted(() => ({ issueEmailOtp: vi.fn(), verifyEmailOtp: vi.fn() }))
vi.mock('@/lib/email-otp', () => otp)
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }))
vi.mock('dns', () => ({ promises: {
  resolveMx: vi.fn().mockResolvedValue([{ exchange: 'mx.example', priority: 10 }]),
  resolve:   vi.fn().mockResolvedValue(['1.2.3.4']),
} }))
const tx = vi.hoisted(() => ({
  sendEmailChangeLink:      vi.fn().mockResolvedValue({ status: 'sent' }),
  sendEmailAlreadyUsedNotice: vi.fn().mockResolvedValue({ status: 'sent' }),
  sendEmailChangedAlert:    vi.fn().mockResolvedValue({ status: 'sent' }),
  sendEmailChangeConfirm:   vi.fn().mockResolvedValue({ status: 'sent' }),
}))
vi.mock('@/lib/transactional-emails', () => tx)

import { getServerSession } from 'next-auth'
import {
  isEmailChangeEnabled, checkEmailChangeEligibility, setPendingEmail, consumeEmailChange, domainAcceptsMail,
} from '@/lib/email-change'
import { POST as requestCodePOST } from '@/app/api/account/email-change/request-code/route'
import { POST as requestPOST } from '@/app/api/account/email-change/request/route'
import { POST as confirmPOST } from '@/app/api/account/email-change/confirm/route'

const P2002 = new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: '5.22.0' })
const future = () => new Date(Date.now() + 10 * 60 * 1000)
const past   = () => new Date(Date.now() - 1000)
const fakeReq = (body: unknown) => ({ json: async () => body, headers: { get: () => null } }) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTH_EMAIL_CHANGE_ENABLED = 'true'
  process.env.NEXTAUTH_URL = 'https://test.grubano.com'
  process.env.SMTP_PASS = 'x'
  process.env.NEXTAUTH_SECRET = 'pepper'
  // default: eligible consumer
  db.operator.findUnique.mockResolvedValue({ id: 'op1', email: 'old@x.com', role: 'consumer' })
  db.operator.update.mockResolvedValue({ id: 'op1' })
  db.operator.updateMany.mockResolvedValue({ count: 1 })
  db.supplierProfile.findUnique.mockResolvedValue(null)
  db.logisticsProfile.findUnique.mockResolvedValue(null)
  db.prestataireProfile.findUnique.mockResolvedValue(null)
  db.account.findFirst.mockResolvedValue(null)
  ;(getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'op1' } })
  otp.issueEmailOtp.mockResolvedValue({ ok: true, code: '123456' })
  otp.verifyEmailOtp.mockResolvedValue(true)
  mail.sendMail.mockResolvedValue({ messageId: 'm' })
})

describe('lib/email-change — eligibility scope guard', () => {
  it('eligible consumer → ok, email READ FROM DB', async () => {
    const r = await checkEmailChangeEligibility('op1')
    expect(r).toEqual({ ok: true, email: 'old@x.com', role: 'consumer' })
  })
  it('not found → not_found', async () => {
    db.operator.findUnique.mockResolvedValueOnce(null)
    expect(await checkEmailChangeEligibility('opX')).toEqual({ ok: false, reason: 'not_found' })
  })
  it('email-keyed role (supplier) → unsupported (no orphan)', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'o@x.com', role: 'supplier' })
    expect(await checkEmailChangeEligibility('op1')).toEqual({ ok: false, reason: 'unsupported_account' })
  })
  it('email-keyed PROFILE present (multi-role) → unsupported', async () => {
    db.logisticsProfile.findUnique.mockResolvedValueOnce({ id: 'lp1' })
    expect(await checkEmailChangeEligibility('op1')).toEqual({ ok: false, reason: 'unsupported_account' })
  })
  it('OAuth-linked (Account row) → unsupported', async () => {
    db.account.findFirst.mockResolvedValueOnce({ id: 'acc1' })
    expect(await checkEmailChangeEligibility('op1')).toEqual({ ok: false, reason: 'unsupported_account' })
  })
})

describe('lib/email-change — token mint + atomic consume', () => {
  it('setPendingEmail mints `${id}.${secret}`, stores sha256(secret) + pending + expiry', async () => {
    const { token } = await setPendingEmail('op1', 'New@X.com')
    expect(token.startsWith('op1.')).toBe(true)
    const secret = token.slice('op1.'.length)
    const data = db.operator.update.mock.calls[0][0].data
    expect(data.pendingEmail).toBe('new@x.com')               // normalised
    expect(data.pendingEmailTokenHash).toBe(sha256(secret))   // only the hash stored
    expect(data.pendingEmailTokenExpiry.getTime()).toBeGreaterThan(Date.now())
  })

  it('valid token → ATOMIC mutate email + clear pending (race-safe), returns {old,new}', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({
      id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com',
      pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future(),
    })
    const r = await consumeEmailChange(`op1.${secret}`)
    expect(r).toEqual({ ok: true, oldEmail: 'old@x.com', newEmail: 'new@x.com' })
    const upd = db.operator.updateMany.mock.calls[0][0]
    expect(upd.where).toMatchObject({ id: 'op1', pendingEmailTokenHash: sha256(secret) })
    expect(upd.data).toEqual({ email: 'new@x.com', pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null })
  })

  it('expired token → invalid (no mutation)', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: past() })
    expect(await consumeEmailChange(`op1.${secret}`)).toEqual({ ok: false, reason: 'invalid' })
    expect(db.operator.updateMany).not.toHaveBeenCalled()
  })
  it('wrong secret → invalid', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com', pendingEmailTokenHash: sha256('real'), pendingEmailTokenExpiry: future() })
    expect(await consumeEmailChange('op1.wrong')).toEqual({ ok: false, reason: 'invalid' })
    expect(db.operator.updateMany).not.toHaveBeenCalled()
  })
  it('no pending → invalid', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null })
    expect(await consumeEmailChange('op1.x')).toEqual({ ok: false, reason: 'invalid' })
  })
  it('lost the race (updateMany count 0) → invalid', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future() })
    db.operator.updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await consumeEmailChange(`op1.${secret}`)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('new email taken between request and confirm (P2002) → collision, current email kept', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'taken@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future() })
    db.operator.updateMany.mockRejectedValueOnce(P2002).mockResolvedValueOnce({ count: 1 }) // mutate throws, best-effort clear ok
    expect(await consumeEmailChange(`op1.${secret}`)).toEqual({ ok: false, reason: 'collision' })
  })
  it('re-checks eligibility at confirm: account became email-keyed mid-flow → invalid, NO email mutation', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique
      .mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future() }) // consume load
      .mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', role: 'supplier' }) // eligibility re-check → now ineligible
    const r = await consumeEmailChange(`op1.${secret}`)
    expect(r).toEqual({ ok: false, reason: 'invalid' })
    const mutated = db.operator.updateMany.mock.calls.some((c) => c[0].data.email !== undefined)
    expect(mutated).toBe(false) // only the best-effort pending-clear ran; email was NEVER changed
  })

  it('domainAcceptsMail true when MX resolves', async () => {
    expect(await domainAcceptsMail('a@b.com')).toBe(true)
  })
})

describe('route: request-code', () => {
  it('flag OFF → 404', async () => {
    delete process.env.AUTH_EMAIL_CHANGE_ENABLED
    expect((await requestCodePOST()).status).toBe(404)
  })
  it('eligible → issues OTP to the DB email (not JWT) + emails it', async () => {
    const res = await requestCodePOST()
    expect(res.status).toBe(200)
    expect(otp.issueEmailOtp).toHaveBeenCalledWith('old@x.com', 'stepup:email_change')
    expect(mail.sendMail).toHaveBeenCalled()
  })
  it('ineligible (supplier) → 403, no OTP issued', async () => {
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'o@x.com', role: 'supplier' })
    expect((await requestCodePOST()).status).toBe(403)
    expect(otp.issueEmailOtp).not.toHaveBeenCalled()
  })
  it('throttled → 429', async () => {
    otp.issueEmailOtp.mockResolvedValueOnce({ ok: false, reason: 'throttled' })
    expect((await requestCodePOST()).status).toBe(429)
  })
})

describe('route: request', () => {
  it('flag OFF → 404', async () => {
    delete process.env.AUTH_EMAIL_CHANGE_ENABLED
    expect((await requestPOST(fakeReq({ newEmail: 'n@x.com', currentEmailCode: '1' }))).status).toBe(404)
  })
  it('bad current code → 400, NO pending stored', async () => {
    otp.verifyEmailOtp.mockResolvedValueOnce(false)
    const res = await requestPOST(fakeReq({ newEmail: 'new@x.com', currentEmailCode: '000000' }))
    expect(res.status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(tx.sendEmailChangeLink).not.toHaveBeenCalled()
  })
  it('good code + FREE new email → generic ok, pending stored, link emailed', async () => {
    db.operator.findUnique.mockImplementation(({ where }: { where: { id?: string; email?: string } }) =>
      where.id ? Promise.resolve({ id: 'op1', email: 'old@x.com', role: 'consumer' }) : Promise.resolve(null))
    const res = await requestPOST(fakeReq({ newEmail: 'new@x.com', currentEmailCode: '123456' }))
    expect(res.status).toBe(200)
    expect(otp.verifyEmailOtp).toHaveBeenCalledWith('old@x.com', 'stepup:email_change', '123456')
    expect(db.operator.update).toHaveBeenCalled()              // pending stored
    expect(tx.sendEmailChangeLink).toHaveBeenCalled()
    expect(tx.sendEmailAlreadyUsedNotice).not.toHaveBeenCalled()
  })
  it('good code + TAKEN new email → generic ok, NO pending, third party notified (anti-enum)', async () => {
    db.operator.findUnique.mockImplementation(({ where }: { where: { id?: string; email?: string } }) =>
      where.id ? Promise.resolve({ id: 'op1', email: 'old@x.com', role: 'consumer' }) : Promise.resolve({ id: 'other' }))
    const res = await requestPOST(fakeReq({ newEmail: 'taken@x.com', currentEmailCode: '123456' }))
    expect(res.status).toBe(200)                                // SAME generic response
    expect(tx.sendEmailAlreadyUsedNotice).toHaveBeenCalledWith({ to: 'taken@x.com' })
    expect(db.operator.update).not.toHaveBeenCalled()           // no pending
    expect(tx.sendEmailChangeLink).not.toHaveBeenCalled()
  })
  it('ineligible → 403', async () => {
    db.account.findFirst.mockResolvedValueOnce({ id: 'acc1' })  // OAuth
    expect((await requestPOST(fakeReq({ newEmail: 'n@x.com', currentEmailCode: '1' }))).status).toBe(403)
  })
})

describe('route: confirm', () => {
  it('flag OFF → 404', async () => {
    delete process.env.AUTH_EMAIL_CHANGE_ENABLED
    expect((await confirmPOST(fakeReq({ token: 'op1.x' }))).status).toBe(404)
  })
  it('valid token → 200, email mutated, alert OLD + confirm NEW sent', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'new@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future() })
    const res = await confirmPOST(fakeReq({ token: `op1.${secret}` }))
    expect(res.status).toBe(200)
    expect(db.operator.updateMany.mock.calls[0][0].data.email).toBe('new@x.com')
    expect(tx.sendEmailChangedAlert).toHaveBeenCalled()         // OLD
    expect(tx.sendEmailChangeConfirm).toHaveBeenCalled()        // NEW
  })
  it('invalid/expired/replayed token → 400, no notifications', async () => {
    const res = await confirmPOST(fakeReq({ token: 'malformed' })) // no dot → parse null
    expect(res.status).toBe(400)
    expect(tx.sendEmailChangedAlert).not.toHaveBeenCalled()
  })
  it('concurrent claim (P2002) → 409 collision, email NOT changed', async () => {
    const secret = 'deadbeef'
    db.operator.findUnique.mockResolvedValueOnce({ id: 'op1', email: 'old@x.com', pendingEmail: 'taken@x.com', pendingEmailTokenHash: sha256(secret), pendingEmailTokenExpiry: future() })
    db.operator.updateMany.mockRejectedValueOnce(P2002).mockResolvedValueOnce({ count: 1 })
    expect((await confirmPOST(fakeReq({ token: `op1.${secret}` }))).status).toBe(409)
  })
})

describe('source-scan: verifyEmailOtp DIRECT (no inert requireStepUp), no money, lib/email-otp untouched', () => {
  // Strip comments so the "we deliberately do NOT use requireStepUp" doc-prose can't trip the scan —
  // we assert the actual CODE never imports/calls requireStepUp or any money lib.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'))
  const NO_MONEY = /lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe|webhooks\/stripe|payCreator|payPartner/
  const routes = [
    'app/api/account/email-change/request-code/route.ts',
    'app/api/account/email-change/request/route.ts',
    'app/api/account/email-change/confirm/route.ts',
  ]
  it('no route imports requireStepUp / lib/step-up (it is inert when the money flag is OFF)', () => {
    for (const r of routes) {
      const c = read(r)
      expect(/requireStepUp|lib\/step-up/.test(c)).toBe(false)
      expect(NO_MONEY.test(c)).toBe(false)
    }
  })
  it('request route proves identity via verifyEmailOtp DIRECT', () => {
    const c = read('app/api/account/email-change/request/route.ts')
    expect(/verifyEmailOtp\(\s*currentEmail\s*,\s*'stepup:email_change'/.test(c)).toBe(true)
  })
  it('lib/email-otp.ts still declares exactly the original 4 OtpPurpose values (NOT modified)', () => {
    const c = read('lib/email-otp.ts')
    expect(c).toContain("export type OtpPurpose = 'login' | 'stepup:withdraw' | 'stepup:bank' | 'stepup:email_change'")
  })
})
