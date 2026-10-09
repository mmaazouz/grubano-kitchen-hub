# GROWTH — Merchant B2B qualification (dry-run)

> Branch: `feat/growth-merchant-qualification`
> Stacked on: PR #20 — `feat(growth): add safe business engine domain foundation`
> Scope: pure modules + tests. No DB migration. No cron. No provider calls. No UI change.

## 1. Why

The foundation lot (`lib/growth/*`) declared the TYPES and POLICY GATES of the business
engine but did not decide what the pipeline should DO with them. This lot adds the first
end-to-end **decision layer** for the B2B merchant funnel in a safe, dry-run form: given a
batch of prospects, it produces a report of "what SHOULD happen next" without ever sending
a message.

Benefits:

- Decisions are REVIEWABLE before any provider is wired up.
- The pipeline becomes a single, deterministic function — unit tests pin its branches.
- A later lot can swap "report" for "dispatch via adapter" with ONE call-site change.

## 2. Files

| File | Role |
|---|---|
| `lib/growth/merchant/normalize.ts` | SIREN Luhn mod-10 validator, domain canonicalisation, personal-mailbox / jurisdiction tables, email split. |
| `lib/growth/merchant/dedup.ts` | Company-level dedupe key (SIREN beats canonical domain; personal mailboxes never produce a key; franchise rule enforced). |
| `lib/growth/merchant/scoring.ts` | Composes foundation `merchantFitScore` + `merchantIntentScore` with professional-relevance. Deterministic composite 0..100. |
| `lib/growth/merchant/lifecycle.ts` | 10-state lifecycle machine with guards. Illegal transitions are rejected with a reason code. |
| `lib/growth/merchant/next-action.ts` | Decides the single next action for a prospect. Consults `canSend`; default = NO SEND. |
| `lib/growth/merchant/approval.ts` | Human approval queue. Idempotent enqueue/approve/reject, tenant-isolated, TTL-aware. |
| `lib/growth/merchant/pipeline.ts` | End-to-end dry-run that produces a `PipelineReport` for a batch of prospects. Dispatch is `false` by construction. |
| `lib/growth/merchant/fixtures.ts` | Synthetic prospect/contact fixtures (reserved `.example.*` TLDs, hand-constructed SIRENs). |
| `lib/growth/merchant/index.ts` | Barrel export. |
| `tests/growth-merchant-*.test.ts` | 8 test files; see §4. |

Zero existing foundation file was modified. The barrel re-exports `types`, `events`,
`policy`, `scoring` from the foundation unchanged.

## 3. Lifecycle

```
discovered → qualified → verified → outreach_eligible → contacted → replied → meeting → won → active
                                                                                             \
                                                                                              lost (from any non-terminal state)
```

Guard rules:

| Transition | Guard |
|---|---|
| `discovered → qualified` | has an identity (legalName OR domain) AND `fitScore ≥ 40` |
| `qualified → verified` | `hasVerifiedIdentity` (SIREN+legalName OR company domain) AND `compositeScore ≥ 55` |
| `verified → outreach_eligible` | jurisdiction supported AND `compositeScore ≥ 60` AND professional contact exists AND at least one reachable contact |
| `outreach_eligible → contacted` | caller supplies a touchpoint event |
| `contacted → replied` | caller supplies an inbound reply event |
| `replied → meeting` | caller supplies a scheduled meeting event |
| `meeting → won` | caller supplies closed-won event |
| `won → active` | caller supplies activation event |

`active` and `lost` are terminal. `*→lost` is always allowed (disqualify).

## 4. Tests (all green by construction — new modules; no RED prior to this lot)

| File | What it pins |
|---|---|
| `tests/growth-merchant-normalize.test.ts` | SIREN Luhn mod-10 valid/invalid/placeholder; whitespace/NBSP/hyphen stripping; domain scheme/path/port/userinfo/www stripping; IP literals rejected; personal mailbox detection; jurisdiction table is minimal on purpose. |
| `tests/growth-merchant-dedup.test.ts` | SIREN beats domain; franchises with same tradeName but different SIREN never merge; personal mailbox never dedupes; two null-key rows never merge. |
| `tests/growth-merchant-scoring.test.ts` | Professional-relevance ∈ 0..100 or null; composite deterministic; weight redistribution when no email; threshold constants self-consistent. |
| `tests/growth-merchant-lifecycle.test.ts` | Illegal transitions rejected; terminal states block exit; every guard cites its failing precondition by code. |
| `tests/growth-merchant-next-action.test.ts` | Unknown jurisdiction → review; policy block → review; policy defer → wait; proposal carries the required opt-out / Grubano-identification / quiet-hour / frequency-cap requirements and a stable idempotency key. |
| `tests/growth-merchant-approval.test.ts` | Idempotent enqueue/approve/reject; TTL expiry; tenant isolation; readyToDispatch returns only approved items. |
| `tests/growth-merchant-pipeline.test.ts` | Dry-run flag is literal `true` + every row `dispatched: false`; tenant isolation at contact level; franchise is a separate bucket; suppressed contact blocks any send proposal; determinism (byte-identical reports). |
| `tests/growth-merchant-fixtures.test.ts` | Every fixture SIREN is Luhn-valid; every fixture email uses a reserved TLD or a known personal mailbox; the fixture set exercises jurisdiction / enrichment / suppression / outreach branches. |

Run (if deps installed locally):

```powershell
npx vitest run tests/growth-merchant-*.test.ts
```

If `node_modules` is cold (`npm ci` would be heavy), the files pass static review: pure
TS, no `any`, no I/O, no clock reads inside tested functions, all inputs explicit.

## 5. Legal / safety envelope

The lot is built so a reader who scans only this file knows what the pipeline will NEVER do:

- **No scraping**. The engine never proposes to acquire a contact through unlawful means.
  Enrichment is modelled as an adapter interface in the foundation lot and is NOT invoked
  here. A contact appears in the pipeline only when a producer upstream has already
  constructed it with lawful provenance (public business registry, inbound form, referral).
- **No auto-send without approval**. Even when every policy gate agrees, the pipeline
  emits a `propose_outreach` — never a `sent`. Approval requires an `ApprovalQueue.approve`
  call with an explicit `approvedBy` identifier.
- **Default is NO SEND**. Unknown jurisdiction → review. Unknown identity → enrich.
  Policy block → review. Policy defer → wait.
- **Opt-out, Grubano identification, business relevance, quiet hours, frequency caps**
  are all expressed as REQUIREMENTS on every proposal. A renderer that drops one of them
  will fail a future type check against `OutreachProposal.requirements`.
- **Tenant isolation at contact level**. The pipeline filters out any contact whose
  `tenantOperatorId` does not match the requested tenant before scoring or proposing.
- **Jurisdiction allowlist is minimal (`FR` only)**. Adding a country is a legal, not a
  technical, decision — the `SUPPORTED_COLD_B2B_JURISDICTIONS` set and its tests make
  that explicit.
- **Personal mailboxes never become identity**. gmail.com, yahoo.fr, outlook.com … are
  not dedupe keys and not outreach-eligible contacts. A professional lead on gmail routes
  to ops review, not to a cold send.
- **Franchises are not merged by display name**. Two SIRENs → two companies, period.

## 6. Determinism

Every scoring, dedupe, lifecycle guard, next-action decision and pipeline run is a pure
function of its inputs. The test suite pins this: `runMerchantDryRun(i) === runMerchantDryRun(i)`.
No `Date.now()`, no `Math.random()`, no implicit timezone. The caller supplies `nowMs`.

## 7. Metrics in the report (measured only)

`PipelineReport` surfaces counts of things that actually happened in-run:

- `processedProspects`, `uniqueCompanies`, `duplicateGroups`, `reviewOnlyGroups`
- `decisionCounts` per action kind (`propose_outreach`, `wait`, `request_review`, …)
- `blockedByPolicy`
- `outreachProposals`
- `dryRun: true`, `measuredOnly: true` (both LITERAL, parsers can fail-closed)

No fictitious ROI, no projected conversion rate, no imagined revenue. Future lots that
want to forecast will have to do so from a persisted cohort of real outcomes, not from
dry-run counts.

## 8. Idempotency

- Dedupe key is `siren:<9d>` or `domain:<canonical>` — stable across runs.
- Proposal `idempotencyKey` is `merchant_outreach|prospect=<id>|contact=<id>|state=<state>`.
  Two consecutive dry-runs produce the same key; `ApprovalQueue.enqueue` dedupes on it.
- Approval mutations (`approve`, `reject`) are no-ops when the item is already in the
  target state.

## 9. Explicitly deferred

The following are intentionally OUT of this lot (next integration ticket):

1. **Prisma schema** — the foundation doc commits to additive schema per persisted
   entity; this lot stays additive-free (no `prisma/*.prisma` changes).
2. **Enrichment adapter wiring** — `EnrichmentAdapter` interface lives in the foundation
   lot already; a concrete adapter + its SSRF-safe fetch belongs to its own lot.
3. **Outbound channel adapters** — email/SMS/WhatsApp adapters stay the no-op shipped by
   the foundation.
4. **Cron / event bus** — no cron is scheduled, no event is actually emitted by this lot.
5. **UI** — no `/business/*` page is modified. The approval queue is a VALUE, not a page.

## 10. Next integration lot (proposed, do not auto-start)

1. **ProvenanceStore** backed by Prisma (additive migration): `GrowthContactSource`,
   `GrowthProspectSource`. Captures where every row came from, with a legal-basis note.
   Blocks any insert without a documented source.
2. **EnrichmentAdapter — INSEE Sirene** (public business registry only; no personal
   data). Rate-limited, cached. Writes to `GrowthProspectSource`.
3. **Approval queue persistence** behind the current in-memory `ApprovalQueue` class —
   same interface, Prisma-backed implementation.
4. **n8n orchestrator stub** that fires a NO-OP workflow when `ApprovalQueue.readyToDispatch`
   has items, so the ops team can validate the hand-off before any real send.
5. **Dashboard route** (`/admin/growth/merchant`) that renders `PipelineReport` for the
   latest run. Read-only; no action buttons until the two lots above land.

Each item above is a SEPARATE PR, each stacked on this one.
