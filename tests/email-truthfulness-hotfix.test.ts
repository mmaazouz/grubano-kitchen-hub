import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── EMAIL TRUTHFULNESS HOTFIX (2026-09-06) — auth + refund e-mails say only what is true ──
// AUTH: formal French, per-mechanism validities derived from the code contracts (link 15 min,
// code 10 min — DIFFERENT), no « réserver une table » promise (sur place OUT), welcome CTA on the
// deployment base, honest 503 when no mail transport is configured (never « lien envoyé »).
// REFUND: success e-mail only after Stripe `succeeded`, neutral actor (never « par {resto} »),
// no numeric bank delay, amount = the ACTUAL succeeded cash refund (never the requested amount).

const { sendMail, db } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  db: {
    operator:      { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    emailDispatch: { create: vi.fn(), deleteMany: vi.fn() },
    emailLog:      { create: vi.fn() },
    loyaltyCustomer: { upsert: vi.fn() },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/i18n', () => ({ locales: ['fr', 'en', 'es', 'it', 'ar'], defaultLocale: 'fr', rtlLocales: ['ar'] }))
vi.mock('@/lib/email-otp', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  issueEmailOtp: async () => ({ ok: true, code: '424242' }),
  isEmailOtpEnabled: () => process.env.AUTH_EMAIL_OTP_ENABLED === 'true',
}))
vi.mock('@/lib/partner-verification', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createVerificationToken: () => ({ token: 'op2.secret', hash: 'h', expiry: new Date(Date.now() + 86_400_000) }),
}))
vi.mock('dns', () => ({ promises: { resolveMx: async () => [{ exchange: 'mx.example.invalid', priority: 10 }], resolve: async () => ['192.0.2.1'] } }))

import { magicLinkValiditySentence, MAGIC_LINK_MINUTES, OTP_CODE_MINUTES } from '@/lib/auth-email-copy'
import { MAGIC_TTL_MS } from '@/lib/magic-link'
import { OTP_TTL_MS } from '@/lib/email-otp'
import { isMailTransportConfigured } from '@/lib/mail-transport-config'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// Unicode-aware boundaries: JS \b treats accented letters as breaks (« n'êtes » would expose a false « tes »).
const INFORMAL = /(?<![\p{L}'’])(tu|ton|ta|tes|toi|clique|copie-colle|saisis|réponds|confirme ton|vérifie ta)(?![\p{L}])|ignore simplement/iu
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;|&#39;/g, "'").replace(/&nbsp;/g, ' ')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'fixture'
  process.env.NEXTAUTH_URL = 'https://app.grubano.com'
  delete process.env.AUTH_EMAIL_OTP_ENABLED
  delete process.env.RATE_LIMIT_ENABLED
  sendMail.mockResolvedValue({ messageId: 'm' })
  db.emailDispatch.create.mockResolvedValue({ id: 'd' })
  db.emailDispatch.deleteMany.mockResolvedValue({ count: 0 })
  db.emailLog.create.mockResolvedValue({ id: 'l' })
  db.operator.update.mockResolvedValue({})
})

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('AUTH — validities are derived from the code contracts and DIFFER (link 15 / code 10)', () => {
  it('code constants: magic link 15 min, OTP code 10 min', () => {
    expect(MAGIC_TTL_MS).toBe(15 * 60 * 1000)
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000)
    expect(MAGIC_LINK_MINUTES).toBe(15)
    expect(OTP_CODE_MINUTES).toBe(10)
  })
  it('link-only sentence names 15 minutes; combined sentence distinguishes 15 (lien) and 10 (code)', () => {
    expect(magicLinkValiditySentence(false)).toBe("Ce lien est valable 15 minutes et ne fonctionne qu'une seule fois.")
    expect(magicLinkValiditySentence(true)).toBe("Ce lien est valable 15 minutes et ce code 10 minutes ; chacun ne fonctionne qu'une seule fois.")
    // negative controls: never one duration for both
    expect(magicLinkValiditySentence(true)).not.toMatch(/lien et ce code sont valables 1[05] minutes/)
  })
})

describe('AUTH — magic link e-mail (live)', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/auth/magic-link/route')
    return POST(new Request('https://app.grubano.com/api/auth/magic-link', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.grubano.com' }, body: JSON.stringify(body) }) as never)
  }
  it('formal French in subject, HTML and text; link-only validity 15 min', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'Léa', status: 'active' })
    const res = await post({ email: 'lea@example.invalid', locale: 'fr', space: 'eat' })
    expect((await res.json()).ok).toBe(true)
    const m = sendMail.mock.calls[0][0]
    expect(m.subject).toBe('Votre lien de connexion Grubano')
    expect(strip(m.html)).not.toMatch(INFORMAL)
    expect(m.text).not.toMatch(INFORMAL)
    expect(strip(m.html)).toContain('Ce lien est valable 15 minutes et ne fonctionne qu\'une seule fois.')
    expect(m.text).toContain('Ce lien est valable 15 minutes')
    expect(strip(m.html)).not.toContain('10 minutes')
  })
  it('with the OTP code state: the sentence distinguishes link 15 / code 10 in HTML and text', async () => {
    process.env.AUTH_EMAIL_OTP_ENABLED = 'true'
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'Léa', status: 'active' })
    await post({ email: 'lea@example.invalid', locale: 'fr', space: 'eat' })
    const m = sendMail.mock.calls[0][0]
    expect(strip(m.html)).toContain('424242')
    expect(strip(m.html)).toContain('Ce lien est valable 15 minutes et ce code 10 minutes')
    expect(m.text).toContain('Ce lien est valable 15 minutes et ce code 10 minutes')
    expect(strip(m.html)).not.toMatch(/sont valables 15 minutes/)
    expect(strip(m.html)).not.toMatch(INFORMAL)
  })
  it('no mail transport configured → honest 503 for everyone (before any lookup), never « lien envoyé »', async () => {
    delete process.env.SMTP_PASS
    expect(isMailTransportConfigured()).toBe(false)
    const res = await post({ email: 'lea@example.invalid', locale: 'fr' })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('mail_unavailable')
    expect(db.operator.findUnique).not.toHaveBeenCalled() // account-independent → no enumeration signal
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('generic anti-enumeration response is formal French', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const res = await post({ email: 'nobody@example.invalid' })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.message).not.toMatch(INFORMAL)
    expect(body.message).toContain('Vérifiez votre boîte')
  })
})

describe('AUTH — welcome e-mail (live)', () => {
  it('formal French, NO table-booking promise, CTA on the deployment base (never a hard-coded production URL)', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    db.operator.create.mockResolvedValue({ id: 'op9', email: 'lea@example.invalid', role: 'consumer' })
    db.loyaltyCustomer.upsert.mockResolvedValue({})
    const { POST } = await import('@/app/api/auth/register/route')
    const res = await POST(new Request('https://app.grubano.com/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Léa Martin', email: 'lea@example.invalid', password: 'Fixture-Passw0rd!' }) }) as never)
    expect(res.status).toBe(201)
    const m = sendMail.mock.calls[0][0]
    const text = strip(m.html)
    expect(m.subject).toBe('Bienvenue sur Grubano — votre compte est prêt')
    expect(text).not.toMatch(INFORMAL)
    expect(text).not.toMatch(/réserver une table|réservation|livraison/i)
    expect(text).toContain('Click & collect')
    expect(m.html).toContain('href="https://app.grubano.com/eat"')
    expect(m.html).not.toContain('https://grubano.com/eat')
    // EmailLog subject matches the sent subject
    expect(db.emailLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subject: 'Bienvenue sur Grubano — votre compte est prêt', trigger: 'consumer_welcome' }) }))
  })
})

describe('AUTH — partner verification e-mail (live) + honest refusal without transport', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/partners/register/route')
    return POST(new Request('http://business.grubano.com/api/partners/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-host': 'business.grubano.com', 'x-forwarded-for': '10.9.1.7' }, body: JSON.stringify(body) }) as never)
  }
  it('formal French subject and body', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    db.operator.create.mockResolvedValue({ id: 'op2' })
    const res = await post({ name: 'Marco Pizzeria', email: 'marco@example.invalid', consent: true, formStartedAt: 0 })
    expect(res.status).toBe(200)
    const verify = sendMail.mock.calls.find((c) => c[0].to === 'marco@example.invalid')![0]
    expect(verify.subject).toBe('Confirmez votre e-mail — espace partenaire Grubano')
    expect(strip(verify.html)).not.toMatch(INFORMAL)
    expect(strip(verify.html)).toContain('24 heures')
  })
  it('no mail transport → 503 BEFORE creating an un-activatable pending account', async () => {
    delete process.env.SMTP_PASS
    const res = await post({ name: 'Marco Pizzeria', email: 'marco2@example.invalid', consent: true, formStartedAt: 0 })
    expect(res.status).toBe(503)
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('AUTH — password reset request without transport → honest 503', () => {
  it('503 before any lookup; no token minted, nothing sent', async () => {
    delete process.env.SMTP_PASS
    const { POST } = await import('@/app/api/auth/forgot-password/route')
    const res = await POST(new Request('https://app.grubano.com/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'lea@example.invalid' }) }) as never)
    expect(res.status).toBe(503)
    expect(db.operator.findUnique).not.toHaveBeenCalled()
    expect(db.verificationToken.create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('REFUND — template: neutral actor, no numeric bank delay, cash amount only', () => {
  it('subject/body never name the restaurant as the refund actor and never state « 5 à 10 jours ouvrés »', async () => {
    await sendRefundConfirmation({ to: 'lea@example.invalid', customerName: 'Léa', restaurantName: 'Gnocchi Bar', refundedCents: 500, partial: true, dedupeKey: 'order:x:500' })
    const m = sendMail.mock.calls[0][0]
    const text = strip(m.html)
    expect(m.subject).toBe('Votre remboursement partiel est confirmé — Gnocchi Bar')
    expect(text).not.toMatch(/effectué par|par Gnocchi Bar/)
    expect(text).not.toMatch(/\d+\s*à\s*\d+\s*jours|jours ouvrés/)
    expect(text).toMatch(/5,00\s€/)                 // the ACTUAL cash amount passed in (fr-FR narrow no-break space)
    expect(text).toContain('moyen de paiement')
    expect(text).not.toMatch(/points|fidélité|cagnotte/i) // mixed funding: loyalty is never presented as cash
    expect(text).toContain('dépend de votre banque')
  })
  it('full refund wording', async () => {
    await sendRefundConfirmation({ to: 'lea@example.invalid', customerName: 'Léa', restaurantName: 'Gnocchi Bar', refundedCents: 2550, partial: false })
    const m = sendMail.mock.calls[0][0]
    expect(m.subject).toBe('Votre remboursement est confirmé — Gnocchi Bar')
    expect(strip(m.html)).toMatch(/25,50\s€/)
  })
})

describe('REFUND — source scan: success e-mail only after Stripe `succeeded`, amount = actual refund', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
  it('engine routes (orders/[id]/refund, admin/refunds/run): pending → 202 with NO email; email uses result.amountCents (engine actual)', () => {
    for (const rel of ['app/api/orders/[id]/refund/route.ts', 'app/api/admin/refunds/run/route.ts']) {
      const src = read(rel)
      const pendingIdx = src.indexOf('result.pending')
      const emailIdx   = src.indexOf('sendRefundConfirmation({')
      expect(pendingIdx).toBeGreaterThan(-1)
      expect(emailIdx).toBeGreaterThan(pendingIdx)                       // the 202 branch returns before the e-mail
      expect(/refundedCents:\s*result\.amountCents/.test(src)).toBe(true)
      expect(/requestedAmountCents|amountCents:\s*parsed\.data\.amountCents/.test(src.slice(emailIdx, emailIdx + 900))).toBe(false)
    }
  })
  it('rail A routes (tickets, refund-deposit): e-mail guarded by result.refund.status === "succeeded" and amount = result.refund.amount (Stripe truth)', () => {
    for (const rel of ['app/api/tickets/[id]/refund/route.ts', 'app/api/reservations/[id]/refund-deposit/route.ts']) {
      const src = read(rel)
      expect(/result\.refund\.status === 'succeeded'/.test(src)).toBe(true)
      const emailBlock = src.slice(src.indexOf('sendRefundConfirmation({'), src.indexOf('sendRefundConfirmation({') + 600)
      expect(/refundedCents:\s*result\.refund\.amount/.test(emailBlock)).toBe(true)
      expect(/refundedCents:\s*result\.refundedCents/.test(emailBlock)).toBe(false) // the audit metadata may still log the estimate
    }
  })
  it('claims: the refunded decision carries the ENGINE amount, never the requested amount', () => {
    expect(/state: 'refunded'; refundId: string; amountCents: number/.test(read('lib/claims.ts'))).toBe(true)
    expect(/state: 'refunded', refundId: result\.refundId, amountCents: result\.amountCents/.test(read('lib/claims.ts'))).toBe(true)
    const arb = read('app/api/admin/claims/[id]/arbitrate/route.ts')
    expect(/refundedCents: refunded \? c\.requestedAmountCents/.test(arb)).toBe(false)
    expect(/result\.refund\?\.state === 'refunded' \? result\.refund\.amountCents : null/.test(arb)).toBe(true)
    const claims = read('app/api/claims/route.ts')
    expect(/auto\.state === 'refunded' \? c\.requestedAmountCents/.test(claims)).toBe(false)
    expect(/auto\.state === 'refunded' \? auto\.amountCents : null/.test(claims)).toBe(true)
  })
  it('the refund template itself carries no restaurant-actor or fixed-delay wording', () => {
    const lib = read('lib/transactional-emails.ts')
    const fn = lib.slice(lib.indexOf('export async function sendRefundConfirmation'), lib.indexOf('export async function sendOrderConfirmation'))
      .replace(/^\s*\/\/.*$/gm, '') // comments may quote the old defect; the CODE must not
    expect(/effectué par/.test(fn)).toBe(false)
    expect(/5 à 10 jours/.test(fn)).toBe(false)
  })
})

describe('REFUND — rail A route behaviour with a Stripe refund object (deterministic)', () => {
  it('tickets/[id]/refund: pending Stripe refund → 200 money response but NO customer e-mail; succeeded → e-mail with refund.amount', async () => {
    vi.resetModules()
    const refundState = { status: 'pending', amount: 500 }
    vi.doMock('@/lib/refund-route-guard', () => ({ requireRefundAdmin: async () => ({ ok: true, actorId: 'admin1', actorEmail: 'admin@example.invalid' }) }))
    vi.doMock('@/lib/admin-audit', () => ({ recordAdminAudit: async () => {} }))
    vi.doMock('@/lib/refund', () => ({ isRefundsEnabled: () => true }))
    vi.doMock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
    vi.doMock('@/lib/refunds', () => ({ refundPayment: async () => ({ ok: true, refund: { id: 're_1', status: refundState.status, amount: refundState.amount }, refundedCents: 999, remainingCents: 1000, routed: false }) }))
    const sendRefund = vi.fn(async () => {})
    vi.doMock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: sendRefund }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {
      tableTicket: { findUnique: async () => ({ id: 't1', restaurantId: 'r1', reservationId: 'rsv1', status: 'paid', stripePaymentIntentId: 'pi_1' }) },
      reservation: { findUnique: async () => ({ email: 'lea@example.invalid', customerName: 'Léa' }) },
      restaurant: { findUnique: async () => ({ name: 'Gnocchi Bar' }) },
    } }))
    const { POST } = await import('@/app/api/tickets/[id]/refund/route')
    const call = () => POST(new Request('http://x/api/tickets/t1/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) as never, { params: { id: 't1' } })
    const r1 = await call()
    expect(r1.status).toBe(200)
    expect(sendRefund).not.toHaveBeenCalled()           // pending ≠ succeeded → no « confirmé »
    refundState.status = 'succeeded'
    const r2 = await call()
    expect(r2.status).toBe(200)
    expect(sendRefund).toHaveBeenCalledTimes(1)
    expect(sendRefund.mock.calls[0][0]).toMatchObject({ refundedCents: 500, dedupeKey: 'ticket:t1:500' }) // Stripe amount, NOT the 999 estimate
    refundState.status = 'failed'
    await call()
    expect(sendRefund).toHaveBeenCalledTimes(1)           // failed ≠ succeeded
    vi.doUnmock('@/lib/transactional-emails'); vi.doUnmock('@/lib/prisma'); vi.doUnmock('@/lib/refunds'); vi.doUnmock('@/lib/refund'); vi.doUnmock('@/lib/rate-limit'); vi.doUnmock('@/lib/admin-audit'); vi.doUnmock('@/lib/refund-route-guard')
  })
})
