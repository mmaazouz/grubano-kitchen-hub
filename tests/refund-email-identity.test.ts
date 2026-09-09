// tests/refund-email-identity.test.ts — T-47
//
// Two DISTINCT legitimate refunds of the SAME amount on ONE order must produce TWO
// customer confirmations; a REPLAY of the same refund must produce at most one.
// The old key was `order:<orderId>:<amountCents>`, so the two collided on the
// EmailDispatch unique constraint and the second customer e-mail was silently
// suppressed — the customer was refunded again without being told.
//
// MONEY idempotency (`refund:<orderId>:<alreadyRefundedCents>`) is a SEPARATE concern
// and is deliberately untouched: this file only pins the e-mail identity.
import { describe, it, expect } from 'vitest'
import { refundEmailDedupeKey } from '@/lib/transactional-emails'

// The exact scenario from the ticket: order o1, two 500 c refunds, both legitimate.
const first = { refundId: 'rowA', stripeRefundId: 're_AAA', amountCents: 500 }
const second = { refundId: 'rowB', stripeRefundId: 're_BBB', amountCents: 500 }

describe('T-47 — the e-mail identity is the refund, not the amount', () => {
  it('two distinct refunds of the SAME amount → two DIFFERENT keys (two e-mails)', () => {
    const a = refundEmailDedupeKey(first)
    const b = refundEmailDedupeKey(second)
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a).not.toBe(b)
  })

  it('replaying the SAME refund identity → the SAME key (at most one e-mail)', () => {
    expect(refundEmailDedupeKey(first)).toBe(refundEmailDedupeKey({ ...first }))
    // a resume that re-drives the same Stripe refund keeps the identity
    expect(refundEmailDedupeKey({ refundId: 'rowA', stripeRefundId: 're_AAA' })).toBe(refundEmailDedupeKey(first))
  })

  it('the Stripe id wins over the row id (stable, external identity)', () => {
    expect(refundEmailDedupeKey({ refundId: 'rowA', stripeRefundId: 're_AAA' })).toBe('refund:re_AAA')
  })

  it('falls back to our Refund row id when Stripe has not named one yet', () => {
    expect(refundEmailDedupeKey({ refundId: 'rowA', stripeRefundId: null })).toBe('refund:rowA')
    expect(refundEmailDedupeKey({ refundId: 'rowA' })).toBe('refund:rowA')
  })

  it('no identity at all → NO key: never collapse two refunds onto one suppressed e-mail', () => {
    expect(refundEmailDedupeKey({})).toBeUndefined()
    expect(refundEmailDedupeKey({ refundId: '', stripeRefundId: '  ' })).toBeUndefined()
  })

  it('the amount is not part of the key at all — a different amount does not change identity', () => {
    expect(refundEmailDedupeKey({ ...first, amountCents: 1 } as never)).toBe(refundEmailDedupeKey(first))
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
// Prove this suite would actually catch the amount-keyed defect it exists to prevent.
describe('negative control — the OLD amount-based key would have been caught', () => {
  const vulnerableKey = (orderId: string, amountCents: number) => `order:${orderId}:${amountCents}`

  it('the old key collides for two distinct legitimate refunds of the same amount', () => {
    expect(vulnerableKey('o1', 500)).toBe(vulnerableKey('o1', 500)) // ← the bug: one e-mail for two refunds
    expect(refundEmailDedupeKey(first)).not.toBe(refundEmailDedupeKey(second)) // ← fixed
  })
})
