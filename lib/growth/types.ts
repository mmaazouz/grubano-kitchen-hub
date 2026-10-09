// ── Growth / business-engine — canonical domain types ─────────────────────────────────
//
// PURE. No I/O, no Prisma import, no `fetch`. These types describe the entities and value
// objects that the two funnels (B2B merchant growth + B2C consumer growth) share. The
// corresponding schema does NOT yet exist in prisma — this lot stays additive-free. Each
// future lot that persists one of these entities will add the matching additive Prisma
// model with the same field names and tenant key (operatorId / restaurantId).
//
// Design invariants (see docs/ops/BUSINESS-ENGINE-FOUNDATION.md §3):
//   1. a GrowthContact is person-level and NOT the same as an Operator — a prospect is a
//      contact long before (if ever) they create an account; the moment they do, a
//      GrowthIdentity binds the contact to the operator record.
//   2. consent/suppression/quiet-hours/frequency-caps are per (contact × channel × purpose),
//      never per sequence — a user who opts out of marketing opts out globally, not just
//      for the sequence that happened to carry the unsubscribe link.
//   3. every outbound action carries attribution (sequence × step × experiment × arm) so
//      that lift measurement never has to guess.
//   4. tenant isolation is explicit: merchant records belong to Grubano (centrally owned);
//      consumer records belong to a specific restaurant tenant (restaurantId required).

export type ISODateString = string
export type UUID = string

// ── Channels, purposes, legal bases ────────────────────────────────────────────────────

export const GROWTH_CHANNELS = ['email', 'sms', 'whatsapp', 'push', 'in_app', 'social'] as const
export type GrowthChannel = (typeof GROWTH_CHANNELS)[number]

/**
 * Communication *purpose*. The legal basis depends on this + the contact's audience type.
 *   - transactional   : service of the contract (order updates, auth, security, invoices)
 *   - commercial      : marketing, upsell, cross-sell, promo
 *   - lifecycle       : product-education that is NOT a direct sell (welcome, how-to)
 *   - security        : credential events, fraud notices (always allowed if contact exists)
 *   - operational_b2b : B2B workflow (quote, dispatch, status) — contract-based
 *   - cold_b2b        : B2B outreach to a professional address under legitimate interest
 */
export const GROWTH_PURPOSES = [
  'transactional',
  'commercial',
  'lifecycle',
  'security',
  'operational_b2b',
  'cold_b2b',
] as const
export type GrowthPurpose = (typeof GROWTH_PURPOSES)[number]

/** The legal basis the engine will claim for a given send. */
export const LEGAL_BASES = [
  'contract',                 // Art. 6-1-b RGPD — necessary for a contract
  'consent',                  // Art. 6-1-a RGPD + ePrivacy LCEN L34-5
  'legitimate_interest',      // Art. 6-1-f RGPD — needs a documented balance test (B2B cold)
  'legal_obligation',         // Art. 6-1-c RGPD — invoicing, DAC7
  'soft_opt_in',              // ePrivacy derogation: own similar products to existing customer
] as const
export type LegalBasis = (typeof LEGAL_BASES)[number]

/** B2B vs B2C — gates behave differently (cold outreach legal, consumer soft opt-in rules). */
export type AudienceType = 'b2b' | 'b2c'

// ── Contact / identity ─────────────────────────────────────────────────────────────────

export interface GrowthContact {
  id:              UUID
  audienceType:    AudienceType
  /** Operator or Restaurant this contact belongs to for isolation purposes. Null = central (Grubano owns, e.g. merchant prospect). */
  tenantOperatorId: UUID | null
  /** For consumer rows this is the restaurant tenant that captured the contact. Null for central prospects. */
  tenantRestaurantId: UUID | null
  email:           string | null
  phoneE164:       string | null
  firstName:       string | null
  lastName:        string | null
  locale:          'fr' | 'en' | 'es' | 'it' | 'ar' | null
  /** IANA timezone (e.g. 'Europe/Paris'). Used for quiet-hours gating. */
  timezone:        string | null
  countryIso2:     string | null
  /** Where this contact first appeared ('import', 'form', 'referral', 'enrichment', …). Immutable. */
  source:          string
  /** Free-text provenance detail. May include the list id, the import batch, the referring URL. */
  provenance:      string | null
  createdAt:       ISODateString
  updatedAt:       ISODateString
}

/** Links a GrowthContact to a Grubano account once they sign up. One contact → many identities (operator + loyaltyCustomer + …). */
export interface GrowthIdentity {
  contactId:       UUID
  operatorId:      UUID | null
  loyaltyCustomerId: UUID | null
  affiliateOperatorId: UUID | null
  creatorId:       UUID | null
  linkedAt:        ISODateString
}

// ── B2B — organisation, lead, opportunity ──────────────────────────────────────────────

export const MERCHANT_ROLES = ['restaurant', 'supplier', 'creator', 'affiliate', 'logistics', 'prestataire', 'franchise'] as const
export type MerchantRole = (typeof MERCHANT_ROLES)[number]

export interface MerchantProspect {
  id:              UUID
  role:            MerchantRole
  siren:           string | null       // 9 digits, FR
  legalName:       string | null
  tradeName:       string | null
  domain:          string | null       // bare domain, no scheme
  city:            string | null
  countryIso2:     string | null
  /** Cuisine tags for restaurant prospects (reuses the Restaurant.cuisine vocabulary). */
  cuisineTags:     string[]
  /** Size signals (branch count, declared turnover bucket, declared followers for affiliates). */
  sizeSignals:     Record<string, number | string | null>
  /** Raw enrichment payload (opaque to the engine). */
  enrichment:      Record<string, unknown>
  source:          string
  provenance:      string | null
  createdAt:       ISODateString
  updatedAt:       ISODateString
}

export const LEAD_ROLES = ['owner', 'manager', 'operations', 'marketing', 'unknown'] as const
export type LeadRoleInProspect = (typeof LEAD_ROLES)[number]

export interface Lead {
  id:              UUID
  prospectId:      UUID
  contactId:       UUID
  roleInProspect:  LeadRoleInProspect
  /** Deterministic 0..100 fit score snapshot at last recompute. */
  fitScore:        number
  /** Deterministic 0..100 intent score snapshot (time-decayed). */
  intentScore:     number
  qualifiedAt:     ISODateString | null
  disqualifiedAt:  ISODateString | null
  disqualifiedReason: string | null
}

export const OPPORTUNITY_STAGES = ['new', 'contacted', 'replied', 'meeting', 'won', 'lost'] as const
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]

export interface Opportunity {
  id:              UUID
  leadId:          UUID
  stage:           OpportunityStage
  ownerOperatorId: UUID | null     // internal rep (admin user), nullable while unassigned
  openedAt:        ISODateString
  closedAt:        ISODateString | null
  closedReason:    string | null
  forecastValueCents: number | null
}

// ── Sequences / enrollment / touchpoints ───────────────────────────────────────────────

export interface Sequence {
  id:              UUID
  key:             string               // human-readable stable key, e.g. 'b2b.restaurants.cold_v1'
  name:            string
  audienceType:    AudienceType
  purpose:         GrowthPurpose
  active:          boolean
  /** Max contacts enrolled concurrently; null = unlimited. */
  concurrencyCap:  number | null
  /** Minutes between consecutive sends to the same contact, across sequences. */
  minSendGapMinutes: number
  createdAt:       ISODateString
  updatedAt:       ISODateString
}

export interface SequenceStep {
  id:              UUID
  sequenceId:      UUID
  position:        number               // 1-based
  channel:         GrowthChannel
  /** Template id resolved at render-time by the channel adapter. */
  templateKey:     string
  /** Minutes of wait AFTER the previous step before this one is due. */
  waitMinutes:     number
  /** When present, the step is an A/B — exposure routed via Exposure table. */
  experimentKey:   string | null
  /** Hard-stop conditions beyond the global exit (e.g. 'replied', 'converted'). */
  exitOn:          string[]
}

export const ENROLLMENT_STATES = ['active', 'paused', 'completed', 'exited'] as const
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number]

export interface Enrollment {
  id:              UUID
  sequenceId:      UUID
  contactId:       UUID
  state:           EnrollmentState
  position:        number               // last fired step position; 0 before first step
  startedAt:       ISODateString
  pausedUntil:     ISODateString | null
  completedAt:     ISODateString | null
  exitedReason:    string | null
}

/** An immutable fact: "this contact had this interaction on this channel at this time". */
export interface Touchpoint {
  id:              UUID
  contactId:       UUID
  channel:         GrowthChannel
  /** 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'complained' | 'unsubscribed' */
  kind:            string
  sequenceId:      UUID | null
  stepId:          UUID | null
  deliveryId:      UUID | null
  /** Provider's immutable event id — the dedupe key for inbound webhooks. */
  providerEventId: string | null
  occurredAt:      ISODateString
  /** Opaque metadata (user-agent hash, link id, bounce code). No raw PII. */
  meta:            Record<string, unknown>
}

export const DELIVERY_STATES = ['planned', 'queued', 'sent', 'failed', 'skipped', 'deferred'] as const
export type DeliveryState = (typeof DELIVERY_STATES)[number]

export interface ChannelDelivery {
  id:              UUID
  contactId:       UUID
  channel:         GrowthChannel
  purpose:         GrowthPurpose
  sequenceId:      UUID | null
  stepId:          UUID | null
  templateKey:     string
  state:           DeliveryState
  /** Provider's send-id after a successful hand-off (brevo message id, twilio sid, …). */
  providerMessageId: string | null
  /** Idempotency key presented to the provider AND persisted here. */
  dedupeKey:       string
  scheduledFor:    ISODateString | null
  sentAt:          ISODateString | null
  failedReason:    string | null
}

// ── Conversions / attribution / experiments ────────────────────────────────────────────

export const CONVERSION_KINDS = [
  'opt_in', 'click', 'reply', 'meeting', 'signup', 'activation',
  'order', 'repeat', 'referral', 'onboarding_completed',
] as const
export type ConversionKind = (typeof CONVERSION_KINDS)[number]

export interface ConversionEvent {
  id:              UUID
  contactId:       UUID
  kind:            ConversionKind
  valueCents:      number | null       // monetary value for 'order' / 'repeat' / 'referral'
  occurredAt:      ISODateString
}

export const ATTRIBUTION_MODELS = ['first_touch', 'last_touch', 'linear'] as const
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number]

export interface Attribution {
  conversionEventId: UUID
  model:           AttributionModel
  touchpointId:    UUID | null
  sequenceId:      UUID | null
  experimentId:    UUID | null
  armId:           UUID | null
  /** Share of credit, 0..1. For single-touch models == 1 on the chosen touchpoint. */
  weight:          number
}

export interface Experiment {
  id:              UUID
  key:             string
  hypothesis:      string
  startedAt:       ISODateString
  endedAt:         ISODateString | null
  holdoutPct:      number              // 0..1
  successMetric:   ConversionKind
}

export interface ExperimentArm {
  id:              UUID
  experimentId:    UUID
  key:             string              // e.g. 'control', 'subject_v2'
  weight:          number              // 0..1, arms sum to 1
}

export interface Exposure {
  experimentId:    UUID
  contactId:       UUID
  armId:           UUID
  exposedAt:       ISODateString
}

// ── Consent / suppression / frequency ──────────────────────────────────────────────────

export interface Consent {
  contactId:       UUID
  channel:         GrowthChannel
  purpose:         GrowthPurpose
  legalBasis:      LegalBasis
  grantedAt:       ISODateString | null
  revokedAt:       ISODateString | null
  /** Where the consent came from ('signup_checkbox', 'preference_center', 'soft_opt_in_prior_order', 'b2b_interest_balance_test#2026-10-08', …). */
  source:          string
}

export const SUPPRESSION_SCOPES = ['all', 'commercial'] as const
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number]

/**
 * Block for a (contactId × channel). Overrides consent.
 *
 * Doctrine (ePrivacy + CAN-SPAM + RFC 8058):
 *   - `scope: 'all'`        → the ADDRESS itself is bad (hard bounce, invalid, admin kill-switch).
 *                             Blocks EVERY purpose, including transactional/security — because
 *                             sending transactional to a dead address only burns reputation.
 *   - `scope: 'commercial'` → the USER refused us (complaint / user-request-unsubscribe).
 *                             Blocks commercial / lifecycle / cold_b2b. Still allows
 *                             transactional / security / operational_b2b: those rest on
 *                             contract or legal obligation and the user is still entitled to
 *                             order confirmations, invoices, security notices.
 *
 * Default must be the SAFER value (`'all'`) when a producer can't classify.
 */
export interface Suppression {
  contactId:       UUID
  channel:         GrowthChannel
  reason:          string              // 'bounce_hard' | 'complaint' | 'user_request' | 'admin' | 'invalid'
  scope:           SuppressionScope
  since:           ISODateString
}

export interface FrequencyCapCounter {
  contactId:       UUID
  channel:         GrowthChannel
  /** Rolling counts per window. Keys are ISO durations: 'PT1H', 'P1D', 'P7D', 'P30D'. */
  counts:          Record<string, number>
  /** Rolling window start-of-count timestamp, keyed as above. */
  startedAt:       Record<string, ISODateString>
}

// ── Next action / AI insight ───────────────────────────────────────────────────────────

export const NEXT_ACTION_KINDS = [
  'enroll_sequence',
  'advance_step',
  'send_one_off',
  'request_meeting',
  'reactivation_offer',
  'referral_prompt',
  'wait',
  'exit_sequence',
  'disqualify',
] as const
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number]

export interface NextAction {
  contactId:       UUID
  kind:            NextActionKind
  dueAt:           ISODateString | null
  /** Deterministic rationale ('rfm.at_risk + days_since_last=35', 'intent_score=72 and no_reply_after_step=2'). */
  rationale:       string
  /** Optional structured payload for the executor ({ sequenceId, stepId, templateKey, …}). */
  payload:         Record<string, unknown>
  /** Confidence 0..1 — rules → 1.0, AI → model confidence. */
  confidence:      number
}

/** Persisted LLM output with full provenance. Written only after output validation passes. */
export interface AIInsight {
  id:              UUID
  task:            string               // e.g. 'merchant_outreach_subject_line'
  model:           string               // 'claude-sonnet-4-5'
  operatorId:      UUID | null          // null for system-level attributions
  contactId:       UUID | null
  prospectId:      UUID | null
  /** The validated output. Shape depends on `task`. */
  output:          Record<string, unknown>
  inputTokens:     number
  outputTokens:    number
  costCents:       number
  createdAt:       ISODateString
}

export interface WebhookReceipt {
  provider:        string               // 'brevo', 'twilio', 'metricool', 'n8n'
  eventId:         string               // provider-sent id
  payloadHash:     string               // sha256 of normalised payload
  receivedAt:      ISODateString
}

// ── Policy types ───────────────────────────────────────────────────────────────────────

export type PolicyOutcome = 'allow' | 'defer' | 'block'

export interface PolicyDecision {
  outcome:         PolicyOutcome
  reason:          string
  /** For `defer` outcomes, when the gate expects to allow — never guessed, always provided by the caller's state. */
  retryAfterMs?:   number
}
