# GROWTH-CONSUMER-B2C — RFM + lifecycle decision layer (dry-run only)

Branch `feat/growth-consumer-rfm`, stacked on business-engine foundation `f3f2b93a`.
Files are ADDITIVE under `lib/growth/consumer/`. No Prisma, no migrations, no provider
calls. Zero changes to existing `lib/growth/*` and zero changes to foundation tests.

## 1. What this lot delivers

Pure, deterministic, tenant-isolated functions on top of the foundation:

| File | Role |
|---|---|
| `lib/growth/consumer/money.ts` | Reduce ONE order (+ succeeded refunds) → net integer cents + countable/uncountable reason. `normaliseOrderBatch` scopes to one (tenant × contact) and stamps everything outside that scope. |
| `lib/growth/consumer/rfm.ts` | `buildRFMSnapshot(scope, rows, nowMs, opts)` → recency / frequency / monetary / lifetime / cohort / reasons / rejected-rows. Composes `../scoring.consumerRFM` + `../scoring.reorderWindowDays`. |
| `lib/growth/consumer/decisions.ts` | `decideNBA(snapshot, opts)` → `NBADraft` with `kind × channel × purpose × templateKey × confidence × idempotencyKey × holdout`. Deterministic FNV-1a holdout partition over 1000 buckets, monotone in `pct`, seeded. |
| `lib/growth/consumer/soft-opt-in.ts` | `evaluateSoftOptIn(input)` → eligibility under ePrivacy Art. 13(2) / Art. L34-5 CPCE: prior similar purchase AT THIS TENANT, documented source allowlist, revocation-aware, GDPR-erasure fail-closed. |
| `lib/growth/consumer/dry-run.ts` | `planDryRun(input)` → `REVIEW` / `ELIGIBLE` / `NO_SEND` + reason + idempotency key + full snapshot/NBA/policy/softOptIn audit. |
| `lib/growth/consumer/index.ts` | Barrel. |

Tests (all RED first, all pure, no Prisma mocks, no network):
- `tests/growth-consumer-money.test.ts`
- `tests/growth-consumer-rfm.test.ts`
- `tests/growth-consumer-decisions.test.ts`
- `tests/growth-consumer-soft-opt-in.test.ts`
- `tests/growth-consumer-dry-run.test.ts`

## 2. Core invariants (and the tests that pin them)

| Invariant | Pinned by |
|---|---|
| `cancelled` orders never count toward RFM, even if paid | money/`cancelled wins over fully_refunded` |
| `paymentStatus !== 'paid'` never counts (abandoned-flow guard) | money/`status reached delivered but paymentStatus never paid` |
| Partial refunds subtract once; full/over refund → excluded | money/`partial refund subtracts`, `fully refunded`, `over-refund` |
| All arithmetic in **integer cents**; non-integer / negative / NaN → `invalid_amount` | money/`gross non-integer`, `negative refund`, `NaN refund` |
| **Tenant isolation**: a tenant-B row cannot inflate tenant-A's RFM | money/`row from tenant B`, rfm/`does NOT fold tenant-B orders`, dry-run/`a row from tenant B does NOT inflate` |
| Same tenant, different contact → rejected | money/`different contactId at the same tenant` |
| Duplicate `orderId` → first wins, rest flagged | money/`duplicate orderId` |
| Cohort decision is deterministic + priority-ordered | rfm/all cohort tests |
| NBA **never fabricates money**: `at_risk` / `dormant` ride `lifecycle` purpose with a template the caller renders | decisions/`cohort "at_risk" → reactivation_offer with LIFECYCLE purpose` |
| `lost` → `wait` + channel null | decisions/`cohort "lost" → wait` |
| Holdout is **stable** for `(seed, tenant, contact, pct)` and **monotone in pct** | decisions/`is deterministic`, `bumping pct from 10% → 20%` |
| Idempotency key includes tenant, contact, cohort, kind, channel, purpose, UTC day — never collides across tenants | decisions/`two tenants with the same contactId produce DIFFERENT keys` |
| Soft-opt-in requires PRIOR SIMILAR PURCHASE AT THE SAME TENANT in-window | soft-opt-in/`cross_tenant_proof_rejected`, `prior_purchase_outside_window`, `no_prior_similar_purchase` |
| Soft-opt-in sources are an **allowlist** (`signup_checkout`, `order_confirmation_optional`, `reservation_optional`); `imported_list` and `''` fail closed | soft-opt-in/`UNDOCUMENTED source`, `EMPTY source string` |
| GDPR erasure (Art. 17) overrides every basis | soft-opt-in/`GDPR erasure overrides`, dry-run/`GDPR erased → NO_SEND` |
| An explicit revocation on (channel × commercial) blows away soft-opt-in | soft-opt-in/`revocation on (channel × commercial)` |
| `allSendsDisabled` kill switch → every record `NO_SEND` | dry-run/`allSendsDisabled → NO_SEND` |
| Frequency cap breach → `REVIEW` with `retryAfterMs > 0` | dry-run/`frequency cap breached` |
| Quiet hours → `REVIEW defer:quiet_hours` with `retryAfterMs > 0` | dry-run/`quiet hours → REVIEW` |
| Transactional emails are never repurposed for marketing (purpose is set by cohort → `lifecycle`/`commercial` only; `transactional` cannot be produced here) | by construction — no cohort maps to `transactional` |
| `planDryRun` is pure (same inputs → same output, same key) | dry-run/`same inputs → same idempotency key + verdict` |

## 3. Verdict decision tree (dry-run.ts)

```
if gdprErased                              → NO_SEND  gdpr_erased
if allSendsDisabled                        → NO_SEND  all_sends_disabled
if nba.holdout                             → NO_SEND  holdout_control
if nba.kind == 'wait' or channel == null   → NO_SEND  wait:<cohort>
if purpose == 'commercial':
    softOptIn = evaluate(...)
policy = canSend(suppression → consent → quiet → caps)
if policy == 'block':
    if commercial AND softOptIn.eligible   → REVIEW   soft_opt_in_candidate:<policyReason>
    else                                   → NO_SEND  blocked:<policyReason>
if policy == 'defer'                       → REVIEW   defer:<reason> (+ retryAfterMs)
else                                       → ELIGIBLE ok:<cohort>
```

## 4. Mapping to the current Prisma schema (projection boundary)

`lib/growth/consumer/*` imports **no Prisma**. The caller (a future API route or cron) is
responsible for projecting rows into `ConsumerOrderInput`:

```
Order row                             → ConsumerOrderInput
---------                                 ---------------------
.id                                   → .orderId
.restaurantId                         → .tenantRestaurantId
.consumerId  (Operator.id, role consumer)  → .contactId   (temporary identity binding — see §5)
.createdAt   (DateTime)               → .atMs = createdAt.getTime()
.status      (String)                 → .status  (same enum)
.paymentStatus (String | null)        → .paymentStatus ('paid'|'pending'|null)
.total       (Float, euros)           → .grossCents = Math.round(total * 100)
Refund rows (status='succeeded', orderId=.id, dedupe on refund.id)
                                      → .refundCentsList = refunds.map(r => r.amountCents)
```

**Boundary rules enforced by the caller (not by this lot):**
1. `Order.total` is a `Float` in euros today. The caller multiplies by 100 and `Math.round`s — ONE conversion, at projection time. `money.ts` refuses non-integer cents, which closes the "future refactor passes euros as cents" footgun.
2. Only `Refund.status === 'succeeded'` is forwarded. Pending/failed refunds must not reduce monetary.
3. Only one row per `Refund.id` (the caller dedupes). The engine does not know how to call Stripe.

## 5. Dependencies for the next lots (live integration)

This lot is dry-run only. Live wiring will need, in order:

1. **Identity binding** — `GrowthContact` ↔ `Operator` (role consumer). Right now `ConsumerOrderInput.contactId` is passed as `Order.consumerId`, which is `Operator.id`. The B2C identity resolver (coming in a separate lot) will replace this with the stable `GrowthContact.id` so that a guest-checkout email bound to a contact BEFORE account creation still ties to the right RFM snapshot.
2. **Consent / Suppression / Delivery / FrequencyCapCounter persistence** — foundation has the TYPES but no Prisma models. A later lot adds the additive models + a projection layer that converts stored rows into `readonly Consent[]` / `readonly Suppression[]` / `recentSendTimestampsMs`.
3. **Deletion / suppression fail-closed** — this lot exposes `gdprErased: boolean` as an EXPLICIT input. The upstream data-subject-rights runbook (`docs/ops/DATA-SUBJECT-RIGHTS-RUNBOOK.md`) is where "an erased contact" is materialised. Fail-closed when the resolver cannot prove non-erasure.
4. **Executor** — a future route/cron reads `DryRunRecord` and dispatches via `lib/growth/adapters/*`. The idempotency key goes **as-is** to the delivery provider as the dedupe anchor. The executor MUST re-check `canSend` at delivery time (defence in depth) and MUST re-evaluate `gdprErased` and `allSendsDisabled` just before send — a planner record is a *draft*, not a licence.
5. **Experiment lift measurement** — the holdout partition is seeded by `holdoutSeed`. The experiment framework must persist the seed and `holdoutPct` so that lift computation can replay the exact same partition on the attribution side.

## 6. What is explicitly OUT of scope here

- **No provider calls, no HTTP, no email send.** `planDryRun` returns a record — nothing else.
- **No scraping, no enrichment, no PII inference.**
- **No schema change, no migration.** Caller projects.
- **No secrets, no env reads.**
- **No payouts, no money movement.** The engine reads refunds; it never emits them.
- **No "we miss you — here's 5 € off"** auto-generation. The `templateKey` names a template the restaurant must have populated; `at_risk` / `dormant` use `lifecycle` purpose precisely so a restaurant that has not configured a reactivation offer still gets a lifecycle message instead of a fabricated discount.
- **No cross-session memory.** Every call is pure.

## 7. How to run the targeted tests

```bash
# Only these five files — do NOT run the full suite under RAM pressure.
./node_modules/.bin/vitest run \
  tests/growth-consumer-money.test.ts \
  tests/growth-consumer-rfm.test.ts \
  tests/growth-consumer-decisions.test.ts \
  tests/growth-consumer-soft-opt-in.test.ts \
  tests/growth-consumer-dry-run.test.ts \
  --reporter=dot
```

Tests are pure (no Prisma mocks, no network). Node ≥ 20 required for `Intl.DateTimeFormat`
`UTC` support, already pinned by the project.
