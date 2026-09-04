# PHASE 2 — PREFLIGHT OPÉRATIONNEL : UNE commande fondateur (staging)

> Contexte : `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §13 (readiness `REFUNDS_ENABLED`). L'environnement Claude Code n'a **aucun shell distant** (SSH :22 filtré, étape SSH GHA en timeout 5/5). Le fichier `.env.local` du serveur est la **seule** source de vérité runtime et n'est **jamais** écrit par la CI. → L'opérateur ci-dessous est shippé automatiquement par le déploiement (`scripts/server/*.js`) et exécuté UNE fois par le fondateur. Il décide PASS/FAIL seul ; aucune interprétation, aucun paramètre, aucun secret à saisir.

## Ce que fait l'opérateur (`scripts/server/phase2-preflight.js`)

1. **ENV** — prouve qu'il tourne dans l'app staging déployée (schéma Phase 1/2 + marqueur de build Phase 2 dans la route webhook compilée + `NEXTAUTH_URL` = app.grubano.com + base NON nommée « prod »). Charge `.env.local` en mémoire (rien n'est imprimé : présence booléenne des secrets, mode de la clé Stripe TEST/LIVE, nom de la base seulement).
2. **FLAGS** — imprime la valeur EFFECTIVE de tous les drapeaux argent (`ABSENT → EFFECTIVE FALSE`). **FAIL** si `REFUNDS_ENABLED`, `CLAIMS_ENABLED`, `CLAIMS_AUTO_APPROVE_ENABLED` ou `GHOST_ORDER_AUTO_REFUND_ENABLED` vaut `true`.
3. **ALERT_EMAIL** — la **seule écriture** : pose `ALERT_EMAIL=admin-qa@grubano.com` dans `.env.local` (sauvegarde horodatée `.env.local.bak-phase2-…` en 600, remplacement ou ajout, relecture vérifiée, idempotent : `UNCHANGED` au second passage).
4. **MAIL** — envoie **UN** e-mail de TEST « MONEY REVIEW — TEST préflight Phase 2 (aucun argent) » via les réglages SMTP de l'app vers `admin-qa@grubano.com` et imprime la ligne d'acceptation du fournisseur (`accepted`, `response`, `messageId`). Aucun remboursement, aucune donnée modifiée, aucun client contacté.
5. **ORDER** — lecture seule de la commande de répétition **GR-N5TSM0** (id `…n5tsm0`) : statut, `paymentStatus`, `subtotal/total`, `pointsRedeemed/loyaltyCreditCents/pointsEarned`, POS franchise, PI tronqué, lignes fidélité, lignes `Refund`, lignes ledger du PI, ligne `FranchiseRoyalty` (attendue : aucune), client fidélité (solde, offset), verdict **DISPOSABLE** (payée, 0 ligne Refund).
6. **FRANCH** — lecture seule : nombre de royalties franchise, de points de vente, d'opérateurs `franchise`, de commandes rattachées à un POS ; `FRANCHISE_ENABLED` effectif.
7. **LEDGER** — appelle la route **lecture seule** `GET /api/admin/ledger/check` (fenêtre 7 jours) de l'app elle-même avec le token interne lu dans l'env (jamais imprimé) ; imprime `ok / refundsOk / compteurs / écarts`.
8. **RESTART** — touche `tmp/restart.txt` **seulement** si `ALERT_EMAIL` a changé (Passenger recharge l'env).

Garanties : **aucun refund, aucune écriture Stripe, aucun argent, aucun schéma, aucun secret imprimé.** Fail-closed : la première anomalie → `RESULT: FAIL` + `FAILED STEP` + exit non nul. Contrôles négatifs prouvés en local avant remise : racine vide, `.env.local` absent, base nommée « prod », `REFUNDS_ENABLED=true`, SMTP injoignable → tous FAIL ; second passage → `ALERT_EMAIL … (UNCHANGED)`.

## LA commande (cPanel Terminal, une seule ligne) — dès que la CI du commit qui la shippe est verte

```bash
~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js
```

→ coller **tout** le bloc `GRUBANO PHASE 2 PREFLIGHT (staging)` dans le chat (il ne contient aucun secret). Si la réponse est « file not found », c'est le signal FAIL à renvoyer tel quel.

## Ce qui a déjà été fait SANS action fondateur (2026-09-04, Stripe TEST, lecture puis écriture de configuration, aucun argent)

- Endpoint webhook TEST `we_…7ueK` (app.grubano.com/api/webhooks/stripe) : **`refund.updated` + `refund.failed` ABONNÉS** en plus des événements existants (`payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `payment_intent.succeeded`, `charge.refunded`), relu depuis Stripe, `livemode=false`.
- Compte Connect TEST du restaurant de répétition (`acct_…byyYMY`, Express, FR) : calendrier de virements **passé de `daily` à `manual`** (config TEST, aucun argent) — sinon les fonds, dès disponibles, seraient virés vers la banque test et le `reverse_transfer` du remboursement échouerait.
- Constat bloquant de calendrier (règle Stripe documentée : « il est possible d'annuler un transfert uniquement si le solde **disponible** du compte connecté est supérieur au montant de l'annulation », et « si la demande de remboursement inclut une annulation de transfert mais que le compte connecté dispose d'un solde insuffisant, la demande de remboursement renvoie une erreur ») : solde disponible **0 €** aujourd'hui ; 13,34 € disponibles le **2026-09-08**, +13,34 € le **2026-09-09**. → **Première date possible de répétition : 2026-09-08** (partiel ≤ 13,34 €) ; remboursement TOTAL de GR-BZE1X (14,50 €) possible à partir du **2026-09-09**.
