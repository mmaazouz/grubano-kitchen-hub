# ORDER NOTIFICATION RELIABILITY — restaurant « nouvelle commande » without a browser (P0 OPERATIONAL, 2026-09-05)

## 1 · Root cause (characterised, `develop` @ 73dadbf)

Call graph of a card order (facts, file:line):

```
POST /api/orders                      → Order{status:'awaiting_payment'}                    app/api/orders/route.ts:596
POST /api/orders/[id]/pay             → Stripe PaymentIntent                                 app/api/orders/[id]/pay/route.ts
Stripe → POST /api/webhooks/stripe    payment_intent.succeeded → handleOrderPaid:
                                        Order.paymentStatus='paid', status→'received'         app/api/webhooks/stripe/route.ts (golden rule: imports NO sender)
checkout screen (browser) polls       POST /api/orders/[id]/confirm every 2 s (owner session):
                                        paymentStatus==='paid' ⇒ sendRestaurantNewOrderEmail   app/api/orders/[id]/confirm/route.ts:63-86
                                                              ⇒ sendOrderConfirmation          :110-121
                                        both via sendOnce → EmailDispatch @@unique([trigger,dedupeKey])
server catch-up                       lib/order-email-sweep.sweepUnconfirmedPaidOrders()
                                        ← POST /api/admin/orders/confirm-sweep (X-Internal-Token or admin session)
                                        ← cron.yml job `sweep-order-emails` every 20 min
```

- **Where the order becomes server-authoritatively paid:** the Stripe webhook (`paymentStatus='paid'`). Truth is never taken from the client.
- **Where the restaurant email was triggered:** ONLY `/confirm`, ONLY when the consumer's checkout tab polled after the webhook. `/confirm` is owner-scoped (the consumer's session) — the restaurant dashboard never triggers it.
- **Server-side fallback:** existed (`confirm-sweep`) but had **no active scheduler**: GitHub `schedule` fires only from the default branch, and remote `main` = `7e03037` (2026-05-25, a Lovable/Vite tree with no `.github/workflows/`); the cPanel crontab (relevé 26-27/07/2026) has 3 jobs, none for orders. An HTTP cron from cPanel would additionally hit the `INTERNAL_CRON_TOKEN` provenance issue (`.env.local` ≠ runtime, HTTP 401 measured 2026-09-04 v3).
- **Duplicate risk today:** none — `EmailDispatch` unique INSERT-claim (race-safe) — but **loss risk = real**: tab closed before the webhook ⇒ nobody is ever emailed.
- **Masking during rehearsals:** the founder's checkout tab stayed open ⇒ the poll fired ⇒ the defect never showed.

## 2 · Chosen contract (A3)

**Server-authoritative trigger:** `Order.paymentStatus='paid' ∧ status ∉ {expired, cancelled}` (written by the webhook) — the durable event. No new table: the paid row *is* the outbox; `EmailDispatch` *is* the "sent" ledger.

**Consumer of the event:** an **in-process scheduler** (`lib/order-notification-scheduler.ts`, started by `instrumentation.ts → register()` once per Next.js server process, `experimental.instrumentationHook` in `next.config.js`) that calls `sweepUnconfirmedPaidOrders()` **directly** — no HTTP, no token, no browser — first tick 10 s after process start, then every 60 s. Rationale over the alternatives:

| Option | Why not / why |
|---|---|
| send from the webhook | violates the locked golden rule (webhook imports no sender; 4 source-scan tests) and would couple SMTP latency/failure to the 2xx Stripe needs |
| cPanel HTTP cron | token provenance (401 measured), founder must install a crontab line, 2–5 min latency; kept as a documented *option*, not required |
| GitHub `cron.yml` | inert until the real default branch carries workflows (founder decision pending) |
| **in-process timer** | zero founder action, correct runtime env, direct lib call, race-safe with the poll; Passenger spawns a process on ANY request — the webhook that recorded the payment is such a request — and keeps it ≥ idle timeout (300 s default), so the first ticks always happen; the long tail resumes at the next request of any kind |

The browser poll (`/confirm`) stays as the **fast path** (unchanged, byte-identical). The admin route `confirm-sweep` stays for manual runs.

## 3 · Idempotency / retry / give-up (A4, A6)

- **Idempotency:** `sendOnce(trigger, 'order:<id>')` → unique INSERT into `EmailDispatch` before the SMTP call; the poll, the scheduler tick(s) of every Passenger process and the admin route all race on the same key — exactly one wins. Proven: TEST 4, 5, 6.
- **SMTP failure:** the rail writes `EmailLog{status:'failed'}` and **releases the claim** ⇒ the next tick retries.
- **Backoff (new, `lib/order-email-sweep.ts`):** before each retry the sweep counts the `failed` EmailLog rows of the (trigger, `GR-` ref) in the 48 h window: attempt n+1 is allowed only after `BACKOFF_MS[n]` = 1 → 2 → 5 → 10 → 20 → 30 → 30 min since the last failure. Unreadable audit log ⇒ retry allowed (never blocks a legitimate send).
- **Give-up:** after `MAX_ATTEMPTS = 8` failures ⇒ durable marker `EmailDispatch{trigger:'<trigger>:gave_up', dedupeKey:'order:<id>'}` (no further attempt, ever), `[EMAIL GIVE-UP]` log line, **one** admin alert `admin_email_giveup` (`lib/admin-alerts.sendAdminEmailGiveUpAlert`, recipient `ALERT_EMAIL`). The order stays paid and visible in the dashboard — only the email channel gave up.
- **Visibility:** `[order-notify] sweep {…counts…}` log line whenever something was sent/failed/given up; heartbeat file `~/.grubano/order-notify-heartbeat.json` (outside the web root; counts + timestamps only, no ids) rewritten every tick.
- **Non-actionable orders:** `cancelled` joins `expired` in the exclusion (TEST 10) — a restaurant never receives « nouvelle commande à accepter » for a cancelled order; the consumer already receives the cancellation family.

## 4 · Gates and switches

| Env | Effect |
|---|---|
| `NODE_ENV=production` | scheduler runs (staging + prod builds). Dev/test never sweep a DB. |
| `ORDER_NOTIFY_SWEEP_DISABLED=true` | kill-switch (no timer). |
| `ORDER_NOTIFY_SWEEP_FORCE=true` | run outside production (ops check only). |
| build phase | never runs. |

Money engine, webhook, `/confirm`, `/pay`, `orders/route` — **untouched** (git blob identical except the status-route T1 guard). No schema change, no migration, no new dependency.

## 5 · Test matrix (tests/order-notification-reliability.test.ts · order-notification-scheduler.test.ts · order-status-pickup-guard.test.ts)

| # | Case | Result |
|---|---|---|
| 1 | paid actionable order, no poll → restaurant + consumer emails sent by the sweep | PASS |
| 2 | customer closes the tab right after payment (no /confirm ever) → sent | PASS |
| 3 | restaurant dashboard closed → sent to `restaurant.operator.email` | PASS |
| 4 | poll after the server send → `alreadySent`, no duplicate | PASS |
| 5 | multiple polls before/after → exactly one email | PASS |
| 6 | 5 sweeps incl. 2 concurrent → exactly one email | PASS |
| 7 | SMTP fails once → claim released, backoff deferral, retry succeeds once, then `alreadyDone` | PASS |
| 8 | unpaid order → no email (sweep + poll) | PASS |
| 9 | failed payment → no email | PASS |
| 10 | cancelled / expired paid orders → excluded | PASS |
| + | give-up after 8 failures: marker + one admin alert + no further attempt | PASS |
| + | scheduler: gates, first tick, cadence, no overlap, error isolation, singleton, stop | PASS |
| + | golden rule: webhook imports no sender / sweep / scheduler; `/confirm` untouched | PASS |

## 6 · Staging rehearsal (A8) — what is measured, what is not

Automated proof above is deterministic (mocked transport). On staging after deploy: `/version.json` = deployed SHA, `/fr/eat` 200, `/api/restaurants` 200 are measurable from outside. **The scheduler tick itself is not observable without server access**: evidence = the `[order-notify] scheduler started …` line in the Passenger log and `~/.grubano/order-notify-heartbeat.json` (founder: `cat ~/.grubano/order-notify-heartbeat.json`). No paid TEST order was created in this lot (no new Stripe money movement without explicit authorisation); the existing paid staging orders inside the 48 h window would be swept (`alreadyDone` expected).

## 7 · Residuals (documented, not hidden)

- Latency without a browser = up to ~60 s (+10 s after a cold spawn). Acceptable for the closed beta; a cPanel cron every 2 min could complement it once the token provenance is fixed (optional).
- If no request of any kind reaches the app after the webhook AND every tick within the idle window fails (SMTP down), the retry resumes at the next request — "eventually", not "within N minutes".
- The 3 existing cPanel cron scripts read `INTERNAL_CRON_TOKEN` from `.env.local`, which differs from the runtime token (401 measured) — a separate ops finding, not addressed here.
