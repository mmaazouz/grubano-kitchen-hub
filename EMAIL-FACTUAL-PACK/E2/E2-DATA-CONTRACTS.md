# E2-DATA-CONTRACTS — fields available to the claims / refunds / admin money emails

Formats: consumer reference `GR-XXXXXX` (`orderRef(orderId)`); money cents → recipient-locale currency (claims) or fr-FR (rail/admin); admin emails show raw ids today (`Claim.id`, `Order.id` cuid, `pi_…`, `re_…`).

## Consumer (localized ×5, `Operator.locale` null ⇒ fr, RTL ar)
| Email | Passed today | Resolved inside | Conditional | Available but NOT passed |
|---|---|---|---|---|
| CLAIM_RECEIVED | `claimId`, `consumerId`, `orderId`, `requestedAmountCents` | `{to, name, locale}` | name empty → no greeting | `Claim.reason` (missing_item · wrong_order · quality · not_delivered · other), `responseDeadlineAt`, restaurant name, photo presence |
| CLAIM_DECISION_ACCEPTED / REFUSED | `claimId`, `consumerId`, `orderId`, `decision`, `reason?`, `restaurantName?` | idem; `restaurantName` null → "Le restaurant" | reason present/absent; REFUSED adds contest sentence | `claimContestHours()` (48 default), `requestedAmountCents` |
| CLAIM_DECISION_APPROVED | idem, `refundedCents` null | idem | — | engine result (`pending`/`failed`/gated) reason — deliberately not shown |
| CLAIM_DECISION_REFUNDED | idem + `refundedCents` = **`claim.requestedAmountCents`** (route choice) | idem | — | engine `result.refund.amountCents` (the truthful figure — implementation fix T8), partial/full, points restored |
| CLAIM_DECISION_REFUSED_FINAL | idem + `reason?` | idem | reason | |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON | `orderId`, `consumerId`, `restaurantName`, `existingClaim?` | idem | `existingClaim` true → `bodyExisting` | paid amount |
| REFUND_SUCCEEDED | `to`, `customerName`, `restaurantName`, `refundedCents` (engine `amountCents`), `partial` (remaining > 0) | — | partial/full | remaining refundable cents, original paid amount, refund id (never show), who instructed (admin) |

## Admin (`ALERT_EMAIL`, FR, dense)
| Email | Fields | Notes |
|---|---|---|
| ADMIN_PAID_CANCELLATION | `orderId`, `paymentIntentId?` ("—"), `amountCents`, `restaurantName?` ("—") | add `GR-` ref (derivable from `orderId`) |
| ADMIN_GHOST_ORDER | `orderId`, `paymentIntentId`, `amountCents`, `refundsOn` | two states |
| ADMIN_STALE_PI | `kind` order/ticket, `entityId`, `paymentIntentId`, `currentPiId?` ("(aucun)"), `amountCents` | |
| ADMIN_MONEY_REVIEW | `kind` ∈ external_refund_settled_royalty · refund_failed · settlement_over_transfer · settlement_amount_drift · refund_reconciliation_incomplete; `title`; `facts` free-form key → string/number/boolean/null | design a facts table for 3–12 rows, long values (Stripe ids, French sentences under `action`) |
| ADMIN_RECONCILE_DIGEST | `count`, `sampleOrderIds[]` ≤10, `dayKey` | |
| ADMIN_STALE_CLAIM | `claimId`, `orderId`, `requestedAmountCents`, `ageHours` (floored) | |
| CRON_LEDGER_ALERT (text) | `SITE_URL`, window ISO ×2, `internalOk`, `reconciliationOk`, `refundsOk`, `ledgerCount/stripeCount`, `ledgerSum/stripeSum`, `ecarts`, JSON ≤ 8 KB | text-only today |

## Idempotency
`claim_<event>` / `claim:<id>` (one email per decision) · `order_cancelled` / `order:<id>` shared with E1 cancellations (one cancellation email per order) · `refund_confirmation` / `order:<id>:<cents>` (deposit route: none) · admin: `order:<id>`, `pi:<id>`, `claim:<id>` once ever, `reconcile:<day>`, `admin_money_review_<kind>` / caller key.
