import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'

// ── Email B4 — partner lifecycle (Agent 144) ──────────────────────────────────
// ONE mutualised sendPartnerStatusEmail({role,status,…}) for restaurant / supplier / influencer,
// dispatched through the B0 sendOnce rail. validated = ONCE (dedupeKey = the stable scope); rejected
// / docs_needed are REPEATABLE (dedupeKey carries a day-bucket discriminant). Best-effort, FR, no money.

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
const { dispatchCreate, dispatchDeleteMany, logCreate } = vi.hoisted(() => ({
  dispatchCreate: vi.fn(), dispatchDeleteMany: vi.fn(), logCreate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { emailDispatch: { create: dispatchCreate, deleteMany: dispatchDeleteMany }, emailLog: { create: logCreate } },
}))

import { sendPartnerStatusEmail } from '@/lib/transactional-emails'

const P = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: '5.22.0' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SMTP_PASS = 'x'
  dispatchCreate.mockResolvedValue({ id: 'd1' })
  dispatchDeleteMany.mockResolvedValue({ count: 1 })
  logCreate.mockResolvedValue({ id: 'l1' })
  sendMail.mockResolvedValue({ messageId: 'm1' })
})

describe('sendPartnerStatusEmail — mutualised, idempotent', () => {
  it('restaurant validated → partner_validated, dedupeKey = the scope (ONCE), to the operator', async () => {
    const r = await sendPartnerStatusEmail({ role: 'restaurant', status: 'validated', to: 'owner@r.com', partnerName: 'Gnocchi Bar', dedupeScope: 'resto:r1' })
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'partner_validated', dedupeKey: 'resto:r1' } })
    expect(sendMail.mock.calls[0][0].to).toBe('owner@r.com')
    expect(sendMail.mock.calls[0][0].subject).toContain('validé')
    expect(sendMail.mock.calls[0][0].html as string).toContain('établissement') // role wording
  })

  it('validated is deduped on repeat (P2002 → no resend)', async () => {
    dispatchCreate.mockRejectedValueOnce(P('P2002'))
    const r = await sendPartnerStatusEmail({ role: 'restaurant', status: 'validated', to: 'o@r.com', partnerName: 'R', dedupeScope: 'resto:r1' })
    expect(r.status).toBe('duplicate')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('supplier rejected → partner_rejected, dedupeKey carries a day discriminant (re-sendable), reason shown', async () => {
    const r = await sendPartnerStatusEmail({ role: 'supplier', status: 'rejected', to: 's@x.com', partnerName: 'Foods SARL', dedupeScope: 'supplier:s1', reason: 'SIREN illisible', occurrence: '2026-07-01' })
    expect(r.status).toBe('sent')
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'partner_rejected', dedupeKey: 'supplier:s1:2026-07-01' } })
    expect(sendMail.mock.calls[0][0].html as string).toContain('compte fournisseur') // role wording
    expect(sendMail.mock.calls[0][0].html as string).toContain('SIREN illisible')    // reason
  })

  it('rejected RE-SENDS across occurrences (different day-bucket → different dedupeKey)', async () => {
    await sendPartnerStatusEmail({ role: 'supplier', status: 'rejected', to: 's@x.com', partnerName: 'F', dedupeScope: 'supplier:s1', occurrence: 'd1' })
    await sendPartnerStatusEmail({ role: 'supplier', status: 'rejected', to: 's@x.com', partnerName: 'F', dedupeScope: 'supplier:s1', occurrence: 'd2' })
    const keys = dispatchCreate.mock.calls.map((c) => c[0].data.dedupeKey)
    expect(keys).toEqual(['supplier:s1:d1', 'supplier:s1:d2']) // distinct → both attempt
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('influencer validated → same fn, wording adapts (votre compte), dedupeKey affiliate:<operatorId>', async () => {
    await sendPartnerStatusEmail({ role: 'influencer', status: 'validated', to: 'a@x.com', partnerName: 'Léa', dedupeScope: 'affiliate:op1' })
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'partner_validated', dedupeKey: 'affiliate:op1' } })
    expect(sendMail.mock.calls[0][0].html as string).toContain('votre compte')
  })

  it('docs_needed → partner_docs_needed with a day discriminant', async () => {
    await sendPartnerStatusEmail({ role: 'supplier', status: 'docs_needed', to: 's@x.com', partnerName: 'F', dedupeScope: 'supplier:s1', occurrence: 'd1' })
    expect(dispatchCreate).toHaveBeenCalledWith({ data: { trigger: 'partner_docs_needed', dedupeKey: 'supplier:s1:d1' } })
  })

  it('best-effort: a send failure never throws', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'))
    const r = await sendPartnerStatusEmail({ role: 'restaurant', status: 'validated', to: 'o@r.com', partnerName: 'R', dedupeScope: 'resto:r2' })
    expect(r.status).toBe('failed')
  })
})

describe('admin route wiring + no-money invariants (source-scan, comments stripped)', () => {
  // Strip comments so a pre-existing doc-comment mentioning e.g. "payoutStatus" can't trip the scan —
  // we assert the actual CODE imports/touches no money lib or Connect/IBAN/payout field.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'))
  const NO_MONEY = /lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe|payoutStatus|stripeConnect|iban/i

  it('resto approve sends validated best-effort, no money/Connect touched', () => {
    const c = read('app/api/admin/restaurants/[id]/approve/route.ts')
    expect(/sendPartnerStatusEmail/.test(c)).toBe(true)
    expect(/status:\s*'validated'/.test(c)).toBe(true)
    expect(/try \{[\s\S]*sendPartnerStatusEmail[\s\S]*\} catch/.test(c)).toBe(true)
    expect(NO_MONEY.test(c)).toBe(false)
  })

  it('supplier status maps active→validated / rejected, gated on actual change, no money/Connect', () => {
    const c = read('app/api/supplier/admin/status/route.ts')
    expect(/profile\.status !== status &&/.test(c)).toBe(true)
    expect(/status === 'active' \? 'validated' : 'rejected'/.test(c)).toBe(true)
    expect(NO_MONEY.test(c)).toBe(false)
  })

  it('influencer decision sends validated/rejected best-effort, no money', () => {
    const c = read('app/api/admin/influencer-verifications/route.ts')
    expect(/sendPartnerStatusEmail/.test(c)).toBe(true)
    expect(/out\.status === 'approved' \? 'validated' : 'rejected'/.test(c)).toBe(true)
    expect(NO_MONEY.test(c)).toBe(false)
  })
})
