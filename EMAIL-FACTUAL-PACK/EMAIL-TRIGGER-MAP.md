# EMAIL-TRIGGER-MAP — event → condition → code path → send → recipient → template → provider

> All chains read first-hand on `develop` @ `d221008`. Provider is always the same: Nodemailer → SMTP `mail.grubano.com:587` (Exim, o2switch). Two rails exist:
> - **RAIL** = `lib/transactional-emails.ts` `sendTransactional()` `:124-185` (best-effort, never throws, EmailLog row, optional race-safe dedupe on `EmailDispatch @@unique([trigger,dedupeKey])`, claim released on `failed|skipped`). `sendOnce()` `:191` = the dedupe convenience. `SMTP_PASS` empty ⇒ status `skipped` (nothing sent, row written).
> - **INLINE** = a route-local `nodemailer.createTransport` + `sendMail` (7 sites): magic-link, register (welcome), step-up code, email-change code, partners/register (verify), suppliers/orders, email-agent. No dedupe; EmailLog only where stated.
>
> **Golden rule (test-guarded):** the Stripe webhook imports **no** consumer/restaurant sender; only `lib/admin-alerts.ts` (admin) may fire from the webhook.

## Legend for the chains
`EVENT → CONDITION → CODE PATH → SEND CALL → RECIPIENT → TEMPLATE → skip / failure / retry / duplicate guard`

---

## AUTH / ACCOUNT

**AUTH_MAGIC_LINK** — `POST /api/auth/magic-link {email, locale?, space?}` → rate-limit `auth_magic_link` 5/10 min (only if `RATE_LIMIT_ENABLED`) → `operator.findUnique(email)` and `status==='active'` → mint token (hash+15 min expiry stored on Operator) → optional OTP code if `AUTH_EMAIL_OTP_ENABLED` → `sendMagicEmail()` inline `:107` → **to** = normalized body email → HTML + text. **Skip:** unknown/inactive account (generic 200, nothing sent); `SMTP_PASS` missing (link logged masked, not sent). **Failure:** caught, generic 200 (never 500). **Retry:** none (user re-requests; each request re-mints, invalidating the previous token). **Dup guard:** none (legitimate repeats).

**AUTH_PASSWORD_RESET** — `POST /api/auth/forgot-password {email, space?}` → rate-limit 5/10 min → account has `password` → purge + create `VerificationToken` (sha256, 1 h) → `sendPasswordResetEmail()` RAIL (no dedupe) → **to** `operator.email`. Skip: passwordless/unknown account (same 200). Failure: rail best-effort; route still 200. Retry: user. Dup: none by design.

**AUTH_PASSWORD_CHANGED** — `POST /api/auth/reset-password {token,email,password}` → token valid → `operator.update(password)` → delete all tokens → `sendPasswordChangedEmail()` RAIL (no dedupe). Always after the commit.

**CONSUMER_WELCOME** — `POST /api/auth/register {name,email,password}` → rate-limit 10/10 min → no existing operator → bcrypt(12) → `operator.create(role consumer, status active)` → loyalty upsert (best-effort) → inline `sendWelcomeEmail()` `:58` → own `emailLog.create({trigger:'consumer_welcome', status})`. Skip: `SMTP_PASS` missing → `skipped` row. Failure: `failed` row, 201 still returned. Dup: impossible (email unique).

**AUTH_STEPUP_CODE** — `POST /api/auth/step-up/request {purpose}` → **gate** `AUTH_MONEY_STEPUP_ENABLED` else 404 → session required → `issueEmailOtp(email,purpose)` (throttle 5 / 10 min → 429) → inline `sendStepUpEmail()` `:47`. Skip: `SMTP_PASS` missing (logged). Failure: 500. No EmailLog. Dup: deliberately none (codes must always deliver).

**ACCOUNT_EMAIL_CHANGE_CODE** — `POST /api/account/email-change/request-code` → **gate** `AUTH_EMAIL_CHANGE_ENABLED` → session → eligibility (email-keyed partner roles / OAuth refused 403) → `issueEmailOtp(currentEmailFromDB,'stepup:email_change')` → inline `sendCode()` `:44`. Same skip/failure profile as step-up.

**ACCOUNT_EMAIL_CHANGE_LINK / ALREADY_USED** — `POST /api/account/email-change/request {newEmail, currentEmailCode}` → gate → session → `verifyEmailOtp` (400 if wrong) → same-address 400 → MX check of new domain (400) → `operator.findUnique(newEmail)`: **exists** ⇒ `sendEmailAlreadyUsedNotice({to:newEmail})` RAIL sendOnce key `email_change_taken:<email>` (once ever per address) + generic 200 · **free** ⇒ `setPendingEmail` (token 15 min) → `sendEmailChangeLink()` RAIL sendOnce key `email_change_link:<sha256(token)>` (a re-request mints a new token ⇒ re-sends). `.catch(()=>{})` on both.

**ACCOUNT_EMAIL_CHANGED_ALERT + CONFIRM** — `POST /api/account/email-change/confirm {token}` → gate → `consumeEmailChange` (atomic) → after commit: `sendEmailChangedAlert({to: oldEmail})` key `email_changed:<old>-><new>` and `sendEmailChangeConfirm({to:newEmail})` key `email_change_done:<old>-><new>`. Best-effort, cannot roll back.

## CONSUMER ORDER

**CONSUMER_ORDER_CONFIRMATION + PARTNER_NEW_ORDER** — Stripe webhook `payment_intent.succeeded` flips `Order.paymentStatus='paid'` (emits **no email**) → the checkout screen polls `POST /api/orders/[id]/confirm` (session owner, 401/404 otherwise) → `paymentStatus==='paid'` else `{emailSent:false}` (UI retries) → **(1)** owner email via `order.restaurant.operator.email` → `sendRestaurantNewOrderEmail()` sendOnce `resto_order_received`/`order:<id>` (placed BEFORE the consumer short-circuit so a re-poll keeps retrying it) → **(2)** consumer `operator.findUnique(consumerId).email` (missing ⇒ `{emailSent:false}`) → `emailDispatch.findFirst` cosmetic pre-check → `sendOrderConfirmation()` sendOnce `order_confirmation`/`order:<id>`. **Backstop:** `POST /api/admin/orders/confirm-sweep` (X-Internal-Token or admin) → `sweepUnconfirmedPaidOrders()` scans `paymentStatus:'paid', status≠'expired', updatedAt ≥ now−48 h, take 100`, same senders/keys ⇒ idempotent. **Scheduler:** `cron.yml` sweep every 20 min — **inert** (default branch `main` lacks the workflow; measured 2026-09-05). **Consequence:** if the consumer closes the tab before the webhook, neither email goes out until an admin runs the sweep. Skip: no owner email (warn) / no consumer email. Failure: `[EMAIL MISS]` + `failed` row + claim released.

**CONSUMER_ORDER_{ACCEPTED,READY,ENROUTE,COMPLETED,CANCELLED_*}** — `PATCH /api/orders/[id]/status {status}` (restaurant owner of the order, or admin) → `TRANSITIONS` (`received→preparing|cancelled`, `preparing→ready|cancelled`, `ready→picked_up|delivered|cancelled`, `picked_up→delivered`) → `order.update` (+ loyalty earn on `delivered`) → email block (best-effort try/catch, after the update):
- `paidCancellation` (= cancelled ∧ paid ∧ `CLAIMS_ENABLED` ∧ amount>0) ⇒ `sendOrderCancelledPaidEmail()` (claims ON) — **not reachable in beta**;
- else `paidCancelled ∧ !claimsOn` ⇒ `sendOrderCancelledPaidOffEmail()` (localized, `order_cancelled`/`order:<id>`);
- else `consumer.email` ⇒ `sendOrderStatusEmail({status:newStatus, fulfillmentType})` → trigger `order_<accepted|ready|enroute|delivered|cancelled>` / `order:<id>`; `received` ⇒ skipped no-op.
Then, **independent of flags**, `paidCancelled` ⇒ `sendAdminPaidCancellationAlert()` (ALERT_EMAIL). Dup guard: distinct triggers share `order:<id>` under `@@unique([trigger,dedupeKey])` ⇒ exactly one email per status per order; a repeated PATCH to the same status is rejected by TRANSITIONS anyway.

## RESERVATIONS (« sur place », OUT of beta, routes not flag-gated)

**CONSUMER_RESERVATION_CONFIRMED + PARTNER_NEW_RESERVATION** — `POST /api/reservations/public` (public; restaurant exists & bookable) → `reservation.create(status confirmed, depositAmount server-side)` → if `data.email` ⇒ `sendReservationConfirmation({depositEur, code:reservationCode(id)})` sendOnce `resv:<id>` → then owner email ⇒ `sendRestaurantNewReservationEmail({customerName: maskCustomerName})` sendOnce `resto_reservation_received`/`resv:<id>`. Skip: no typed email (guest gets nothing; **no account fallback here**). Dashboard `POST /api/reservations` sends **nothing**.

**CONSUMER_RESERVATION_CANCELLED_BY_CLIENT + PARTNER_…_BY_CLIENT** — `POST /api/reservations/[id]/cancel` (consumer `userId` owner) → status cancelled (+ `releaseHold` if a PI exists) → `resolveReservationRecipient(reservation)` (typed email → account email) ⇒ `sendReservationCancelledByClientToClient()` `resv:<id>`, else `logEmailSkipped('reservation_cancelled_by_client_client')` traced row → owner email ⇒ `sendReservationCancelledByClientToOwner()` `resv:<id>`.

**CONSUMER_RESERVATION_CANCELLED_BY_OWNER** — `PATCH /api/reservations {id, status:'cancelled'}` (operator scope) → release hold → update → `resolveReservationRecipient` ⇒ `sendReservationCancelledByOwner()` `resv:<id>` else traced skip.

**CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE** — `POST /api/restaurants/[id]/closures {from,to,reason}` → loop over affected reservations → each `update(cancelled, cancelReason 'closure')` → recipient ⇒ `sendReservationCancelledByClosure({closureReason: public reason})` `resv:<id>` else traced skip. Per-reservation try/catch; errors collected.

**CONSUMER_NOSHOW_PENALTY_CHARGED** — `PATCH … status:'noshow'` or `POST /api/reservations/[id]/deposit/capture` → `captureHold()` → **refused 403 while `PUNITIVE_CAPTURE_ENABLED` is OFF** (`lib/deposit.ts:71`) ⇒ `capturedCents` null ⇒ **no email**; PATCH path releases the hold instead. When ON: `reservation.email` ⇒ `sendNoShowPenaltyCharged()` `resv:<id>`.

## PARTNER LIFECYCLE

**PARTNER_EMAIL_VERIFY + ADMIN_PARTNER_PENDING(restaurant)** — `POST /api/partners/register` → host must be `business.grubano.com` (else 404) → per-IP rate limit (429) → validation → existing email ⇒ anti-enum generic OK (**no emails**) → `operator.create(role restaurant, status pending, verifyToken hash 24 h)` → inline `sendVerificationEmail()` (own EmailLog `partner_verify` sent|failed|skipped) → RAIL `sendAdminNewPartnerEmail({role:'restaurant'})` sendOnce `admin_partner_pending`/`restaurant:<operatorId>` (skipped when `ALERT_EMAIL` empty) → generic OK.

**ADMIN_PARTNER_PENDING(supplier)** — `POST /api/supplier/register` → **gate `SUPPLIER_ENABLED`** (404) → SIREN vetting → only when resulting `status==='pending'` ⇒ sendOnce `supplier:<profileId>`. **(influencer)** — `POST /api/affiliate/verify-request` → **gate `INFLUENCER_ENABLED`** → `createVerificationRequest` ok ⇒ sendOnce `influencer:<operatorId>:<YYYY-MM-DD>`. **(logistics)** — see courier.

**PARTNER_ACCOUNT_VALIDATED / REJECTED** — restaurant: `POST /api/admin/restaurants/[id]/approve` (admin) → `restaurant.update(isActive, approvedAt once)` → owner email ⇒ `sendPartnerStatusEmail({role:'restaurant', status:'validated', dedupeScope:'resto:<id>'})` (once per restaurant, re-approve = duplicate). Supplier: `PATCH /api/supplier/admin/status` (**gate `SUPPLIER_ENABLED`**, admin) → only on an actual change to `active|rejected` ⇒ validated (`supplier:<id>`) / rejected (`supplier:<id>:<day>`). Influencer: `POST /api/admin/influencer-verifications` (**gate `INFLUENCER_ENABLED`**) → `decideVerification` ok ⇒ validated/rejected (`affiliate:<operatorId>`). **No restaurant-rejection route** and **no `docs_needed` caller** exist.

**COURIER_WAITLIST_CONFIRMATION + ADMIN_PARTNER_PENDING(logistics)** — `POST /api/logistics/register` → **gate `LOGISTICS_SIGNUP_ENABLED` (or `LOGISTICS_ENABLED`)** else 404 → honeypot / <2 s / duplicate email ⇒ generic OK, **no email** (anti-enum) → vetting → `logisticsProfile.create` → if `status!=='rejected'` ⇒ `sendCourierWaitlistConfirmation()` sendOnce `logistics:<profileId>` + `sendAdminNewPartnerEmail({role:'logistics'})` → provision non-connectable operator. Staging: route measured **404** on 2026-09-04 (flag written false by operator v2); operator v3 writes `true` — **not measured since**.

**ONBOARDING_NUDGE_*** — `POST /api/admin/onboarding-nudges/run` → rate-limit → **gate `ONBOARDING_NUDGE_ENABLED`** else `{gated:true}` → X-Internal-Token or admin session → 6 cohorts (restaurant, affiliate, creator, supplier, prestataire, franchisor), each candidate: checklist progress → `decideNudgeLevel` (J+1/J+3/J+7, max 3, stop if complete/unsubscribed) → **claim** `onboardingNudge.create({operatorId, role, level})` (P2002 ⇒ skip) → `getTranslations(Operator.locale)` → `sendTransactional({trigger:'onboarding_nudge'})` (no dedupeKey — the claim is the guard). Unsubscribe: `GET /api/onboarding/unsubscribe?token=` (HMAC, global per operator). Scheduler: `cron.yml` daily — inert.

**OPERATOR_SUPPLIER_PURCHASE_ORDER** — `POST /api/suppliers/orders {supplierId, items, total}` (restaurant/admin scope) → `supplier.findUnique` (404) → `supplierOrder.create(pending)` → if `supplier.email && SMTP_PASS` ⇒ inline `sendMail` (**awaited, not caught**: a transport error ⇒ 500 with the order already created and left `pending`) → `supplierOrder.update(status 'sent')`. No EmailLog, no dedupe.

**CREATOR_DISH_ADOPTED** — `POST /api/dishes/adopt` (restaurant) → adoption transaction (unique) → `creator.email` ⇒ `sendDishAdoptedToCreator({royaltyPct from AdoptionConfig})` RAIL (no dedupe; adoption unique upstream). Best-effort.

**PARTNER_WAITLIST_OFFER** — `sweepAndPromote(creatorDishId, city)` from `POST /api/dishes/waitlist/accept|decline` and `/api/dishes/withdraw` → next waitlist row → `update(status 'offered', offerExpiresAt = now + WAITLIST_OFFER_TTL_HOURS)` → `brand.operator.email` ⇒ `sendWaitlistOfferToRestaurant()` RAIL (no dedupe; promotion atomic).

## CLAIMS (all behind `CLAIMS_ENABLED`; consumer emails localized ×5)

**CLAIM_RECEIVED** — `POST /api/claims` → **gate** (403 gated) → session → `createClaim` (owner, window 48 h, amount ≤ total, one active per order) → `autoResolveSmallClaim` (triple-locked OFF in beta) → `sendClaimAckEmail()` → `resolveConsumer` (`operator.findUnique` email/name/locale; none ⇒ `logEmailSkipped('claim_ack', reason no_recipient)`) → `sendTransactional` `claim_ack`/`claim:<id>`. Then if auto-resolution returned `refunded|pending` ⇒ `sendClaimDecisionEmail(refunded|approved)`.

**CLAIM_DECISION_ACCEPTED / REFUSED** — `POST /api/claims/[id]/respond {action, reason?}` (restaurant owner) → `respondToClaim` (accept → `arbitration`, refuse → `refused`; **no money**) → restaurant name lookup → `sendClaimDecisionEmail({decision: accepted|refused, reason, restaurantName})` `claim_decision_<d>`/`claim:<id>`.

**CLAIM_DECISION_APPROVED / REFUNDED / REFUSED_FINAL** — `POST /api/admin/claims/[id]/arbitrate {decision: approve|refuse_final, reason?}` (admin) → `arbitrateClaim` (approve ⇒ `triggerClaimRefund` ⇒ engine `executeRefund`, itself gated `REFUNDS_ENABLED`) → audit → `refunded = result.refund?.state==='refunded'` ⇒ decision `refunded` (amount = **claim.requestedAmountCents**) · approve without succeeded refund (pending/failed/gated) ⇒ `approved` (no amount) · refuse_final ⇒ `refused_final`.

**ADMIN_STALE_CLAIM** — `GET /api/admin/claims/stale-alerts` → rate-limit → `isClaimsEnabled()` else `{enabled:false}` → token/admin → claims `restaurant_review` past `responseDeadlineAt` ⇒ `sendAdminStaleClaimAlert()` sendOnce `admin_stale_claim`/`claim:<id>` (once ever, no daily reminder).

## REFUNDS (engine behind `REFUNDS_ENABLED`, OBSERVED false on staging 2026-09-04)

**REFUND_SUCCEEDED** — four routes, same regime `rateLimit → isRefundsEnabled() (403 gated) → auth (admin session / internal token) → refund`:
- `POST /api/admin/refunds/run {orderId, amountCents?}` → `executeRefund` → `result.pending` ⇒ **202, audit `pending:true`, NO email** → succeeded ⇒ audit → `consumer.email` ⇒ `sendRefundConfirmation({refundedCents: result.amountCents, partial: remaining>0, dedupeKey:'order:<id>:<cents>'})`.
- `POST /api/orders/[id]/refund` (admin only since P0-03) → same engine, same pending branch, same email/key.
- `POST /api/tickets/[id]/refund` → rail A `refundPayment` → email only if `ticket.reservationId` and `reservation.email`, key `ticket:<id>:<cents>`.
- `POST /api/reservations/[id]/refund-deposit` → rail A full refund → `reservation.email` ⇒ email **without dedupeKey**.
Stripe `refund.updated`/`refund.failed` webhook branches finalize rows and raise **admin** MONEY REVIEW only — **no consumer email on late success or failure** (decision D-F).

## ADMIN / INTERNAL

**ADMIN_PAID_CANCELLATION** — see status route; `ALERT_EMAIL` empty ⇒ skipped; key `order:<id>`.
**ADMIN_GHOST_ORDER** — webhook `payment_intent.succeeded` on `status==='expired'` order → mark `reconcile_manual` or auto-refund (`GHOST_ORDER_AUTO_REFUND_ENABLED`) → alert key `order:<id>`.
**ADMIN_STALE_PI** — webhook: succeeded PI ≠ current PI of its order/ticket → ledger line written, confirmation refused → alert key `pi:<id>`.
**ADMIN_MONEY_REVIEW** — webhook `charge.refunded` (Stripe refund list unavailable ⇒ `refund_reconciliation_incomplete`, 503 fail-closed; external refund on settled royalty ⇒ `external_refund_settled_royalty`), `refund.updated|failed` (`refund_failed`), `lib/refund.markRefundRowFailed` (`refund_failed`), `lib/franchise-settlement` (`settlement_amount_drift`, `settlement_over_transfer` — rail OFF). Each: `console.error('[MONEY REVIEW] …')` first, then sendOnce `admin_money_review_<kind>`/caller key.
**ADMIN_RECONCILE_DIGEST** — `GET /api/admin/reconcile-ghost-orders` (token/admin) → orders `expired ∧ paid|reconcile_manual` → if any ⇒ digest key `reconcile:<day>`.
**CRON_LEDGER_ALERT** — cPanel `0 7 * * *` → script loads `.env.local` → `GET /api/admin/ledger/check` (X-Internal-Token) → `ok:false` ⇒ text mail to `ALERT_EMAIL` (no ALERT_EMAIL ⇒ log-only, exit 1).
**CRON_CREATOR_EARNINGS_RECAP** — cPanel `30 6 * * *` → `POST /api/admin/creator-earnings/mature` → `matured+cancelled>0 ∧ ALERT_EMAIL` ⇒ text mail.
**CRON_MONTHLY_INVOICES_RECAP** — cPanel `0 8 1 * *` → `POST /api/admin/invoices/generate` → `ALERT_EMAIL` ⇒ text recap.

## DEAD — `POST /api/email-agent` (Bearer `CRON_SECRET`, **unscheduled**)
4 LLM-written sends (`inactive_14d` 7-day window via `emailLog.findFirst`; `milestone_<n>` once; `dish_approved_<id>` once; `weekly_digest` Monday 08h server-time, 6-day window). Not race-safe, no consent, no unsubscribe. Founder decision P0-07 removed the scheduler; the route remains callable.

## Cross-cutting failure semantics
- RAIL: never throws; `SMTP_PASS` empty ⇒ `skipped` (silent for the user, row + `[EMAIL MISS]` log); transport error ⇒ `failed` row; dedupe claim released so a later retry re-sends. **No automatic retry / queue anywhere** — every send is synchronous inside the request.
- INLINE: magic-link/register/step-up/email-change-code/partner-verify catch and degrade; **suppliers/orders does not** (500).
- No bounce / complaint / unsubscribe handling exists except the nudge HMAC unsubscribe. No delivery-status observability beyond `EmailLog.status` (no messageId, no error text stored).
