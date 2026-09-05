# EMAIL-PACK-ADDENDUM — 2026-09-05 (pre-pilot fixes after the factual pack 7c83581)

This addendum records what changed in the product after the pack was established. The core files keep their measured state @ `d221008`; where a row is affected, this file wins.

## 1 · P0 OPERATIONAL — restaurant new-order notification no longer depends on a browser

| Before (pack) | After |
|---|---|
| `PARTNER_NEW_ORDER` + `CONSUMER_ORDER_CONFIRMATION` fired only from `POST /api/orders/[id]/confirm` (the checkout tab's 2 s poll); the server sweep had **no active scheduler** (remote `main` = Lovable tree, cPanel crontab without order job, HTTP cron would 401 on token provenance). | **In-process scheduler** (`lib/order-notification-scheduler.ts`, started by `instrumentation.ts` → `register()` per Next.js process, `experimental.instrumentationHook`) runs `sweepUnconfirmedPaidOrders()` directly: first tick 10 s after process start, then every 60 s. Truth = `Order.paymentStatus='paid'` written by the Stripe webhook (which still imports **no** sender — golden rule intact). Poll stays as the fast path. |
| Retry = "next poll" | **Bounded backoff** per (trigger, order) on `EmailLog` failures: 1 → 2 → 5 → 10 → 20 → 30 → 30 min; **give-up after 8** with a durable `EmailDispatch` marker `<trigger>:gave_up`, an `[EMAIL GIVE-UP]` log and **one** admin alert (new `ADMIN_EMAIL_GIVEUP`, see §3). |
| Sweep excluded `expired` only | Sweep excludes `expired` **and `cancelled`** (non-actionable — TEST 10). |

Manifest impact: `PARTNER_NEW_ORDER` and `CONSUMER_ORDER_CONFIRMATION` "Reachable" columns → **YES, server-guaranteed** (no browser dependency). Truthfulness T5 → **CLOSED**. Dead/orphan D7 (sweep without scheduler) → **CLOSED** (scheduler in-process; `cron.yml` job kept as idempotent redundancy). Contract + tests: `docs/ops/ORDER-NOTIFICATION-RELIABILITY.md`, `tests/order-notification-reliability.test.ts` (13), `tests/order-notification-scheduler.test.ts` (14).

## 2 · P0 TRUTHFULNESS T1 / T2 — fixed

| Finding | Fix | Where |
|---|---|---|
| **T1** « en route — elle arrive bientôt » reachable for a pickup order (`ready → picked_up` allowed for any fulfillment type) | Domain guard: `picked_up` is refused (422) for any non-delivery order — the pickup hand-off is `ready → delivered` (« remise au client »). Defence in depth: `sendOrderStatusEmail` returns `skipped` for `picked_up` on a non-delivery order (no email at all). | `app/api/orders/[id]/status/route.ts` (guard after the state machine; `TRANSITIONS` constant unchanged), `lib/transactional-emails.ts` |
| **T2** delivery wording (« Livraison », « part bientôt en livraison », « livrée ») reachable in code while delivery is OUT | **Double gate** `isDeliveryWording(type) = type==='delivery' && DELIVERY_FULFILLMENT_ENABLED` (the same pilot switch that makes `POST /api/orders` refuse delivery). Everything else — pickup, legacy/unknown types, legacy `delivery` rows while the switch is OFF — is worded Click & collect. Applies to order confirmation (mode line), restaurant new-order (mode label) and all status emails. | `lib/transactional-emails.ts` |

**DELIVERY WORDING REACHABLE IN CLOSED BETA = NO.** Delivery templates are preserved (not deleted) as OUT-OF-BETA dormant states, reachable only when the pilot switch is ON **and** the order is a delivery. Renders `CONSUMER_ORDER_CONFIRMATION_DELIVERY`, `CONSUMER_ORDER_READY_DELIVERY`, `CONSUMER_ORDER_ENROUTE`, `CONSUMER_ORDER_DELIVERED` are now produced with the switch forced ON by the harness and carry `outOfBeta:true, requiresFlag` in their `.json`.

Manifest impact: `CONSUMER_ORDER_ENROUTE` → **B** (reachable only with `DELIVERY_FULFILLMENT_ENABLED=true` on a delivery order), maturity OUT_OF_BETA. T1, T2 → **CLOSED**. Tests: `tests/order-status-pickup-guard.test.ts` (7), `tests/email-order-status.test.ts` (+3 T1/T2 cases incl. the negative control "switch ON → delivery wording present").

## 3 · New candidate (admin, internal)

| EMAIL ID | Family | Audience | Status | Trigger | Send | Subject | Contract | Tranche |
|---|---|---|---|---|---|---|---|---|
| ADMIN_EMAIL_GIVEUP | ADMIN / INTERNAL | `ALERT_EMAIL` | **A** (reachable when a (trigger, order) fails 8 times) | `lib/order-email-sweep.giveUp()` | `lib/admin-alerts.sendAdminEmailGiveUpAlert` → sendOnce `admin_email_giveup` / `<trigger>:order:<id>` (once ever) | `[Grubano] Email non délivré après {n} tentatives — commande GR-XXXXXX` | trigger, orderId (raw), orderRef, attempts | E2 (admin operational shell) |

Total candidates: **61** (A 35 · B 22 · D 4; `CONSUMER_ORDER_ENROUTE` A→B, `ADMIN_EMAIL_GIVEUP` new A).

## 4 · E1 delivery strategy

E1 is split into capacity-safe sub-tranches: **E1-A** (global system + AUTH_MAGIC_LINK + CONSUMER_ORDER_READY pickup + PARTNER_NEW_ORDER; portable bundle `E1-A/CLAUDE-DESIGN-E1-A-BUNDLE.zip`) → founder approval → E1-B (auth), E1-C (consumer order), E1-D (partner core). E2/E3 unchanged, not started.

## 5 · Unchanged (still open)

Deliverability pre-production blocker (external proof, DKIM signing, DMARC `rua`) — open, founder gate for one external mailbox. P1/P2 register preserved (T3, T4, T6–T24). Cron scripts' `INTERNAL_CRON_TOKEN` provenance (401) — separate ops finding.
