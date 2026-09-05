# EMAIL-INFRASTRUCTURE — what actually sends Grubano mail (facts, no secret values)

## 1 · Provider and transport

| Item | Fact | Source |
|---|---|---|
| Provider | **Self-hosted SMTP of the o2switch shared hosting** (Exim). Banner: `220-muscadier.o2switch.net ESMTP Exim 4.99.5`. **Not** Brevo, Resend, SES, Postmark. | read-only EHLO probe 2026-09-05 11:45 CEST |
| Brevo | `@getbrevo/brevo ^2.3.0` is in `package.json:24` but **imported nowhere** in `app/`, `lib/`, `scripts/` (grep: only `package.json`, i18n strings, lock files) → **dead dependency**; SMS never implemented. `CLAUDE.md §2` ("Email/SMS: Brevo") is inaccurate. | grep |
| Library | `nodemailer ^7.0.13` (+ `@types/nodemailer ^8`). | `package.json:60` |
| Host | `process.env.SMTP_HOST \|\| 'mail.grubano.com'` (DNS: `mail.grubano.com` → `109.234.165.222` = `muscadier.o2switch.net`). | every transport; DNS |
| Port / TLS | **587 hardcoded**, `secure:false` ⇒ Nodemailer **opportunistic STARTTLS** (server advertises `STARTTLS`; `requireTLS` is not set, so a STARTTLS failure would fall back to plaintext). | all 7+3 transports; EHLO caps |
| AUTH | `AUTH PLAIN LOGIN` advertised; user `process.env.SMTP_USER \|\| 'contact@grubano.com'`, pass `SMTP_PASS`. | EHLO; code |
| EHLO identity | Client EHLO = Nodemailer default (`os.hostname()` of the app server) — not configured. Server greets as `muscadier.o2switch.net`. | code (no `name` option) |
| Env read | **only** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. No `SMTP_PORT`, no `SMTP_FROM`, no `REPLY_TO`. `.env.local` on the server has `SMTP_HOST=`, `SMTP_USER=`, `SMTP_PASS=` (key names measured locally; server values NOT READ). | grep; local key names |
| Transport instances | **10 separate `createTransport` calls** with identical config: `lib/transactional-emails.ts:21` (rail) + 6 inline routes (`auth/magic-link:22`, `auth/register:32`, `auth/step-up/request:26`, `account/email-change/request-code:24`, `partners/register:140`, `suppliers/orders:28`, `email-agent:9`) + 3 cron scripts + 1 ops script (`phase2-preflight.js:383`). No pooling, no shared module. | grep |

## 2 · Sender identity

| Item | Fact |
|---|---|
| From (app) | `"Grubano" <contact@grubano.com>` — hardcoded in **11 places** (rail `FROM` const `:31` + each inline route). |
| From (cron scripts) | `"Grubano ledger probe" <contact@grubano.com>`, `"Grubano gains créateurs" <contact@grubano.com>`, `"Grubano facturation" <contact@grubano.com>`. |
| Envelope sender / Return-Path | Nodemailer default: envelope MAIL FROM = the From address (`contact@grubano.com`). Exim on cPanel normally stamps `Return-Path: <contact@grubano.com>`; **actual header value NOT MEASURED** (needs a received message). Domain alignment From ↔ envelope = same domain by construction. |
| Reply-To | **none set anywhere.** Several bodies say "vous pouvez y répondre" / "répondez à cet email" → replies land in the `contact@grubano.com` mailbox (whether it is read is an operations fact, NOT MEASURED). |
| Message-ID | Nodemailer default (`<random@grubano.com>` derived from the From domain). |
| List-Unsubscribe header | none. Only the onboarding nudge carries an in-body unsubscribe link (HMAC token, `GET /api/onboarding/unsubscribe`). |
| Per-family senders | none (one identity for auth, orders, admin alerts, supplier POs). |

## 3 · Content format

| Item | Fact |
|---|---|
| HTML | inline-styled fragments (`<div style=…>`), **no `<html>/<head>/<body>`, no doctype, no `<title>`, no preheader**, no `lang`/`dir` attributes except `dir="rtl|ltr"` on the claim and nudge shells. Width `max-width:480px` (rail/inline) or `520–560px` (admin alerts); font stack `Inter,Arial,sans-serif` (rail) or `system-ui,Arial,sans-serif` (admin) — **Inter is never loaded** in email (client fallback). |
| Plain-text alternative | **only 3 senders**: magic link, step-up code, email-change code (`text:` set). Everything else is HTML-only (clients synthesize text). The 3 cron scripts are **text-only**. |
| Images | **zero `<img>`** across all 60 rendered templates (verified). No logo. Status conveyed by heading text + "✓" glyph + orange heading colour. |
| Tables | layout tables only for label/value rows (`table()` helper) and the supplier PO; buttons are styled `<a>` (no VML/Outlook fallback). |
| Escaping | rail `esc()` on user strings; **inline welcome + partner-verify inject `name` unescaped**; admin alerts escape. |
| Localization | FR hardcoded except `lib/claim-emails.ts` (5 locales via `next-intl` `claimEmails.*`, `Operator.locale` null⇒fr, RTL for ar) and the onboarding nudge (`onboardingNudge.*`). Mixed register: **tu** (magic link, welcome, partner verify) vs **vous** (everything else). |
| Templating | string templates in TS; `shell(title, body)` `:64-71` (private), `row()`/`table()` helpers; `claimShell()` and `renderNudgeHtml()` are local copies of the same shell. No MJML / React Email / Handlebars. |
| Currency / dates | `eurosFromCents()` → `Intl.NumberFormat('fr-FR', EUR)` ("12,50 €"); claims use the recipient locale; supplier PO uses `€${x.toFixed(2)}` (English-style, symbol first); `formatDateFr()` pinned to `Europe/Paris` ("samedi 12 septembre à 19:30"); supplier PO `toLocaleDateString('fr-FR')` in **server TZ**. |

## 4 · Send semantics

| Item | Fact |
|---|---|
| Sync / async | Every send is **awaited inside the HTTP request** (or the cron process). No queue, no job table, no background worker. |
| Retry | none automatic. The rail releases its dedupe claim on `failed|skipped` so a *future* business event (re-poll, sweep, re-decision) may re-send. |
| Timeout | Nodemailer defaults (connection 2 min, greeting 30 s, socket 10 min) — nothing configured. A slow SMTP stalls the API response (best-effort blocks are still awaited). |
| Error handling | RAIL: try/catch → `console.error('[EMAIL MISS] …')` with `{to, subject}` + message; EmailLog `failed`. INLINE: caught in magic-link/register/step-up/email-change/partner-verify; **not caught in suppliers/orders** (500). Cron scripts exit 1 on SMTP error. |
| `SMTP_PASS` missing | RAIL ⇒ `skipped` row; inline ⇒ log line only (magic link: "link NOT emailed"). Silent to the end user in every case. |
| Duplicate guard | `EmailDispatch @@unique([trigger,dedupeKey])` race-safe INSERT-claim (B0). Coverage: all rail sends **except** password reset/changed (deliberate), dish adopted, waitlist offer (guarded upstream), reservation `refund-deposit` email (no key passed). Inline sends: none. Nudges: `OnboardingNudge @@unique([operatorId,role,level])`. Email-agent: `emailLog.findFirst` (not race-safe). |
| Audit log | `EmailLog {recipient, subject, trigger, status sent|skipped|failed, claudeTokens?, sentAt}` — **no messageId, no error text, no index, no purge, no reader UI**. Written by the rail, `auth/register`, `partners/register`, `email-agent`. **Not written** by magic-link, step-up, email-change-code, suppliers/orders, cron scripts. |
| Alerting on email failure | none (console only). |
| Bounce / complaint | none (no webhook, no DSN parsing; bounces land in the `contact@` mailbox). |
| Rate limits (inbound) | app-level `rateLimit()` on public senders (`auth_magic_link` 5/10 min, `auth_register` 10/10 min, `auth_forgot_password` 5/10 min, partner register per-IP) — active only when `RATE_LIMIT_ENABLED` (staging value NOT MEASURED). Server: Exim `LIMITS MAILMAX=1000 RCPTMAX=50000`; o2switch policy banner forbids bulk/unsolicited mail. |

## 5 · Where each family fires from (module map)

```
lib/transactional-emails.ts   rail + 22 template fns (FR)           → orders, reservations, partner, auth reset, courier, email-change notices, creator/waitlist
lib/claim-emails.ts           4 fns, ×5 locales, RTL                  → claims + paid-cancellation variants (uses the rail)
lib/admin-alerts.ts           6 fns, ALERT_EMAIL                      → webhook / status route / cron routes / refund lib / franchise lib (uses sendOnce)
lib/order-email-sweep.ts      server backstop for /confirm            → admin route confirm-sweep (uses the rail)
app/api/auth/magic-link       inline (+text)                          → login
app/api/auth/register         inline + own EmailLog                   → welcome
app/api/auth/step-up/request  inline (+text)                          → money step-up code
app/api/account/email-change/request-code  inline (+text)             → email-change code
app/api/partners/register     inline + own EmailLog                   → partner verify
app/api/suppliers/orders      inline, no log, not best-effort         → supplier PO
app/api/email-agent           inline + own EmailLog, LLM bodies       → DEAD (unscheduled)
app/api/admin/onboarding-nudges/run  rail, i18n ×5, unsubscribe       → nudges
scripts/cron/*.js             3 text-only admin recaps/alerts         → cPanel crontab (active)
```

## 6 · Environments and recipients of internal mail

| Var | Role | SOURCE / OBSERVED / REQUIRED |
|---|---|---|
| `ALERT_EMAIL` | recipient of every admin alert (app) and cron recap (scripts). Empty ⇒ app alerts `skipped`, scripts log-only. | `.env.example:65` = `ops@grubano.com` (placeholder). Staging OBSERVED 2026-09-04: `m.maazouz@grubano.com` before operator v2 → v2 wrote `admin-qa@grubano.com` → operator v3 REQUIRES `m.maazouz@grubano.com` (v3 run **NOT MEASURED**). GitHub secret `ALERT_EMAIL` for `cron.yml` (inert). |
| `NEXTAUTH_URL` | CTA base for rail emails, nudges, password reset, magic link fallback | staging `https://app.grubano.com` (code default prod `https://grubano.com`) |
| `PARTNER_APP_URL` | base for the partner verify link (else request host) | not in `.env.example`; local key absent |
| `ALLOWED_MAGIC_HOSTS` | magic-link host allow-list | default `app.grubano.com,business.grubano.com,grubano.com` |
| `CRON_SECRET` / `INTERNAL_CRON_TOKEN` | auth of cron-callable routes | names only |

## 7 · Known infrastructure defects (facts, not fixes)

1. Ten duplicated transport definitions; three different display names; no single sender module → any change (DKIM domain, From, Reply-To, TLS enforcement) must be made in 11 places.
2. No `requireTLS` → plaintext fallback possible if STARTTLS is ever unavailable.
3. No plain-text part for 57 of 60 HTML templates; no `<html>` document wrapper; no preheader; no `lang`.
4. EmailLog is not a delivery log (no messageId/error) and has no reader.
5. `suppliers/orders` can 500 after creating the order when SMTP fails (order stays `pending`).
6. `CONSUMER_WELCOME` CTA points to production even on staging.
7. Brevo dependency is dead weight; CLAUDE.md stack table is stale on this point.
8. The only server-side catch-up for the two payment-triggered emails (`confirm-sweep`) has **no active scheduler**.
