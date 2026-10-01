# E3-DATA-CONTRACTS — fields available to the E3 emails (from `../EMAIL-DATA-CONTRACTS.md`)

| Email | Passed today | Conditional / nullable | Available but NOT passed |
|---|---|---|---|
| AUTH_STEPUP_CODE | `to`, `code`, `purpose` → label (withdraw / bank / email change; fallback "confirmer une action sensible") | — | expiry timestamp (10 min constant) |
| ACCOUNT_EMAIL_CHANGE_CODE | `to` (current DB email), `code` | — | — |
| ACCOUNT_EMAIL_CHANGE_LINK | `to` (new), `link` (`/eat/account/email/confirm?token=`) | — | expiry (15 min constant) |
| ACCOUNT_EMAIL_CHANGED_ALERT | `to` (old), `newEmailMasked` (`l***@e***`) | — | date/time, support address (hardcode `contact@grubano.com` allowed — it is the product channel) |
| ACCOUNT_EMAIL_CHANGE_CONFIRM | `to` (new) | — | — |
| ACCOUNT_EMAIL_ALREADY_USED | `to` (existing holder) | — | — |
| PARTNER_EMAIL_VERIFY | `to`, `name` (unescaped today), `link` (`{PARTNER_APP_URL or request host}/api/partners/verify-email?token=`) | — | expiry (24 h constant) |
| ADMIN_PARTNER_PENDING | `role` ∈ restaurant/supplier/influencer/logistics → label, `partnerName` | occurrence (influencer day bucket) | dossier link (console path is hardcoded text), applicant email (privacy: not passed) |
| PARTNER_ACCOUNT_VALIDATED / REJECTED / DOCS_NEEDED | `role`, `status`, `to`, `partnerName` (fallbacks: operator name → restaurant name → "partenaire"; contactName ‖ companyName; name ‖ email) | `reason?` (rejected/docs), `occurrence?` | dashboard URL per role (`/dashboard`, `/supplier/dashboard`, `/affiliate/dashboard` — known paths, not passed), restaurant name for restaurant role |
| ONBOARDING_NUDGE_RESTAURANT / GENERIC | `title`, `greeting(name)`, `body(steps)`, `resumeCta`, `unsubPrefix`, `unsubLink`, `resumeUrl` (`{base}/{locale}{nextStep.ctaHref ?? default}`), `unsubUrl` (HMAC), `rtl` | `steps` ICU plural (0 possible? no — only incomplete onboardings are nudged) | the checklist items themselves (`progress.nextStep.label` exists in the engine, not passed), level (1/2/3) |
| COURIER_WAITLIST_CONFIRMATION | `to`, `contactName` | — | zones, status (`pending`/`active` — never surfaced by design) |
| CONSUMER_RESERVATION_CONFIRMED | `to`, `customerName`, `restaurantName`, `date`, `guests`, `code` (`#XXXX`), `depositEur` (0 ⇒ no paragraph) | deposit state | restaurant address/phone, table name |
| PARTNER_NEW_RESERVATION | `reservationId`, `to`, `restaurantName`, `customerName` (**masked**), `date`, `guests`, `code` | — | phone/email of guest (hidden by founder model) |
| CONSUMER_RESERVATION_CANCELLED_BY_CLIENT | `to`, `customerName`, `restaurantName`, `date` | — | |
| PARTNER_RESERVATION_CANCELLED_BY_CLIENT | `to`, masked name, `restaurantName`, `date`, `guests` | — | |
| CONSUMER_RESERVATION_CANCELLED_BY_OWNER | `to`, `customerName`, `restaurantName`, `date` | `closureReason?` (null on a direct cancel) | |
| CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE | idem | `closureReason?` (public reason verbatim) | closure date range |
| CONSUMER_NOSHOW_PENALTY_CHARGED | `to`, `customerName`, `restaurantName`, `capturedCents` (Stripe capture), `date` | — | contest deadline (no rule exists) |
| OPERATOR_SUPPLIER_PURCHASE_ORDER | `items[{name, quantity, unit, price}]`, `total`, `supplier.leadTime` (free text), `order.id` (raw) | — | ordering restaurant identity (scope known at the route), supplier name, PO display number (none exists) |
| CREATOR_DISH_ADOPTED | `to`, `creatorName`, `restaurantName`, `city` (`''` allowed), `dishName`, `priceEur`, `royaltyPct` (fraction from `AdoptionConfig`) | city empty → no parenthesis | |
| PARTNER_WAITLIST_OFFER | `to`, `restaurantName`, `dishName`, `city`, `hours` (`WAITLIST_OFFER_TTL_HOURS`) | — | offer expiry timestamp (`offerExpiresAt` exists on the row) |
| CRON_CREATOR_EARNINGS_RECAP (text) | scanned (referral + dishSales), matured, cancelled, pending, reasons{} | — | |
| CRON_MONTHLY_INVOICES_RECAP (text) | month, generated, alreadyExisted, invoices[] (number, restaurantId, TTC/HT/TVA, alreadyExisted), totals | — | |

Idempotency: `partner_validated` / scope (once per partner) · `partner_rejected|docs_needed` / scope:day · `admin_partner_pending` / role:id(:day) · `courier_waitlist_confirmation` / `logistics:<id>` · email-change keys per token / per swap / per address · reservations `resv:<id>` per trigger · nudges: DB claim per (operator, role, level) · dish adopted / waitlist offer: none (upstream uniqueness) · supplier PO / codes: none.
