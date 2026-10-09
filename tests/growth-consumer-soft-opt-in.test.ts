// tests/growth-consumer-soft-opt-in.test.ts — ePrivacy soft-opt-in derogation.
// Adversarial focus: GDPR erasure overrides everything; suppression blocks commercial;
// prior similar purchase MUST be at the same tenant and inside the window; a cross-tenant
// "proof" is rejected with a distinct reason; a revocation blows away the derogation.

import { describe, it, expect } from 'vitest'
import { evaluateSoftOptIn } from '@/lib/growth/consumer/soft-opt-in'
import type { ConsumerOrderNet } from '@/lib/growth/consumer/money'
import type { Consent, Suppression } from '@/lib/growth/types'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

const paidNet = (over: Partial<ConsumerOrderNet>): ConsumerOrderNet => ({
  orderId: 'o1',
  tenantRestaurantId: 'tenant-A',
  contactId: 'contact-1',
  atMs: NOW - 30 * DAY,
  netCents: 2_500,
  countable: true,
  reason: 'ok',
  ...over,
})

const baseInput = {
  contactId: 'contact-1',
  tenantRestaurantId: 'tenant-A',
  channel: 'email' as const,
  nowMs: NOW,
  orders: [paidNet({})],
  suppressions: [] as Suppression[],
  consents: [] as Consent[],
  source: 'signup_checkout',
  gdprErased: false,
}

describe('evaluateSoftOptIn — gates', () => {
  it('eligible under default inputs (checkbox + prior order in window)', () => {
    const d = evaluateSoftOptIn(baseInput)
    expect(d.eligible).toBe(true)
    expect(d.reason).toBe('ok')
    expect(d.proofOrderId).toBe('o1')
  })

  it('GDPR erasure overrides everything (even a valid prior purchase)', () => {
    const d = evaluateSoftOptIn({ ...baseInput, gdprErased: true })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('erased')
  })

  it('a channel suppression blocks (commercial scope)', () => {
    const sup: Suppression = {
      contactId: 'contact-1', channel: 'email', reason: 'complaint', scope: 'commercial',
      since: new Date(NOW - DAY).toISOString(),
    }
    const d = evaluateSoftOptIn({ ...baseInput, suppressions: [sup] })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('suppressed')
  })

  it('a revocation on (channel × commercial) blows away soft-opt-in', () => {
    const consent: Consent = {
      contactId: 'contact-1', channel: 'email', purpose: 'commercial', legalBasis: 'soft_opt_in',
      grantedAt: new Date(NOW - 60 * DAY).toISOString(),
      revokedAt: new Date(NOW - 10 * DAY).toISOString(),
      source: 'preference_center',
    }
    const d = evaluateSoftOptIn({ ...baseInput, consents: [consent] })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('explicit_revocation')
  })

  it('an UNDOCUMENTED source is refused (fail-closed)', () => {
    const d = evaluateSoftOptIn({ ...baseInput, source: 'imported_list' })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('source_not_allowed')
  })

  it('an EMPTY source string is refused', () => {
    const d = evaluateSoftOptIn({ ...baseInput, source: '' })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('source_not_allowed')
  })
})

describe('evaluateSoftOptIn — proof requirement', () => {
  it('no prior purchase at all → "no_prior_similar_purchase"', () => {
    const d = evaluateSoftOptIn({ ...baseInput, orders: [] })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('no_prior_similar_purchase')
  })

  it('all prior purchases are OUTSIDE the window → "prior_purchase_outside_window"', () => {
    const old = paidNet({ atMs: NOW - 400 * DAY })
    const d = evaluateSoftOptIn({ ...baseInput, orders: [old], windowDays: 365 })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('prior_purchase_outside_window')
  })

  it('a non-countable "proof" row (fully refunded) does NOT prove prior purchase', () => {
    const refunded = paidNet({ countable: false, reason: 'fully_refunded', netCents: 0 })
    const d = evaluateSoftOptIn({ ...baseInput, orders: [refunded] })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('no_prior_similar_purchase')
  })

  it('a cross-tenant proof is REJECTED with distinct reason "cross_tenant_proof_rejected"', () => {
    // The attacker surface: X's customer buys at X, then marketing at Y tries to borrow
    // that purchase as soft-opt-in proof. Must fail even though the purchase is "recent".
    const borrowed = paidNet({ tenantRestaurantId: 'tenant-B', atMs: NOW - 5 * DAY })
    const d = evaluateSoftOptIn({ ...baseInput, orders: [borrowed] })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('cross_tenant_proof_rejected')
  })

  it('the LATEST countable in-window order is picked as proof (not the earliest)', () => {
    const older  = paidNet({ orderId: 'A1', atMs: NOW - 100 * DAY })
    const newer  = paidNet({ orderId: 'A2', atMs: NOW -  10 * DAY })
    const d = evaluateSoftOptIn({ ...baseInput, orders: [older, newer] })
    expect(d.proofOrderId).toBe('A2')
  })
})
