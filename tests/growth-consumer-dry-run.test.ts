// tests/growth-consumer-dry-run.test.ts — REVIEW/ELIGIBLE/NO_SEND verdicts.
// Adversarial focus: GDPR + all-sends-disabled + holdout all short-circuit to NO_SEND;
// commercial purpose without consent → NO_SEND unless soft-opt-in → REVIEW; quiet hours
// or frequency caps → REVIEW with retryAfter; wait cohort → NO_SEND; all pure.

import { describe, it, expect } from 'vitest'
import { planDryRun } from '@/lib/growth/consumer/dry-run'
import type { ConsumerOrderInput } from '@/lib/growth/consumer/money'
import type { Consent, Suppression } from '@/lib/growth/types'

const NOW = Date.UTC(2026, 9, 9, 14, 0, 0, 0) // 2026-10-09 14:00 UTC — outside default 21-9 quiet window in UTC
const DAY = 86_400_000

const regularPairOrders: ConsumerOrderInput[] = [
  {
    orderId: 'o1', tenantRestaurantId: 'tenant-A', contactId: 'c1',
    atMs: NOW - 20 * DAY, status: 'delivered', paymentStatus: 'paid',
    grossCents: 2_500, refundCentsList: [],
  },
  {
    orderId: 'o2', tenantRestaurantId: 'tenant-A', contactId: 'c1',
    atMs: NOW - 5 * DAY, status: 'delivered', paymentStatus: 'paid',
    grossCents: 2_500, refundCentsList: [],
  },
]

const emailConsent = (purpose: Consent['purpose']): Consent => ({
  contactId: 'c1', channel: 'email', purpose, legalBasis: 'consent',
  grantedAt: new Date(NOW - 10 * DAY).toISOString(), revokedAt: null,
  source: 'preference_center',
})

const baseInput = {
  contact: { id: 'c1', audienceType: 'b2c' as const, timezone: 'UTC' },
  tenantRestaurantId: 'tenant-A',
  nowMs: NOW,
  orders: regularPairOrders,
  consents: [emailConsent('commercial'), emailConsent('lifecycle')],
  suppressions: [] as Suppression[],
  recentSendTimestampsMs: [] as number[],
  frequencyCaps: [{ channel: 'email' as const, windowMs: 7 * DAY, max: 3 }],
  quietHours: null,
  softOptInSource: 'signup_checkout',
  gdprErased: false,
  allSendsDisabled: false,
}

describe('planDryRun — ELIGIBLE path', () => {
  it('regular cohort with consent + quiet hours null + no caps breach → ELIGIBLE', () => {
    const r = planDryRun(baseInput)
    expect(r.verdict).toBe('ELIGIBLE')
    expect(r.reason.startsWith('ok:')).toBe(true)
    expect(r.nba.kind).toBe('referral_prompt')
    expect(r.idempotencyKey).toContain('tenant=tenant-A')
    expect(r.idempotencyKey).toContain('contact=c1')
  })
})

describe('planDryRun — NO_SEND short-circuits', () => {
  it('GDPR erased → NO_SEND reason "gdpr_erased" (overrides everything)', () => {
    const r = planDryRun({ ...baseInput, gdprErased: true })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('gdpr_erased')
  })

  it('allSendsDisabled → NO_SEND reason "all_sends_disabled"', () => {
    const r = planDryRun({ ...baseInput, allSendsDisabled: true })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('all_sends_disabled')
  })

  it('holdout (pct=1) → NO_SEND reason "holdout_control"', () => {
    const r = planDryRun({ ...baseInput, nbaOptions: { holdoutPct: 1, holdoutSeed: 'x' } })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('holdout_control')
  })

  it('cohort "lost" → NO_SEND reason "wait:lost"', () => {
    // Build a lost cohort: orders ≥ 2 but recency past winbackMaxDays.
    const r = planDryRun({
      ...baseInput,
      orders: [
        { ...regularPairOrders[0], atMs: NOW - 800 * DAY },
        { ...regularPairOrders[1], atMs: NOW - 700 * DAY },
      ],
      rfmOptions: { winbackMaxDays: 365 },
    })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('wait:lost')
  })

  it('zero orders → cohort "none" → NO_SEND reason "wait:none"', () => {
    const r = planDryRun({ ...baseInput, orders: [] })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('wait:none')
  })
})

describe('planDryRun — commercial consent gate', () => {
  it('no consent for commercial purpose + no soft-opt-in proof → NO_SEND "blocked:no_permission:no_consent"', () => {
    // No consents + no documented collection source for soft-opt-in. The NBA for
    // regular is commercial, so the policy gate blocks on no_consent and there is
    // no derogation fallback. Keep orders to retain the regular cohort.
    const r = planDryRun({ ...baseInput, consents: [], softOptInSource: null })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason.startsWith('blocked:no_permission')).toBe(true)
  })

  it('no consent + eligible soft-opt-in proof → REVIEW "soft_opt_in_candidate:*"', () => {
    const r = planDryRun({ ...baseInput, consents: [], softOptInSource: 'signup_checkout' })
    expect(r.verdict).toBe('REVIEW')
    expect(r.reason.startsWith('soft_opt_in_candidate:')).toBe(true)
    expect(r.softOptIn?.eligible).toBe(true)
  })

  it('no consent + ONLY cross-tenant purchases exist → NO_SEND "wait:none" (no cohort)', () => {
    // Doctrine: a tenant-B purchase cannot build a tenant-A cohort NOR serve as proof.
    // After normalise, all rows are tenant_mismatch → lifetimeOrders=0 → cohort "none"
    // → NO_SEND short-circuits to wait:none BEFORE even hitting the consent gate.
    const borrowed1: ConsumerOrderInput = { ...regularPairOrders[0], tenantRestaurantId: 'tenant-B' }
    const borrowed2: ConsumerOrderInput = { ...regularPairOrders[1], tenantRestaurantId: 'tenant-B' }
    const r = planDryRun({ ...baseInput, consents: [], orders: [borrowed1, borrowed2] })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('wait:none')
    expect(r.snapshot.rejected.filter((x) => x.reason === 'tenant_mismatch').length).toBe(2)
  })
})

describe('planDryRun — defer paths (REVIEW with retryAfter)', () => {
  it('frequency cap breached → REVIEW "defer:frequency_cap" + retryAfterMs set', () => {
    // 3 sends within last 24h, cap is 3 per 7d → next slot is in 6 days from the oldest.
    const sendsMs = [NOW - 1 * DAY, NOW - 2 * DAY, NOW - 3 * DAY]
    const r = planDryRun({ ...baseInput, recentSendTimestampsMs: sendsMs })
    expect(r.verdict).toBe('REVIEW')
    expect(r.reason).toBe('defer:frequency_cap')
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })

  it('quiet hours → REVIEW "defer:quiet_hours"', () => {
    // Default quiet hours = 21..9. Pick a nowMs that falls at 23:00 UTC.
    const nightMs = Date.UTC(2026, 9, 9, 23, 0, 0, 0)
    const r = planDryRun({
      ...baseInput, nowMs: nightMs, quietHours: { startHour: 21, endHour: 9 },
    })
    expect(r.verdict).toBe('REVIEW')
    expect(r.reason).toBe('defer:quiet_hours')
    expect(r.retryAfterMs).toBeGreaterThan(0)
  })
})

describe('planDryRun — tenant isolation (A ↔ B)', () => {
  it('a row from tenant B does NOT inflate contact-A at tenant-A (verdict unchanged)', () => {
    const leaked: ConsumerOrderInput = {
      orderId: 'B-leaked', tenantRestaurantId: 'tenant-B', contactId: 'c1',
      atMs: NOW - 1 * DAY, status: 'delivered', paymentStatus: 'paid',
      grossCents: 999_99, refundCentsList: [],
    }
    const r = planDryRun({ ...baseInput, orders: [...regularPairOrders, leaked] })
    // Verdict and monetary should be identical to the clean run.
    expect(r.verdict).toBe('ELIGIBLE')
    expect(r.snapshot.rfm.monetaryCents).toBe(5_000) // the two paid orders at 25€ each
    expect(r.snapshot.rejected.some((x) => x.orderId === 'B-leaked' && x.reason === 'tenant_mismatch')).toBe(true)
  })

  it('a contact that is "regular" at tenant A is "none" at tenant B (no data cross-reads)', () => {
    const r = planDryRun({ ...baseInput, tenantRestaurantId: 'tenant-B' })
    // The scope passed to buildRFMSnapshot is tenant-B/c1, so all input orders become
    // tenant-mismatch rejects → lifetimeOrders=0 → cohort "none".
    expect(r.snapshot.cohort).toBe('none')
    expect(r.verdict).toBe('NO_SEND')
  })
})

describe('planDryRun — idempotency and purity', () => {
  it('same inputs → same idempotency key + verdict (pure)', () => {
    const a = planDryRun(baseInput)
    const b = planDryRun(baseInput)
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
    expect(a.verdict).toBe(b.verdict)
    expect(a.snapshot).toEqual(b.snapshot)
  })
})
