import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

// ── Email B5a — admin alert: new partner dossier pending validation (Agent 145) ──
// ONE mutualised sendAdminNewPartnerEmail({role,partnerName,dedupeScope,occurrence?}) for
// restaurant / supplier / influencer registrations, dispatched through the B0 sendOnce rail to
// ALERT_EMAIL. Skipped cleanly if ALERT_EMAIL is unset. Best-effort, FR, no money/no webhook.

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
const { dispatchCreate, dispatchDeleteMany, logCreate } = vi.hoisted(() => ({
  dispatchCreate: vi.fn(), dispatchDeleteMany: vi.fn(), logCreate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { emailDispatch: { create: dispatchCreate, deleteMany: dispatchDeleteMany }, emailLog: { create: logCreate } },
}))

import { sendAdminNewPartnerEmail } from '@/lib/transactional-emails'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const P = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.22.0' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'x'
  process.env.ALERT_EMAIL = 'ops@grubano.com'
  dispatchCreate.mockResolvedValue({ id: 'd1' })
  dispatchDeleteMany.mockResolvedValue({ count: 1 })
  logCreate.mockResolvedValue({ id: 'l1' })
  sendMail.mockResolvedValue({ messageId: 'm1' })
})

describe('sendAdminNewPartnerEmail — mutualised admin alert', () => {
  it('restaurant → admin_partner_pending, dedupeKey restaurant:<id>, to ALERT_EMAIL, FR « restaurant »', async () => {
    const r = await sendAdminNewPartnerEmail({ role: 'restaurant', partnerName: 'Gnocchi Bar', dedupeScope: 'restaurant:r1' })
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'admin_partner_pending', dedupeKey: 'restaurant:r1' } })
    expect(sendMail.mock.calls[0][0].to).toBe('ops@grubano.com')
    expect(sendMail.mock.calls[0][0].subject).toContain('restaurant')
    expect(sendMail.mock.calls[0][0].html as string).toContain('Gnocchi Bar')
  })

  it('mutualises supplier (« fournisseur ») and influencer (« influenceur »); influencer key carries the occurrence', async () => {
    await sendAdminNewPartnerEmail({ role: 'supplier', partnerName: 'Foods SARL', dedupeScope: 'supplier:s1' })
    expect(dispatchCreate).toHaveBeenLastCalledWith({ data: { trigger: 'admin_partner_pending', dedupeKey: 'supplier:s1' } })
    expect(sendMail.mock.calls[0][0].subject).toContain('fournisseur')

    await sendAdminNewPartnerEmail({ role: 'influencer', partnerName: 'instagram @lea', dedupeScope: 'influencer:op1', occurrence: '2026-06-24' })
    expect(dispatchCreate).toHaveBeenLastCalledWith({ data: { trigger: 'admin_partner_pending', dedupeKey: 'influencer:op1:2026-06-24' } })
    expect(sendMail.mock.calls[1][0].subject).toContain('influenceur')
  })

  it('ALERT_EMAIL unset → SKIP cleanly (no send, no dispatch claim, no throw)', async () => {
    process.env.ALERT_EMAIL = ''
    const r = await sendAdminNewPartnerEmail({ role: 'restaurant', partnerName: 'R', dedupeScope: 'restaurant:r9' })
    expect(r.status).toBe('skipped')
    expect(dispatchCreate).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('idempotent: a duplicate dossier (P2002) does NOT resend', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2002'))
    const r = await sendAdminNewPartnerEmail({ role: 'supplier', partnerName: 'F', dedupeScope: 'supplier:s1' })
    expect(r.status).toBe('duplicate')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('influencer re-application RE-alerts across days (distinct occurrence → distinct key)', async () => {
    await sendAdminNewPartnerEmail({ role: 'influencer', partnerName: 'tiktok @x', dedupeScope: 'influencer:op1', occurrence: 'd1' })
    await sendAdminNewPartnerEmail({ role: 'influencer', partnerName: 'tiktok @x', dedupeScope: 'influencer:op1', occurrence: 'd2' })
    const keys = dispatchCreate.mock.calls.map((c) => c[0].data.dedupeKey)
    expect(keys).toEqual(['influencer:op1:d1', 'influencer:op1:d2'])
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('best-effort: a send failure never throws', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sendAdminNewPartnerEmail({ role: 'restaurant', partnerName: 'R', dedupeScope: 'restaurant:r2' })
    expect(r.status).toBe('failed')
  })
})

describe('registration-route wiring + no-money/no-webhook + partner_verify intact (source-scan)', () => {
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'))
  // money engine + webhook must never be pulled into a registration route by this change
  const NO_MONEY = /lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe|webhooks\/stripe|payCreator|payPartner/

  it('partners/register: best-effort restaurant alert AFTER create, partner_verify untouched, no money/webhook', () => {
    const c = read('app/api/partners/register/route.ts')
    expect(/sendAdminNewPartnerEmail/.test(c)).toBe(true)
    expect(/role:\s*'restaurant'/.test(c)).toBe(true)
    expect(/try \{[\s\S]*sendAdminNewPartnerEmail[\s\S]*\} catch/.test(c)).toBe(true)
    expect(/trigger:\s*'partner_verify'/.test(c)).toBe(true) // the partner-facing email stays
    expect(NO_MONEY.test(c)).toBe(false)
  })

  it('supplier/register: alert only on the pending (review) path, best-effort, no money/Connect/webhook', () => {
    const c = read('app/api/supplier/register/route.ts')
    expect(/sendAdminNewPartnerEmail/.test(c)).toBe(true)
    expect(/role:\s*'supplier'/.test(c)).toBe(true)
    expect(/if \(status === 'pending'\)/.test(c)).toBe(true)
    expect(NO_MONEY.test(c)).toBe(false)
  })

  it('affiliate/verify-request: influencer alert after out.ok, occurrence discriminant, no money/webhook', () => {
    const c = read('app/api/affiliate/verify-request/route.ts')
    expect(/sendAdminNewPartnerEmail/.test(c)).toBe(true)
    expect(/role:\s*'influencer'/.test(c)).toBe(true)
    expect(/occurrence:/.test(c)).toBe(true)
    expect(NO_MONEY.test(c)).toBe(false)
  })
})
