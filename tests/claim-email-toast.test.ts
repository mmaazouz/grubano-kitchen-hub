// tests/claim-email-toast.test.ts — T-49 round 13, slice W6: J-C31 (H11, I-08) — the operator toast for a customer e-mail
// result, its French mirror, and the 5-locale copy. logEmailSkipped's half lives in tests/email-idempotency.test.ts.
import { describe, it, expect, expectTypeOf } from 'vitest'
import { readFileSync } from 'node:fs'
import { customerEmailLine, CUSTOMER_EMAIL_FR, type CustomerEmailWhy } from '@/lib/claim-email-toast'
import type { ClaimEmailWhy } from '@/lib/claim-emails'
import { specCopyTable, messageAt, SPEC_LOCALES } from './support/spec-copy'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const KEYS = ['sent', 'duplicate', 'claimsDisabled', 'noRecipient', 'smtpDisabled', 'rowUnproven', 'stripeNotConfirmed', 'notSent', 'failed']

describe('J-C31 — customerEmailLine per H11', () => {
  it('maps every result shape exactly', () => {
    expect(customerEmailLine({ status: 'sent' })).toEqual({ tone: 'success', key: 'sent' })
    expect(customerEmailLine({ status: 'duplicate' })).toEqual({ tone: 'info', key: 'duplicate' })
    const skip: Record<ClaimEmailWhy, string> = {
      claims_disabled: 'claimsDisabled',
      no_recipient: 'noRecipient',
      smtp_disabled: 'smtpDisabled',
      refunded_row_unproven: 'rowUnproven',
      refunded_row_failed: 'rowUnproven',
      stripe_not_confirmed: 'stripeNotConfirmed',
      claim_not_found: 'notSent',
      no_closure_record: 'notSent',
      not_a_closure: 'notSent',
      sender_error: 'notSent',
    }
    for (const [why, key] of Object.entries(skip)) expect(customerEmailLine({ status: 'skipped', why }), why).toEqual({ tone: 'error', key })
    expect(customerEmailLine({ status: 'skipped' })).toEqual({ tone: 'error', key: 'notSent' })
    expect(customerEmailLine({ status: 'failed', why: 'sender_error' })).toEqual({ tone: 'error', key: 'failed' })
    expect(customerEmailLine({ status: 'failed' })).toEqual({ tone: 'error', key: 'failed' })
    expect(customerEmailLine({ status: 'not_applicable', why: 'not_a_closure' })).toBeNull()
    expect(customerEmailLine(null)).toBeNull()
    expect(customerEmailLine(undefined)).toBeNull()
  })

  it('every non-null key other than sent and duplicate has the error tone', () => {
    const shapes = [{ status: 'skipped' }, { status: 'failed' }, ...KEYS.map((k) => ({ status: 'skipped', why: k }))]
    for (const s of shapes) {
      const line = customerEmailLine(s)
      if (line && line.key !== 'sent' && line.key !== 'duplicate') expect(line.tone, JSON.stringify(s)).toBe('error')
    }
  })

  it('NEGATIVE CONTROL — « duplicate » passed as a skip reason is not a duplicate toast (and is not a ClaimEmailWhy)', () => {
    expect(customerEmailLine({ status: 'skipped', why: 'duplicate' })).toEqual({ tone: 'error', key: 'notSent' })
    // @ts-expect-error — 'duplicate' is not a ClaimEmailWhy (compile-time control, checked by tsc)
    const notAWhy: ClaimEmailWhy = 'duplicate'
    expect(notAWhy).toBe('duplicate')
    // The client-side union restates the server's exactly (no import of the senders into the console bundle).
    expectTypeOf<CustomerEmailWhy>().toEqualTypeOf<ClaimEmailWhy>()
  })
})

describe('J-C31 — CUSTOMER_EMAIL_FR and the 5-locale copy', () => {
  it('CUSTOMER_EMAIL_FR has the 9 keys and deep-equals messages/fr.json claims.admin.customerEmail', () => {
    const fr = JSON.parse(read('messages/fr.json'))
    expect(Object.keys(CUSTOMER_EMAIL_FR).sort()).toEqual([...KEYS].sort())
    expect(CUSTOMER_EMAIL_FR).toEqual(fr.claims.admin.customerEmail)
  })

  it('the 5 locales carry the 9 keys with the H11 values, verbatim from the frozen specification', () => {
    const table = specCopyTable('H11', 'claims.admin.customerEmail.')
    expect(Object.keys(table).sort()).toEqual(KEYS.map((k) => `claims.admin.customerEmail.${k}`).sort())
    for (const loc of SPEC_LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      expect(Object.keys(m.claims.admin.customerEmail).sort(), loc).toEqual([...KEYS].sort())
      for (const [path, vals] of Object.entries(table)) expect(messageAt(m, path), `${loc} ${path}`).toBe(vals[loc])
    }
  })

  it('the toast module is pure: no import at all (never lib/refund, lib/stripe, lib/claims or lib/claim-emails)', () => {
    const src = read('lib/claim-email-toast.ts')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/@\/lib\/(refund|stripe|claims|claim-emails)['"]/)
  })
  // J-C31 BREAK/RESTORE: mapping stripe_not_confirmed to 'sent' in lib/claim-email-toast.ts turns « maps every result shape
  // exactly » red (its skip table expects { tone: 'error', key: 'stripeNotConfirmed' }). W6 fixer: the former in-test
  // « witness » built its own broken mapper and passed whatever the module contained; it was removed as tautological.
})
