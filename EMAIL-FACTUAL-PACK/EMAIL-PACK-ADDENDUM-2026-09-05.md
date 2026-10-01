# EMAIL-PACK-ADDENDUM — 2026-09-05 (pre-pilot fixes after the factual pack 7c83581)

This addendum records what changed in the product after the pack was established. The core files keep their measured state @ `d221008`; where a row is affected, this file wins.

## 1 · P0 OPERATIONAL — restaurant new-order notification no longer depends on a browser

| Before (pack) | After |
|---|---|
| `PARTNER_NEW_ORDER` + `CONSUMER_ORDER_CONFIRMATION` fired only from `POST /api/orders/[id]/confirm` (the checkout tab's 2 s poll); the server sweep had **no active scheduler** (remote `main` = Lovable tree, cPanel crontab without order job, HTTP cron would 401 on token provenance). | **In-process scheduler** (`lib/order-notification-scheduler.ts`, started by `instrumentation.ts` → `register()` per Next.js process, `experimental.instrumentationHook`) runs `sweepUnconfirmedPaidOrders()` directly: first tick 10 s after process start, then every 60 s. Truth = `Order.paymentStatus='paid'` written by the Stripe webhook (which still imports **no** sender — golden rule intact). Poll stays as the fast path. |
| Retry = "next poll" | **Bounded backoff** per (trigger, order) on `EmailLog` failures: 1 → 2 → 5 → 10 → 20 → 30 → 30 min; **give-up after 8** with a durable `EmailDispatch` marker `<trigger>:gave_up`, an `[EMAIL GIVE-UP]` log and **one** admin alert (new `ADMIN_EMAIL_GIVEUP`, see §3). |
| Sweep excluded `expired` only | Sweep excludes `expired` **and `cancelled`** (non-actionable — TEST 10). |

Manifest impact: `PARTNER_NEW_ORDER` and `CONSUMER_ORDER_CONFIRMATION` "Reachable" columns → **YES, server-guaranteed** (no browser dependency). Truthfulness T5 → **CLOSED**. Dead/orphan D7 (sweep without scheduler) → **CLOSED** (scheduler in-process; `cron.yml` job kept as idempotent redundancy). Contract + tests: `docs/ops/ORDER-NOTIFICATION-RELIABILITY.md`, `tests/order-notification-reliability.test.ts` (13), `tests/order-notification-scheduler.test.ts` (14).

### 1.1 · Staging measurement (2026-09-05/06)
SCHEDULER LIVE ON STAGING = **MEASURED YES** · HEARTBEAT TWO-POINT OBSERVATION = **PASS** (same PID 1693378; ticks 3 → 9; lastTickAt 23:03:27Z → 23:09:27Z; errors 0; nothing eligible to notify during the window) · LONG-IDLE / OVERNIGHT SURVIVAL = **NOT YET MEASURED** (pre-pilot observation, not a blocker) · pre-pilot check = read the heartbeat after a long idle interval / next morning (`docs/ops/ORDER-NOTIFICATION-RELIABILITY.md §8`). Design-facing product truth: new paid-order restaurant notifications are server-side reachable and do not require a browser tab to remain open. Any "depends on the browser poll" wording in the pack is PRE-FIX / HISTORICAL (core manifest rows updated 2026-09-06).

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

## 4b · EMAIL TRUTHFULNESS HOTFIX — 2026-09-06 (auth + refund, live code)

| Finding (register) | Fix | Where |
|---|---|---|
| T22 tutoiement (magic link, welcome, partner verify) | formal French everywhere; subjects « Votre lien de connexion Grubano », « Bienvenue sur Grubano — votre compte est prêt », « Confirmez votre e-mail — espace partenaire Grubano » | `app/api/auth/magic-link`, `app/api/auth/register`, `app/api/partners/register` |
| T12 code validity « 15 minutes » (code lives 10) | validity sentence derived from the code constants: link 15 min (`MAGIC_TTL_MS`), code 10 min (`OTP_TTL_MS`); combined state distinguishes both | `lib/auth-email-copy.ts` |
| T3 welcome promises « réserver une table » | removed (sur place OUT); beta capabilities only (Click & collect, points fidélité) | `app/api/auth/register` |
| T4 welcome CTA hard-coded to production | CTA on the deployment base (`NEXTAUTH_URL`) | idem |
| T13 « lien envoyé » when SMTP is not configured | account-independent honest 503 (`mail_unavailable`) BEFORE any lookup on magic-link, forgot-password and partner register (no un-activatable pending account created) | `lib/mail-transport-config.ts` + the 3 routes |
| T6 refund « effectué par {resto} » | neutral: « Votre remboursement (partiel) est confirmé … renvoyé sur le moyen de paiement utilisé pour votre commande chez {resto} » | `lib/transactional-emails.ts sendRefundConfirmation` |
| T7 « 5 à 10 jours ouvrés » | removed; « Le délai d'apparition sur votre compte dépend de votre banque. » (no number) | idem |
| T8 claim refunded amount = requested | engine actual amount carried on the refunded outcome (`RefundTriggerResult.amountCents`) and used by the arbitrate + auto-small paths | `lib/claims.ts`, `app/api/admin/claims/[id]/arbitrate`, `app/api/claims` |
| NEW rail A status truth (tickets, refund-deposit) | rail A answered ok on Stripe *acceptance*; e-mail now only when `refund.status === 'succeeded'`, amount = Stripe `refund.amount`; deposit route gains the missing dedupe key | `app/api/tickets/[id]/refund`, `app/api/reservations/[id]/refund-deposit` |

Register status after the hotfix: T3, T4, T6, T7, T8, T12, T13, T22 → **CLOSED**. Remaining P1/P2: T9 (guard note), T10 (no-show, flag OFF), T11, T14–T21, T23, T24. Tests: `tests/email-truthfulness-hotfix.test.ts` (17). **Refund e-mail safe for the Phase 2 rehearsal: YES — SEND IF STRIPE SUCCEEDED** (see `docs/ops/EMAIL-TRUTHFULNESS-HOTFIX-2026-09-06.md`).

## 4c · EXTERNAL DELIVERABILITY GATE — 2026-09-06 · PASS (EMAIL BETA GATE CLOSED)

One QA message (`[QA Grubano] Test de délivrabilité pré-bêta`) sent 2026-09-06T02:11:36Z through the real transport (Exim `250 OK id=1x32MK-0000000A4Fd-0Kzx`) to the founder's Gmail. Gmail "Show original": **received · INBOX · spf=pass (client IP `109.234.163.45`, MAIL FROM `contact@grubano.com`) · dkim=pass (`d=grubano.com`, `s=default`) · dmarc=pass (p=none, via both) · Return-Path `contact@grubano.com` · TLS 1.3**. Factual correction: the egress IP is the o2switch relay `109.234.163.45` (PTR `prout.jabatus.fr`, authorized by `include:spf.jabatus.fr`), not the submission host `109.234.165.222`. No DNS, product state, Stripe or flag change. Details: `EMAIL-DELIVERABILITY.md` §6. Remaining should-fix (DNS, founder-authorized): DMARC `rua` + enforcement path.

## 5 · Unchanged (still open)

Deliverability pre-production blocker (external proof, DKIM signing, DMARC `rua`) — open, founder gate for one external mailbox. P1/P2 register preserved (T3, T4, T6–T24). Cron scripts' `INTERNAL_CRON_TOKEN` provenance (401) — separate ops finding.
