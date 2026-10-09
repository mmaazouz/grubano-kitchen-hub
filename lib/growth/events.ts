// ── Growth / business-engine — event taxonomy + Zod envelope ──────────────────────────
//
// PURE. No I/O, no persistence. The event bus is not materialised in this lot — these
// schemas are the contract that every future producer and consumer (crons, API routes,
// workers, n8n webhooks) will share. Validation happens where events ENTER the system
// (webhook handlers, API routes) and where they LEAVE (dashboards, attribution). Internal
// callers may bypass validation if they constructed the event themselves AND tsc confirms
// the type.
//
// Design rules (see docs/ops/BUSINESS-ENGINE-FOUNDATION.md §3.4):
//   - every event has a stable `eventId` (idempotent re-emission is a no-op)
//   - every event is tenant-safe (operatorId or restaurantId required where applicable)
//   - AI drafts emit `outreach.drafted` with provenance; they MUST still pass policy
//     gates before `outreach.sent` is emitted.

import { z } from 'zod'
import { SUPPRESSION_SCOPES } from './types'
import type { GrowthChannel, GrowthPurpose, ConversionKind, OpportunityStage } from './types'

export const GROWTH_EVENT_TYPES = [
  // Lead / contact lifecycle
  'lead.discovered',
  'lead.enriched',
  'lead.qualified',
  'lead.disqualified',
  'contact.created',
  'contact.updated',
  'contact.consent_granted',
  'contact.consent_revoked',
  'contact.suppressed',
  // Outreach
  'outreach.sequence_enrolled',
  'outreach.step_due',
  'outreach.drafted',
  'outreach.sent',
  'outreach.delivered',
  'outreach.opened',
  'outreach.clicked',
  'outreach.replied',
  'outreach.bounced',
  'outreach.complained',
  // Opportunity
  'opportunity.created',
  'opportunity.updated',
  'opportunity.won',
  'opportunity.lost',
  // Onboarding
  'onboarding.started',
  'onboarding.step_completed',
  'onboarding.abandoned',
  'onboarding.completed',
  'merchant.activated',
  // Consumer
  'consumer.signup',
  'consumer.first_order',
  'consumer.repeat_order',
  'consumer.churn_risk',
  'consumer.reactivated',
  // Loyalty / referral
  'loyalty.earned',
  'loyalty.spent',
  'loyalty.tier_up',
  'referral.created',
  'referral.converted',
  // Experiment
  'experiment.exposed',
  'experiment.converted',
] as const

export type GrowthEventType = (typeof GROWTH_EVENT_TYPES)[number]

// ── Shared envelope ────────────────────────────────────────────────────────────────────

const iso = () => z.string().datetime({ offset: true })
const uuid = () => z.string().min(1)   // IDs are opaque; we don't require RFC4122 shape

/**
 * Minimum tenant hint: at least one of operatorId / restaurantId / contactId must be a
 * non-empty string. An unanchored event (all three null/missing/empty) would be routed to
 * every tenant by the event bus, so the parser refuses it at the gate.
 */
const tenancy = z.object({
  operatorId:    uuid().nullable().optional(),
  restaurantId:  uuid().nullable().optional(),
  contactId:     uuid().nullable().optional(),
}).refine(
  (t) =>
    (typeof t.operatorId   === 'string' && t.operatorId.length   > 0) ||
    (typeof t.restaurantId === 'string' && t.restaurantId.length > 0) ||
    (typeof t.contactId    === 'string' && t.contactId.length    > 0),
  { message: 'tenancy_requires_at_least_one_nonempty_id' },
)

const envelope = z.object({
  eventId:       uuid(),
  type:          z.enum(GROWTH_EVENT_TYPES),
  occurredAt:    iso(),
  producedBy:    z.enum(['system', 'operator', 'ai', 'webhook', 'cron']),
  idempotencyKey: uuid(),       // dedupe anchor; may equal eventId
  tenancy,
})

// ── Payload schemas ────────────────────────────────────────────────────────────────────
//
// Each key MUST appear in GROWTH_EVENT_PAYLOADS below. Payloads are intentionally minimal:
// enough to attribute and dedupe, not a full-fidelity dump of the entity.

const channel: z.ZodType<GrowthChannel> = z.enum(['email', 'sms', 'whatsapp', 'push', 'in_app', 'social'])
const purpose: z.ZodType<GrowthPurpose> = z.enum(['transactional', 'commercial', 'lifecycle', 'security', 'operational_b2b', 'cold_b2b'])
const conversionKind: z.ZodType<ConversionKind> = z.enum([
  'opt_in', 'click', 'reply', 'meeting', 'signup', 'activation',
  'order', 'repeat', 'referral', 'onboarding_completed',
])
const opportunityStage: z.ZodType<OpportunityStage> = z.enum(['new', 'contacted', 'replied', 'meeting', 'won', 'lost'])

const leadRef = z.object({ contactId: uuid(), prospectId: uuid().nullable().optional() })

const outreachRef = z.object({
  contactId:     uuid(),
  channel,
  sequenceId:    uuid().nullable().optional(),
  stepId:        uuid().nullable().optional(),
  deliveryId:    uuid().nullable().optional(),
  providerEventId: z.string().nullable().optional(),
})

export const GROWTH_EVENT_PAYLOADS = {
  'lead.discovered':         leadRef.extend({ source: z.string(), provenance: z.string().nullable().optional() }),
  'lead.enriched':           leadRef.extend({ fields: z.array(z.string()) }),
  'lead.qualified':          leadRef.extend({ fitScore: z.number().min(0).max(100), intentScore: z.number().min(0).max(100) }),
  'lead.disqualified':       leadRef.extend({ reason: z.string() }),

  'contact.created':         z.object({ contactId: uuid(), audienceType: z.enum(['b2b', 'b2c']), source: z.string() }),
  'contact.updated':         z.object({ contactId: uuid(), fields: z.array(z.string()) }),
  'contact.consent_granted': z.object({ contactId: uuid(), channel, purpose, legalBasis: z.string(), source: z.string() }),
  'contact.consent_revoked': z.object({ contactId: uuid(), channel, purpose, reason: z.string().nullable().optional() }),
  'contact.suppressed':      z.object({ contactId: uuid(), channel, reason: z.string(), scope: z.enum(SUPPRESSION_SCOPES) }),

  'outreach.sequence_enrolled': z.object({ contactId: uuid(), sequenceId: uuid() }),
  'outreach.step_due':       outreachRef,
  'outreach.drafted':        outreachRef.extend({ by: z.enum(['human', 'ai']), model: z.string().nullable().optional(), task: z.string().nullable().optional() }),
  'outreach.sent':           outreachRef,
  'outreach.delivered':      outreachRef,
  'outreach.opened':         outreachRef,
  'outreach.clicked':        outreachRef.extend({ linkKey: z.string().nullable().optional() }),
  'outreach.replied':        outreachRef,
  'outreach.bounced':        outreachRef.extend({ bounceKind: z.enum(['hard', 'soft', 'unknown']) }),
  'outreach.complained':     outreachRef,

  'opportunity.created':     z.object({ opportunityId: uuid(), leadId: uuid(), stage: opportunityStage }),
  'opportunity.updated':     z.object({ opportunityId: uuid(), stage: opportunityStage, previousStage: opportunityStage.optional() }),
  'opportunity.won':         z.object({ opportunityId: uuid(), valueCents: z.number().int().min(0).nullable().optional() }),
  'opportunity.lost':        z.object({ opportunityId: uuid(), reason: z.string() }),

  'onboarding.started':      z.object({ operatorId: uuid(), role: z.string() }),
  'onboarding.step_completed': z.object({ operatorId: uuid(), role: z.string(), step: z.string() }),
  'onboarding.abandoned':    z.object({ operatorId: uuid(), role: z.string(), lastStep: z.string().nullable().optional() }),
  'onboarding.completed':    z.object({ operatorId: uuid(), role: z.string() }),
  'merchant.activated':      z.object({ operatorId: uuid(), role: z.string(), firstEventAt: iso() }),

  'consumer.signup':         z.object({ contactId: uuid(), restaurantId: uuid().nullable().optional() }),
  'consumer.first_order':    z.object({ contactId: uuid(), restaurantId: uuid(), orderId: uuid(), valueCents: z.number().int().min(0) }),
  'consumer.repeat_order':   z.object({ contactId: uuid(), restaurantId: uuid(), orderId: uuid(), orderNumber: z.number().int().min(2), valueCents: z.number().int().min(0) }),
  'consumer.churn_risk':     z.object({ contactId: uuid(), restaurantId: uuid(), score: z.number().min(0).max(1) }),
  'consumer.reactivated':    z.object({ contactId: uuid(), restaurantId: uuid(), afterDays: z.number().int().min(0) }),

  'loyalty.earned':          z.object({ contactId: uuid(), points: z.number().int().min(1), orderId: uuid().nullable().optional() }),
  'loyalty.spent':           z.object({ contactId: uuid(), points: z.number().int().min(1), orderId: uuid().nullable().optional() }),
  'loyalty.tier_up':         z.object({ contactId: uuid(), fromTier: z.string(), toTier: z.string() }),

  'referral.created':        z.object({ contactId: uuid(), referrerContactId: uuid().nullable().optional(), code: z.string() }),
  'referral.converted':      z.object({ contactId: uuid(), referrerContactId: uuid().nullable().optional(), orderId: uuid(), valueCents: z.number().int().min(0) }),

  'experiment.exposed':      z.object({ contactId: uuid(), experimentId: uuid(), armId: uuid() }),
  'experiment.converted':    z.object({ contactId: uuid(), experimentId: uuid(), armId: uuid(), kind: conversionKind }),
} as const satisfies Record<GrowthEventType, z.ZodTypeAny>

// ── Discriminated event + validator ────────────────────────────────────────────────────

export type GrowthEventPayloads = {
  [K in GrowthEventType]: z.infer<(typeof GROWTH_EVENT_PAYLOADS)[K]>
}

/**
 * True discriminated union keyed on `type`. Distribute `K` over the pair so TS can narrow
 * `payload` from `type`: `if (ev.type === 'contact.created') ev.payload.contactId // ok`.
 *
 * The earlier `GrowthEvent<T = GrowthEventType>` default-generic form collapsed to a
 * non-discriminated intersection that forced callers to `as any` the payload.
 */
export type GrowthEvent = {
  [K in GrowthEventType]: z.infer<typeof envelope> & { type: K; payload: GrowthEventPayloads[K] }
}[GrowthEventType]

/** Narrow helper: `type ContactCreated = GrowthEventOfType<'contact.created'>`. */
export type GrowthEventOfType<T extends GrowthEventType> = Extract<GrowthEvent, { type: T }>

export const growthEventEnvelope = envelope

/** Validate an unknown-shaped event. Returns the typed event or throws a ZodError. */
export function parseGrowthEvent(input: unknown): GrowthEvent {
  const env = envelope.parse(input)
  const payloadSchema = GROWTH_EVENT_PAYLOADS[env.type]
  const parsedPayload = payloadSchema.parse((input as { payload?: unknown }).payload)
  return { ...env, payload: parsedPayload } as GrowthEvent
}

/** Non-throwing variant. */
export function safeParseGrowthEvent(input: unknown): { ok: true; event: GrowthEvent } | { ok: false; error: z.ZodError } {
  try {
    return { ok: true, event: parseGrowthEvent(input) }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e }
    throw e
  }
}

/**
 * Field names, in canonical order, that identify a growth event for dedupe purposes.
 * Order is stable so two producers that construct the same event converge on the same key.
 *
 * We include MULTIPLE fields rather than the single first-match, because events like
 * `contact.consent_granted` are keyed on `(contactId × channel × purpose)` — using only
 * `contactId` would collide two legitimately-distinct consent grants (e.g. email + sms)
 * onto the same idempotency key and swallow the second.
 */
const IDEMPOTENCY_KEY_FIELDS = [
  // Provider-origin identifiers (most authoritative — unique per real-world event)
  'providerEventId',
  // Entity identifiers
  'orderId', 'opportunityId', 'deliveryId', 'experimentId', 'armId',
  'sequenceId', 'stepId',
  // Subject identifiers
  'contactId', 'operatorId', 'restaurantId',
  // Composite-key disambiguators (channel+purpose for consent, kind for conversions, etc.)
  'channel', 'purpose', 'kind',
  // Domain-specific stable identifiers
  'code',   // referral code
  'step',   // onboarding step key
  'scope',  // suppression scope
] as const

/**
 * Stable idempotency key for an event. If the caller passed an explicit idempotencyKey,
 * we trust it; otherwise we derive one from (type + ALL present identifying fields in
 * canonical order) so that two producers emitting the "same" event converge on the same
 * key AND two legitimately-distinct events do not collide.
 *
 * The caller is responsible for persisting dedupe. This helper only computes the key.
 */
export function deriveIdempotencyKey(type: GrowthEventType, payload: Record<string, unknown>, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit.trim()
  // Escape the separator (`|`) and the key/value delimiter (`=`) inside VALUES so that a
  // malicious or pathological id (e.g. `orderId: 'a|contactId=b'`) cannot forge a collision
  // with a legitimate `{ orderId: 'a', contactId: 'b' }`. Backslash is also escaped so
  // the encoding is unambiguous. Field names come from a fixed whitelist and are not escaped.
  const esc = (s: string) => s.replace(/[\\|=]/g, (c) => '\\' + c)
  const parts: string[] = [type]
  for (const k of IDEMPOTENCY_KEY_FIELDS) {
    const v = payload[k]
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}=${esc(v)}`)
    else if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${k}=${v}`)
  }
  return parts.join('|')
}
