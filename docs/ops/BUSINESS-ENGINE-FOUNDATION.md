# BUSINESS-ENGINE — Foundation (Phase 0/1)

> Branch: `feat/business-engine-foundation`
> Base: `48cee3b345cafae68c8286cfa582261ccbe1e6d1`
> Status: V1 foundation — types + event taxonomy + policy gates + adapter interfaces + deterministic scoring + tests + runbook.
> **No schema change, no outbound send, no provider call, no secret, no DB mutation.**

---

## 1. Why this document exists

Grubano must grow on two fronts that look superficially similar but are legally and operationally different:

- **B2B Merchant Growth** — discover restaurants/suppliers/creators, qualify them, reach decision-makers, convert them into active partners.
- **B2C Consumer Growth** — acquire eaters, activate them (first order), convert them to repeat, build loyalty, win back the dormant, close the referral loop.

Both funnels share plumbing (events, attribution, experiments, dashboards, AI drafting) and both must respect the same safety primitives (consent, suppression, frequency caps, quiet hours, tenant isolation, idempotency, auditability). Mixing the two — e.g. applying consumer soft opt-in to a cold B2B send, or counting a merchant onboarding as a consumer conversion — is how you break law AND dashboards simultaneously.

This document is the authoritative map of (a) what already exists in the Grubano codebase that this engine must REUSE, (b) the canonical architecture and vocabulary, (c) the legal/safety gates every outbound action must traverse, (d) the phased plan, and (e) exactly what this first lot delivered. It is not an aspirational product spec; it is the ground on which the next lots can be reviewed independently.

---

## 2. Audit — what exists today (REUSE), what is partial (EXTEND), what is missing (BUILD)

### 2.1 Identity, tenancy, auth

| Capability | Status | Where |
|---|---|---|
| Multi-role user (restaurant / supplier / creator / affiliate / franchise / logistics / prestataire / consumer / admin) | **EXISTS** | `prisma/schema.prisma` Operator + OperatorRole; `middleware.ts` |
| Tenant key per establishment | **EXISTS** | Restaurant.operatorId (1:N), Brand.restaurantId, Order.restaurantId |
| NextAuth JWT + CredentialsProvider + passwordless magic-link | **EXISTS** | `lib/auth.ts`, Operator.magicLinkToken* |
| RGPD consent timestamp at signup | **EXISTS** | Operator.consentAt |

### 2.2 Loyalty / referral / promotions

| Capability | Status | Where |
|---|---|---|
| Points ledger (earn / redeem / refund / reversal / offset) | **EXISTS** | LoyaltyTransaction (@@unique sourceEventId,type); `lib/loyalty.ts` |
| Tiers bronze / silver / gold / platine | **EXISTS** | `pointsBalance` thresholds |
| Signup bonus (10 pts) | **EXISTS** | `/api/loyalty/register` |
| Referral binding (customer ↔ creator XOR affiliate), 90-day window, matured earnings | **EXISTS** | Referral, ReferralConfig, ReferralOrder, Affiliate, Creator |
| Referral click counter — no PII, no IP, no UA | **EXISTS** | ReferralClick; `lib/affiliate-clicks.ts` |
| Promotions: percent / fixed / second_item / threshold_reward | **EXISTS** | `lib/promotions.ts` (D1–D5 doctrine) |
| CODE promotions with per-user unique redemption | **EXISTS** | PromoRedemption @@unique(promotionId,userId) |
| Chef demand-driver campaigns (CreatorCampaign) | **EXISTS** | Opt-in link to Promotion |
| UTM query-param capture | **MISSING** | — |
| RFM / cohorts / segments | **MISSING** | — |
| Churn / reactivation / winback | **MISSING** | — |
| A/B framework (variants, holdout, exposure logging) | **MISSING** | — |

### 2.3 Operator acquisition / onboarding

| Capability | Status | Where |
|---|---|---|
| Public registration for 6 B2B roles | **EXISTS** | `/api/{partners,supplier,logistics,prestataire,affiliate,creator}/*` |
| KYB SIREN verification | **EXISTS** | `lib/business-verification.ts` |
| Admin approval for restaurants | **EXISTS** | `/api/admin/restaurants/[id]/approve` |
| Franchise / franchisee applications | **EXISTS** | FranchiseApplication, FranchiseeApplication |
| Anti-abandon onboarding nudges (J+1 / J+3 / J+7, max 3, HMAC unsub) | **EXISTS** | `lib/onboarding-nudge.ts`, `/api/admin/onboarding-nudges/run` |
| Dedicated **prospect / lead / organization** entity before signup | **MISSING** | — |
| Enrichment adapter (SIREN → company, domain → company, Pappers / Places / LinkedIn) | **MISSING** | Only on-demand `recherche-entreprises.api.gouv.fr` during registration |
| CRM provider integration (HubSpot / Salesforce / Pipedrive) | **NOT INTEGRATED** | — |
| Bulk-import of prospects (ToS-compliant list ingestion) | **MISSING** | — |
| Outreach sequences / cadences | **MISSING** | — |
| Opportunity pipeline (prospect → qualified → opportunity → won/lost) | **MISSING** | — |

### 2.4 Communications

| Capability | Status | Where |
|---|---|---|
| Transactional email via SMTP (`nodemailer`), 30+ senders | **EXISTS** | `lib/transactional-emails.ts`, `lib/claim-emails.ts` |
| Idempotent send (`sendOnce(trigger, dedupeKey)`) backed by `EmailDispatch @@unique([trigger,dedupeKey])` | **EXISTS** | `lib/transactional-emails.ts` |
| Audit log (recipient, subject, trigger, status) | **EXISTS** | EmailLog |
| Brevo SDK | **INSTALLED, UNUSED** | `@getbrevo/brevo` in `package.json`, no imports |
| SMS / WhatsApp / push / social publishing | **NOT BUILT** | UI toggle in notifPrefs but no transport |
| Email bounce / complaint feedback loop | **MISSING** | SMTP only, no webhook from provider |
| List-Unsubscribe header (RFC 8058) | **MISSING** | Only HMAC token for onboarding nudges |
| Global suppression list (across triggers/channels) | **MISSING** | Only `Operator.onboardingNudgeUnsub` for one trigger |

### 2.5 Cron / scheduling

| Capability | Status | Where |
|---|---|---|
| GitHub Actions cron (every-20min / daily 03:20 / monthly 1st) with staging guard | **EXISTS** | `.github/workflows/cron.yml`, `scripts/cron/cron-target-guard.js` |
| `INTERNAL_CRON_TOKEN` + admin-session dual auth on cron routes | **EXISTS** | `/api/admin/*/run` routes |
| In-process `setInterval` for order-notification sweep | **EXISTS** | `instrumentation.ts` → `lib/order-notification-scheduler.ts` |
| Queue / worker (BullMQ, Inngest, QStash, pg-boss) | **NOT PRESENT** | — |
| Scheduled outbound sequences (merchant or consumer) | **MISSING** | — |

### 2.6 Analytics / attribution

| Capability | Status | Where |
|---|---|---|
| First-touch referral cookie `grubano_ref` (90d, flag-gated) | **EXISTS** (gated OFF) | `lib/attribution-cookies.ts`, `/api/ref/[code]` |
| Last-touch chef cookie `grubano_chef` (24h) | **EXISTS** | `/api/chef-visit/[slug]` |
| Referral click/order attribution | **EXISTS** | ReferralClick, ReferralOrder |
| Operator analytics API (7d / 30d revenue, peak hours, brand ranking) | **EXISTS** | `/api/analytics`, `/analytics` page |
| Generic event bus (`track()`, `logEvent()`) | **NOT PRESENT** | — |
| UTM capture (source / medium / campaign / content / term) | **NOT PRESENT** | — |
| Multi-touch attribution | **NOT PRESENT** | — |
| Third-party pixel (GA / Meta / TikTok / Pinterest / Snap) | **NOT PRESENT** | Deliberate (no CMP yet) |

### 2.7 Consent / privacy / safety

| Capability | Status | Where |
|---|---|---|
| Operator RGPD consent timestamp + locale | **EXISTS** | Operator.consentAt, Operator.locale |
| Partner onboarding-nudge unsubscribe (HMAC) | **EXISTS** | `/api/onboarding/unsubscribe` |
| Courier GPS tracking consent (opt-in + revoke) | **EXISTS** | LogisticsProfile.trackingConsent |
| Marketing consent on LoyaltyCustomer / consumer | **MISSING** | — |
| Cookie consent banner / CMP | **MISSING** | Only necessary cookies listed in `/legal/cookies` |
| Legal pages: CGV / confidentialité / cookies / mentions légales | **DRAFT** | `app/[locale]/legal/*` behind `isLegalInfoComplete()` gate |
| DSAR export / RTBF deletion endpoints | **MISSING** | — |
| Retention / purge crons | **PARTIAL** | VerificationToken purged on read; courier position TTL; no systematic EmailLog / Order retention |
| Documented cold B2B legal basis (ePrivacy LCEN Art. 34-5, soft opt-in, legitimate interest Art. 6 RGPD) | **MISSING** | — |

### 2.8 AI stack

| Capability | Status | Where |
|---|---|---|
| Single `llmComplete()` entry (Anthropic SDK, Haiku + Sonnet) | **EXISTS** | `lib/llm/index.ts` |
| Task registry (14 named tasks, max-tokens per task) | **EXISTS** | `TASKS` record |
| Per-operator daily + monthly cents quota (fail-open on transient) | **EXISTS** | `lib/llm/quota.ts`, `LlmUsage` table |
| Kill-switch `LLM_DISABLED` | **EXISTS** | — |
| Output JSON parsing + shape validation + clamping | **EXISTS** | per-module parsers |
| SSRF-safe URL fetch (anti-rebinding lookup, redirect re-validation) | **EXISTS** | `lib/safe-fetch.ts` |
| PII masking before prompt (briefing reservations) | **PARTIAL** | masked at display layer, not at log layer |
| Shared outreach-drafting prompt library | **MISSING** | — |

---

## 3. Canonical architecture

### 3.1 Two funnels, one chassis

```
                       ┌─────────────────────────────────────────┐
                       │     Shared Growth Chassis               │
                       │  (events, attribution, experiments,     │
                       │   policy gates, dashboards, AI drafts)  │
                       └──────────────┬──────────────┬───────────┘
                                      │              │
                 ┌────────────────────┘              └────────────────────┐
                 ▼                                                        ▼
       ┌─────────────────────┐                               ┌─────────────────────┐
       │ B2B Merchant Growth │                               │ B2C Consumer Growth │
       │                     │                               │                     │
       │ Discovery           │                               │ Acquisition         │
       │ → Qualification     │                               │ → Activation        │
       │ → Contact + DM      │                               │ → Conversion        │
       │ → Outreach seq.     │                               │ → Repeat            │
       │ → Opportunity       │                               │ → Loyalty           │
       │ → Onboarding        │                               │ → Reactivation      │
       │ → Activation        │                               │ → Referral          │
       └─────────────────────┘                               └─────────────────────┘
```

### 3.2 Canonical entities (names + role, schema deferred to Phase 1/2)

| Entity | Scope | Purpose |
|---|---|---|
| `GrowthContact` | both | Person-level identity: email, phone, locale, timezone, country, source, provenance. Separate from `Operator` because a prospect isn't a user yet. |
| `GrowthIdentity` | both | Links one `GrowthContact` to any of {Operator, LoyaltyCustomer, Affiliate, Creator} once signed up. Many-to-one on contact side. |
| `MerchantProspect` | B2B | Organization-level record: SIREN, legal name, domain, city, cuisine (if restaurant), size signals, enrichment payload. |
| `Lead` | B2B | A `GrowthContact` attached to a `MerchantProspect` with role (owner / manager / unknown) and intent markers. |
| `Opportunity` | B2B | Qualified lead with stage (new / contacted / replied / meeting / won / lost), owner, forecasted close. |
| `AudienceSegment` | both | Named query definition (filters, source, refresh cadence). Materialised at run-time, not stored as rows. |
| `Sequence` | both | Ordered steps with waits, channels, exit conditions, caps. |
| `SequenceStep` | both | One step: channel + template + policy requirements + experiment variant. |
| `Enrollment` | both | `GrowthContact × Sequence` membership with position, started/paused/exited state. |
| `Touchpoint` | both | One happened event about one contact via one channel at one time. Immutable. |
| `ChannelDelivery` | both | A planned or executed send (email / sms / whatsapp / push / in-app). Backed by provider id. |
| `ConversionEvent` | both | A meaningful outcome: `opt_in`, `click`, `reply`, `meeting`, `signup`, `activation`, `order`, `repeat`, `referral`. |
| `Attribution` | both | Binding `ConversionEvent → (Touchpoint ∨ Sequence ∨ Experiment ∨ Referral)`, with model (first_touch, last_touch, linear). |
| `Experiment` | both | A/B definition with hypothesis, start/end, holdout %, success metric. |
| `ExperimentArm` | both | Variant of an experiment. |
| `Exposure` | both | `GrowthContact × Experiment` → `ExperimentArm` assignment (sticky). |
| `Consent` | both | `GrowthContact × channel × purpose` with legal basis, grant/revoke timestamps, source. |
| `Suppression` | both | Hard block for a `GrowthContact × channel` (bounce, complaint, user request). Overrides consent. |
| `FrequencyCap` | both | Per-contact-per-channel per-window counters. |
| `NextAction` | both | Deterministic + AI recommendation for a given contact. |
| `AIInsight` | both | Persisted LLM draft/explanation with model, task, tokens, cost, operatorId. |
| `WebhookReceipt` | both | Idempotency ledger for all inbound webhooks (provider, event id, received at, hash). |

All of the above are **conceptual** today. Phase 1 schema will introduce only what the first operational slice needs; the rest come when their slice ships. Nothing is added speculatively.

### 3.3 n8n boundary

- n8n may orchestrate workflows (fire a sequence, wait for an event, branch).
- The **source of truth for state** (consent, suppression, enrollment position, policy decision) lives in Grubano's DB.
- n8n calls Grubano HTTP endpoints that are idempotent and policy-gated. If n8n is down, Grubano's crons can run the same workflows (degraded but correct). If Grubano says "suppressed", n8n cannot override. All provider IDs n8n sees are stored on Grubano rows so n8n is replaceable.

### 3.4 Event taxonomy (shared, namespaced)

All events are flat strings `<domain>.<action>` with a stable JSON payload. Payloads are validated with Zod schemas defined in `lib/growth/events.ts`.

```
# Lead / contact lifecycle (B2B + B2C)
lead.discovered
lead.enriched
lead.qualified
lead.disqualified
contact.created
contact.updated
contact.consent_granted
contact.consent_revoked
contact.suppressed

# Outreach
outreach.sequence_enrolled
outreach.step_due
outreach.drafted
outreach.sent
outreach.delivered
outreach.opened
outreach.clicked
outreach.replied
outreach.bounced
outreach.complained

# Opportunity (B2B)
opportunity.created
opportunity.updated
opportunity.won
opportunity.lost

# Onboarding (B2B)
onboarding.started
onboarding.step_completed
onboarding.abandoned
onboarding.completed
merchant.activated

# Consumer
consumer.signup
consumer.first_order
consumer.repeat_order
consumer.churn_risk
consumer.reactivated

# Loyalty / referral
loyalty.earned
loyalty.spent
loyalty.tier_up
referral.created
referral.converted

# Experiment
experiment.exposed
experiment.converted
```

Design rules:

1. **Immutable + idempotent** — every event carries a stable `eventId` so re-emission is a no-op. `deriveIdempotencyKey` concatenates ALL identifying fields in canonical order (not just the first match) so that two legitimately-distinct events — e.g. a `contact.consent_granted` on `email` vs. on `sms` for the same contact — never collide onto the same dedupe anchor.
2. **Attribution-ready** — every event carries `contactId`, optional `sequenceId`, `experimentId`, `touchpointId`.
3. **Tenant-safe** — every merchant event carries `operatorId`; every consumer event carries `restaurantId` or `operatorId` of the restaurant the behaviour applies to.
4. **No PII in topic name** — the string identifies the kind, not the subject.
5. **AI is a user, not an override** — an outreach drafted by AI emits `outreach.drafted` with provenance `{ by: "ai", model, task }` and MUST still pass policy gates before `outreach.sent`.
6. **Discriminated union** — `GrowthEvent` is a true discriminated union keyed on `type`; `GrowthEventOfType<'contact.created'>` narrows `payload` without casts. The TS compiler is the first line of defence against mis-typed consumers.

### 3.5 Provider adapter interfaces

```ts
EmailAdapter        send, dedupe
SmsAdapter          send
WhatsAppAdapter     send (template-only outside session window)
SocialAdapter       publish, schedule, metrics
EnrichmentAdapter   lookupByDomain, lookupBySiren
OrchestratorAdapter fireWorkflow, cancelWorkflow
```

Rules:

- Provider id (Brevo message id, Twilio sid, Metricool post id, n8n run id) is **stored on Grubano rows**. Domain logic reads/writes abstract types, never the vendor SDK.
- Every adapter has a **no-op implementation** used by tests, local dev, and feature-flagged rollouts.
- Switching vendors is a config change + an adapter module swap, not a schema rewrite.

### 3.6 Legal / safety gate (every outbound action)

Each outbound action passes a composite policy decision before any provider call:

```
canSend(contact, channel, purpose, context) =
  isSuppressed(contact, channel, purpose) → BLOCK (hard, scope-aware — see below)
  ∧ hasConsent(contact, channel, purpose) with the right legal basis   → BLOCK if missing
  ∧ withinQuietHours(contact, now)                                     → DEFER
  ∧ withinFrequencyCap(contact, channel, recentCount, cap)             → DEFER
  ∧ purposeAllowed(purpose, contact.audienceType)                      → BLOCK (e.g. no commercial to B2C without consent)
  ⇒ ALLOW | DEFER(until) | BLOCK(reason)
```

**Suppression scope** (industry standard, ePrivacy + CAN-SPAM):
- `scope: 'all'`        — hard bounce / invalid address / admin kill-switch. Blocks EVERY purpose, including transactional/security — sending to a dead address only burns reputation.
- `scope: 'commercial'` — complaint / user-requested unsubscribe. Blocks commercial/lifecycle/cold_b2b. Still allows transactional/security/operational_b2b: the user remains contractually entitled to order confirmations, invoices, security notices even after clicking "unsubscribe from marketing".

A producer that cannot classify MUST default to `'all'` (fail-closed).

Legal-basis constants, encoded in the gate:

- **B2C transactional** — contract (Art. 6-1-b RGPD). Suppression still applies. No marketing cross-sell inside transactional template.
- **B2C commercial** — consent (Art. 6-1-a + ePrivacy LCEN Art. L34-5). Soft opt-in only for own similar products to existing customers; new prospects need explicit opt-in.
- **B2B cold outreach** — legitimate interest (Art. 6-1-f). Only to professional addresses, with clear opt-out, documented interest balance test, no sensitive data, respect of any opt-out signal across the whole engine.
- **B2B transactional / contractual** — contract. Same shape as B2C transactional.

AI never bypasses this. An AI-drafted message is a `ContentDraft` that still must traverse `canSend`.

### 3.7 Scoring / next-best-action

**Merchant fit score** (0–100, deterministic):
- Role match (restaurant / supplier / etc. matches our ICP)
- City coverage
- Cuisine fit (restaurant)
- Size signals (branch count, average ticket if known)
- Verified SIREN presence
- Data completeness

**Merchant intent score** (0–100, time-decayed):
- Recency of visit to `/business`
- Engagement with outreach (reply > click > open)
- Form abandonment position

**Consumer RFM** (per restaurant tenant):
- R = days since last order
- F = order count in a window
- M = net spend in a window
- Score = weighted combination normalised to 0–100

**Lifecycle state** (consumer):
- `new` — one or zero orders
- `active` — recent order (R < reorder_median)
- `at_risk` — R between 1× and 2× reorder_median
- `dormant` — R between 2× and 4× reorder_median
- `lost` — R > 4× reorder_median

Rules first, AI second: AI can **explain**, **draft**, and **suggest** but cannot flip a score or bypass a legal gate.

### 3.8 Dashboards / KPIs

**Merchant pipeline:**
- Prospects by stage, by week
- Reply rate, meeting rate, onboarding rate, activation rate
- Time-to-first-reply, time-to-onboarding, time-to-first-paid-order
- Channel-level ROI (email vs linkedin vs direct)

**Consumer:**
- CAC per channel, blended CAC
- Activation rate (first order within 7 / 30 days of signup)
- Conversion rate per surface (/eat home, /eat/r/[id], /eat/cart)
- AOV, basket mix
- Repeat rate 7 / 30 / 60 / 90 days
- Retention cohort heatmap
- Churn rate, dormant %, winback rate
- LTV by cohort
- Referral GMV, referred-order ratio
- Offer ROI (margin after discount vs incremental orders)

**Trust / safety:**
- Suppression rate (bounces + complaints + user requests) per channel
- Policy block rate (`blocked_consent`, `blocked_cap`, `deferred_quiet_hours`)
- Experiment holdout vs treatment lift with p-value guardrail

---

## 4. What can be built without external secrets vs what needs connection

| Need | Can start now | Needs external hookup |
|---|---|---|
| Domain types, event taxonomy, policy gates (pure) | **YES** | — |
| Provider adapter interfaces + no-op mocks | **YES** | — |
| Deterministic scoring (merchant fit, consumer RFM) | **YES** | — |
| Unit tests + architecture doc | **YES** | — |
| Prisma additive models (MerchantProspect, GrowthContact, Consent, Suppression, Touchpoint, Sequence) | Phase 1, after design review | — |
| Brevo transactional adapter | Interface YES; implementation needs Brevo API key + sender verification + webhook secret |
| Twilio SMS/WhatsApp adapter | Interface YES; implementation needs Twilio account + 10DLC/WhatsApp templates approval |
| Metricool / social adapter | Interface YES; implementation needs Metricool connection + each platform OAuth |
| Enrichment adapter (Pappers / Places / LinkedIn) | Interface YES; implementation needs API keys + ToS review for each |
| n8n orchestrator | Interface YES; implementation needs n8n instance + shared secret |
| GA4 / Meta pixel | Needs CMP first (currently no cookie banner); not blocking |

---

## 5. Phased plan

**Foundation (THIS LOT, V1).** Types, event taxonomy, policy gates, adapter interfaces + no-op mocks, deterministic scoring, tests, this document. Zero schema change, zero outbound.

**Lot 1 — Prospect & Consent additive schema.** Prisma additive models (`MerchantProspect`, `GrowthContact`, `Consent`, `Suppression`, `WebhookReceipt`). Migration via the project's additive operator pattern (`scripts/server/phase1-staging-migrate.js` style) — never `--accept-data-loss`. Wire read-paths. No sends.

**Lot 2 — Merchant acquisition slice.** Single B2B channel (email, Brevo adapter), one sequence (3 steps), opportunity pipeline minimum (new → contacted → replied → won/lost), reply webhook, policy gate wired end-to-end. Soft launch to internal address book first, legitimate-interest balance test documented.

**Lot 3 — Consumer lifecycle slice.** RFM materialisation (daily cron), lifecycle state, two sequences (welcome + at-risk winback), transactional + commercial consent separation on `LoyaltyCustomer`, reorder-window scoring, dashboard tiles.

**Lot 4 — Multichannel.** Twilio SMS + WhatsApp template, Metricool social publish, push adapter spec. Channel-level frequency caps and quiet hours per tenant.

**Lot 5 — AI optimization.** Deterministic scoring + rules remain law. AI drafts outreach content and summarises funnel state; drafts carry provenance (`AIInsight`); every draft must traverse the same policy gate. Experiment framework for A/B on templates and send times. Attribution model switchable (first_touch / last_touch / linear).

---

## 6. Risks / blockers

- **Legal basis for cold B2B** — zero codified doctrine today. Lot 2 cannot ship without a written interest-balance test and an opt-out register that outlasts any single sequence.
- **No CMP** — any pixel-based acquisition tracking must wait for a cookie banner. Lot 3 can live without one (server-side RFM only).
- **Idempotency** — every provider webhook must be deduplicated by `WebhookReceipt`. Missing today for Brevo / Twilio.
- **Tenant isolation** — merchant growth is centrally owned by Grubano; consumer growth is a per-restaurant tenant. Mixing scopes in dashboards would leak competitor data. Every consumer-side query must filter by the restaurant / operator the viewer owns.
- **AI cost** — `lib/llm/quota.ts` is per-operator. The growth engine's AI drafts are often system-attributed (no operator). Needs a system-level budget before Lot 5.
- **Suppression authority** — a user who clicks the global unsubscribe must be suppressed for every channel of that purpose, across every sequence and tenant that doesn't have a lawful basis to continue (e.g. transactional). Must be enforced at the gate, not at each caller.

---

## 7. What this lot (Phase 0/1 Foundation) actually delivered

Files added (all under `lib/growth/` and `tests/`, zero schema change, zero outbound):

```
lib/growth/
├── types.ts           Canonical domain types
├── events.ts          Event taxonomy + Zod schemas + idempotent envelope
├── policy.ts          Pure policy gates (consent, suppression, quiet hours, frequency cap)
├── scoring.ts         Deterministic merchant fit/intent, consumer RFM, lifecycle, churn risk
├── adapters/
│   ├── types.ts       Provider adapter interfaces (email, sms, whatsapp, social, enrichment, orchestrator)
│   └── noop.ts        No-op implementations usable in tests and local dev
└── index.ts           Barrel

tests/
├── growth-events.test.ts
├── growth-policy.test.ts
├── growth-scoring.test.ts
└── growth-adapters-noop.test.ts

docs/ops/BUSINESS-ENGINE-FOUNDATION.md   this document
```

All code is pure TypeScript, no I/O, no `@/lib/prisma` import, no `fetch`, no `nodemailer`. Everything is exercised by unit tests.

---

## 8. Runbook

### 8.1 Local checks
```bash
npm run typecheck
npm test -- growth-
npm run lint
```

### 8.2 Adding a new event type
1. Add the string to `GROWTH_EVENT_TYPES` in `lib/growth/events.ts`.
2. Define its Zod payload schema and register it in `GROWTH_EVENT_PAYLOADS`.
3. Add a test case to `tests/growth-events.test.ts`.
4. Document the event under §3.4 of this file.

### 8.3 Adding a new provider adapter
1. Define the interface in `lib/growth/adapters/types.ts`.
2. Add a no-op implementation in `lib/growth/adapters/noop.ts`.
3. Add a unit test for the no-op that confirms it never calls the network, never throws, and returns a stable shape.
4. Only after the above three, add a real implementation in `lib/growth/adapters/<provider>.ts` guarded by its own env flag.

### 8.4 Policy gate invocation (future callers)
```ts
import { canSend } from '@/lib/growth/policy'
const decision = canSend({
  contact, channel: 'email', purpose: 'commercial',
  nowMs: Date.now(), recentSends, consents, suppressions, frequencyCaps,
})
if (decision.outcome !== 'allow') return decision  // never call the provider
```

The gate is **pure** — callers pass in the state they already have in-memory and get back `{ outcome, reason, retryAfterMs? }`. It makes no DB call so it is cheap, deterministic, and trivially unit-tested.
