# EMAIL-TRUTHFULNESS-REGISTER — unsupported or wrong statements in current copy (no rewrite here)

> P0 = false statement about money, safety or a promise the product cannot keep on a **reachable** email · P1 = misleading/unsupported on a reachable email, or P0-class wording on a gated email · P2 = precision, register, hygiene. Reachability per `EMAIL-MANIFEST.md`. Findings are about the **current** copy/code; the design contract (`EMAIL-DESIGN-SYSTEM-FACTS.md §7`) forbids re-introducing them.

| # | Sev | Email (status) | Statement (verbatim) | Why unsupported | Evidence |
|---|---|---|---|---|---|
| T1 | **P0** | CONSUMER_ORDER_ENROUTE (A) | "votre commande … est en route — elle arrive bientôt !" | Delivery is OUT of beta; the `picked_up` transition is allowed from `ready` for **any** fulfillment type, so a pickup order marked `picked_up` emails a delivery promise + an implicit ETA. | `orders/[id]/status/route.ts:17-25`, `transactional-emails.ts:245-250` |
| T2 | **P0** | CONSUMER_ORDER_CONFIRMATION / READY / COMPLETED delivery variants (A, code path) | "Livraison — votre commande arrive chez vous." · "prête et part bientôt en livraison" · "livrée" | Delivery OFF (`DELIVERY_FULFILLMENT_ENABLED` effective false); wording reachable only if an order has `fulfillmentType==='delivery'` — the checkout does not offer it, so exposure is low but the code path is live. | `:732-734`, `:241-243`, `:253-255` |
| T3 | **P1** | CONSUMER_WELCOME (A) | "Tu peux commander, **réserver une table** et suivre tes points fidélité depuis ton espace." | Table reservation (« sur place ») is OUT of the closed beta. | `auth/register/route.ts:46-47` |
| T4 | **P1** | CONSUMER_WELCOME (A) | CTA « Découvrir les restaurants » → `https://grubano.com/eat` | Hardcoded **production** URL — a staging beta tester is sent to production. | `:49` |
| T5 | **P1** | PARTNER_NEW_ORDER (A) | (absence) — the restaurant is notified only if the consumer's browser polls `/confirm`; the server backstop has **no active scheduler**. | A paid order can exist with the restaurant never emailed (tab closed before the webhook). Not a copy lie, but the email family's implicit promise ("you'll be notified") is not guaranteed. | `lib/order-email-sweep.ts:3-9`, `cron.yml:13-14`, `main` = Lovable tree |
| T6 | **P1** | REFUND_SUCCEEDED (B, gated) | "un remboursement … vient d'être effectué **par {resto}** sur votre moyen de paiement." | Refunds are admin-only (Q3); the restaurant never refunds. Wrong actor. | `:706-709`; `lib/refund-route-guard.ts` |
| T7 | **P1** | REFUND_SUCCEEDED (B) | "Le délai bancaire est de 5 à 10 jours ouvrés selon votre banque." | No product source; Stripe gives indicative ranges, not a guarantee. Unsupported banking delay. | `:710` |
| T8 | **P1** | CLAIM_DECISION_REFUNDED (B) | "un remboursement de **{euros}** a été émis" with `euros = claim.requestedAmountCents` | The engine may refund a different (partial) cash amount; the arbitrate route passes the **requested** amount, not `result.refund.amountCents`. Amount may be wrong. | `admin/claims/[id]/arbitrate/route.ts:67-77`, `claim-emails.ts:248` |
| T9 | **P1** | CONSUMER_ORDER_CANCELLED_GENERIC (A) | "Pour toute question, contactez directement le restaurant." | For a **paid** order the route now sends the paid-off variant, so this generic text reaches unpaid cancellations only — correct today; flagged because the generic template would be wrong if the branch order changed. Keep the guard. | status route `:227-267` |
| T10 | **P1** | CONSUMER_NOSHOW_PENALTY_CHARGED (B, unreachable) | "Conformément aux conditions annoncées lors de la réservation, l'empreinte de garantie a été débitée." + "contestation recevable pendant 30 jours" | The confirmation email no longer announces any penalty (V4-1 removed it) → "conditions annoncées" would be false; the 30-day window has no product rule behind it. Flag OFF; part of the reactivation checklist. | `:845-847`, `:516-526`, `flags.md` PUNITIVE |
| T11 | **P1** | CONSUMER_RESERVATION_CONFIRMED_DEPOSIT (A, product OUT) | "Une empreinte bancaire temporaire de X € **peut être demandée** … elle reste active jusqu'au paiement de l'addition et est libérée automatiquement." | Conditional wording is honest; "libérée automatiquement" depends on the ticket-close/webhook release path (payments state: real money, Stripe TEST). Acceptable but product is OUT of beta. | `:527-530` |
| T12 | **P1** | AUTH_MAGIC_LINK_WITH_OTP (B) | "Ce lien et ce code sont valables 15 minutes" | Code TTL is **10 minutes** (`OTP_TTL_MS`); link 15. Over-states code validity. | `magic-link/route.ts:94`, `lib/email-otp.ts:27` |
| T13 | **P1** | AUTH_MAGIC_LINK / partner register UI message (A) | "un lien de connexion vient d'être envoyé" | False when `SMTP_PASS` is unset (link logged, not sent). Config-dependent, not copy — recorded so the design does not harden the promise. | `:163-168` |
| T14 | **P1** | ADMIN_GHOST_ORDER (A) | "Un remboursement automatique a été émis via le moteur royalty-aware (à vérifier)." (when `refundsOn`) | Written before the refund result is known; the engine may answer pending/failed. Admin-facing, but it asserts a money movement. | `lib/admin-alerts.ts:33-35` |
| T15 | **P2** | AUTH_PASSWORD_RESET (A) | link `…/fr/eat/reset-password?token=&email=` | Email address in the query string; locale hardcoded `/fr/`. Privacy/i18n hygiene. | `forgot-password/route.ts:77-79` |
| T16 | **P2** | CONSUMER_WELCOME, PARTNER_EMAIL_VERIFY (A) | `${name}` interpolated | Not HTML-escaped (XSS-in-email hygiene; names are validated length-only). | `register:45`, `partners/register:162` |
| T17 | **P2** | OPERATOR_SUPPLIER_PURCHASE_ORDER (A) | "Référence commande : {order.id}" · "Livraison estimée sous {leadTime}" · `€41.40` | Raw DB id as reference; supplier-entered free text presented as an estimate; English money format. | `suppliers/orders/route.ts:112-118` |
| T18 | **P2** | Every rail email (A) | "vous pouvez y répondre si besoin" / "répondez à cet email" | No Reply-To; replies go to `contact@grubano.com` — supported only if that mailbox is monitored (ops fact, NOT MEASURED). | `:69` |
| T19 | **P2** | PARTNER_ACCOUNT_VALIDATED (A) | "votre établissement" · "Vous pouvez dès maintenant accéder à votre espace." (no link) | Lexicon forbids « établissement »; CTA-less action sentence. | `:352,:369-370` |
| T20 | **P2** | ACCOUNT_EMAIL_CHANGED_ALERT (B) | "contactez-nous immédiatement" | No contact channel given in the email. | `:478` |
| T21 | **P2** | CLAIM_DECISION_REFUSED (B) | "Vous pouvez la contester depuis le suivi de votre commande — Grubano arbitrera." | Contest window (48 h default) not stated; consumer learns the deadline nowhere. | `messages/fr.json claimEmails.refused.contest`, `lib/claims.ts:48` |
| T22 | **P2** | Register mix (A) | tu / vous | 3 emails tutoient (magic link, welcome, partner verify) vs vous elsewhere. | copy inventory §K |
| T23 | **P2** | CONSUMER_ORDER_COMPLETED (A) | "Un avis sur votre expérience aiderait beaucoup le restaurant — vous pouvez le partager depuis votre espace." | No link; loyalty points just credited are not mentioned (missed truthful information, not a lie). | `:256` |
| T24 | **P2** | Dead EMAIL_AGENT_* (D) | promo code 15 % 48 h; "bilan de la semaine" | Code never persisted; digest without metrics — LLM hallucination risk. Dead (unscheduled), listed so nobody revives the copy. | `email-agent/route.ts:76-86, :191-197` |

## Reference-exposure audit (canonical `GR-XXXXXX`)
- ✔ All consumer/partner **order** emails use `orderRef()` (`GR-XXXXXX`), including claims and paid-cancellation variants.
- ✘ Admin alerts expose raw `orderId` / `claimId` / `pi_` (acceptable for admin, but a `GR-` ref alongside would help reconciliation).
- ✘ OPERATOR_SUPPLIER_PURCHASE_ORDER exposes raw `SupplierOrder.id` as the customer-facing reference.
- ✔ Reservations use the `#XXXX` session code (separate namespace, by design).

## Absent statements that would be **true** and are missing (informational, not defects)
Pickup address / restaurant address on ready-for-pickup · order items on status emails (only on confirmation) · loyalty points earned on completion · contest deadline on refusal · support channel on security alerts.

## Blockers summary
- **P0 EMAIL BLOCKERS (reachable today):** T1 (en-route promise on pickup), T2 (delivery wording live in code while delivery OFF).
- **P1 EMAIL BLOCKERS:** T3, T4, T5, T6, T7, T8, T10, T12, T13, T14.
