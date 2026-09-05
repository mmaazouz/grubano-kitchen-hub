# EMAIL-CLAIMS-REFUNDS-FACTS — what is WIRED, what is PRODUCT-CONFIRMED, what is only a PROPOSAL

> Facts as of `develop` @ `d221008` (Phase 2 refund rail merged `4ce8f53`; Claims module built, gated OFF). Sources: `lib/claims.ts`, `lib/claim-emails.ts`, `lib/refund.ts`, `lib/admin-alerts.ts`, the 4 refund routes, `docs/ops/REFUND-FINANCIAL-CONTRACT.md` (§8 D-F), `docs/ops/POST-BETA-CLAIMS-BACKLOG.md` (D4), `docs/ops/BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md`, Notion inbox 2026-09-04 (flag measurements).
>
> **Before Claude Code implements E2, this file must be refreshed against the final Claims/Refund code** (Phase 3 not started).

## 0 · Locked product facts (founder decisions — the design must never contradict them)

| Fact | Status | Source |
|---|---|---|
| Consumer cannot refund; restaurant cannot refund. Every refund = **admin** action (`requireRefundAdmin`, Q3). | LOCKED, wired | `lib/refund-route-guard.ts`, P0-03 |
| Claim ≠ Refund. A restaurant **accepting** a claim moves **no money** → the claim goes to Grubano arbitration. | LOCKED, wired (P0-24) | `lib/claims.ts respondToClaim`, backlog doc |
| Admin resolutions: **refuse_final** (no refund) · **approve** → engine refund (partial or full: the engine derives the cash amount ≤ captured; a claim's `requestedAmountCents` is the requested amount). | LOCKED, wired | `arbitrateClaim`, `executeRefund` |
| `CLAIMS_ENABLED=false` for the **whole closed beta** (D4). Human escalation = support mailbox `contact@grubano.com` + admin alert on every paid cancellation + `/admin/reconciliation` queue. | LOCKED (beta) | `POST-BETA-CLAIMS-BACKLOG.md` |
| `REFUNDS_ENABLED` — technical freeze. OBSERVED staging **false** (`POST /api/admin/refunds/run {}` → 403 `{gated:true}`, 2026-09-04 post-delivery). Operational freeze active; rehearsal not authorized. | LOCKED (freeze) | Notion 2026-09-04 |
| Refund wording follows the **Stripe status**: `pending` ⇒ 202, **no email**; `failed` ⇒ row `failed`, cursor released, **admin** MONEY REVIEW, **no consumer email**; only `succeeded` ⇒ « Remboursement effectué ». | LOCKED (D-F), wired | `REFUND-FINANCIAL-CONTRACT.md §8`, routes `:85-104` |
| Allergen/safety claims: no dedicated code path exists (claim `reason ∈ missing_item \| wrong_order \| quality \| not_delivered \| other`). No safety escalation email exists. | NOT PRODUCT (proposal space) | `prisma Claim.reason` comment |
| No auto-refund without a human: `CLAIMS_AUTO_APPROVE_ENABLED` OFF and unscheduled (P0-07), `CLAIM_AUTO_RESOLVE_ENABLED` OFF + cap 0 (P0-27), `GHOST_ORDER_AUTO_REFUND_ENABLED` separate. | LOCKED | `flags.md` |

## 1 · CURRENTLY WIRED (code + send call + recipient + template) — all behind a flag today

| Email | Trigger (exact) | Recipient | Reachable today | Amount shown | Wording facts |
|---|---|---|---|---|---|
| CLAIM_RECEIVED | `POST /api/claims` 201 | consumer (`Operator.email`, locale) | **NO** (`CLAIMS_ENABLED` false → 403) | **requested** amount | "Nous avons bien reçu votre réclamation sur la commande {ref} (montant demandé : {euros}). Vous serez informé(e) par email dès qu'une décision sera prise." |
| CLAIM_DECISION_ACCEPTED | restaurant `respond accept` | consumer | NO | none | "{resto} a accepté votre réclamation … Elle est transmise à Grubano pour décision de remboursement." — truthful post-P0-24 |
| CLAIM_DECISION_REFUSED | restaurant `respond refuse` | consumer | NO | none | + optional reason + "Vous pouvez la contester depuis le suivi de votre commande — Grubano arbitrera." (contest window `CLAIM_CONTEST_HOURS` default 48 h — **not stated** in the email) |
| CLAIM_DECISION_APPROVED | admin `approve` with refund **pending / failed / gated** | consumer | NO | none | "Grubano a tranché en votre faveur sur la commande {ref}." — no promise, no delay ✔ |
| CLAIM_DECISION_REFUNDED | admin `approve` with `refund.state==='refunded'` | consumer | NO (needs CLAIMS **and** REFUNDS) | `claim.requestedAmountCents` | "un remboursement de {euros} a été émis … vers votre moyen de paiement." ⚠️ amount = **requested**, not the engine's actual `amountCents` (they coincide only when the admin refunds exactly the requested amount — the arbitrate route does not pass `result.refund.amountCents`). |
| CLAIM_DECISION_REFUSED_FINAL | admin `refuse_final` | consumer | NO | none | "…a confirmé le refus. Cette décision est définitive." |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON | paid order cancelled with claims ON (system claim) | consumer | NO | none | "Une demande de remboursement a été transmise à Grubano. Elle sera examinée par un membre de l'équipe…" (+ `bodyExisting` when a claim was already active) |
| **CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF** | paid order cancelled with claims **OFF** | consumer | **YES — this is the live beta email** | none | "Pour le remboursement du montant payé, contactez notre support : contact@grubano.com (ou répondez simplement à cet e-mail) — chaque demande est traitée par un membre de l'équipe pendant la bêta. Indiquez la référence {ref}." — truthful ✔ |
| REFUND_SUCCEEDED (full/partial) | 4 admin refund routes, **Stripe `succeeded` only** | consumer / guest | **NO** (403 gated) | engine `result.amountCents` | ⚠️ "vient d'être effectué **par {resto}**" — the actor is Grubano admin, never the restaurant; ⚠️ "Le délai bancaire est de 5 à 10 jours ouvrés selon votre banque" — unsupported figure (Stripe: typically 5–10 business days for cards, but not guaranteed; no source in product). |
| ADMIN_STALE_CLAIM | `GET /api/admin/claims/stale-alerts` (token/admin) | ALERT_EMAIL | NO (claims OFF; scheduler inert) | requested | admin-facing, raw ids |
| ADMIN_PAID_CANCELLATION | paid order cancelled (any flag state) | ALERT_EMAIL | **YES** | paid amount | "Aucun remboursement automatique n'a été déclenché … à instruire via l'outil admin." |
| ADMIN_MONEY_REVIEW `refund_failed` | Stripe `refund.failed`/`refund.updated` failed, or engine finalize | ALERT_EMAIL | **YES** (webhook; an external Dashboard refund exercises it) | facts table | "Aucune action automatique n'a été prise. Décision humaine requise (contrat Phase 2, §13.3)." |
| ADMIN_MONEY_REVIEW `refund_reconciliation_incomplete` / `external_refund_settled_royalty` | webhook `charge.refunded` | ALERT_EMAIL | YES (webhook) | facts | idem |
| ADMIN_MONEY_REVIEW `settlement_*` | franchise settlement | ALERT_EMAIL | NO (franchise rail OFF) | facts | idem |
| ADMIN_GHOST_ORDER · ADMIN_STALE_PI · ADMIN_RECONCILE_DIGEST | webhook / admin GET | ALERT_EMAIL | YES / YES / manual | amounts | reconciliation queue wording |

Idempotency in this family: `claim_<event>` / `claim:<id>` (exactly one email per decision, replays = duplicate); `order_cancelled` / `order:<id>` shared by the 3 cancellation variants (one cancellation email per order whatever the path); `refund_confirmation` / `order:<id>:<cents>` (a second refund of the **same** amount is deduped — documented intentional; the deposit route passes no key).

## 2 · PRODUCT CONTRACT CONFIRMED — email **not** wired (design against the contract, do not claim LIVE)

| Contract fact | Email that would follow | Status |
|---|---|---|
| Refund `pending` at Stripe → the customer has **not** been refunded; row stays `pending`; finalized later by RESUME-FIRST or `refund.updated`. | *(no email by decision D-F)* — an optional neutral "remboursement en cours de traitement" is **not** part of the contract. | PRODUCT_CONTRACT_CONFIRMED_EMAIL_NOT_WIRED **as a deliberate non-email**. Design may propose one only as **DESIGN_PROPOSAL** and it must never say "effectué". |
| Refund `failed` → order locked, human re-transfer required. | consumer notice | same — deliberate silence toward the consumer; admin is alerted. |
| Late `succeeded` via webhook (`refund.updated`) → row finalized, ledger written, loyalty reconciled. | REFUND_SUCCEEDED | **NOT wired on the webhook path** (golden rule: no consumer email from the webhook; only RESUME-FIRST engine calls send it). Gap recorded: a refund that succeeds late never emails the consumer. |
| `refunding → refunded` claim transition when a pending refund later succeeds. | CLAIM_DECISION_REFUNDED | Phase 3 item (`§15 A7`), not wired. |
| Restaurant ignores a claim past `responseDeadlineAt` → visibility only (`stale-alerts`), no auto-approval; admin cannot act on `restaurant_review` claims. | (none) | Functional gap noted in the Phase 0 inventory — not an email fact. |

## 3 · NOT YET IMPLEMENTED / DESIGN PROPOSAL ALLOWED (explicitly not product today)

- Claim → **restaurant** notification ("nouvelle réclamation à traiter", with the response deadline) — absent (`lib/claim-emails.ts:9` scope statement: "pas de notification resto, pas d'email admin d'ouverture").
- Claim → **admin** receipt at opening — absent (only the stale alert exists).
- **Allergen / safety** escalation: no reason code, no priority path, no email. Design rules if proposed: serious tone, immediate admin visibility, no auto-refund, minimal necessary information, **no diagnosis**.
- Consumer "refund pending" / "refund failed" notices — see §2 (deliberate silence today).
- Claim contest confirmation to the consumer (`contestClaim` route exists; **no email** on contest) — absent.
- Restaurant notification of the arbitration outcome — absent.
- Refund receipt to the **restaurant** (reverse transfer) — absent.

## 4 · Wording rules for E2 (derived from the contract, binding)

1. Only Stripe `succeeded` may be phrased as "Remboursement effectué" / "émis". Pending ≠ succeeded. Failed ≠ succeeded. **Claim resolved ≠ refund succeeded** (APPROVED must not say the money moved).
2. The refunding actor is **Grubano** (admin), never "{resto} vous a remboursé" (current REFUND_SUCCEEDED gets this wrong).
3. No banking-delay figure unless the product sources one (the "5 à 10 jours ouvrés" line is unsupported).
4. Amounts: show the **engine's actual refunded cents** (`result.amountCents`), not the claim's requested amount, and label partial vs full explicitly; cash refund ≤ cash captured; loyalty-financed value is returned in **points**, never cash (Phase 1 LOYALTY-REFUND-CONTRACT).
5. Reference = `GR-XXXXXX` (`lib/order-ref.ts`); never expose `Claim.id`, `Refund.id`, `re_…`, `pi_…` to consumers (admin alerts may).
6. Claims during the beta are **OFF**: E2 consumer designs are for the post-beta activation; the only live consumer money-adjacent email in beta is CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF (support-driven wording).
7. Contest window (48 h default) may be stated only if the value is read from `claimContestHours()` at send time.

## 5 · Refresh checklist before E2 implementation
- Re-read `lib/claims.ts` state machine (`restaurant_review → arbitration|refused|approved|refunding|refunded|refused_final`) and `lib/claim-emails.ts` triggers.
- Confirm whether the arbitrate route now passes the engine amount to CLAIM_DECISION_REFUNDED.
- Confirm the `refund.updated` late-success path (still no consumer email?).
- Re-measure `CLAIMS_ENABLED` / `REFUNDS_ENABLED` on staging (SOURCE / OBSERVED / REQUIRED).
- Re-check `ALERT_EMAIL` value (operator v3 outcome).
