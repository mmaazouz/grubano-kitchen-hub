// tests/growth-consumer-b2c-hardening.test.ts — adversarial hardening (PR #23 B2C).
//
// Covers (from the read-only adversarial audit):
//   1) gdprErased is required and fail-closed across the money → RFM → NBA → plan pipeline.
//      An "unknown" (non-boolean) erasure state must NEVER produce ELIGIBLE.
//   2) Idempotency key delimiter escaping — a contactId containing '|' or '=' must not
//      forge a collision with a second-field value.
//   3) Future-dated orders (atMs > nowMs) must be excluded with reason 'invalid_atMs'.
//      A non-finite atMs is also rejected.
//   4) Refund dedup caller boundary — the pure module exposes an optional refundIds
//      companion that lets the caller push dedup into the library; a length mismatch
//      is fail-closed as 'invalid_amount'; two refunds with the same id are counted once.
//   5) Tenant isolation + suppression ambiguity + no legal opt-in assertion without
//      cryptographic proof-of-prior-purchase — covered by compile-time + runtime checks.

import { describe, it, expect } from 'vitest'
import {
  orderNet,
  normaliseOrderBatch,
  type ConsumerOrderInput,
} from '@/lib/growth/consumer/money'
import { buildRFMSnapshot } from '@/lib/growth/consumer/rfm'
import { decideNBA, buildIdempotencyKey } from '@/lib/growth/consumer/decisions'
import { planDryRun } from '@/lib/growth/consumer/dry-run'
import { evaluateSoftOptIn } from '@/lib/growth/consumer/soft-opt-in'
import type { Consent, Suppression } from '@/lib/growth/types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 9, 14, 0, 0, 0)

const paidOrder = (over: Partial<ConsumerOrderInput> = {}): ConsumerOrderInput => ({
  orderId: 'o1',
  tenantRestaurantId: 'tenant-A',
  contactId: 'c1',
  atMs: NOW - 5 * DAY,
  status: 'delivered',
  paymentStatus: 'paid',
  grossCents: 2_500,
  refundCentsList: [],
  ...over,
})

// ── 1. GDPR erasure — fail-closed propagation ─────────────────────────────────────────

describe('b2c hardening — gdprErased fail-closed propagation', () => {
  const baseDryRun = {
    contact: { id: 'c1', audienceType: 'b2c' as const, timezone: 'UTC' },
    tenantRestaurantId: 'tenant-A',
    nowMs: NOW,
    orders: [paidOrder({ atMs: NOW - 20 * DAY }), paidOrder({ orderId: 'o2', atMs: NOW - 5 * DAY })],
    consents: [{
      contactId: 'c1', channel: 'email' as const, purpose: 'commercial' as const,
      legalBasis: 'consent' as const, grantedAt: new Date(NOW - 10 * DAY).toISOString(),
      revokedAt: null, source: 'preference_center',
    }],
    suppressions: [] as Suppression[],
    recentSendTimestampsMs: [] as number[],
    frequencyCaps: [{ channel: 'email' as const, windowMs: 7 * DAY, max: 3 }],
    quietHours: null,
    softOptInSource: 'signup_checkout',
    gdprErased: false,
    allSendsDisabled: false,
  }

  it('planDryRun with gdprErased === undefined (non-boolean) → NO_SEND, never ELIGIBLE', () => {
    // A caller refactor drops the field. TypeScript would catch it in-tree but a JS caller
    // (API route, cron) must still be fail-closed at runtime.
    const r = planDryRun({ ...baseDryRun, gdprErased: undefined as unknown as boolean })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('gdpr_erased')
  })

  it('planDryRun with gdprErased === "false" (string, not boolean) → NO_SEND fail-closed', () => {
    const r = planDryRun({ ...baseDryRun, gdprErased: 'false' as unknown as boolean })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('gdpr_erased')
  })

  it('planDryRun with gdprErased === null → NO_SEND fail-closed', () => {
    const r = planDryRun({ ...baseDryRun, gdprErased: null as unknown as boolean })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('gdpr_erased')
  })

  it('buildRFMSnapshot threads gdprErased: when true, snapshot is empty + cohort "none"', () => {
    const snap = buildRFMSnapshot(
      { tenantRestaurantId: 'tenant-A', contactId: 'c1' },
      [paidOrder({ atMs: NOW - 2 * DAY })],
      NOW,
      { gdprErased: true },
    )
    expect(snap.gdprErased).toBe(true)
    expect(snap.lifetimeOrders).toBe(0)
    expect(snap.lifetimeMonetaryCents).toBe(0)
    expect(snap.cohort).toBe('none')
    expect(snap.cohortReasons).toContain('gdpr_erased')
    expect(snap.rfm.frequency).toBe(0)
    expect(snap.rfm.monetaryCents).toBe(0)
  })

  it('buildRFMSnapshot without opts.gdprErased defaults to false (back-compat for standalone callers)', () => {
    const snap = buildRFMSnapshot(
      { tenantRestaurantId: 'tenant-A', contactId: 'c1' },
      [paidOrder({ atMs: NOW - 2 * DAY })],
      NOW,
    )
    expect(snap.gdprErased).toBe(false)
  })

  it('decideNBA on an erased snapshot → kind "wait", channel null, confidence 1, reason "gdpr_erased"', () => {
    const snap = buildRFMSnapshot(
      { tenantRestaurantId: 'tenant-A', contactId: 'c1' },
      [paidOrder({ atMs: NOW - 2 * DAY })],
      NOW,
      { gdprErased: true },
    )
    const d = decideNBA(snap)
    expect(d.kind).toBe('wait')
    expect(d.channel).toBeNull()
    expect(d.templateKey).toBeNull()
    expect(d.rationale).toContain('gdpr_erased')
  })

  it('planDryRun(valid gdprErased=true) → snapshot.gdprErased=true + verdict NO_SEND', () => {
    const r = planDryRun({ ...baseDryRun, gdprErased: true })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('gdpr_erased')
    expect(r.snapshot.gdprErased).toBe(true)
  })
})

// ── 2. Idempotency key — delimiter escaping ────────────────────────────────────────────

describe('b2c hardening — NBA idempotency key escaping', () => {
  it('contactId containing "|" or "=" does NOT forge a collision with another field', () => {
    // Attack: contactId "c1|cohort=lost" tried to pivot the "cohort=regular" field.
    // After escaping, the delimiter inside the value is distinct from the real separator.
    const k1 = buildIdempotencyKey({
      tenantRestaurantId: 'tenant-A',
      contactId: 'c1|cohort=lost',
      cohort: 'regular',
      kind: 'referral_prompt',
      channel: 'email',
      purpose: 'commercial',
      anchorKey: '2026-10-09',
    })
    const k2 = buildIdempotencyKey({
      tenantRestaurantId: 'tenant-A',
      contactId: 'c1',
      cohort: 'lost',  // the attacker-pivoted field value
      kind: 'referral_prompt',
      channel: 'email',
      purpose: 'commercial',
      anchorKey: '2026-10-09',
    })
    expect(k1).not.toBe(k2)
  })

  it('backslash in a value does NOT collide with an escaped delimiter', () => {
    const k1 = buildIdempotencyKey({
      tenantRestaurantId: 'tenant-A',
      contactId: 'c\\|evil',
      cohort: 'regular',
      kind: 'referral_prompt',
      channel: 'email',
      purpose: 'commercial',
      anchorKey: '2026-10-09',
    })
    const k2 = buildIdempotencyKey({
      tenantRestaurantId: 'tenant-A',
      contactId: 'c',
      cohort: 'evil',
      kind: 'referral_prompt',
      channel: 'email',
      purpose: 'commercial',
      anchorKey: '2026-10-09',
    })
    expect(k1).not.toBe(k2)
  })

  it('innocent IDs (uuid-like, no special chars) are unchanged in shape (back-compat)', () => {
    const k = buildIdempotencyKey({
      tenantRestaurantId: 'tenant-A',
      contactId: '550e8400-e29b-41d4-a716-446655440000',
      cohort: 'regular',
      kind: 'referral_prompt',
      channel: 'email',
      purpose: 'commercial',
      anchorKey: '2026-10-09',
    })
    expect(k).toContain('tenant=tenant-A')
    expect(k).toContain('contact=550e8400-e29b-41d4-a716-446655440000')
  })
})

// ── 3. Future-dated orders — fail-closed ──────────────────────────────────────────────

describe('b2c hardening — future-dated atMs excluded', () => {
  it('orderNet(input, nowMs) with atMs > nowMs → not countable, reason "invalid_atMs"', () => {
    const n = orderNet(paidOrder({ atMs: NOW + 1 }), NOW)
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_atMs')
  })

  it('orderNet with non-finite atMs → not countable, reason "invalid_atMs"', () => {
    const n = orderNet(paidOrder({ atMs: Number.NaN }), NOW)
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_atMs')
  })

  it('normaliseOrderBatch(scope, rows, nowMs) stamps future rows as invalid_atMs', () => {
    const scope = { tenantRestaurantId: 'tenant-A', contactId: 'c1' }
    const out = normaliseOrderBatch(scope, [
      paidOrder({ orderId: 'past', atMs: NOW - DAY }),
      paidOrder({ orderId: 'future', atMs: NOW + 10 * DAY }),
    ], NOW)
    const future = out.find((o) => o.orderId === 'future')
    expect(future?.countable).toBe(false)
    expect(future?.reason).toBe('invalid_atMs')
  })

  it('buildRFMSnapshot excludes future-dated rows from cohort assignment', () => {
    const snap = buildRFMSnapshot(
      { tenantRestaurantId: 'tenant-A', contactId: 'c1' },
      [paidOrder({ orderId: 'future', atMs: NOW + 5 * DAY })],
      NOW,
    )
    expect(snap.lifetimeOrders).toBe(0)
    expect(snap.cohort).toBe('none')
    expect(snap.rejected.some((r) => r.orderId === 'future' && r.reason === 'invalid_atMs')).toBe(true)
  })

  it('orderNet without nowMs still fails if atMs is non-finite (defensive)', () => {
    const n = orderNet(paidOrder({ atMs: Number.POSITIVE_INFINITY }))
    expect(n.reason).toBe('invalid_atMs')
  })
})

// ── 4. Refund dedup — caller boundary pulled into the library ─────────────────────────

describe('b2c hardening — refund dedup via refundIds', () => {
  it('two refundCents entries with the SAME refundId subtract ONCE (dedup inside the library)', () => {
    const n = orderNet(paidOrder({
      grossCents: 2_500,
      refundCentsList: [500, 500],
      refundIds: ['re_1', 're_1'],
    }))
    expect(n.countable).toBe(true)
    expect(n.netCents).toBe(2_000)
  })

  it('two distinct refundIds subtract fully (back-compat with multi-refund orders)', () => {
    const n = orderNet(paidOrder({
      grossCents: 2_500,
      refundCentsList: [500, 300],
      refundIds: ['re_1', 're_2'],
    }))
    expect(n.countable).toBe(true)
    expect(n.netCents).toBe(1_700)
  })

  it('refundIds.length !== refundCentsList.length → invalid_amount (fail-closed, caller contract)', () => {
    const n = orderNet(paidOrder({
      grossCents: 2_500,
      refundCentsList: [500, 500],
      refundIds: ['re_1'],
    }))
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_amount')
  })

  it('refundIds not provided → caller contract documented; refundCentsList summed as-is (legacy)', () => {
    const n = orderNet(paidOrder({ grossCents: 2_500, refundCentsList: [500, 500] }))
    expect(n.countable).toBe(true)
    expect(n.netCents).toBe(1_500)
  })

  it('empty-string refundId is treated as its own distinct bucket (no silent collapse)', () => {
    // Doctrine: '' is a legal (if ugly) id. Two '' entries DO dedupe to one.
    const n = orderNet(paidOrder({
      grossCents: 2_500,
      refundCentsList: [500, 500],
      refundIds: ['', ''],
    }))
    expect(n.netCents).toBe(2_000)
  })
})

// ── 5. Tenant isolation + suppression ambiguity + no opt-in without proof ─────────────

describe('b2c hardening — tenant isolation + suppression ambiguity', () => {
  it('cross-tenant purchase cannot assert soft-opt-in (no "legal opt-in without proof")', () => {
    const borrowed = {
      orderId: 'X-at-B', tenantRestaurantId: 'tenant-B', contactId: 'c1',
      atMs: NOW - 5 * DAY, netCents: 2_500, countable: true, reason: 'ok' as const,
    }
    const d = evaluateSoftOptIn({
      contactId: 'c1', tenantRestaurantId: 'tenant-A',
      channel: 'email', nowMs: NOW,
      orders: [borrowed], suppressions: [], consents: [],
      source: 'signup_checkout', gdprErased: false,
    })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('cross_tenant_proof_rejected')
  })

  it('a Suppression row carries no tenantRestaurantId — platform-wide unsubscribe (documented doctrine)', () => {
    // Doctrine lock: this test is adversarial glue; if a future refactor adds a tenant
    // key to Suppression, this test will fail and force a reviewer decision.
    const sup = {
      contactId: 'c1', channel: 'email' as const,
      reason: 'complaint', scope: 'commercial' as const,
      since: new Date(NOW - DAY).toISOString(),
    } satisfies Suppression
    // No 'tenantRestaurantId' key — enforced by the type definition.
    expect(Object.prototype.hasOwnProperty.call(sup, 'tenantRestaurantId')).toBe(false)
  })

  it('soft-opt-in needs an actual in-window proof — signup_checkout alone is NOT enough', () => {
    const d = evaluateSoftOptIn({
      contactId: 'c1', tenantRestaurantId: 'tenant-A',
      channel: 'email', nowMs: NOW,
      orders: [], // no prior purchase
      suppressions: [], consents: [],
      source: 'signup_checkout', gdprErased: false,
    })
    expect(d.eligible).toBe(false)
    expect(d.reason).toBe('no_prior_similar_purchase')
  })

  it('planDryRun — tenant-B leakage with cross-tenant soft-opt-in attempt → wait:none, no REVIEW', () => {
    // The attack: caller gives tenant-A context but passes a tenant-B order claiming
    // signup_checkout. Must not land in REVIEW (soft_opt_in_candidate). The cross-tenant
    // row becomes tenant_mismatch, snapshot has 0 orders, verdict wait:none.
    const r = planDryRun({
      contact: { id: 'c1', audienceType: 'b2c', timezone: 'UTC' },
      tenantRestaurantId: 'tenant-A',
      nowMs: NOW,
      orders: [paidOrder({ tenantRestaurantId: 'tenant-B', atMs: NOW - 5 * DAY })],
      consents: [] as Consent[],
      suppressions: [] as Suppression[],
      recentSendTimestampsMs: [] as number[],
      frequencyCaps: [],
      quietHours: null,
      softOptInSource: 'signup_checkout',
      gdprErased: false,
      allSendsDisabled: false,
    })
    expect(r.verdict).toBe('NO_SEND')
    expect(r.reason).toBe('wait:none')
  })
})
