// tests/claims-closure-notice-route.test.ts — T-49 round 13, slice W6: J-C27 (H08, H06, E-09, E-16), plus the D10 (iv)
// halves of J-M38.
//
// POST /api/admin/claims/[id]/closure-notice is the only resend of a closure notice. Empty body; the content comes from the
// database and, for a refunded claim, from Stripe's refund object read in the same request (R0, read-only). It is not
// gated by the claims flags and it never reaches a money function.
//
// D′ L1 (FIN-EMAIL-01, S-25 — spec v2 §6.2): an explicit terminal CLOSURE is always sendable. The route passes
// `claimsOpen: claimNoticeGate('closure')` (≡ true), so the notice goes out even under the kill-switch (no product flag, no
// lease). Before L1 (05152b6) it passed the lease and the sender skipped as claims_disabled — INVERTED below, with the
// negative control that the sender's claims_disabled path is still alive for a PRE-MONEY gate. The gate is real
// (lib/claim-flags reads process.env); only lib/claims' reconcileClaimEvidence is mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const { adminMock, limitMock, db, claimsMock, senderMock, auditMock, mail } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  limitMock: vi.fn(),
  db: {
    claim:         { findUnique: vi.fn(), count: vi.fn() },
    refund:        { findUnique: vi.fn() },
    operator:      { findUnique: vi.fn() },
    emailDispatch: { findFirst: vi.fn() },
  },
  // D′ L1: no gate on this mock — a route reading isClaimsEnabled through lib/claims would throw on the missing export.
  claimsMock: { reconcileClaimEvidence: vi.fn() },
  senderMock: vi.fn(),
  auditMock: vi.fn(),
  mail: { sendTransactional: vi.fn(), logEmailSkipped: vi.fn() },
}))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: limitMock }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/claims', () => claimsMock)
vi.mock('@/lib/claim-emails', () => ({ sendClaimClosureEmail: senderMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/transactional-emails', () => mail)
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/onboarding-nudge', () => ({ resolveNudgeLocale: () => 'fr' }))

import { POST } from '@/app/api/admin/claims/[id]/closure-notice/route'
import { MARKERS } from '@/lib/claim-action-rules'
import { claimsSurfaceOpen, claimNoticeGate } from '@/lib/claim-flags'

/** The kill-switch: no product flag, no lease — every surface gate reads CLOSED. */
const killSwitch = () => { closeClaimsWindow(); delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED }

type Row = Record<string, unknown>
const BASE: Row = { id: 'cl1', status: 'refunded', consumerId: 'c1', orderId: 'o1', refundId: 'rf1', refundError: null, arbitrationDecision: 'approved', restaurantResponse: null, arbitrationReason: null }
const KINDS: Record<string, Row> = {
  settled_by_declaration: { status: 'refunded', refundError: `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement…` },
  closed_by_declaration: { status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x' },
  refused_confirmed: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' },
  refused_by_grubano: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: null },
}
const NOT_A_CLOSURE = 'Cette réclamation n’appelle pas d’avis de clôture (son état a changé) — rechargez la liste.'
let claim: Row | null
const pick = (r: Row, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.entries(r).filter(([k]) => select[k] === true)) : r)

const post = async (body?: unknown) => {
  const res = await POST(new Request('https://app.grubano.com/api/admin/claims/cl1/closure-notice', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as Row }
}
const standing = (o: Row = {}) => ({ ok: true, outcome: 'refund_still_standing', refundId: 'rf1', stripeStatus: 'succeeded', amountCents: 1250, ...o })

beforeEach(() => {
  for (const m of [adminMock, limitMock, senderMock, auditMock, claimsMock.reconcileClaimEvidence, mail.sendTransactional, mail.logEmailSkipped]) m.mockReset()
  for (const group of Object.values(db)) for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset()
  claim = { ...BASE }
  // D′ L1: the suite runs under the KILL-SWITCH by default — a closure notice does not depend on any claims gate.
  killSwitch()
  adminMock.mockResolvedValue({ id: 'op1', email: 'a@x.test', role: 'admin', name: 'A' })
  limitMock.mockReturnValue(null)
  claimsMock.reconcileClaimEvidence.mockResolvedValue(standing())
  db.claim.findUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => (claim ? pick(claim, select) : null))
  senderMock.mockImplementation(async (p: { claimsOpen: boolean }) => (p.claimsOpen
    ? { status: 'sent', kind: 'refunded' }
    : { status: 'skipped', kind: 'refunded', why: 'claims_disabled' }))
  auditMock.mockResolvedValue(true)
})
afterEach(killSwitch)

describe('J-C27 — refusals before any read', () => {
  it('a non-admin → 403, nothing read, sent or audited', async () => {
    adminMock.mockResolvedValue(null)
    expect((await post()).status).toBe(403)
    expect(db.claim.findUnique).not.toHaveBeenCalled()
    expect(senderMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a body with any field → 400 ({amount:1}, {note:\'x\'}); an empty body and {} are accepted', async () => {
    for (const body of [{ amount: 1 }, { note: 'x' }]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(senderMock).not.toHaveBeenCalled()
    expect((await post()).status).toBe(200)
    expect((await post({})).status).toBe(200)
  })

  it('a missing claim → 404', async () => {
    claim = null
    expect((await post()).status).toBe(404)
    expect(senderMock).not.toHaveBeenCalled()
  })

  it('not a closure (approved, REVERTED_AFTER_REFUND) → 409 with the H08 text, no Stripe read, no send, no audit', async () => {
    for (const c of [{ status: 'approved', refundError: 'engine_failed: x' }, { status: 'refunded', refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` }]) {
      claim = { ...BASE, ...c }
      const r = await post()
      expect(r).toEqual({ status: 409, body: { error: NOT_A_CLOSURE } })
    }
    expect(claimsMock.reconcileClaimEvidence).not.toHaveBeenCalled()
    expect(senderMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('J-C27 — the evidence passed to the sender', () => {
  it('declaration and refusal kinds: no Stripe read, evidence undefined, the closure gate (claimsOpen: true) at send time', async () => {
    for (const [kind, c] of Object.entries(KINDS)) {
      claim = { ...BASE, ...c }
      senderMock.mockClear()
      claimsMock.reconcileClaimEvidence.mockClear()
      expect((await post()).status, kind).toBe(200)
      expect(claimsMock.reconcileClaimEvidence, kind).not.toHaveBeenCalled()
      expect(senderMock, kind).toHaveBeenCalledWith({ claimId: 'cl1', evidence: undefined, claimsOpen: true })
    }
  })

  it('refunded: only refund_still_standing {succeeded, integer 1250} passes {stripe_read, 1250}; every other R0 answer passes undefined', async () => {
    expect((await post()).status).toBe(200)
    expect(claimsMock.reconcileClaimEvidence).toHaveBeenCalledWith({ claimId: 'cl1' })
    expect(senderMock).toHaveBeenLastCalledWith({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1250 }, claimsOpen: true })
    const others: Array<[string, () => void]> = [
      ['pending', () => claimsMock.reconcileClaimEvidence.mockResolvedValue(standing({ stripeStatus: 'pending' }))],
      ['requires_action', () => claimsMock.reconcileClaimEvidence.mockResolvedValue(standing({ stripeStatus: 'requires_action' }))],
      ['stripeStatus missing', () => claimsMock.reconcileClaimEvidence.mockResolvedValue(standing({ stripeStatus: undefined }))],
      ['amount 12.5', () => claimsMock.reconcileClaimEvidence.mockResolvedValue(standing({ amountCents: 12.5 }))],
      ['refunded_row_unproven', () => claimsMock.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'refunded_row_unproven', refundId: 'rf1', detail: 'x' })],
      ['unconfirmed_within_window', () => claimsMock.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf1', until: 'x' })],
      ['a refusal', () => claimsMock.reconcileClaimEvidence.mockResolvedValue({ ok: false, status: 409, error: 'refusé' })],
      ['a throw', () => claimsMock.reconcileClaimEvidence.mockRejectedValue(new Error('stripe down'))],
    ]
    for (const [name, arrange] of others) {
      arrange()
      senderMock.mockClear()
      expect((await post()).status, name).toBe(200)
      expect(senderMock, name).toHaveBeenCalledWith({ claimId: 'cl1', evidence: undefined, claimsOpen: true })
    }
  })

  it('reverted_after_refund → 409 naming the customer view, sender not called; changed_during_read → 409', async () => {
    claimsMock.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'reverted_after_refund', refundId: 'rf1' })
    const r = await post()
    expect(r.status).toBe(409)
    expect(String(r.body.error)).toContain('Aucun avis envoyé : Stripe rapporte que le remboursement lié a échoué ou a été annulé.')
    expect(String(r.body.error)).toContain('Quand les réclamations sont ouvertes')
    expect(senderMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.closure_notice' }))

    claimsMock.reconcileClaimEvidence.mockResolvedValue({ ok: true, outcome: 'changed_during_read' })
    const c = await post()
    expect(c).toEqual({ status: 409, body: { error: 'La réclamation a changé pendant la lecture : aucun avis envoyé. Rechargez la liste.' } })
    expect(senderMock).not.toHaveBeenCalled()
  })

  it('the audit carries {status, why, kind, moneyMoved:false}', async () => {
    senderMock.mockResolvedValue({ status: 'skipped', kind: 'refunded', why: 'stripe_not_confirmed' })
    await post()
    // D′ L8 (§18): the metadata now also records the RESTAURANT notice's own outcome, so « was the
    // restaurant told what the refund cost them? » is answerable from the audit trail and not only from the
    // e-mail tables. Here the claim's Stripe evidence was NOT confirmed, so no restaurant notice was even
    // attempted — both fields are null, which is a different fact from « attempted and skipped ».
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'claim.closure_notice', targetType: 'claim', targetId: 'cl1',
      metadata: expect.objectContaining({ status: 'skipped', why: 'stripe_not_confirmed', kind: 'refunded', moneyMoved: false }),
    }))
    // …and the two D′ L8 keys are PRESENT, whatever their value: « the restaurant notice was not recorded »
    // and « it was recorded as skipped » must not look the same in a trail an admin reads later.
    const meta = (auditMock.mock.calls.at(-1)?.[0] as { metadata: Record<string, unknown> }).metadata
    expect(Object.keys(meta)).toContain('restaurantStatus')
    expect(Object.keys(meta)).toContain('restaurantWhy')
  })

  it('D′ L1 INVERSION (S-25) — kill-switch (no product flag, no lease) → 200 and the notice is SENT with claimsOpen: true; the surface itself reads closed', async () => {
    killSwitch()
    expect(claimsSurfaceOpen()).toBe(false)
    expect(claimNoticeGate('pre_money')).toBe(false) // the pre-money gate IS closed here — the closure is sent anyway
    const r = await post()
    expect(r.status).toBe(200)
    expect(senderMock).toHaveBeenCalledWith({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1250 }, claimsOpen: true })
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    // D′ L8: the restaurant notice is attempted on this path (refunded + Stripe evidence) and reports its
    // own outcome. With no ledger line in this fixture it is `ledger_incomplete` — §16, and the assertion
    // worth keeping: a kill-switch does not suppress it, a missing accounting line does.
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'claim.closure_notice',
      metadata: expect.objectContaining({ status: 'sent', why: null, kind: 'refunded', moneyMoved: false }),
    }))
  })

  it('…and the same under an open legacy lease or the product surface: the closure gate never varies', async () => {
    openClaimsWindow()
    expect((await post()).body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    killSwitch(); process.env.CLAIMS_SURFACE_ENABLED = 'true'
    expect((await post()).body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(senderMock).toHaveBeenCalledTimes(2)
    for (const c of senderMock.mock.calls) expect(c[0]).toMatchObject({ claimsOpen: true })
  })

  it('NEGATIVE CONTROL — the 05152b6 shape (claimsOpen from the lease / the pre-money gate) would skip claims_disabled under the kill-switch: the sender contract is unchanged', async () => {
    killSwitch()
    // the same sender double, handed the PRE-MONEY gate the old route read, answers what the old test expected
    await expect(senderMock({ claimId: 'cl1', evidence: undefined, claimsOpen: claimNoticeGate('pre_money') }))
      .resolves.toEqual({ status: 'skipped', kind: 'refunded', why: 'claims_disabled' })
    senderMock.mockClear()
    // …while the route, in the same environment, sends
    expect((await post()).body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(senderMock).toHaveBeenCalledTimes(1)
    expect(senderMock.mock.calls[0][0]).toMatchObject({ claimsOpen: true })
  })

  it('a sender that throws → 200 with customerEmail failed / sender_error', async () => {
    senderMock.mockRejectedValue(new Error('boom'))
    const r = await post()
    // D′ L8: `restaurantEmail` joins the body. It is present (this is a refunded closure with Stripe
    // evidence) and carries its own outcome — the customer sender throwing does not decide the other one.
    expect(r.status).toBe(200)
    expect(r.body.customerEmail).toEqual({ status: 'failed', kind: 'refunded', why: 'sender_error' })
    expect(Object.keys(r.body).sort()).toEqual(['customerEmail', 'restaurantEmail'])
  })
})

describe('J-C27 — no money path, pinned in the source', () => {
  const src = readFileSync('app/api/admin/claims/[id]/closure-notice/route.ts', 'utf8').replace(/\r\n/g, '\n')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const named = (from: string) => Array.from(code.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${from.replace(/\//g, '\\/')}'`, 'g'))).flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean))
  it('imports from @/lib/claims are exactly {reconcileClaimEvidence} and from @/lib/claim-flags exactly {claimNoticeGate} (D′ L1); no executeRefund, getStripe, lib/refund, lib/stripe or adminAuditLog', () => {
    // D′ L8 (T-46): a SECOND named import from lib/claims, and it is a READ. `readClaimFinancialEffect`
    // reads the claim, the bound Refund row, the ledger lines of its `re_…` and the charge's commission;
    // it writes nothing, calls no engine and touches no Stripe (the route's only Stripe read is still
    // `reconcileClaimEvidence`). Naming it here keeps the list exhaustive, which is what stops a third
    // import — an engine call, say — from arriving unnoticed.
    expect(named('@/lib/claims').sort()).toEqual(['readClaimFinancialEffect', 'reconcileClaimEvidence'])
    expect(named('@/lib/claim-flags')).toEqual(['claimNoticeGate'])
    expect(code).not.toMatch(/\bisClaimsEnabled\b|\bclaimsSurfaceOpen\b|\bclaimsIntakeOpen\b/)
    expect(code).not.toMatch(/executeRefund|getStripe|@\/lib\/refund['"]|@\/lib\/stripe['"]|adminAuditLog/)
  })

  it("the sender call carries claimsOpen: claimNoticeGate('closure') — never true, the lease, the surface or the pre-money class (spec v2 §6.2)", () => {
    expect(code).toMatch(/sendClaimClosureEmail\(\{ claimId: params\.id, evidence, claimsOpen: claimNoticeGate\('closure'\) \}\)/)
    expect(code).not.toMatch(/claimsOpen:\s*(true|isClaimsEnabled\(\)|claimsSurfaceOpen\(\)|claimNoticeGate\('pre_money'\))/)
    // NEGATIVE CONTROL — each 05152b6 / wrong-class shape written into a copy of the call trips the pin
    for (const bad of ['true', 'isClaimsEnabled()', 'claimsSurfaceOpen()', "claimNoticeGate('pre_money')"]) {
      const broken = code.replace("claimsOpen: claimNoticeGate('closure')", `claimsOpen: ${bad}`)
      expect(broken).not.toBe(code)
      expect(broken).toMatch(/claimsOpen:\s*(true|isClaimsEnabled\(\)|claimsSurfaceOpen\(\)|claimNoticeGate\('pre_money'\))/)
    }
  })
})

describe('J-C27 NEGATIVE CONTROL — through the REAL sender (record present, succeeded row)', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('@/lib/claim-emails')>('@/lib/claim-emails')
    senderMock.mockImplementation((p: Parameters<typeof actual.sendClaimClosureEmail>[0]) => actual.sendClaimClosureEmail(p))
    db.refund.findUnique.mockResolvedValue({ orderId: 'o1', status: 'succeeded', amountCents: 1250, stripeRefundId: 're_1' })
    db.claim.count.mockResolvedValue(1)
    db.emailDispatch.findFirst.mockResolvedValue({ id: 'rec1' })
    db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa', locale: null })
    mail.sendTransactional.mockResolvedValue({ status: 'sent' })
  })

  it('Stripe pending → the mail rail is never reached (stripe_not_confirmed)', async () => {
    claimsMock.reconcileClaimEvidence.mockResolvedValue(standing({ stripeStatus: 'pending' }))
    const r = await post()
    expect(r.status).toBe(200)
    expect(r.body.customerEmail).toEqual({ status: 'skipped', kind: 'refunded', why: 'stripe_not_confirmed' })
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })

  it('…and Stripe succeeded reaches it exactly once (the spy works) — under the kill-switch (D′ L1: the closure is always sendable)', async () => {
    killSwitch()
    expect(claimsSurfaceOpen()).toBe(false)
    const r = await post()
    expect(r.body.customerEmail).toEqual({ status: 'sent', kind: 'refunded' })
    expect(mail.sendTransactional).toHaveBeenCalledTimes(1)
    expect(mail.sendTransactional).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'claim_decision_refunded', dedupeKey: 'claim:cl1' }))
    expect(mail.logEmailSkipped).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — the REAL sender handed the PRE-MONEY gate under the kill-switch still skips claims_disabled (one traced miss, the mail rail never reached): the inversion is the route’s class, not a sender change', async () => {
    killSwitch()
    const actual = await vi.importActual<typeof import('@/lib/claim-emails')>('@/lib/claim-emails')
    const r = await actual.sendClaimClosureEmail({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1250 }, claimsOpen: claimNoticeGate('pre_money') })
    expect(r).toEqual({ status: 'skipped', kind: 'refunded', why: 'claims_disabled' })
    expect(mail.logEmailSkipped).toHaveBeenCalledWith('claim_decision_refunded', 'claim cl1', expect.objectContaining({ claimId: 'cl1', reason: 'claims_disabled' }), 'claims_disabled')
    expect(mail.sendTransactional).not.toHaveBeenCalled()
  })
})
