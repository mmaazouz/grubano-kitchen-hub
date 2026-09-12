// tests/claims-closure-emails.test.ts — T-49 round 13, slice W6: J-C24 (H06 check order, H04, H11, R-D4, R-D6 (d)),
// J-C25 (F18 (h), F03 — the customer status and the closure sender agree), J-C44 (I-08, H11, E-16, E-17 — one EmailLog row
// per attempt). Supersedes Track B's tests/claim-closure-email.test.ts.
//
// The senders run for real on the real mail rail (lib/transactional-emails), with nodemailer and Prisma mocked and the real
// message catalogs: an EmailLog row is counted where the code writes it, and the html is the rendered copy.
//
// IMPLEMENTATION NOTE (W6) on ER-C19 / J-C24: « every fixture produces exactly one EmailLog row » holds for every attempt
// that reaches a template. A claim that is not a closure (not_applicable / not_a_closure) is not an attempt and leaves no
// row; a 'duplicate' leaves none either (the earlier attempt's row stands). A skip for no_recipient keeps the historical
// recipient « (aucun destinataire) » (H11: byte-identical when why is no_recipient).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, mail } = vi.hoisted(() => ({
  db: {
    claim:         { findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    refund:        { findUnique: vi.fn() },
    operator:      { findUnique: vi.fn() },
    emailDispatch: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    emailLog:      { create: vi.fn() },
    adminAuditLog: { findFirst: vi.fn() },
  },
  mail: { sendMail: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mail.sendMail }) } }))
vi.mock('@/lib/onboarding-nudge', () => ({
  resolveNudgeLocale: (l: string | null | undefined) => (l && ['fr', 'en', 'es', 'it', 'ar'].includes(l) ? l : 'fr'),
}))
const MSG: Record<string, unknown> = Object.fromEntries(['fr', 'en', 'es', 'it', 'ar'].map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'))]))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = MSG[locale]
      for (const p of `${namespace}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[p]
      if (typeof cur !== 'string') throw new Error(`missing i18n key ${locale}:${namespace}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m))
    },
}))

import { sendClaimClosureEmail, sendClaimAckEmail, sendClaimDecisionEmail, type ClaimEmailWhy } from '@/lib/claim-emails'
import { customerClaimStatus, refundedRowTruth, MARKERS, type ClaimFacts } from '@/lib/claim-action-rules'
import { orderRef } from '@/lib/order-ref'

type Row = Record<string, unknown>
const REF = orderRef('ord123abc')
const REFUNDED: Row = {
  id: 'cl1', status: 'refunded', consumerId: 'c1', orderId: 'ord123abc', refundId: 'rf1', refundError: null,
  arbitrationDecision: 'approved', restaurantResponse: null, arbitrationReason: null,
}
const ROW: Row = { orderId: 'ord123abc', status: 'succeeded', amountCents: 1250, stripeRefundId: 're_1' }
const CONSUMER: Row = { email: 'lea@x.fr', name: 'Léa', locale: null }
const st: { claim: Row | null; row: Row | null; binders: number; record: boolean; consumer: Row | null; claimThrows: boolean } =
  { claim: null, row: null, binders: 1, record: true, consumer: null, claimThrows: false }

const pick = (r: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.entries(r).filter(([k]) => select[k] === true)) : r)
const text = (locale: string, key: string, vars: Record<string, string> = {}) => {
  let cur: unknown = MSG[locale]
  for (const p of `claimEmails.${key}`.split('.')) cur = (cur as Row | undefined)?.[p]
  return String(cur).replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)
}
const eurosFr = (cents: number) => new Intl.NumberFormat('fr', { style: 'currency', currency: 'EUR' }).format(cents / 100)

function fresh(over: Partial<typeof st> = {}) {
  for (const group of Object.values(db)) for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset()
  mail.sendMail.mockReset()
  Object.assign(st, { claim: { ...REFUNDED }, row: { ...ROW }, binders: 1, record: true, consumer: { ...CONSUMER }, claimThrows: false }, over)
  process.env.SMTP_PASS = 'x'
  db.claim.findUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => {
    if (st.claimThrows) throw new Error('db down')
    return st.claim ? pick(st.claim, select) : null
  })
  db.refund.findUnique.mockImplementation(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) =>
    (st.row && where.id === st.claim?.refundId ? pick(st.row, select) : null))
  db.claim.count.mockImplementation(async () => st.binders)
  db.emailDispatch.findFirst.mockImplementation(async ({ where }: { where: { trigger: string; dedupeKey: string } }) =>
    (st.record && where.trigger === 'claim_closure_record' && where.dedupeKey === `claim:${String(st.claim?.id)}` ? { id: 'rec1' } : null))
  db.emailDispatch.create.mockResolvedValue({ id: 'd1' })
  db.emailDispatch.deleteMany.mockResolvedValue({ count: 1 })
  db.emailLog.create.mockResolvedValue({ id: 'l1' })
  db.operator.findUnique.mockImplementation(async () => st.consumer)
  mail.sendMail.mockResolvedValue({ messageId: 'm1' })
}
const logs = () => (db.emailLog.create.mock.calls as Array<[{ data: Row }]>).map((c) => c[0].data)
const sends = () => (mail.sendMail.mock.calls as Array<[{ to: string; subject: string; html: string }]>).map((c) => c[0])
const dispatchTriggers = () => (db.emailDispatch.create.mock.calls as Array<[{ data: Row }]>).map((c) => String(c[0].data.trigger))
const EV = (amountCents: number) => ({ basis: 'stripe_read' as const, amountCents })
const closure = (evidence?: unknown, claimsOpen = true) => sendClaimClosureEmail({ claimId: 'cl1', evidence: evidence as never, claimsOpen })

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  fresh()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errSpy.mockRestore()
  delete process.env.SMTP_PASS
})

// ══ J-C24 — the check order, one fixture per step ═══════════════════════════════════════════════
describe('J-C24 — sendClaimClosureEmail check order, one EmailLog row per attempt', () => {
  it('(1) claim not found → skipped claim_not_found, one traced row', async () => {
    fresh({ claim: null })
    expect(await closure(EV(1250))).toEqual({ status: 'skipped', kind: null, why: 'claim_not_found' })
    expect(logs()).toEqual([expect.objectContaining({ status: 'skipped', recipient: '(non envoyé : claim_not_found)', subject: 'claim cl1' })])
    expect(sends()).toEqual([])
  })

  it('(2) approved / refunding / financial_verification / refunded + REVERTED_AFTER_REFUND → not_applicable, no record read, no row', async () => {
    for (const c of [
      { status: 'approved', refundError: 'engine_failed: x' },
      { status: 'refunding', refundError: null },
      { status: MARKERS.FINANCIAL_VERIFICATION, refundError: 'x' },
      { status: 'refunded', refundError: `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée…` },
    ]) {
      fresh({ claim: { ...REFUNDED, ...c } })
      expect(await closure(EV(1250)), c.status).toEqual({ status: 'not_applicable', kind: null, why: 'not_a_closure' })
      expect(db.emailDispatch.findFirst).not.toHaveBeenCalled()
      expect(logs()).toEqual([])
      expect(sends()).toEqual([])
    }
  })

  it('(3) a terminal claim without THIS build\'s closure record (legacy) → no_closure_record, nothing sent', async () => {
    fresh({ record: false })
    // A HEAD audit row exists for legacy closures: it is never read (AMF-2).
    db.adminAuditLog.findFirst.mockResolvedValue({ id: 'audit1', action: 'claim.arbitrate' })
    expect(await closure(EV(1250))).toEqual({ status: 'skipped', kind: 'refunded', why: 'no_closure_record' })
    expect(db.adminAuditLog.findFirst).not.toHaveBeenCalled()
    expect(logs()).toEqual([expect.objectContaining({ trigger: 'claim_decision_refunded', recipient: '(non envoyé : no_closure_record)' })])
    expect(sends()).toEqual([])
  })

  it('(4) record present, claims closed → claims_disabled (the record check came first: no record + closed → no_closure_record)', async () => {
    expect(await closure(EV(1250), false)).toEqual({ status: 'skipped', kind: 'refunded', why: 'claims_disabled' })
    expect(logs()).toHaveLength(1)
    fresh({ record: false })
    expect((await closure(EV(1250), false)).why).toBe('no_closure_record')
    expect(sends()).toEqual([])
  })

  it('(5) refusal kinds delegate to the decision sender: kind from provenance, reason from the database', async () => {
    fresh({ claim: { ...REFUNDED, status: 'refused_final', refundId: null, arbitrationDecision: 'refused_final', restaurantResponse: 'refused', arbitrationReason: 'Preuves insuffisantes' } })
    expect(await closure()).toEqual({ status: 'sent', kind: 'refused_confirmed' })
    let m = sends()[0]
    expect(dispatchTriggers()).toEqual(['claim_decision_refused_final'])
    expect(m.subject).toBe(text('fr', 'refusedFinal.subject', { ref: REF }))
    expect(m.html).toContain(text('fr', 'refusedFinal.body', { ref: REF }))
    expect(m.html).toContain('Preuves insuffisantes')

    fresh({ claim: { ...REFUNDED, status: 'refused_final', refundId: null, arbitrationDecision: 'refused_final', restaurantResponse: null, arbitrationReason: 'Hors délai' } })
    expect(await closure()).toEqual({ status: 'sent', kind: 'refused_by_grubano' })
    m = sends()[0]
    expect(dispatchTriggers()).toEqual(['claim_decision_refused_final'])
    expect(m.subject).toBe(text('fr', 'refusedFinal.subject', { ref: REF }))
    expect(m.html).toContain(text('fr', 'refusedByGrubano.title'))
    expect(m.html).toContain(text('fr', 'refusedByGrubano.body', { ref: REF }))
    expect(m.html).not.toContain(text('fr', 'refusedFinal.body', { ref: REF }))
    expect(m.html).toContain('Hors délai')
    expect(logs()).toHaveLength(1)
  })

  it('(6) refunded: bound row failed → refunded_row_failed; other order / refundId null / amount 0 → refunded_row_unproven; binders 2 → refunded_row_unproven', async () => {
    fresh({ row: { ...ROW, status: 'failed' } })
    expect((await closure(EV(1250))).why).toBe('refunded_row_failed')
    expect(logs()).toHaveLength(1)
    for (const over of [{ row: { ...ROW, orderId: 'o_other' } }, { claim: { ...REFUNDED, refundId: null } }, { row: { ...ROW, amountCents: 0 } }, { binders: 2 }] as Array<Partial<typeof st>>) {
      fresh(over)
      expect((await closure(EV(1250))).why, JSON.stringify(over)).toBe('refunded_row_unproven')
      expect(logs()).toHaveLength(1)
      expect(sends()).toEqual([])
    }
  })

  it('(7) refunded: evidence undefined / ledger_row / amount 0 / 1.5 → stripe_not_confirmed', async () => {
    for (const ev of [undefined, { basis: 'ledger_row', amountCents: 1250 }, EV(0), EV(1.5)]) {
      fresh()
      expect(await closure(ev), JSON.stringify(ev)).toEqual({ status: 'skipped', kind: 'refunded', why: 'stripe_not_confirmed' })
      expect(logs()).toHaveLength(1)
      expect(sends()).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — a succeeded row with no Stripe read in the request never reaches the mail rail', async () => {
    await closure(undefined)
    expect(mail.sendMail).toHaveBeenCalledTimes(0)
    expect(db.emailDispatch.create).toHaveBeenCalledTimes(0)
  })

  it('(8) Stripe 1300 vs row 1250 → refundRecorded.*: no « € », no digits of either amount', async () => {
    expect(await closure(EV(1300))).toEqual({ status: 'sent', kind: 'refunded' })
    const m = sends()[0]
    expect(dispatchTriggers()).toEqual(['claim_decision_refunded'])
    expect(m.subject).toBe(text('fr', 'refundRecorded.subject', { ref: REF }))
    expect(m.html).toContain(text('fr', 'refundRecorded.body', { ref: REF }))
    expect(m.html).toContain(text('fr', 'refundRecorded.next', { ref: REF }))
    expect(m.html).not.toContain('€')
    expect(m.html).not.toMatch(/13,00|12,50|1300|1250/)
    expect(logs()).toHaveLength(1)
  })

  it('(9) Stripe 1250 = row 1250 → refunded.subject/title + refundedLinked.body with « 12,50 »; a pending row with equal evidence → refundedLinked too', async () => {
    for (const status of ['succeeded', 'pending']) {
      fresh({ row: { ...ROW, status } })
      expect(await closure(EV(1250))).toEqual({ status: 'sent', kind: 'refunded' })
      const m = sends()[0]
      expect(m.subject).toBe(text('fr', 'refunded.subject', { ref: REF }))
      expect(m.html).toContain(text('fr', 'refunded.title'))
      expect(m.html).toContain(text('fr', 'refundedLinked.body', { ref: REF, euros: eurosFr(1250) }))
      expect(m.html).toContain('12,50')
      expect(m.html).toContain(text('fr', 'refundedLinked.next', { ref: REF }))
      expect(logs()).toHaveLength(1)
    }
  })

  it('(10) both declaration kinds → claim_closed_by_support, closedBySupport.*, no evidence needed, no note and no amount in the html', async () => {
    for (const c of [
      { status: 'refunded', refundError: `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement…`, arbitrationReason: 'note opérateur secrète' },
      { status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x', arbitrationReason: 'note opérateur secrète' },
    ]) {
      fresh({ claim: { ...REFUNDED, ...c } })
      expect(await closure()).toEqual({ status: 'sent', kind: c.status === 'refunded' ? 'settled_by_declaration' : 'closed_by_declaration' })
      const m = sends()[0]
      expect(dispatchTriggers()).toEqual(['claim_closed_by_support'])
      expect(m.subject).toBe(text('fr', 'closedBySupport.subject', { ref: REF }))
      expect(m.html).toContain(text('fr', 'closedBySupport.body', { ref: REF }))
      expect(m.html).toContain(text('fr', 'closedBySupport.next', { ref: REF }))
      expect(m.html).not.toContain('note opérateur')
      expect(m.html).not.toContain('€')
      expect(db.refund.findUnique).not.toHaveBeenCalled()
      expect(logs()).toHaveLength(1)
    }
  })

  it('(11) no recipient → no_recipient; SMTP disabled → smtp_disabled; transport failure → sender_error; a database throw → failed, never a throw', async () => {
    fresh({ consumer: { email: null, name: 'X', locale: null } })
    expect(await closure(EV(1250))).toEqual({ status: 'skipped', kind: 'refunded', why: 'no_recipient' })
    expect(logs()).toEqual([expect.objectContaining({ recipient: '(aucun destinataire)' })])

    fresh()
    delete process.env.SMTP_PASS
    expect(await closure(EV(1250))).toEqual({ status: 'skipped', kind: 'refunded', why: 'smtp_disabled' })
    expect(logs()).toEqual([expect.objectContaining({ recipient: 'lea@x.fr', status: 'skipped' })])

    fresh()
    mail.sendMail.mockRejectedValue(new Error('smtp down'))
    expect(await closure(EV(1250))).toEqual({ status: 'failed', kind: 'refunded', why: 'sender_error' })
    expect(logs()).toEqual([expect.objectContaining({ recipient: 'lea@x.fr', status: 'failed' })])

    fresh({ claimThrows: true })
    await expect(closure(EV(1250))).resolves.toEqual({ status: 'failed', kind: null, why: 'sender_error' })
    expect(logs()).toEqual([expect.objectContaining({ status: 'skipped', recipient: '(non envoyé : sender_error)' })])
  })

  it('(12) locale ar → html dir rtl and the ar copy', async () => {
    fresh({ consumer: { ...CONSUMER, locale: 'ar' } })
    await closure(EV(1250))
    const m = sends()[0]
    expect(m.html).toContain('dir="rtl"')
    expect(m.subject).toBe(text('ar', 'refunded.subject', { ref: REF }))
  })
})

// ══ J-C25 — parity: the customer status and the closure sender ═══════════════════════════════════
describe('J-C25 — customer refund_unconfirmed ⇔ sender refunded_row_unproven / refunded_row_failed', () => {
  const ROWS: Record<string, Row | null> = {
    missing: null,
    other_order: { orderId: 'o_other', status: 'succeeded', stripeRefundId: 're_1' },
    failed_with_id: { orderId: 'ord123abc', status: 'failed', stripeRefundId: 're_1' },
    failed_without_id: { orderId: 'ord123abc', status: 'failed', stripeRefundId: null },
    pending: { orderId: 'ord123abc', status: 'pending', stripeRefundId: 're_1' },
    succeeded: { orderId: 'ord123abc', status: 'succeeded', stripeRefundId: 're_1' },
  }
  it('over rows × amount {0, 1250} × binders {1, 2}, Stripe evidence equal', async () => {
    const impossible: string[] = []
    for (const [name, base] of Object.entries(ROWS)) for (const amountCents of [0, 1250]) for (const binders of [1, 2]) {
      const row = base ? { ...base, amountCents } : null
      fresh({ row, binders })
      const r = await closure(EV(1250))
      const cust = customerClaimStatus(st.claim as ClaimFacts, null, refundedRowTruth(row as never, binders, 'ord123abc'))
      const reached = mail.sendMail.mock.calls.length > 0
      const label = `${name}/${amountCents}/${binders}`
      const rowRefusal = r.why === 'refunded_row_unproven' || r.why === 'refunded_row_failed'
      expect(cust === 'refund_unconfirmed', label).toBe(rowRefusal && binders === 1)
      if (binders === 2) {
        expect(cust, label).toBe('financial_verification')
        expect(r.why, label).toBe('refunded_row_unproven')
      }
      expect(cust === 'refunded', label).toBe(reached)
      if ((cust === 'refunded' && rowRefusal) || (cust === 'refund_unconfirmed' && reached)) impossible.push(label)
    }
    // NEGATIVE CONTROL: neither contradiction occurs.
    expect(impossible).toEqual([])
  })
})

// ══ J-C44 — miss signals ══════════════════════════════════════════════════════════════════════════
describe('J-C44 — every attempt that does not send leaves exactly one EmailLog row, through each sender', () => {
  type Case = { name: string; setup?: () => void; run: () => Promise<{ status: string; why?: string }>; why: ClaimEmailWhy; reached: boolean }
  const ack = (claimsOpen = true) => sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250, claimsOpen })
  const decision = (claimsOpen = true) => sendClaimDecisionEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', decision: 'refused_by_grubano', claimsOpen })
  const noConsumer = () => { st.consumer = { email: null, name: 'X', locale: null } }
  const noSmtp = () => { delete process.env.SMTP_PASS }
  const dbDown = () => { db.operator.findUnique.mockRejectedValue(new Error('db down')) }
  const smtpDown = () => { mail.sendMail.mockRejectedValue(new Error('smtp down')) }
  const CASES: Case[] = [
    { name: 'ack closed', run: () => ack(false), why: 'claims_disabled', reached: false },
    { name: 'ack no recipient', setup: noConsumer, run: () => ack(), why: 'no_recipient', reached: false },
    { name: 'ack smtp disabled', setup: noSmtp, run: () => ack(), why: 'smtp_disabled', reached: true },
    { name: 'ack db throw', setup: dbDown, run: () => ack(), why: 'sender_error', reached: false },
    { name: 'ack transport failed', setup: smtpDown, run: () => ack(), why: 'sender_error', reached: true },
    { name: 'decision closed', run: () => decision(false), why: 'claims_disabled', reached: false },
    { name: 'decision no recipient', setup: noConsumer, run: () => decision(), why: 'no_recipient', reached: false },
    { name: 'decision smtp disabled', setup: noSmtp, run: () => decision(), why: 'smtp_disabled', reached: true },
    { name: 'decision db throw', setup: dbDown, run: () => decision(), why: 'sender_error', reached: false },
    { name: 'decision transport failed', setup: smtpDown, run: () => decision(), why: 'sender_error', reached: true },
    { name: 'closure not found', setup: () => { st.claim = null }, run: () => closure(EV(1250)), why: 'claim_not_found', reached: false },
    { name: 'closure no record', setup: () => { st.record = false }, run: () => closure(EV(1250)), why: 'no_closure_record', reached: false },
    { name: 'closure closed', run: () => closure(EV(1250), false), why: 'claims_disabled', reached: false },
    { name: 'closure row failed', setup: () => { st.row = { ...ROW, status: 'failed' } }, run: () => closure(EV(1250)), why: 'refunded_row_failed', reached: false },
    { name: 'closure row unproven', setup: () => { st.binders = 2 }, run: () => closure(EV(1250)), why: 'refunded_row_unproven', reached: false },
    { name: 'closure no Stripe read', run: () => closure(undefined), why: 'stripe_not_confirmed', reached: false },
    { name: 'closure no recipient', setup: noConsumer, run: () => closure(EV(1250)), why: 'no_recipient', reached: false },
    { name: 'closure smtp disabled', setup: noSmtp, run: () => closure(EV(1250)), why: 'smtp_disabled', reached: true },
    { name: 'closure db throw', setup: () => { st.claimThrows = true }, run: () => closure(EV(1250)), why: 'sender_error', reached: false },
    { name: 'closure transport failed', setup: smtpDown, run: () => closure(EV(1250)), why: 'sender_error', reached: true },
  ]

  it('one row per attempt: a traced skip when the rail was not reached, the rail\'s own row otherwise; the claim id in the console; no claim write', async () => {
    const whys: string[] = []
    for (const c of CASES) {
      fresh()
      errSpy.mockClear()
      c.setup?.()
      const r = await c.run()
      whys.push(String(r.why))
      expect(r.why, c.name).toBe(c.why)
      const rows = logs()
      expect(rows, c.name).toHaveLength(1)
      if (!c.reached) {
        expect(rows[0], c.name).toMatchObject({
          status: 'skipped', subject: 'claim cl1',
          recipient: c.why === 'no_recipient' ? '(aucun destinataire)' : `(non envoyé : ${c.why})`,
        })
      } else {
        expect(rows[0].recipient, c.name).toBe('lea@x.fr')
        expect(['skipped', 'failed'], c.name).toContain(rows[0].status)
      }
      const lines = errSpy.mock.calls.map((a) => a.map(String).join(' '))
      expect(lines.some((l) => l.includes('[EMAIL MISS]') && l.includes('cl1')), c.name).toBe(true)
      expect(db.claim.update, c.name).not.toHaveBeenCalled()
      expect(db.claim.updateMany, c.name).not.toHaveBeenCalled()
    }
    // NEGATIVE CONTROL: I-08's names that are not ClaimEmailWhy values never appear.
    expect(whys.filter((w) => ['no_address', 'not_eligible', 'duplicate'].includes(w))).toEqual([])
    // @ts-expect-error — 'duplicate' is not a ClaimEmailWhy (compile-time control, checked by tsc)
    const notAWhy: ClaimEmailWhy = 'duplicate'
    expect(notAWhy).toBe('duplicate')
  })
})
