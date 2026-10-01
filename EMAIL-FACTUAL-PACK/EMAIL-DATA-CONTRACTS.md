# EMAIL-DATA-CONTRACTS — the dynamic data each template actually receives

> Read from the TypeScript signatures and their call sites (`develop @ d221008`). REQUIRED = parameter without `?`; OPTIONAL = `?` or defaulted; NULLABLE = may arrive empty at runtime even if typed required (with the observed fallback); DERIVED = computed inside the template. Source of truth per field is the DB column or engine result the caller reads — templates never recompute money.

## 0 · Shared formatting rules (facts)

| Concern | Rule in code | Where |
|---|---|---|
| Order reference | `orderRef(orderId) = 'GR-' + id.slice(-6).toUpperCase()` — display ref, **not unique**, no persisted `orderNumber`. Used by every consumer/partner order email and claim email. | `lib/order-ref.ts` |
| Reservation code | `reservationCode(id) = '#' + 4 chars (djb2 hash)` — "N° de session". | `lib/reservation-code.ts:56` |
| Currency | cents → `Intl.NumberFormat('fr-FR', {currency:'EUR'})` → "12,50 €" (rail `eurosFromCents`); claims: recipient-locale `Intl.NumberFormat(locale)`; admin alerts `(cents/100).toFixed(2) + ' €'`; supplier PO `'€' + n.toFixed(2)`; creator adoption `priceEur.toFixed(2).replace('.', ',') + ' €'`. **Four different money formats.** | code |
| Money source | order emails: `order.total` (Float € in DB) → `Math.round(total*100)` cents at the call site; refund: `result.amountCents` (engine, Stripe truth); no-show: `settle.capturedAmount` (Stripe capture); claims: `Claim.requestedAmountCents`. | call sites |
| Date/time | `formatDateFr(Date)` → `Intl.DateTimeFormat('fr-FR', {timeZone:'Europe/Paris', weekday long, day, month long})` + `HH:mm` → "samedi 12 septembre à 19:30" (server-TZ independent). Supplier PO: `toLocaleDateString('fr-FR')` in server TZ. Nudges/claims: no dates. | `lib/transactional-emails.ts:43-55` |
| Names | rail escapes with `esc()`; claim/nudge escape; **welcome + partner-verify do not**. Empty consumer name → callers fall back to the email (`consumer.name ?? consumer.email`) in status/refund routes; the confirm route passes `consumer.name` raw (may be `''`). Claims omit the greeting when the name is empty. | code |
| Restaurant name fallback | `'votre restaurant'` when the relation is missing (status, confirm, refund, sweep). | call sites |
| Locale | rail/inline: none (FR). Claims/nudges: `resolveNudgeLocale(Operator.locale)` ∈ fr en es it ar, null ⇒ fr; `rtl = locale==='ar'`. | `lib/onboarding-nudge.ts:59` |
| Base URL | `baseUrl()` = `NEXTAUTH_URL` trimmed, fallback `https://grubano.com`; nudges fallback `https://app.grubano.com`; welcome hardcoded prod; partner verify = `PARTNER_APP_URL` or request host; magic link = allow-listed request host or canonical. | code |
| Idempotency key | provided by the caller (see manifest); templates never build it except `sendPartnerStatusEmail` / `sendAdminNewPartnerEmail` (scope + day bucket) and `sendEmailAlreadyUsedNotice` (address). | code |

## 1 · `lib/transactional-emails.ts`

| Template | REQUIRED | OPTIONAL | NULLABLE at runtime (fallback) | DERIVED in template | Source of truth |
|---|---|---|---|---|---|
| `sendOrderConfirmation` | to, customerName, restaurantName, orderRef, fulfillmentType (`'pickup'\|'delivery'\|string`), items[{name, qty}], paidCents | dedupeKey | customerName may be `''`; items may be `[]` (filtered from `Order.items` JSON by `typeof name==='string'`, qty `Number(qty)\|\|1`); restaurantName fallback 'votre restaurant' | mode sentence (pickup ⇒ "Click & collect — votre commande sera à retirer au restaurant." else "Livraison — votre commande arrive chez vous."); euros ×2 | `Order.total`, `Order.items`, `Order.fulfillmentType`, `Restaurant.name`, `Operator.name/email` |
| `sendRestaurantNewOrderEmail` | orderId, to, restaurantName, orderRef, fulfillmentType, items, totalCents | — | items `[]` | mode label ('Click & collect' / 'Livraison'), euros | same |
| `sendOrderStatusEmail` | orderId, to, customerName, restaurantName, orderRef, status, fulfillmentType | — | non-notifiable status ⇒ `{status:'skipped'}` | trigger/subject/title/body per status; pickup vs delivery wording for `ready` & `delivered` | `Order.status` transition, `Order.fulfillmentType` |
| `sendRestaurantNewReservationEmail` | reservationId, to, restaurantName, customerName (masked by caller), date, guests, code | — | — | formatDateFr | `Reservation.*` |
| `sendPartnerStatusEmail` | role ∈ restaurant/supplier/influencer, status ∈ validated/rejected/docs_needed, to, partnerName, dedupeScope | reason, occurrence (YYYY-MM-DD) | partnerName fallbacks: `operator.name ?? restaurant.name ?? 'partenaire'`, `contactName \|\| companyName`, `op.name ?? op.email` | noun by role ("votre établissement" / "votre compte fournisseur" / "votre compte"), dedupeKey | admin decision |
| `sendAdminNewPartnerEmail` | role ∈ restaurant/supplier/influencer/logistics, partnerName, dedupeScope | occurrence | `ALERT_EMAIL` empty ⇒ skipped | label by role, dedupeKey | registration |
| `sendCourierWaitlistConfirmation` | to, contactName, dedupeKey | — | — | — | `LogisticsProfile` |
| `sendEmailChangeLink` | to, link, dedupeKey | — | — | — | pending token |
| `sendEmailChangedAlert` | to, newEmailMasked, dedupeKey | — | — | — | committed swap |
| `sendEmailChangeConfirm` | to, dedupeKey | — | — | — | idem |
| `sendEmailAlreadyUsedNotice` | to | — | — | dedupeKey from address | uniqueness probe |
| `sendReservationConfirmation` | to, customerName, restaurantName, date, guests, code, depositEur | dedupeKey | depositEur `0` ⇒ no deposit paragraph | formatDateFr; deposit € with comma; conditional paragraph | `Reservation.depositAmount` (server-set) |
| `sendReservationCancelledByClientToClient` | to, customerName, restaurantName, date | dedupeKey | — | formatDateFr | |
| `sendReservationCancelledByClientToOwner` | to, customerName (masked), restaurantName, date, guests | dedupeKey | — | formatDateFr | |
| `sendReservationCancelledByOwner` | to, customerName, restaurantName, date | dedupeKey, closureReason (null) | — | reason paragraph, CTA `{base}/eat` | |
| `sendReservationCancelledByClosure` | to, customerName, restaurantName, date | dedupeKey, closureReason | — | idem | `Closure.reason` (public) |
| `sendPasswordResetEmail` | to, name, resetUrl (full URL incl. token+email+space) | — | — | — | `VerificationToken` |
| `sendPasswordChangedEmail` | to, name | — | — | — | |
| `sendRefundConfirmation` | to, customerName, restaurantName, refundedCents, partial | dedupeKey | deposit route: no key | euros; "partiel" insertion | `result.amountCents` / `result.refundedCents`; `partial = remaining>0` |
| `sendDishAdoptedToCreator` | to, creatorName, restaurantName, city (`''` allowed), dishName, priceEur, royaltyPct (fraction) | — | city `''` ⇒ no parenthesis | price with comma, pct ×100 (0 or 1 decimal), CTA `/creators/dashboard` | `AdoptionConfig.creatorCommissionPctReferred` |
| `sendWaitlistOfferToRestaurant` | to, restaurantName, dishName, city, hours | — | — | CTA `/menu` | `WAITLIST_OFFER_TTL_HOURS` |
| `sendNoShowPenaltyCharged` | to, customerName, restaurantName, capturedCents, date | dedupeKey | — | euros, formatDateFr ×2 | Stripe capture amount |

## 2 · `lib/claim-emails.ts` (localized)

| Template | REQUIRED | OPTIONAL | Resolved inside | i18n variables |
|---|---|---|---|---|
| `sendClaimAckEmail` | claimId, consumerId, orderId, requestedAmountCents | — | consumer {to, name, locale} via `operator.findUnique` (no email ⇒ traced skip) | `ref`, `euros`, `name` |
| `sendClaimDecisionEmail` | claimId, consumerId, orderId, decision ∈ accepted/refused/refunded/approved/refused_final | reason, restaurantName (null ⇒ i18n `theRestaurant` "Le restaurant"), refundedCents (null ⇒ 0 formatted but only used by `refunded.body`) | idem | `ref`, `resto`, `euros`, `name` |
| `sendOrderCancelledPaidEmail` | orderId, consumerId, restaurantName | existingClaim | idem | `ref`, `resto`, `name` |
| `sendOrderCancelledPaidOffEmail` | orderId, consumerId, restaurantName | — | idem | `ref`, `resto`, `name` |

## 3 · `lib/admin-alerts.ts` (recipient always `ALERT_EMAIL`)

| Template | REQUIRED | Notes |
|---|---|---|
| `sendAdminGhostOrderAlert` | orderId, paymentIntentId, amountCents, refundsOn | raw ids shown; action sentence depends on `refundsOn` |
| `sendAdminStalePiAlert` | kind ∈ order/ticket, entityId, paymentIntentId, currentPiId (null ⇒ "(aucun)"), amountCents | |
| `sendAdminPaidCancellationAlert` | orderId, paymentIntentId (null ⇒ "—"), amountCents, restaurantName (null ⇒ "—") | |
| `sendAdminStaleClaimAlert` | claimId, orderId, requestedAmountCents, ageHours (floored) | |
| `sendAdminReconcileDigest` | count, sampleOrderIds[] (≤10, raw), dayKey | |
| `sendAdminMoneyReviewAlert` | kind (5 values), dedupeKey, title, facts: `Record<string, string\|number\|boolean\|null\|undefined>` (undefined dropped; rendered as 2-col rows) | free-form keys; design must accept N rows |

## 4 · Inline senders

| Email | Inputs | Notes |
|---|---|---|
| AUTH_MAGIC_LINK | name (may be `''` ⇒ "Bonjour,"), to, link, code? (null ⇒ no code block; plural grammar toggles) | HTML + text |
| CONSUMER_WELCOME | to, name (unescaped) | CTA hardcoded prod URL |
| AUTH_STEPUP_CODE | to, code, purpose → action label (fallback "confirmer une action sensible") | HTML + text |
| ACCOUNT_EMAIL_CHANGE_CODE | to, code | HTML + text |
| PARTNER_EMAIL_VERIFY | to, name (unescaped), token → link | |
| OPERATOR_SUPPLIER_PURCHASE_ORDER | items[{name, quantity, unit, price}] (unescaped), total, supplier.leadTime (free text), order.id (raw) | date = today server TZ |
| ONBOARDING_NUDGE_* | title, greeting(name), body(steps), resumeCta, unsubPrefix, unsubLink, resumeUrl (`{base}/{locale}{nextStep.ctaHref ?? default}`), unsubUrl (HMAC token), rtl | ICU plural on `steps` |
| EMAIL_AGENT_* | LLM output (no contract) | dead |

## 5 · Nullability / fallback matrix worth designing for
- **Empty customer name** — welcome/magic-link handle it ("Bonjour,"); rail templates would print "Bonjour ," (callers usually substitute the email address, which then appears as the greeting name).
- **Empty items** — order confirmation/new order print the reference + total with no lines.
- **No restaurant relation** — "votre restaurant".
- **No `ALERT_EMAIL`** — admin emails silently skipped (log only).
- **No typed reservation email** — public booking sends nothing to the guest; cancellations fall back to the account email or leave a traced `skipped` row.
- **Locale null** — fr; unsupported locale string — fr.
- **`depositEur` 0** — no deposit paragraph (the deposit flow itself is OUT/pilot).
- **Partial refund** — one template, boolean switch in subject/body; no "remaining" amount shown.
- **Facts table** (MONEY REVIEW) — variable row count and key names.

## 6 · Fields that exist in code but are **not** surfaced (available to a redesign without new plumbing)
`Order.fulfillmentType` label beyond pickup/delivery · `Order.pointsEarned` (credited on delivered, never mentioned) · pickup address / restaurant address (not passed) · `Reservation.guests` in confirmation ✔ already · `Claim.responseDeadlineAt` / contest window (not passed) · `Refund.remainingRefundableCents` (computed in routes, not passed) · `Operator.locale` for every rail email (only claims/nudges read it).
