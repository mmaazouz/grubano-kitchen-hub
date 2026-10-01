// tests/claim-approval-toast.test.ts — CLAIMS batch 2, re-audit fix
//
// What the admin console says after an approval is a statement about MONEY, and it was wrong in
// two directions. The dangerous one: RESUME-FIRST. The engine can resume an OLDER interrupted
// refund of the same order while `triggerClaimRefund` returns `{ state: 'failed', error:
// 'resume_mismatch' }`, because it did not settle THIS claim (lib/claims.ts, REFUND IDENTITY
// BINDING). Two of the four writers of that verdict follow a Stripe SUCCESS, two sit on the
// PENDING path. « le remboursement a ÉCHOUÉ : aucun argent n'est parti » is false on the first two
// and invites a second payment; « de l'argent EST parti » is false on the other two (ROUND-7 AUDIT
// FIX — this suite used to ENFORCE that sentence). Only "not this claim's refund" holds on all four.
//
// D′ L2 (spec v2 S-02, F13 v1.1): an admin approval no longer reaches the engine, so the arbitration console
// shows the nominal `admin.approvedNotSent` on every approve and never calls this mapper; the mapper stays the
// tested rendering of a RAIL attempt (triggerClaimRefund, D′ L5). The approvedNotSent copy was reworded ×5
// (decision recorded, no refund started by THIS action, payment by the financial rail) and the dead key
// `admin.approved` (« remboursement déclenché ») was deleted ×5 — both pinned below.
import { describe, it, expect, expectTypeOf } from 'vitest'
import fs from 'node:fs'
import { approvalToast, type ApprovalToast, type ApprovalRefundOutcome } from '@/lib/claim-approval-toast'
import type { RefundTriggerResult } from '@/lib/claims'

describe('a succeeded refund is reported as succeeded, with the amount that moved', () => {
  it('state refunded → success, carrying the ENGINE amount (not the requested one)', () => {
    expect(approvalToast({ state: 'refunded', amountCents: 473 }))
      .toEqual({ key: 'approvedRefunded', tone: 'success', amountCents: 473 })
  })

  it('a refunded outcome with no amount degrades to 0 rather than throwing', () => {
    expect(approvalToast({ state: 'refunded' })).toMatchObject({ key: 'approvedRefunded', amountCents: 0 })
  })
})

describe('RESUME-FIRST — money moved, and the admin must never be told otherwise', () => {
  it('failed + resume_mismatch is NOT reported as a failure of the same kind', () => {
    const m = approvalToast({ state: 'failed', error: 'resume_mismatch' })
    expect(m.key).toBe('approvedResumeMismatch')
    expect(m.key).not.toBe('approvedFailed')
  })

  it('its wording is a warning, not a reassurance', () => {
    expect(approvalToast({ state: 'failed', error: 'resume_mismatch' }).tone).toBe('error')
  })

  it('the French copy says the refund is NOT this claim’s, forbids a second refund, and asserts NO movement either way', () => {
    // ROUND-7 AUDIT FIX (P1): this test ENFORCED « de l’argent EST parti » — false on two of the
    // four writers of resume_mismatch (the PENDING path, where Stripe only accepted) and « pour un
    // autre montant » was false on two others (identical amount, different identity). The toast
    // now states only what all four establish.
    const fr = JSON.parse(fs.readFileSync('messages/fr.json', 'utf8'))
    const copy: string = fr.claims.admin.approvedResumeMismatch
    expect(copy).toMatch(/n’appartient PAS à cette réclamation/)
    expect(copy).toMatch(/Ne relancez aucun remboursement/) // do not pay again
    expect(copy).not.toMatch(/argent (EST|est|a) (parti|bougé)/i)
    expect(copy).not.toMatch(/autre montant/)
    expect(copy).not.toMatch(/a abouti/) // ROUND-8 (P3): the console's SUCCESS verb, on two PENDING writers
    expect(copy).not.toMatch(/aucun argent n’est parti/)
  })

  it('the FAILED copy asserts no cash outcome: the engine also "fails" on « déjà intégralement remboursé »', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(fs.readFileSync(`messages/${loc}.json`, 'utf8'))
      const failed: string = m.claims.admin.approvedFailed
      expect(failed, loc).not.toMatch(/aucun argent n[’']est parti|no money left|no ha salido dinero|nessun denaro|لم يخرج/i)
      const mismatch: string = m.claims.admin.approvedResumeMismatch
      expect(mismatch, loc).not.toMatch(/EST parti|DID leave|sí ha salido|È partito|خرج مال فعلاً/)
    }
  })

  it('the key exists in all five locales', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(fs.readFileSync(`messages/${loc}.json`, 'utf8'))
      expect(typeof m.claims.admin.approvedResumeMismatch).toBe('string')
      expect(m.claims.admin.approvedResumeMismatch.length).toBeGreaterThan(20)
    }
  })
})

describe('a genuine failure is still a failure', () => {
  it('failed with any other error → approvedFailed', () => {
    for (const error of [undefined, 'card_error', 'insufficient_funds', 'resume', 'mismatch']) {
      expect(approvalToast({ state: 'failed', error }).key).toBe('approvedFailed')
    }
  })
})

describe('everything else claims only what THIS action confirmed', () => {
  it('rail closed, Stripe pending, already handled, missing outcome → approvedNotSent', () => {
    for (const refund of [
      { state: 'pending', error: undefined },
      { state: 'already_handled' },
      { state: 'weird_future_state' },
      null,
      undefined,
      {},
    ]) {
      expect(approvalToast(refund).key).toBe('approvedNotSent')
    }
  })

  it('the fallback copy (D′ L2, F13 v1.1: the nominal toast of EVERY approve) says only what THIS action did — decision recorded, no refund started, paid by the rail — and never that nothing left, never « remboursement déclenché »', () => {
    const fr = JSON.parse(fs.readFileSync('messages/fr.json', 'utf8'))
    // ROUND 13 (F13) → D′ L2 (F13 v1.1): the reworded key says only what THIS action did, in all five locales, names
    // no console section (a T2 (e') park lands in financial verification, which « Remboursements à traiter » never
    // lists) and now states where payment comes from — the financial rail, in an authorised window — so an admin
    // never reads an approval as a payment and never re-approves to be paid.
    const EXPECTED: Record<string, string> = {
      fr: 'Réclamation approuvée — décision enregistrée, aucun remboursement n’a été lancé par cette action : le paiement sera traité séparément par le rail financier lors d’une fenêtre autorisée.',
      en: 'Claim approved — decision recorded, no refund was started by this action: payment is handled separately by the financial rail during an authorised window.',
      es: 'Reclamación aprobada — decisión registrada, esta acción no inició ningún reembolso: el pago se tramita por separado en el raíl financiero durante una ventana autorizada.',
      it: 'Reclamo approvato — decisione registrata, nessun rimborso è stato avviato da questa azione: il pagamento viene gestito separatamente dal binario finanziario durante una finestra autorizzata.',
      ar: 'تمت الموافقة على الشكوى — تم تسجيل القرار، ولم يُطلَق أي استرداد بهذا الإجراء: تتم معالجة الدفع بشكل منفصل عبر المسار المالي خلال نافذة مصرّح بها.',
    }
    // The truthfulness rule, unchanged: the copy scopes its claim to THIS action, promises no amount, asserts no cash
    // outcome either way, and names no console section.
    const SCOPED_TO_THIS_ACTION: Record<string, RegExp> = {
      fr: /par cette action/, en: /by this action/, es: /esta acción/, it: /da questa azione/, ar: /بهذا الإجراء/,
    }
    expect(fr.claims.admin.approvedNotSent).toBe(EXPECTED.fr)
    for (const loc of Object.keys(EXPECTED)) {
      const admin = JSON.parse(fs.readFileSync(`messages/${loc}.json`, 'utf8')).claims.admin as Record<string, string | undefined>
      const t = admin.approvedNotSent as string
      expect(t, loc).toBe(EXPECTED[loc])
      expect(t, loc).toMatch(SCOPED_TO_THIS_ACTION[loc])
      expect(t, loc).not.toContain('Remboursements à traiter')
      expect(t, loc).not.toMatch(/aucun argent n[’']est parti|no money left|no ha salido dinero|nessun denaro|لم يخرج/i)
      expect(t, loc).not.toMatch(/remboursement déclenché|refund triggered|reembolso activado|rimborso attivato|approuvez-la à nouveau|nouvelle approbation/i)
      expect(t, loc).not.toMatch(/\d+[.,]?\d*\s?(€|EUR)/) // no amount is ever promised by a decision
      // the dead key the console used to show on every approve (« Réclamation approuvée — remboursement déclenché ») is gone
      expect(admin.approved, `${loc} admin.approved deleted`).toBeUndefined()
    }
  })

  it('NEGATIVE CONTROL — the truthfulness pins reject the pre-D′ console copy', () => {
    const dead = 'Réclamation approuvée — remboursement déclenché.'
    expect(dead).toMatch(/remboursement déclenché/)
    expect(dead).not.toMatch(/par cette action/)
    const promise = 'Réclamation approuvée — 12,50 € seront remboursés.'
    expect(promise).toMatch(/\d+[.,]?\d*\s?(€|EUR)/)
  })
})

// ── REGRESSION PINS ON THE SHIPPED MAPPER ───────────────────────────────────────
// ROUND-8 AUDIT FIX (P3): this block held "negative controls" that restated the pre-fix rules as
// local lambdas and asserted the lambdas — they touched no shipped code. What is pinned is the
// shipped mapper; the differential proof lives in the round's control run.
describe('the two pre-fix rules stay fixed in the shipped mapper', () => {
  it('a closed rail (pending) is never reported as a triggered refund', () => {
    expect(approvalToast({ state: 'pending' }).key).toBe('approvedNotSent')
  })

  it('resume_mismatch is never folded into the generic failure', () => {
    expect(approvalToast({ state: 'failed', error: 'resume_mismatch' }).key).toBe('approvedResumeMismatch')
  })
})

// ══ ROUND 13 (slice W7) — J-C15 (F12, A-S15a, A-S16a, A-S30*, A-S33, A-S38, A-S41, E-10): one case per result shape ══════
// BREAK/RESTORE (run on lib/claim-approval-toast.ts): mapping every state 'pending' to approvedPending turns the
// « pending refunds_disabled » and « pending without reason » rows red; mapping 'identity_unverified' to
// approvedResumeMismatch turns its row red. The table below is the only oracle (no in-test mapper).
describe('J-C15 — approvalToast: key and tone exactly per F12', () => {
  const NOT_SENT_OK: ApprovalToast = { key: 'approvedNotSent', tone: 'success' }
  const NOT_SENT_ERR: ApprovalToast = { key: 'approvedNotSent', tone: 'error' }
  // The engine's 202 carries a refundId: passed through a variable (the outcome type does not name it).
  const pendingWithRefund = { state: 'pending', reason: 'stripe_pending', refundId: 'rf' }
  const until = '2026-09-13T08:00:00.000Z'
  const CASES: Array<[string, ApprovalRefundOutcome, ApprovalToast]> = [
    ['refunded 1250', { state: 'refunded', amountCents: 1250 }, { key: 'approvedRefunded', tone: 'success', amountCents: 1250 }],
    ['pending stripe_pending (own 202)', pendingWithRefund, { key: 'approvedPending', tone: 'success' }],
    ['pending refunds_disabled (E-10)', { state: 'pending', reason: 'refunds_disabled' }, NOT_SENT_OK],
    ['pending without reason', { state: 'pending' }, NOT_SENT_OK],
    ['already_handled', { state: 'already_handled' }, NOT_SENT_OK],
    ['failed resume_mismatch (A-S15)', { state: 'failed', error: 'resume_mismatch' }, { key: 'approvedResumeMismatch', tone: 'error' }],
    ['failed identity_unverified (A-S16)', { state: 'failed', error: 'identity_unverified' }, { key: 'approvedIdentityUnverified', tone: 'error' }],
    ['failed attempt_superseded (A-S41)', { state: 'failed', error: 'attempt_superseded' }, { key: 'approvedSuperseded', tone: 'error' }],
    ['failed unconfirmed_within_window + until (A-S30e-3)', { state: 'failed', error: 'unconfirmed_within_window', until }, { key: 'approvedNotSentUntil', tone: 'success', until }],
    ['failed unconfirmed_within_window without until', { state: 'failed', error: 'unconfirmed_within_window' }, NOT_SENT_OK],
    ['failed safety_check_unreadable (A-S30b)', { state: 'failed', error: 'safety_check_unreadable' }, NOT_SENT_OK],
    ['failed safety_hold (A-S30)', { state: 'failed', error: 'safety_hold' }, NOT_SENT_ERR],
    ['failed proof_locked (A-S30e-1)', { state: 'failed', error: 'proof_locked' }, NOT_SENT_ERR],
    ['failed proof_awaiting (A-S30e-2)', { state: 'failed', error: 'proof_awaiting' }, NOT_SENT_ERR],
    ['failed proof_stale (A-S38)', { state: 'failed', error: 'proof_stale' }, NOT_SENT_ERR],
    ['failed financial_verification (A-S30e-4)', { state: 'failed', error: 'financial_verification' }, NOT_SENT_ERR],
    ['failed own_row_exists (A-S33)', { state: 'failed', error: 'own_row_exists' }, NOT_SENT_ERR],
    ['failed x', { state: 'failed', error: 'x' }, { key: 'approvedFailed', tone: 'error' }],
    ['null', null, NOT_SENT_OK],
    ['undefined', undefined, NOT_SENT_OK],
  ]

  for (const [name, input, want] of CASES) {
    it(name, () => {
      expect(approvalToast(input)).toEqual(want)
    })
  }

  it('the input and output types are pinned (F12)', () => {
    expectTypeOf<ApprovalRefundOutcome>().toEqualTypeOf<{ state?: string; amountCents?: number; error?: string; reason?: string; until?: string } | null | undefined>()
    expectTypeOf<ApprovalToast>().toEqualTypeOf<
      | { key: 'approvedRefunded'; tone: 'success'; amountCents: number }
      | { key: 'approvedPending'; tone: 'success' }
      | { key: 'approvedResumeMismatch'; tone: 'error' }
      | { key: 'approvedIdentityUnverified'; tone: 'error' }
      | { key: 'approvedSuperseded'; tone: 'error' }
      | { key: 'approvedNotSentUntil'; tone: 'success'; until: string }
      | { key: 'approvedNotSent'; tone: 'success' | 'error' }
      | { key: 'approvedFailed'; tone: 'error' }
    >()
    // The contract: every shape triggerClaimRefund returns is an outcome the mapper reads.
    expectTypeOf<RefundTriggerResult>().toMatchTypeOf<NonNullable<ApprovalRefundOutcome>>()
  })

  it('NEGATIVE CONTROL — refunds_disabled is never approvedPending; identity_unverified never approvedResumeMismatch; attempt_superseded never approvedRefunded', () => {
    expect(approvalToast({ state: 'pending', reason: 'refunds_disabled' }).key).not.toBe('approvedPending')
    expect(approvalToast({ state: 'failed', error: 'identity_unverified' }).key).not.toBe('approvedResumeMismatch')
    expect(approvalToast({ state: 'failed', error: 'attempt_superseded' }).key).not.toBe('approvedRefunded')
    // every key the mapper returns exists in the five locales (the arbitration console renders t(`admin.${key}`))
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const admin = JSON.parse(fs.readFileSync(`messages/${loc}.json`, 'utf8')).claims.admin as Record<string, string>
      for (const [, , want] of CASES) expect(typeof admin[want.key], `${loc} ${want.key}`).toBe('string')
    }
  })
})
