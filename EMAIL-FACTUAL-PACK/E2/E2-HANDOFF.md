# E2-HANDOFF — Claude Design tranche 2: CLAIMS / SAV · REFUNDS · SAFETY · ADMIN MONEY REVIEW · FINANCIAL EXCEPTIONS

> Self-contained. Load `../EMAIL-DESIGN-SYSTEM-FACTS.md` and the E1 output `CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md` (**mandatory — no visual drift**). Depth in this folder: `E2-MANIFEST.md` (15 emails), `E2-COPY.md` (verbatim, incl. `ar`/`en` variants), `E2-DATA-CONTRACTS.md`, `E2-CURRENT-VISUALS.md` (18 fossils), `E2-DESIGN-BRIEF.md`. Product truth: `../EMAIL-CLAIMS-REFUNDS-FACTS.md` (read §0 and §4 at minimum).
>
> **Every email here is tagged.** WIRED = code sends it today when its flag is on · PRODUCT CONTRACT CONFIRMED = the behaviour is locked, the email is not (or is deliberately absent) · DESIGN PROPOSAL = allowed to propose, not product. Claims are **OFF for the whole closed beta** (founder D4); the refund engine is **frozen** (`REFUNDS_ENABLED` measured false). You are designing the post-beta state against the confirmed contract, plus the admin alerts that are live today.

## 1 · The set

| ID | Tag | Audience | Reachable today | Role |
|---|---|---|---|---|
| CLAIM_RECEIVED | WIRED (flag `CLAIMS_ENABLED`) | consumer ×5 locales | no | acknowledgement with requested amount |
| CLAIM_DECISION_ACCEPTED | WIRED (flag) | consumer | no | restaurant accepted → transmitted to Grubano (no money moved) |
| CLAIM_DECISION_REFUSED | WIRED (flag) | consumer | no | restaurant refused (+reason) → contest possible (48 h default, not stated) |
| CLAIM_DECISION_APPROVED | WIRED (flag) | consumer | no | Grubano approved, refund **not yet succeeded** — no amount, no delay |
| CLAIM_DECISION_REFUNDED | WIRED (flags CLAIMS+REFUNDS) | consumer | no | refund **issued** ("émis"); ⚠️ amount currently = requested, not engine amount (T8) |
| CLAIM_DECISION_REFUSED_FINAL | WIRED (flag) | consumer | no | definitive refusal |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON | WIRED (flag) | consumer | no | paid order cancelled → system claim created (+ variant when a claim already exists) |
| REFUND_SUCCEEDED (full / partial) | WIRED (flag `REFUNDS_ENABLED`) | consumer / guest | no (403 gated) | **only after Stripe `succeeded`**; ⚠️ current copy names the restaurant as the refunder and states "5 à 10 jours ouvrés" (T6, T7) |
| ADMIN_PAID_CANCELLATION | WIRED, **live** | admin (`ALERT_EMAIL`) | **yes** | the beta escalation: paid order cancelled → human refund via admin tool |
| ADMIN_GHOST_ORDER | WIRED, live (webhook) | admin | yes | expired order captured |
| ADMIN_STALE_PI | WIRED, live (webhook) | admin | yes | orphan PaymentIntent captured |
| ADMIN_MONEY_REVIEW (5 kinds) | WIRED, live (webhook kinds) | admin | yes | Phase 2 residuals needing a human; free-form facts table |
| ADMIN_RECONCILE_DIGEST | WIRED, manual (scheduler inert) | admin | manual | daily queue digest |
| ADMIN_STALE_CLAIM | WIRED (flag + scheduler inert) | admin | no | claim ignored by the restaurant past deadline |
| CRON_LEDGER_ALERT | WIRED, live (cPanel cron, text-only) | admin | yes (exceptional) | ledger check `ok:false` |

**Deliberately absent (PRODUCT CONTRACT CONFIRMED as no-email — design only as DESIGN PROPOSAL, clearly labelled):** consumer "refund pending", consumer "refund failed", late-success notice via webhook, claim opened → restaurant, claim opened → admin receipt, contest confirmation, arbitration outcome → restaurant, allergen/safety escalation (no reason code exists).

## 2 · Binding rules (from `../EMAIL-CLAIMS-REFUNDS-FACTS.md §4`)
1. **Claim ≠ Refund.** APPROVED must never say money moved. Only Stripe `succeeded` → "Remboursement effectué / émis". Requested ≠ pending ≠ failed ≠ succeeded.
2. Refund actor = **Grubano** (admin). Never "le restaurant vous a remboursé".
3. No banking-delay figure (drop "5 à 10 jours ouvrés" unless the founder sources it).
4. Amount shown = engine actual cents; partial vs full explicit; loyalty-financed value returns in **points**, never cash (Phase 1 contract) — if you show points, label them as points.
5. Consumer sees `GR-XXXXXX` only; admin emails may show raw ids **and should add the `GR-` reference** for reconciliation.
6. Contest deadline may be shown only as a variable (`{contestHours}` read at send time).
7. Safety/allergen (proposal only): serious, high priority, minimal necessary information, immediate admin visibility, **no auto-refund, no diagnosis, no medical advice**.
8. During the beta the only live consumer money-adjacent email is CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF (E1) — E2 consumer designs are post-beta.

## 3 · Deliverables
1. Designed HTML references for the 15 emails (18 states: `ar` RTL and `en` variants for one claim email each; full/partial refund; claim-exists variant), on the E1 contract.
2. Admin sub-family: a **dense operational** variant of the shell (facts table, monospace ids, urgency band) — reused by E3 admin emails.
3. `E2-gallery.html` desktop/mobile + images-off + text.
4. Subject/preheader recommendations (FR; note the ×5 localized families).
5. Status semantics mapping per email (WARNING for refusals, SUCCESS only for REFUNDED, URGENT for MONEY REVIEW / STALE PI / GHOST ORDER, NEUTRAL for ack/accepted/approved).
6. Conditional states: reason present/absent; restaurant name null → "Le restaurant"; partial vs full; facts table with N rows; `refundsOn` true/false (ghost order).
7. Proposals appendix (labelled DESIGN PROPOSAL): refund-pending neutral notice, refund-failed notice, claim→restaurant, allergen escalation — **no implementation claim**.
8. Plain-text recommendation per email.

## 4 · OUT-OF-SCOPE
E1 emails (already designed); onboarding, partner lifecycle, reservations, courier, supplier, creator, cron recaps (E3); any change to the money semantics; translations.

## 5 · Gate
Founder approval → E3. Before Claude Code implements E2, `../EMAIL-CLAIMS-REFUNDS-FACTS.md` is refreshed against the final Claims/Refund code (Phase 3 not started).
