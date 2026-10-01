# E2-DESIGN-BRIEF — claims, refunds, safety, admin money review

## Tone
Consumer claim/refund emails: calm, precise, respectful of a customer who had a problem; never defensive, never promotional; state **who** decided (restaurant vs Grubano) and **what** happens next. Admin emails: operational, dense, scannable in 5 seconds on a phone, with the exact facts to act (amounts, ids, queue name), urgency visible without colour alone.

## Semantics per email
| Email | Band | Key line | Forbidden |
|---|---|---|---|
| CLAIM_RECEIVED | NEUTRAL | "réclamation enregistrée sur GR-…, montant demandé X" + "vous serez informé(e) de la décision" | any promise of outcome or delay |
| CLAIM_DECISION_ACCEPTED | NEUTRAL (progress) | "{resto} a accepté ; transmise à Grubano pour décision de remboursement" | "remboursée" |
| CLAIM_DECISION_REFUSED | WARNING | "{resto} a refusé" + reason + how to contest (+ `{contestHours}` variable) | finality wording |
| CLAIM_DECISION_APPROVED | NEUTRAL→SUCCESS (decision), **no money band** | "Grubano a tranché en votre faveur" + "le remboursement suit son cours" (no delay) | amount, "effectué" |
| CLAIM_DECISION_REFUNDED | SUCCESS | "remboursement de X émis vers votre moyen de paiement" (X = engine amount) | restaurant as actor, banking delay |
| CLAIM_DECISION_REFUSED_FINAL | WARNING (final) | definitive refusal + reason | re-contest CTA |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON (+existing) | WARNING + money note | cancelled; "demande de remboursement transmise, examinée par un humain" / "votre réclamation en cours porte la question" | "remboursement effectué" |
| REFUND_SUCCEEDED full / partial | SUCCESS | "Grubano a remboursé X (partiel: sur Y payé)" — actor Grubano | "par {resto}", "5 à 10 jours ouvrés" |
| ADMIN_PAID_CANCELLATION | URGENT/ACTION | order `GR-` + raw id, restaurant, PI, amount, queue "/admin/reconciliation › Annulées payées", tool "refunds/run" | any automatic-action claim |
| ADMIN_GHOST_ORDER | URGENT | expired order captured; two states: `refundsOn` (auto-refund **attempted** — wording must say "tentative", T14) vs manual queue | asserting the refund succeeded |
| ADMIN_STALE_PI | URGENT | kind order/ticket, both PI ids, amount, "le client a pu payer deux fois" | |
| ADMIN_MONEY_REVIEW (5 kinds) | URGENT | title, "aucune action automatique", facts table (N rows, keys as given), contract ref §13.3 | |
| ADMIN_RECONCILE_DIGEST | ACTION | count + sample ids (≤10) + queue | |
| ADMIN_STALE_CLAIM | ACTION | claim id, order, amount, age in hours, console path `/admin/claims` | reminder loop (it fires once) |
| CRON_LEDGER_ALERT | URGENT (text-only today) | ledger vs Stripe counts/sums, window, `refundsOk` | — propose an HTML+text version on the admin shell |

## Safety / allergen (DESIGN PROPOSAL only)
If proposed: URGENT band, minimal fields (order `GR-`, restaurant, declared allergen text as typed, contact channel), immediate admin recipient, consumer acknowledgement neutral and serious ("nous avons transmis votre signalement en priorité"), **no** refund promise, **no** health guidance, **no** diagnosis. Tag every artefact DESIGN_PROPOSAL_NOT_YET_PRODUCT.

## Localization facts
Consumer claim family ships ×5 locales with RTL `ar` today (see `E2-COPY.md` variants). Design FR; ensure the layout survives long ES/IT strings and RTL mirroring (status band, key/value alignment, button direction).

## Acceptance for E2
Every consumer email states the actor and never up-states the money status · REFUND actor = Grubano · no delay figures · admin shell reusable · WIRED/CONTRACT/PROPOSAL tags visible on every artefact · no drift from the E1 contract.
