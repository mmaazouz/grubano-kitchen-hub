// tests/growth-events.test.ts — business-engine Phase 0/1 event taxonomy.
// Exercises the Zod envelope + per-type payload schemas defined in lib/growth/events.ts.
// No I/O, no Prisma. These schemas are the contract every webhook/API/cron must speak,
// so the proof must be at the parser, not the caller.

import { describe, it, expect } from 'vitest'
import {
  GROWTH_EVENT_TYPES,
  parseGrowthEvent, safeParseGrowthEvent,
  deriveIdempotencyKey,
} from '@/lib/growth/events'

const base = {
  eventId:        'evt_1',
  occurredAt:     '2026-10-08T12:00:00+00:00',
  producedBy:     'system' as const,
  idempotencyKey: 'idem_1',
  // At least one tenancy anchor is required (operatorId / restaurantId / contactId).
  // The event payload may name the entity, but the envelope-level tenancy is what the
  // event bus persists and routes on, so an empty object is treated as "unknown tenant".
  tenancy:        { contactId: 'c_tenant_fixture' },
}

describe('GROWTH_EVENT_TYPES', () => {
  it('is a non-empty, unique list', () => {
    expect(GROWTH_EVENT_TYPES.length).toBeGreaterThan(20)
    expect(new Set(GROWTH_EVENT_TYPES).size).toBe(GROWTH_EVENT_TYPES.length)
  })
})

describe('envelope', () => {
  it('rejects an unknown type', () => {
    const bad = { ...base, type: 'nope.notreal', payload: {} }
    const r = safeParseGrowthEvent(bad)
    expect(r.ok).toBe(false)
  })

  it('requires an ISO datetime with offset', () => {
    const bad = { ...base, occurredAt: 'yesterday', type: 'contact.created', payload: { contactId: 'c', audienceType: 'b2b', source: 'form' } }
    const r = safeParseGrowthEvent(bad)
    expect(r.ok).toBe(false)
  })

  it('tenancy requires at least one non-empty tenant key', () => {
    // Comment on the tenancy schema says "at least one of operatorId / restaurantId /
    // contactId", but the implementation marked all three optional, so `{}` passed. An
    // event bus that routes/isolates on tenancy MUST refuse an unanchored event — it
    // would otherwise be routed to every tenant.
    const empty = safeParseGrowthEvent({
      ...base, tenancy: {},
      type: 'contact.created',
      payload: { contactId: 'c_1', audienceType: 'b2b', source: 'form' },
    })
    expect(empty.ok).toBe(false)

    // null / empty-string in every slot — also unanchored.
    const nulls = safeParseGrowthEvent({
      ...base, tenancy: { operatorId: null, restaurantId: null, contactId: null },
      type: 'contact.created',
      payload: { contactId: 'c_1', audienceType: 'b2b', source: 'form' },
    })
    expect(nulls.ok).toBe(false)

    const emptyStrings = safeParseGrowthEvent({
      ...base, tenancy: { operatorId: '', restaurantId: '', contactId: '' },
      type: 'contact.created',
      payload: { contactId: 'c_1', audienceType: 'b2b', source: 'form' },
    })
    expect(emptyStrings.ok).toBe(false)

    // Each of the three slots, by itself, is enough.
    for (const t of [{ operatorId: 'op_1' }, { restaurantId: 'r_1' }, { contactId: 'c_1' }]) {
      const r = safeParseGrowthEvent({
        ...base, tenancy: t,
        type: 'contact.created',
        payload: { contactId: 'c_1', audienceType: 'b2b', source: 'form' },
      })
      expect(r.ok, `tenancy ${JSON.stringify(t)} should pass`).toBe(true)
    }
  })
})

describe('payload validators', () => {
  it('contact.created — accepts the minimal valid shape', () => {
    const ev = parseGrowthEvent({
      ...base, type: 'contact.created',
      payload: { contactId: 'c_1', audienceType: 'b2c', source: 'eat_signup' },
    })
    expect(ev.type).toBe('contact.created')
    // Narrow by the discriminator — proves the type is a true discriminated union AND
    // gives tsc permission to see `contactId` on `payload`.
    if (ev.type !== 'contact.created') throw new Error('narrow failed')
    expect(ev.payload.contactId).toBe('c_1')
  })

  it('contact.consent_granted — requires channel + purpose + legalBasis + source', () => {
    const good = parseGrowthEvent({
      ...base, type: 'contact.consent_granted',
      payload: { contactId: 'c_1', channel: 'email', purpose: 'commercial', legalBasis: 'consent', source: 'signup_checkbox' },
    })
    if (good.type !== 'contact.consent_granted') throw new Error('narrow failed')
    expect(good.payload.legalBasis).toBe('consent')

    const bad = safeParseGrowthEvent({
      ...base, type: 'contact.consent_granted',
      payload: { contactId: 'c_1', channel: 'email', purpose: 'commercial' /* missing legalBasis/source */ },
    })
    expect(bad.ok).toBe(false)
  })

  it('outreach.sent — accepts optional provider id and nullable sequence', () => {
    const ev = parseGrowthEvent({
      ...base, type: 'outreach.sent',
      payload: { contactId: 'c_1', channel: 'email', sequenceId: null, stepId: null, deliveryId: 'd_1', providerEventId: 'brevo_42' },
    })
    if (ev.type !== 'outreach.sent') throw new Error('narrow failed')
    expect(ev.payload.providerEventId).toBe('brevo_42')
  })

  it('outreach.drafted — tracks AI provenance', () => {
    const ev = parseGrowthEvent({
      ...base, type: 'outreach.drafted',
      payload: { contactId: 'c_1', channel: 'email', by: 'ai', model: 'claude-sonnet-4-5', task: 'merchant_outreach_subject' },
    })
    if (ev.type !== 'outreach.drafted') throw new Error('narrow failed')
    expect(ev.payload.by).toBe('ai')
    expect(ev.payload.model).toBe('claude-sonnet-4-5')
  })

  it('opportunity.won — valueCents is non-negative or nullable', () => {
    const good = parseGrowthEvent({
      ...base, type: 'opportunity.won',
      payload: { opportunityId: 'o_1', valueCents: 50_000 },
    })
    if (good.type !== 'opportunity.won') throw new Error('narrow failed')
    expect(good.payload.valueCents).toBe(50_000)

    const bad = safeParseGrowthEvent({
      ...base, type: 'opportunity.won',
      payload: { opportunityId: 'o_1', valueCents: -1 },
    })
    expect(bad.ok).toBe(false)
  })

  it('consumer.repeat_order — orderNumber ≥ 2', () => {
    const bad = safeParseGrowthEvent({
      ...base, type: 'consumer.repeat_order',
      payload: { contactId: 'c_1', restaurantId: 'r_1', orderId: 'o_1', orderNumber: 1, valueCents: 1000 },
    })
    expect(bad.ok).toBe(false)
    const good = parseGrowthEvent({
      ...base, type: 'consumer.repeat_order',
      payload: { contactId: 'c_1', restaurantId: 'r_1', orderId: 'o_1', orderNumber: 2, valueCents: 1000 },
    })
    if (good.type !== 'consumer.repeat_order') throw new Error('narrow failed')
    expect(good.payload.orderNumber).toBe(2)
  })

  it('contact.suppressed — scope field is required', () => {
    const bad = safeParseGrowthEvent({
      ...base, type: 'contact.suppressed',
      payload: { contactId: 'c_1', channel: 'email', reason: 'bounce_hard' /* missing scope */ },
    })
    expect(bad.ok).toBe(false)
    const good = parseGrowthEvent({
      ...base, type: 'contact.suppressed',
      payload: { contactId: 'c_1', channel: 'email', reason: 'bounce_hard', scope: 'all' },
    })
    if (good.type !== 'contact.suppressed') throw new Error('narrow failed')
    expect(good.payload.scope).toBe('all')
  })

  it('consumer.churn_risk — score bounded [0,1]', () => {
    const bad = safeParseGrowthEvent({
      ...base, type: 'consumer.churn_risk',
      payload: { contactId: 'c_1', restaurantId: 'r_1', score: 1.5 },
    })
    expect(bad.ok).toBe(false)
  })

  it('experiment.exposed — enforces required ids', () => {
    const bad = safeParseGrowthEvent({
      ...base, type: 'experiment.exposed',
      payload: { contactId: 'c_1' },  // missing experimentId + armId
    })
    expect(bad.ok).toBe(false)
  })
})

describe('deriveIdempotencyKey', () => {
  it('honours an explicit non-empty key', () => {
    expect(deriveIdempotencyKey('consumer.first_order', { orderId: 'o_1' }, 'manual_42')).toBe('manual_42')
  })

  it('derives a stable composite key from ALL identifying fields present (in canonical order)', () => {
    expect(deriveIdempotencyKey('consumer.first_order', { orderId: 'o_1', contactId: 'c_1' })).toBe('consumer.first_order|orderId=o_1|contactId=c_1')
    expect(deriveIdempotencyKey('contact.created',       { contactId: 'c_1' })).toBe('contact.created|contactId=c_1')
    expect(deriveIdempotencyKey('outreach.sent',         { providerEventId: 'brevo_1', contactId: 'c_1', channel: 'email' })).toBe('outreach.sent|providerEventId=brevo_1|contactId=c_1|channel=email')
  })

  it('does NOT collide two legitimately-distinct consent grants (different channels)', () => {
    const emailGrant = deriveIdempotencyKey('contact.consent_granted', { contactId: 'c_1', channel: 'email', purpose: 'commercial' })
    const smsGrant   = deriveIdempotencyKey('contact.consent_granted', { contactId: 'c_1', channel: 'sms',   purpose: 'commercial' })
    expect(emailGrant).not.toBe(smsGrant)
  })

  it('does NOT collide two legitimately-distinct consent grants (different purposes)', () => {
    const comm = deriveIdempotencyKey('contact.consent_granted', { contactId: 'c_1', channel: 'email', purpose: 'commercial' })
    const life = deriveIdempotencyKey('contact.consent_granted', { contactId: 'c_1', channel: 'email', purpose: 'lifecycle' })
    expect(comm).not.toBe(life)
  })

  it('falls back to the type when nothing identifies the row', () => {
    expect(deriveIdempotencyKey('onboarding.started', {})).toBe('onboarding.started')
  })

  it('escapes separators inside values so pathological ids cannot forge a collision', () => {
    // Without escaping, `orderId='a|contactId=b'` + no contactId collides with
    // `orderId='a'` + `contactId='b'`. There are no persisted keys yet, so changing the
    // encoding is safe; the dedupe layer must not be forgeable by injecting the
    // separator character or the `key=value` delimiter into an id value.
    const injected = deriveIdempotencyKey('consumer.first_order', { orderId: 'a|contactId=b' })
    const legit    = deriveIdempotencyKey('consumer.first_order', { orderId: 'a', contactId: 'b' })
    expect(injected).not.toBe(legit)
  })
})

describe('every event type has a payload schema', () => {
  it('EVERY type in GROWTH_EVENT_TYPES is parseable with its registered payload (coverage probe)', () => {
    // Build a minimal payload matching the schema for each event, then round-trip. The point here is
    // negative: if a new event type is added without a payload schema, this fails at `safeParseGrowthEvent`.
    const samples: Record<string, Record<string, unknown>> = {
      'lead.discovered':         { contactId: 'c_1', source: 'form' },
      'lead.enriched':           { contactId: 'c_1', fields: ['domain'] },
      'lead.qualified':          { contactId: 'c_1', fitScore: 50, intentScore: 50 },
      'lead.disqualified':       { contactId: 'c_1', reason: 'country' },
      'contact.created':         { contactId: 'c_1', audienceType: 'b2b', source: 'form' },
      'contact.updated':         { contactId: 'c_1', fields: ['email'] },
      'contact.consent_granted': { contactId: 'c_1', channel: 'email', purpose: 'commercial', legalBasis: 'consent', source: 'signup_checkbox' },
      'contact.consent_revoked': { contactId: 'c_1', channel: 'email', purpose: 'commercial' },
      'contact.suppressed':      { contactId: 'c_1', channel: 'email', reason: 'bounce_hard', scope: 'all' },
      'outreach.sequence_enrolled': { contactId: 'c_1', sequenceId: 's_1' },
      'outreach.step_due':       { contactId: 'c_1', channel: 'email' },
      'outreach.drafted':        { contactId: 'c_1', channel: 'email', by: 'human' },
      'outreach.sent':           { contactId: 'c_1', channel: 'email' },
      'outreach.delivered':      { contactId: 'c_1', channel: 'email' },
      'outreach.opened':         { contactId: 'c_1', channel: 'email' },
      'outreach.clicked':        { contactId: 'c_1', channel: 'email' },
      'outreach.replied':        { contactId: 'c_1', channel: 'email' },
      'outreach.bounced':        { contactId: 'c_1', channel: 'email', bounceKind: 'hard' },
      'outreach.complained':     { contactId: 'c_1', channel: 'email' },
      'opportunity.created':     { opportunityId: 'o_1', leadId: 'l_1', stage: 'new' },
      'opportunity.updated':     { opportunityId: 'o_1', stage: 'contacted' },
      'opportunity.won':         { opportunityId: 'o_1' },
      'opportunity.lost':        { opportunityId: 'o_1', reason: 'budget' },
      'onboarding.started':      { operatorId: 'op_1', role: 'restaurant' },
      'onboarding.step_completed': { operatorId: 'op_1', role: 'restaurant', step: 'kyb' },
      'onboarding.abandoned':    { operatorId: 'op_1', role: 'restaurant' },
      'onboarding.completed':    { operatorId: 'op_1', role: 'restaurant' },
      'merchant.activated':      { operatorId: 'op_1', role: 'restaurant', firstEventAt: '2026-10-08T12:00:00+00:00' },
      'consumer.signup':         { contactId: 'c_1' },
      'consumer.first_order':    { contactId: 'c_1', restaurantId: 'r_1', orderId: 'o_1', valueCents: 1000 },
      'consumer.repeat_order':   { contactId: 'c_1', restaurantId: 'r_1', orderId: 'o_2', orderNumber: 2, valueCents: 1000 },
      'consumer.churn_risk':     { contactId: 'c_1', restaurantId: 'r_1', score: 0.5 },
      'consumer.reactivated':    { contactId: 'c_1', restaurantId: 'r_1', afterDays: 42 },
      'loyalty.earned':          { contactId: 'c_1', points: 5 },
      'loyalty.spent':           { contactId: 'c_1', points: 5 },
      'loyalty.tier_up':         { contactId: 'c_1', fromTier: 'bronze', toTier: 'silver' },
      'referral.created':        { contactId: 'c_1', code: 'ABC' },
      'referral.converted':      { contactId: 'c_1', orderId: 'o_1', valueCents: 1000 },
      'experiment.exposed':      { contactId: 'c_1', experimentId: 'x_1', armId: 'a_1' },
      'experiment.converted':    { contactId: 'c_1', experimentId: 'x_1', armId: 'a_1', kind: 'order' },
    }
    for (const t of GROWTH_EVENT_TYPES) {
      const payload = samples[t]
      expect(payload, `missing sample for event ${t}`).toBeDefined()
      const r = safeParseGrowthEvent({ ...base, type: t, payload })
      if (!r.ok) {
        // Produce a helpful failure
        throw new Error(`event '${t}' did not parse: ${JSON.stringify(r.error.flatten())}`)
      }
      expect(r.ok).toBe(true)
    }
  })
})
