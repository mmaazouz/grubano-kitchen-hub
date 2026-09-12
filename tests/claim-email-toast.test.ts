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

  // ROUND 13 (slice W7) — ER-C22 / H11 W6 fixer note: a row with two or more binders answers refunded_row_unproven, so rowUnproven
  // names that cause too. The frozen H11 value plus exactly one inserted clause, per locale (IMPLEMENTATION NOTE (W7) on H11).
  const ROW_UNPROVEN_CLAUSE: Record<string, [string, string]> = {
    fr: ['porte sur une autre commande, ', 'est liée à plusieurs réclamations, '],
    en: ['belongs to another order, ', 'is linked to several claims, '],
    es: ['pertenece a otro pedido, ', 'está vinculada a varias reclamaciones, '],
    it: ['riguarda un altro ordine, ', 'è collegata a più reclami, '],
    ar: ['أو يخص طلبًا آخر، ', 'أو مرتبط بعدة شكاوى، '],
  }
  const amendedRowUnproven = (frozen: string, loc: string) => {
    const [after, clause] = ROW_UNPROVEN_CLAUSE[loc]
    return frozen.replace(after, `${after}${clause}`)
  }

  it('the 5 locales carry the 9 keys with the H11 values, verbatim from the frozen specification (rowUnproven: + the W7 clause)', () => {
    const table = specCopyTable('H11', 'claims.admin.customerEmail.')
    expect(Object.keys(table).sort()).toEqual(KEYS.map((k) => `claims.admin.customerEmail.${k}`).sort())
    for (const loc of SPEC_LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      expect(Object.keys(m.claims.admin.customerEmail).sort(), loc).toEqual([...KEYS].sort())
      for (const [path, vals] of Object.entries(table)) {
        const want = path.endsWith('.rowUnproven') ? amendedRowUnproven(vals[loc], loc) : vals[loc]
        expect(want, `${loc} ${path} (the clause anchor exists)`).not.toBe(path.endsWith('.rowUnproven') ? vals[loc] : undefined)
        expect(messageAt(m, path), `${loc} ${path}`).toBe(want)
      }
    }
  })

  it('NEGATIVE CONTROL (ER-C22) — the frozen rowUnproven, which omits the multi-binder cause, is no longer the shipped copy', () => {
    const table = specCopyTable('H11', 'claims.admin.customerEmail.')
    for (const loc of SPEC_LOCALES) {
      const shipped = messageAt(JSON.parse(read(`messages/${loc}.json`)), 'claims.admin.customerEmail.rowUnproven')
      expect(shipped, loc).not.toBe(table['claims.admin.customerEmail.rowUnproven'][loc])
      expect(String(shipped), loc).toContain(ROW_UNPROVEN_CLAUSE[loc][1].trim().replace(/[,،]$/, ''))
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
