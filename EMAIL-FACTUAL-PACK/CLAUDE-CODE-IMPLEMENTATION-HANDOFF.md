# CLAUDE-CODE-IMPLEMENTATION-HANDOFF — how the designed emails will be implemented (NOT NOW)

> Sequence: this factual pack → Claude Design E1 → founder approval of the system contract → E2 → approval → E3 → approval → **then** Claude Code implements. Nothing below is executed in this session. Money / auth / Claims / Refund semantics must stay byte-identical: only the **rendering and transport** layers change.

## 1 · Target architecture (constraints derived from the facts)

| Layer | Today | Target |
|---|---|---|
| Sender module | 10 duplicated `createTransport` + rail `sendTransactional` | **one** `lib/email/transport.ts` (SMTP config, `requireTLS:true`, EHLO `name`, pooled transport, timeouts) — every inline sender migrated to the rail (`sendTransactional` / `sendOnce`) so EmailLog + dedupe cover 100 % of sends. Non-deduped classes (magic link, OTP codes, password reset) keep `dedupeKey` undefined **deliberately** (documented list). |
| Renderer | string templates ×4 shells | `lib/email/render.ts`: one email-safe document shell (`<!doctype>`, `<html lang dir>`, `<title>`, hidden preheader, 600 px table container, inline CSS, system font stack, bulletproof button, footer block) + per-family **state components** (status band, order lines table, key/value rows, code block, CTA, muted note). Designed HTML references from Claude Design are the source; implement as TS render functions (no MJML/React-Email runtime added unless the founder approves a dependency). |
| Plain text | 3/60 | `text` generated for **every** email from the same data (not html-to-text of the HTML). |
| Subject / preheader map | subjects inline | `lib/email/catalog.ts`: `{ id, family, trigger, subject(locale, vars), preheader(locale, vars), audience, dedupe policy, tranche }` — the single place Claude Design's subject/preheader recommendations land. |
| Locale | FR hardcoded (except 2 families) | all templates read `Operator.locale` (null ⇒ fr) via `next-intl` message namespaces `email.<family>.<id>.*` (×5, RTL for ar). **Design in FR; translations are a separate i18n lot** (never parallel-edit `messages/*` — memory). |
| Dynamic fields | ad-hoc params | typed contracts per template (`EMAIL-DATA-CONTRACTS.md`) with explicit nullable handling; money always in cents from the server value already passed today. |
| Identity | From only | From `"Grubano" <contact@grubano.com>` + `Reply-To` (support mailbox, founder-decided) + `List-Unsubscribe` **only** for the nudge family + `X-Grubano-Email-Id` header (= EMAIL ID) for observability. |
| Audit | EmailLog {recipient, subject, trigger, status} | EmailLog v2 (additive migration, founder-run db push): `emailId`, `messageId`, `error`, `locale`, `dedupeKey` + index; no purge of PII beyond current policy without a data-rights decision. |

## 2 · Implementation lots (each = one branch, one review, byte-identical money gate)

| Lot | Scope | Gate |
|---|---|---|
| I0 | transport consolidation + document shell + text part + catalog + EmailLog v2 (additive) | tsc 0 · full vitest · build cold · money engine + webhook byte-identical (git blob hash) · webhook imports no consumer sender (existing source-scan tests) · `SMTP_PASS` absent ⇒ skipped path preserved |
| I1 (E1) | auth + consumer order + partner new order on the new renderer | all E1 fixtures render (snapshot tests) · trigger tests unchanged · truthfulness tests (T1/T2: no delivery/en-route wording reachable for pickup; welcome CTA = `NEXTAUTH_URL`) |
| I2 (E2) | claims + refunds + admin money family — **only after `EMAIL-CLAIMS-REFUNDS-FACTS.md` is refreshed** against final Claims/Refund code | refund email only on Stripe `succeeded` (existing tests) · actor = Grubano · amount = engine `amountCents` (fix T8) · pending/failed ⇒ no consumer email (unless the founder confirms a proposal) · flags stay OFF |
| I3 (E3) | onboarding / partner lifecycle / secondary account / waitlist / reservations (OUT) / supplier PO / crons | idem + `refund-deposit` dedupeKey (D13) + supplier route best-effort (never 500 after order creation) |
| I4 | deliverability: external test script, DMARC `rua` (founder DNS change), DKIM confirmation, staging send rehearsal | see §6 |

## 3 · Test matrix to add (vitest, `tests/email-*`)

| Test | What it proves |
|---|---|
| render tests | every EMAIL ID × locale renders with the deterministic fixtures of `tools/render-current.test.ts` (reuse its mocks); snapshot of subject / preheader / text; `<html lang>`, preheader present, no `<img>` without `alt`, no JS, container ≤ 640 px, no `{` unresolved placeholders |
| transport tests | one transport module; `requireTLS`; From/Reply-To/List-Unsubscribe headers per family; `SMTP_PASS` absent ⇒ `skipped` + no throw |
| trigger tests | existing `email-idempotency`, `email-order-status`, `email-resto-notif`, `email-partner-lifecycle`, `email-admin-partner-pending`, `claim-emails*`, `order-email-sweep`, `magic-link-route`, `step-up-request-route`, `email-change` **must keep passing unchanged** (they pin triggers, keys, gates) |
| truthfulness tests | pickup order never receives "en route"/"livrée"; refund email requires `stripeStatus==='succeeded'`; refund actor string never = restaurant; no ETA words in any FR/EN/ES/IT/AR catalog entry (`bientôt`, `minutes`, `arrive`) on order emails; welcome copy has no reservation promise while sur place is OUT |
| mobile renders | headless Chrome screenshots at 320/390/600 for the E1 set via `tools/screenshot.mjs` (extend widths) — visual review artefact, not an assertion |
| images-off | render with `<img>` stripped → text still complete (assert every image has `alt` and no information is image-only) |
| plain-text | `text` present for 100 % of sends; contains the CTA URL and the reference |
| external-delivery regression | `scripts/ops/deliverability-test.js <recipient>`: one message, prints SMTP response; manual header capture checklist (SPF/DKIM/DMARC PASS) — run before each production flag flip |
| staging send rehearsal | founder-run: one order end-to-end on staging with `ALERT_EMAIL` + a founder external mailbox → confirmation, restaurant, status, cancellation emails observed in inbox (not spam) |

## 4 · Fixtures (reuse, do not invent new ones)
`tools/render-current.test.ts` fixtures: consumer « Léa Martin » `lea.martin@example.invalid`, restaurant « Gnocchi Bar » owner `gnocchi.bar@example.invalid`, order id `clx0fixtureabc123` → `GR-ABC123`, items 2× Gnocchi 4 fromages + 1× Tiramisu maison, 25,50 € / 28,50 € delivery variant, claim 12,50 €, refund 5,00 € partial, date 2026-09-12 19:30 Paris, reservation code `#K7Q2`, courier « Sami », creator « Chef Nadia », supplier « Primeurs de Lyon ». All recipients `*.example.invalid` (RFC 2606) — never a real mailbox.

## 5 · Non-negotiables carried from the product
- Never email from the Stripe webhook (consumer/restaurant); admin alerts only via `lib/admin-alerts`.
- Never recompute money; pass the server value already available at the call site.
- Never suppress a legitimate notice through dedupe (codes, links, password reset stay undeduped; day-bucket for repeatable partner decisions).
- Never flip `CLAIMS_ENABLED`, `REFUNDS_ENABLED`, `PUNITIVE_CAPTURE_ENABLED`, `DELIVERY_*`, `FRANCHISE_*`; never touch Stripe LIVE.
- Never send to real customers from a test path; QA addresses must be test-ish (`+qa`, `.test`, `.qa`, `example.invalid`).

## 6 · Deliverability lot (needs the founder)
1. Founder provides **one** external QA address (Gmail preferred, plus Outlook/Orange if available).
2. Claude Code sends the single `[GRUBANO STAGING] Deliverability test` from the staging transport, records the SMTP `250` line; founder pastes `Authentication-Results` + folder.
3. If `dkim=pass d=grubano.com s=default` → DKIM PROVEN; else cPanel *Email Deliverability* → enable/repair DKIM (founder action, cPanel UI).
4. DMARC: founder adds `rua=mailto:<monitored>` (DNS write, founder-authorized) → 2-week observation → `p=quarantine` → `p=reject`.
5. Re-run the test after each DNS change; keep the header captures in `EMAIL-FACTUAL-PACK/deliverability-evidence/` (to create).

## 7 · Scheduler decision (blocks the "restaurant always notified" guarantee)
Choose one before beta scale: (a) cPanel crontab entry calling `POST /api/admin/orders/confirm-sweep` every 20 min with `X-Internal-Token` (mirrors the 3 existing jobs, `docs/ops/crons.md §2`), or (b) get `cron.yml` onto the real default branch. Same decision covers nudges / reconcile digest / stale-claims. Founder decision; nothing changed here.

## 8 · Out of scope for the email implementation
Marketing/re-engagement (dead email-agent) — requires a consent + unsubscribe foundation first. Restaurant-side claim notifications, allergen escalation, courier decision emails — product contract first (E2/E3 design proposals may be produced, implementation waits for a founder decision).
