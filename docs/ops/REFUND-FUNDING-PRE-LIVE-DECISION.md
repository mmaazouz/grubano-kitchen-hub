# REFUND-FUNDING-PRE-LIVE-DECISION — who funds a refund when the restaurant has already been paid out

> Pre-LIVE policy file (2026-09-04, Phase 2 final hardening). **Technical facts are measured or documented; the policy choice is the founder's** — it is a COMMERCIAL condition for restaurants and later a PARTNER CONTRACT / LEGAL term. Nothing here changes Stripe LIVE, production, or any restaurant's real payout timing. No legal conclusion is drawn.

---

## 1 · The problem, measured

Grubano charges are **destination charges** with `on_behalf_of` (`lib/stripe.ts`): Stripe transfers the whole charge to the restaurant's connected account and pulls the application fee back to the platform (`REFUND-FINANCIAL-CONTRACT.md` §9.2). A refund initiated by the engine (`lib/refund.ts driveRefund`) is created with `reverse_transfer:true` + `refund_application_fee:true`: the customer is paid from the **platform** balance and Stripe **reverses** the proportional amount from the **connected account** (contract §9.2, Stripe docs).

Stripe's documented rules (verbatim, `docs.stripe.com/connect/charges` § Remboursements and `…/separate-charges-and-transfers` § Annuler les transferts):

- « Il est possible d'annuler un transfert uniquement si le solde **disponible** du compte connecté est supérieur au montant de l'annulation ou si les réserves du compte connecté sont activées. »
- « Si la demande de remboursement inclut également une tentative d'annulation de transfert, mais que le compte connecté dispose d'un solde insuffisant, la demande de remboursement **renvoie une erreur** au lieu de créer un remboursement avec le statut `pending`. »
- Failed refund on a destination charge: « le montant du remboursement ayant échoué est recrédité sur le solde Stripe de votre compte de plateforme. Créez un transfert pour envoyer les fonds vers le compte connecté, le cas échéant. » (the reversed transfer is **not** restored automatically).

Measured on the TEST rehearsal restaurant (`acct_…byyYMY`, Express FR, 2026-09-04): available **0 €**, pending **26,68 €** (two payments net 13,34 € each, `available_on` 2026-09-08 / 2026-09-09, `delay_days` 7), payout schedule was `daily` → switched to `manual` (TEST only) so cleared funds are not swept to the test bank.

**Consequence in words:** once a restaurant's funds have been paid out (or are still pending), a customer refund that tries to take the money back from the restaurant **fails at request time** — it is not queued. Today the engine reports this as a fail-safe 502 (row `pending`, resume later) and moves no money. This is a **structural** property of the current Connect architecture, not a TEST-calendar accident.

## 2 · What the code does today (facts)

- Engine: `reverse_transfer` + `refund_application_fee` always on routed charges; insufficient connected balance → Stripe error → `502` retryable, `Refund` row `pending`, RESUME-FIRST later; no partial success (contract §9.7).
- Webhook (F2 closed): the ledger books **only** Stripe's actual movements — a refund without reversal shows the platform bearing it (`netToRestaurant 0`), with a `MONEY REVIEW` line.
- Founder treasury statement (2026-09-04): **Grubano does not have treasury to routinely advance restaurant-funded refunds.** → « platform advances, recovers later » is **NOT** a default.

## 3 · Options (facts, pros, cons — no decision here)

### OPTION A — Delayed / manual restaurant payout
Keep funds on the connected account longer: `settings.payouts.schedule.delay_days = N` (Stripe minimum depends on country; FR minimum is a Stripe-set floor) or `interval = 'weekly' | 'monthly' | 'manual'` (platform triggers payouts). Supported for Express accounts via the Accounts API (`accounts.update` — used in TEST on 2026-09-04).
- Pros: refunds within the window are reversible from the restaurant's own balance; no platform treasury; ledger and Stripe stay aligned; simplest engine (unchanged).
- Cons: the restaurant receives its money later (T+N) — a **commercial** condition with treasury impact for small independent restaurants; must appear in the partner contract; a refund after the window still hits the same wall.
- Not automatic: **no production payout schedule is changed by Claude Code** — founder decision + contract.

### OPTION B — Platform advances the customer refund
Refund without `reverse_transfer` (customer paid from platform balance), recover from the restaurant later (offset against future sales, or a later `transfers.createReversal` once balance exists).
- Pros: fastest customer experience; independent of the restaurant's balance.
- Cons: requires Grubano treasury and a recovery mechanism (offset engine does not exist today; a later reversal needs the same available balance); credit risk on the restaurant; the ledger must carry a receivable. **Rejected as default by the founder (no treasury).**

### OPTION C — Refund pending / admin queue (fail-closed, truthful)
When the connected balance is insufficient the refund is **not** created, the case stays `pending` in the admin queue (Claims / refund row), a `MONEY REVIEW` alert names the order, and the admin retries once funds are available (next payment clears, or after a manual payout hold). This is what the engine does **today** (502 + row `pending` + RESUME-FIRST), minus a purpose-built queue view.
- Pros: no false « refunded » status, no platform treasury, no restaurant over-debit; deterministic.
- Cons: customer waits (up to `delay_days` + next sales); needs an admin queue surface and a customer-facing « refund in progress » truth (Claims Phase 3/4); a restaurant with no further sales never funds its refund → falls back to A or B.

### OPTION D — Reserve / hold mechanisms (only what Stripe actually supports here)
- `debit_negative_balances` (measured `true` on the TEST account): lets Stripe **debit the connected account's external bank** when its balance is negative — it does **not** make a reversal succeed (the request still errors); it only recovers a negative balance that already exists (disputes). Not a refund mechanism.
- « Connected reserves » (Stripe: `connect_reserved` balance): reserves are set **by Stripe** on accounts it deems risky; a platform cannot create a rolling reserve on an Express account through the API in this architecture. **Not available** — do not invent.
- Separate charges & transfers with `source_transaction` and deferred transfers (transfer only after N days) would move the hold to the platform balance — an **architecture change** (charge type), out of Phase 2 scope; noted for the LIVE architecture decision.

## 4 · Recommendation (technical) for CLOSED BETA / initial LIVE pilot

Context: low volume, Click & collect only, admin-controlled refunds via Claims, no Grubano refund treasury, small independent restaurants, restaurant treasury sensitivity.

**Technical recommendation = C as the engine behaviour (already true) + A as the commercial condition, with a short window.**
1. Keep the engine fail-closed: a refund the restaurant cannot fund is **never** created, never marked refunded, and is surfaced to the admin (queue + MONEY REVIEW). Done in Phase 2.
2. Pair it with a restaurant payout **delay window** long enough to cover the beta claim window (claims are accepted 48 h after the order — `lib/claims.ts`) plus admin review time: **`delay_days` ≈ 7 (Stripe default for many accounts) or a weekly interval** keeps most beta refunds fundable from the restaurant's own balance. This is a commercial term to be **stated to pilot restaurants** and written into the partner contract; Claude Code does not set it in LIVE.
3. Explicitly **no platform advance** by default (B rejected); an exceptional advance stays a human, documented decision.
4. Post-beta architecture question (not now): if the founder wants instant refunds regardless of restaurant balance, the Connect charge type must change (separate charges & deferred transfers) — a design project with legal/contract consequences.

**Commercial impact (documented, founder-owned):** later restaurant cash-in (T+7 vs daily); must be disclosed and agreed; may need a compensating commercial argument (reliability of refunds, no clawback surprises).
**Legal / contractual (recorded, not concluded):** payout timing, refund funding order, offset rights against future sales and any reserve are **partner-contract terms** → LEGAL FOUNDATION train (roadmap), not this phase.

## 5 · TEST rehearsal state (kept, TEST-only)
The rehearsal restaurant's TEST payout schedule stays `manual` so the rehearsal refund can be funded from its own cleared balance; **read the actual available balance at execution time** (`balance.retrieve` with `stripeAccount`) — never trust the calendar (expected 13,34 € on 2026-09-08, +13,34 € on 2026-09-09). No TEST top-up transfer without explicit founder authorisation.
