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
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { approvalToast } from '@/lib/claim-approval-toast'

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

  it('the fallback copy does not assert that nothing left — it may have, under already_handled', () => {
    const fr = JSON.parse(fs.readFileSync('messages/fr.json', 'utf8'))
    expect(fr.claims.admin.approvedNotSent).toMatch(/confirmé par cette action/)
  })
})

// ── NEGATIVE CONTROLS ────────────────────────────────────────────────────────────
describe('negative controls — both pre-fix rules would be caught', () => {
  it('the original rule said "remboursement déclenché" for a closed rail', () => {
    const preFix = () => 'approved' // one message, unconditionally
    expect(preFix()).toBe('approved')
    expect(approvalToast({ state: 'pending' }).key).toBe('approvedNotSent') // ← fixed
  })

  it('the first fix folded resume_mismatch into "no money left"', () => {
    const firstFix = (r: { state?: string }) => (r.state === 'failed' ? 'approvedFailed' : 'approvedNotSent')
    expect(firstFix({ state: 'failed' })).toBe('approvedFailed')            // ← the defect the re-audit found
    expect(approvalToast({ state: 'failed', error: 'resume_mismatch' }).key)
      .toBe('approvedResumeMismatch')                                        // ← fixed
  })
})
