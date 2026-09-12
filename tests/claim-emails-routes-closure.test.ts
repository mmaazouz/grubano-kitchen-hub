// tests/claim-emails-routes-closure.test.ts — T-49 round 13, slice W6: J-M38 (D10, D11, H05, H06, E-16, E-17, E-18, I-08) —
// closure-notice attempts carry no money path, depend on the closure record only, and never contradict Stripe.
//
// IMPLEMENTATION NOTE (W6) on J-M38: the fixture runs here rather than in tests/claim-emails-routes.test.ts because that file
// mocks the senders; these sites run the REAL sender on the real mail rail (nodemailer and Prisma mocked), with lib/claims
// mocked at its route boundary. The halves that need the real lib/claims — the record written at each H05 site, the webhook
// settlement's single [EMAIL MISS] line, a record-write failure's console line — are pinned in tests/claim-closure-record.test.ts
// and tests/claims-closure-webhook.test.ts. The missing-notice list (« Avis client non envoyés », H10) is the console slice's:
// « listed in closureNotices » is asserted there; here, the census count closure.terminalWithoutRecord is.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

type Row = Record<string, unknown>
const { db, st, mail, flag, lib, adminMock, auditMock, execMock } = vi.hoisted(() => ({
  st: {
    claim: null as Record<string, unknown> | null,
    row: null as Record<string, unknown> | null,
    dispatch: [] as Array<{ trigger: string; dedupeKey: string }>,
  },
  db: {
    claim:         { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    refund:        { findUnique: vi.fn() },
    operator:      { findUnique: vi.fn() },
    emailDispatch: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    emailLog:      { create: vi.fn() },
    adminAuditLog: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  mail: { sendMail: vi.fn() },
  flag: vi.fn(),
  lib: { resolveStuckClaim: vi.fn(), reconcileClaimEvidence: vi.fn(), attributeClaimRefund: vi.fn(), adoptStripeRefundForClaim: vi.fn() },
  adminMock: vi.fn(),
  auditMock: vi.fn(),
  execMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ''}` }))
vi.mock('@/lib/onboarding-nudge', () => ({ resolveNudgeLocale: () => 'fr' }))
vi.mock('@/lib/claims', () => ({ ...lib, isClaimsEnabled: flag, STRIPE_REFUND_ID_RE: /^re_[A-Za-z0-9]{8,}$/ }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock }))

import { POST as RESOLVE_STUCK } from '@/app/api/admin/claims/[id]/resolve-stuck/route'
import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import { POST as ATTRIBUTE } from '@/app/api/admin/claims/[id]/attribute/route'
import { POST as CLOSURE_NOTICE } from '@/app/api/admin/claims/[id]/closure-notice/route'
import { customerEmailLine } from '@/lib/claim-email-toast'
import { MARKERS } from '@/lib/claim-action-rules'

const REC = { trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }
const REFUNDED: Row = { id: 'cl1', status: 'refunded', consumerId: 'c1', orderId: 'o1', refundId: 'rf1', refundError: null, arbitrationDecision: 'approved', restaurantResponse: null, arbitrationReason: null }
const DECLARED: Row = { ...REFUNDED, status: 'refused_final', refundId: null, refundError: 'engine_failed: x' }
const LEGACY_REFUSAL: Row = { ...REFUNDED, status: 'refused_final', refundId: null, arbitrationDecision: 'refused_final', restaurantResponse: null }
const ROW: Row = { orderId: 'o1', status: 'succeeded', amountCents: 300, stripeRefundId: 're_1' }
const pick = (r: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.entries(r).filter(([k]) => select[k] === true)) : r)

const req = (body?: unknown) => new Request('https://app.grubano.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const call = async (h: (r: Request, c: { params: { id: string } }) => Promise<Response>, body?: unknown) => {
  const res = await h(req(body), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as Row }
}
const sends = () => mail.sendMail.mock.calls.length
const rows = () => (db.emailLog.create.mock.calls as Array<[{ data: Row }]>).map((c) => c[0].data)

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset()
  for (const fn of [...Object.values(lib), mail.sendMail, flag, adminMock, auditMock, execMock]) fn.mockReset()
  st.claim = { ...REFUNDED }
  st.row = { ...ROW }
  st.dispatch = [{ ...REC }]
  process.env.SMTP_PASS = 'x'
  flag.mockReturnValue(true)
  adminMock.mockResolvedValue({ id: 'op1', email: 'a@x.test', role: 'admin', name: 'A' })
  auditMock.mockResolvedValue(true)
  mail.sendMail.mockResolvedValue({ messageId: 'm1' })
  db.claim.findUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => (st.claim ? pick(st.claim, select) : null))
  db.claim.count.mockResolvedValue(1)
  db.refund.findUnique.mockImplementation(async () => st.row)
  db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa', locale: null })
  db.emailDispatch.findFirst.mockImplementation(async ({ where }: { where: { trigger: string; dedupeKey: string } }) =>
    st.dispatch.find((d) => d.trigger === where.trigger && d.dedupeKey === where.dedupeKey) ?? null)
  db.emailDispatch.findMany.mockImplementation(async ({ where }: { where: { trigger: string | { in: string[] }; dedupeKey: { in: string[] } } }) => {
    const triggers = typeof where.trigger === 'string' ? [where.trigger] : where.trigger.in
    return st.dispatch.filter((d) => triggers.includes(d.trigger) && where.dedupeKey.in.includes(d.dedupeKey)).map((d) => ({ ...d }))
  })
  db.emailDispatch.create.mockImplementation(async ({ data }: { data: { trigger: string; dedupeKey: string } }) => { st.dispatch.push({ ...data }); return data })
  db.emailDispatch.deleteMany.mockResolvedValue({ count: 0 })
  db.emailLog.create.mockResolvedValue({ id: 'l1' })
  db.adminAuditLog.findFirst.mockResolvedValue({ id: 'audit1', action: 'claim.arbitrate', targetId: 'cl1' })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { errSpy.mockRestore(); delete process.env.SMTP_PASS })

describe('J-M38 — no money path', () => {
  it('lib/claim-emails.ts imports none of lib/refund, lib/stripe, lib/claims; the closure-notice route calls only reconcileClaimEvidence, sendClaimClosureEmail and recordAdminAudit beyond its guards and its claim read', () => {
    expect(readFileSync('lib/claim-emails.ts', 'utf8')).not.toMatch(/@\/lib\/(refund|stripe|claims)['"]/)
    // Comments and string literals stripped: a French word before a parenthesis inside a message is not a call.
    const code = readFileSync('app/api/admin/claims/[id]/closure-notice/route.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    const called = new Set(Array.from(code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)).map((m) => m[1]))
    const effects = Array.from(called).filter((n) => !['POST', 'resolveAdmin', 'rateLimit', 'isClaimsEnabled', 'claimClosureKind', 'safeParse', 'text', 'trim', 'parse', 'json', 'findUnique', 'isInteger', 'object', 'strict', 'if', 'catch'].includes(n))
    expect(effects.sort()).toEqual(['reconcileClaimEvidence', 'recordAdminAudit', 'sendClaimClosureEmail'])
  })
})

describe('J-M38 — sites (i)-(iv) attempt the notice after the closing write, whatever the audit returned', () => {
  it('(i) resolve-stuck with recordAdminAudit false (auditing off) and a record present → the notice is sent', async () => {
    st.claim = { ...DECLARED }
    auditMock.mockResolvedValue(false)
    lib.resolveStuckClaim.mockResolvedValue({ ok: true, claim: st.claim })
    const r = await call(RESOLVE_STUCK, { resolution: 'closed_no_payment', reason: 'note' })
    expect(r.status).toBe(200)
    expect(r.body.noteRecorded).toBe(false)
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'closed_by_declaration' })
    expect(sends()).toBe(1)
  })

  it('(ii) reconcile outcome refunded with evidence stripe_read → sent; with our row only → stripe_not_confirmed, nothing sent', async () => {
    lib.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 300, evidence: 'stripe_read' })
    let r = await call(RECONCILE)
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(sends()).toBe(1)

    mail.sendMail.mockClear()
    st.dispatch = [{ ...REC }]
    lib.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 300 })
    r = await call(RECONCILE)
    expect(r.body.customerEmail).toEqual({ status: 'skipped', kind: 'refunded', why: 'stripe_not_confirmed' })
    expect(sends()).toBe(0)
  })

  it('(iii) attribute, row branch and adoption branch, after an observed commit → sent', async () => {
    lib.attributeClaimRefund.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', rowStatusBefore: 'succeeded', evidence: 'stripe_read', amountCents: 300 })
    let r = await call(ATTRIBUTE, { refundRowId: 'rf1' })
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })

    st.dispatch = [{ ...REC }]
    lib.adoptStripeRefundForClaim.mockResolvedValue({ ok: true, outcome: 'refunded', refundId: 'rf1', facts: {}, evidence: 'stripe_read', amountCents: 300 })
    r = await call(ATTRIBUTE, { stripeRefundId: 're_1234567890' })
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(sends()).toBe(2)
  })

  it('a closure observed only through the C7 re-read → no attempt at all', async () => {
    lib.attributeClaimRefund.mockResolvedValue({ ok: false, status: 409, error: 'Cette réclamation est déjà liée à ce remboursement (statut actuel : « refunded »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; sa clôture est enregistrée. Relisez sa ligne dans la file.' })
    const r = await call(ATTRIBUTE, { refundRowId: 'rf1' })
    expect(r.status).toBe(409)
    expect(r.body).not.toHaveProperty('customerEmail')
    expect(db.emailDispatch.findFirst).not.toHaveBeenCalled()
    expect(sends()).toBe(0)
  })
})

describe('J-M38 — eligibility is the H05 record only', () => {
  it('a legacy terminal claim WITH a HEAD « claim.arbitrate » audit row and no closure record → no_closure_record, no send, the audit table never read; counted in census closure.terminalWithoutRecord', async () => {
    st.claim = { ...LEGACY_REFUSAL }
    st.dispatch = []
    const r = await call(CLOSURE_NOTICE)
    expect(r).toEqual({ status: 200, body: { customerEmail: { status: 'skipped', kind: 'refused_by_grubano', why: 'no_closure_record' } } })
    expect(sends()).toBe(0)
    expect(db.adminAuditLog.findFirst).not.toHaveBeenCalled()
    expect(db.adminAuditLog.findMany).not.toHaveBeenCalled()
    db.claim.findMany.mockResolvedValue([{ ...LEGACY_REFUSAL }])
    const { claimsClosureCensus } = await vi.importActual<typeof import('@/lib/claims-census')>('@/lib/claims-census')
    expect(await claimsClosureCensus()).toMatchObject({ terminalWithoutRecord: 1, missing: 0 })
  })

  it('NEGATIVE CONTROL — the same claim WITH the record, claims open → exactly one send', async () => {
    st.claim = { ...LEGACY_REFUSAL }
    const r = await call(CLOSURE_NOTICE)
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refused_by_grubano' })
    expect(sends()).toBe(1)
  })
})

describe('J-M38 — CLAIMS off, and never over a Stripe reversal', () => {
  it('claims closed → the EmailLog row « (non envoyé : claims_disabled) », the [EMAIL MISS] line, and the claimsDisabled toast', async () => {
    st.claim = { ...DECLARED }
    flag.mockReturnValue(false)
    lib.resolveStuckClaim.mockResolvedValue({ ok: true, claim: st.claim })
    const r = await call(RESOLVE_STUCK, { resolution: 'closed_no_payment' })
    expect(r.status).toBe(200)
    expect(rows()).toEqual([{ recipient: '(non envoyé : claims_disabled)', subject: 'claim cl1', trigger: 'claim_closed_by_support', status: 'skipped' }])
    expect(errSpy.mock.calls.some((c) => String(c[0]).startsWith('[EMAIL MISS] [claim_closed_by_support] not sent (claims_disabled)'))).toBe(true)
    expect(customerEmailLine(r.body.customerEmail as never)).toEqual({ tone: 'error', key: 'claimsDisabled' })
    expect(sends()).toBe(0)
  })

  it('refunded kind: sent only on refund_still_standing succeeded read in the request; reverted_after_refund → 409, the R0 read happened first, nothing sent', async () => {
    lib.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'refund_still_standing', refundId: 'rf1', stripeStatus: 'succeeded', amountCents: 300 })
    expect((await call(CLOSURE_NOTICE)).body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(sends()).toBe(1)

    mail.sendMail.mockClear()
    db.emailDispatch.findFirst.mockClear()
    st.dispatch = [{ ...REC }]
    lib.reconcileClaimEvidence.mockReset().mockResolvedValue({ ok: true, outcome: 'reverted_after_refund', refundId: 'rf1' })
    const r = await call(CLOSURE_NOTICE)
    expect(r.status).toBe(409)
    expect(lib.reconcileClaimEvidence).toHaveBeenCalledTimes(1)
    expect(db.emailDispatch.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ trigger: 'claim_closure_record' }) }))
    expect(sends()).toBe(0)
  })

  it('a claim already marked REVERTED_AFTER_REFUND → 409 (not a closure), no Stripe read, nothing sent', async () => {
    st.claim = { ...REFUNDED, refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` }
    const r = await call(CLOSURE_NOTICE)
    expect(r.status).toBe(409)
    expect(lib.reconcileClaimEvidence).not.toHaveBeenCalled()
    expect(sends()).toBe(0)
  })

  it('the webhook route and the reconcile-refunds cron route do not import the sender', () => {
    for (const f of ['app/api/webhooks/stripe/route.ts', 'app/api/admin/claims/reconcile-refunds/route.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/claim-emails|sendClaimClosureEmail|sendClaimDecisionEmail/)
    }
    expect(execMock).not.toHaveBeenCalled()
  })
})
