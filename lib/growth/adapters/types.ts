// ── Growth / business-engine — provider adapter interfaces ────────────────────────────
//
// PURE. No I/O here, no SDK import. These are the SHAPES every provider must satisfy so
// the domain code stays provider-agnostic. Switching Brevo ↔ SendGrid, Twilio ↔ Vonage,
// Metricool ↔ Buffer should be an adapter module swap + env flag, not a schema change.
//
// Every adapter method returns a `Deliverable`:
//   - `status === 'sent'`      → provider accepted; `providerMessageId` is the stable
//                                attribution handle (will appear on inbound webhooks).
//   - `status === 'queued'`    → accepted but delivery is asynchronous.
//   - `status === 'skipped'`   → the adapter refused (bad input, dry-run, flag OFF). This
//                                is NOT a policy decision — policy must have passed BEFORE
//                                we even call the adapter.
//   - `status === 'failed'`    → transient / permanent error; caller may retry per policy.
//
// Important: adapters MUST honour an `idempotencyKey` so that re-trying the same send
// (crash recovery, replay) produces the same `providerMessageId` without duplicate
// provider-side sends.

import type { GrowthChannel } from '../types'

export type DeliverableStatus = 'sent' | 'queued' | 'skipped' | 'failed'

export interface Deliverable {
  status:            DeliverableStatus
  /** Provider's stable id (brevo message id, twilio sid, metricool post id). */
  providerMessageId: string | null
  /** Opaque reason string — used for logs and dashboards. Never raw PII. */
  reason:            string
  /** Milliseconds the caller should wait before re-trying on `failed`. 0 = immediate. */
  retryAfterMs:      number
}

// ── Common envelope ────────────────────────────────────────────────────────────────────

export interface SendEnvelope {
  idempotencyKey: string
  /** Per-tenant attribution; stored on the Grubano row irrespective of provider. */
  tenantHint:    { operatorId: string | null; restaurantId: string | null }
  /** Opaque payload for debugging — never shipped to the provider as-is. */
  diagnostics?:  Record<string, unknown>
}

// ── Email ──────────────────────────────────────────────────────────────────────────────

export interface EmailMessage extends SendEnvelope {
  to:            { email: string; name?: string | null }
  from:          { email: string; name?: string | null }
  replyTo?:      { email: string; name?: string | null }
  subject:       string
  /** HTML body. Caller is responsible for escaping. */
  html:          string
  /** Optional text fallback. If omitted the adapter may synthesise one. */
  text?:         string
  /** Standard RFC 8058 List-Unsubscribe header value. */
  listUnsubscribe?: string
  /** Headers appended as-is. Avoid provider-specific headers here. */
  headers?:      Record<string, string>
  /** Attribution tags surfaced in provider dashboards. Not PII. */
  tags?:         readonly string[]
}

export interface EmailAdapter {
  readonly channel: Extract<GrowthChannel, 'email'>
  send(message: EmailMessage): Promise<Deliverable>
}

// ── SMS ────────────────────────────────────────────────────────────────────────────────

export interface SmsMessage extends SendEnvelope {
  to:            { phoneE164: string }
  from:          { phoneE164: string; alphanumericSender?: string }
  text:          string
  /** Max segments the adapter is allowed to send. Protects against runaway long messages. */
  maxSegments?:  number
}

export interface SmsAdapter {
  readonly channel: Extract<GrowthChannel, 'sms'>
  send(message: SmsMessage): Promise<Deliverable>
}

// ── WhatsApp (template-only outside session window) ────────────────────────────────────

export interface WhatsAppMessage extends SendEnvelope {
  to:            { phoneE164: string }
  from:          { businessPhoneId: string }
  /** WhatsApp template key approved in the Business Manager. */
  templateKey:   string
  /** Named placeholders. All values MUST be strings; no raw objects. */
  variables:     Record<string, string>
  languageCode:  string
}

export interface WhatsAppAdapter {
  readonly channel: Extract<GrowthChannel, 'whatsapp'>
  send(message: WhatsAppMessage): Promise<Deliverable>
}

// ── Social publishing ──────────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'youtube_shorts'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export interface SocialPost extends SendEnvelope {
  platforms:     readonly SocialPlatform[]
  caption:       string
  /** Media URLs the adapter is allowed to fetch. Caller must have the right to use the asset. */
  mediaUrls:     readonly string[]
  /** When present, the adapter schedules; when null, it publishes immediately. */
  scheduledFor:  string | null
}

export interface SocialAdapter {
  readonly channel: Extract<GrowthChannel, 'social'>
  publish(post: SocialPost): Promise<Deliverable>
  metrics(providerMessageId: string): Promise<{ impressions: number; engagements: number } | null>
}

// ── Enrichment (lookup prospect by SIREN / domain) ─────────────────────────────────────

export interface EnrichmentLookup {
  siren?:   string
  domain?:  string
  /** Opaque hint — e.g. company name — for adapters that do fuzzy matching. */
  nameHint?: string
}

export interface EnrichmentResult {
  found:       boolean
  siren?:      string
  legalName?:  string
  tradeName?:  string
  domain?:     string
  city?:       string
  countryIso2?: string
  /** Opaque payload from the provider; must NOT contain PII of individuals without a lawful basis. */
  raw?:        Record<string, unknown>
}

export interface EnrichmentAdapter {
  lookup(input: EnrichmentLookup): Promise<EnrichmentResult>
}

// ── Orchestrator (n8n boundary) ────────────────────────────────────────────────────────
//
// Rule of thumb: Grubano owns STATE, n8n owns ORCHESTRATION. The orchestrator can fire a
// Grubano-defined workflow (which is just a sequence of policy-gated API calls into
// Grubano), but a workflow MUST be a no-op if Grubano says the policy fails. There is no
// "override" affordance.

export interface OrchestratorFireInput {
  workflowKey:   string
  /** Payload is handed back to the workflow unchanged. */
  payload:       Record<string, unknown>
  idempotencyKey: string
}

export interface OrchestratorFireResult {
  status:        'accepted' | 'already_fired' | 'failed'
  runId?:        string
  reason:        string
}

export interface OrchestratorAdapter {
  fire(input: OrchestratorFireInput): Promise<OrchestratorFireResult>
  cancel(runId: string): Promise<{ cancelled: boolean; reason: string }>
}
