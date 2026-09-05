# PHASE 2 — RÉCONCILIATION FINANCIÈRE FINALE v5 : UNE commande fondateur (staging) — preuve DIRECTE DB ↔ Stripe TEST

> Contexte : `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §19, `docs/ops/BETA-PRODUCT-FINAL-CLOSEOUT.md` (« RÉCONCILIATION FINANCIÈRE FINALE (v5) »), `docs/ops/RUNTIME-SECRET-SOURCE-MATRIX.md`, `docs/ops/WEB-ROOT-HARDENING-HANDOFF.md`. Aucun shell distant ; l'opérateur est shippé par le déploiement et exécuté UNE fois par le fondateur. Aucun paramètre, aucun secret à saisir ni imprimé. **Ce train ne touche ni `.htaccess`, ni les variables d'env hébergeur ; il ne fait aucun refund, aucune écriture DB/Stripe/fidélité.**
>
> **Historique.** v1 : `REFUNDS_ENABLED=true` mesuré → FAIL fermé. v2 : gel écrit, waitlist fermée par erreur, arrêt avant restart. v3 : PASS serveur (gel technique OBSERVÉ 403 gated, waitlist IN, tips FALSE, `ALERT_EMAIL` fondateur, 0 refund inattendu, GR-N5TSM0) sauf ledger HTTP 401. **v4** : forensics OK (provenance mesurée : `INTERNAL_CRON_TOKEN`, `TIPS_ENABLED`, `ALERT_EMAIL` présents dans `process.env` avant le chargement des fichiers ; secret GitHub = token runtime, 200) **mais la réconciliation directe n'a PAS été mesurée** : l'opérateur avait cassé son propre environnement — Prisma sans `DATABASE_URL` (v4 ne repeuplait plus `process.env`) et `stripe` non résolvable (**absent du runtime standalone** : Next le bundle dans les chunks). ⇒ v4 = **NOT MEASURED**, jamais « mismatch ».
>
> **Ce que v5 corrige (plomberie seulement, `scripts/server/reconcile-helpers.js`, testé).** Env chargé via **`@next/env`** — le chargeur exact de l'app déployée (`.env.production.local` › `.env.local` › `.env.production` › `.env`, `process.env` pré-existant jamais écrasé ; repli dotenv même ordre) ; Prisma construit avec l'URL **explicite** (`datasources.db.url`) ; Stripe via le SDK s'il est résolvable depuis `APP_ROOT`, sinon **client REST lecture seule** (GET uniquement, `api.stripe.com` épinglé, `paymentIntents.list/retrieve`, `refunds.list`, pagination `starting_after`, toute réponse ≠ 200 = exception, jamais une liste vide silencieuse). **`lib/ledger-check-core.js` inchangé** = même contrat que `GET /api/admin/ledger/check` sans son wrapper d'auth.

## Deux verdicts séparés (règle fondateur)

| Verdict | Source | Où |
|---|---|---|
| **DIRECT FINANCIAL RECONCILIATION** | DB staging + Stripe TEST, lecture seule, fenêtres **A** = 7 j (défaut route) et **B** = depuis le 2026-08-28 (couvre la fenêtre flag=true du 29/08 sans effet de bord sur le jour Z1) | étape 10 |
| **HTTP LEDGER AUTH** | statut de `GET /api/admin/ledger/check` avec le token des fichiers = **KNOWN OPEN** (401 ; 200 avec le secret GitHub) — P1 pré-prod, *document only* | étape 11 |

## Ce que fait l'opérateur v5 (`scripts/server/phase2-preflight.js`)

1. **ENV + IDENTITÉ** — staging (schéma, marqueurs Phase 2/F2, `NEXTAUTH_URL` app.grubano.com, base non « prod », clé **TEST**) ; **chargement runtime `@next/env`** → `OPERATOR ENV LOADER`, `DATABASE_URL AVAILABLE TO OPERATOR = YES/NO`, `STRIPE_SECRET_KEY AVAILABLE TO OPERATOR = YES/NO`, `STRIPE SECRET MODE (operator process) = TEST` (FAIL sinon) ; diagnostics par clé (3 lectures), historique des sauvegardes, sonde du processus vivant.
2. **SCAN HÉBERGEUR (noms seulement)**.
3. **RÉ-ASSERTION DE SÛRETÉ (idempotente, attendu `NO CHANGE NEEDED`)** ; garde flags argent sur la vue fusionnée (FAIL + restauration + restart refusé si `true`).
4. **ALERTE** — seulement si `ALERT_EMAIL` change.
5. **PROVENANCE** — lit `~/.grubano/env-provenance.json` (restart + preuve seulement si absent/périmé).
6. **SANTÉ ×3** + **6b EXPOSITION WEB** (HEAD, statut seul) : classes **secret** (`.env*`, sauvegardes, `.htaccess`, `.git/*`, `deploy_key`, `*.sql`) → un 200 = **P0 SECURITY INCIDENT → FAIL dur, arrêt** ; classes **source** (`server.js`, `package.json`, `prisma/schema.prisma`, `tmp/restart.txt`, `scripts/server/*.js`, `lib/ledger-check-core.js`) → 200 = **P1 pré-prod enregistré (T-41), non corrigé ici**.
7. **RÉSOLUTION DES DÉPENDANCES (layout de l'app déployée)** → `PRISMA CLIENT RESOLUTION = PASS/FAIL`, `LEDGER CORE RESOLUTION = PASS/FAIL`, `STRIPE SDK RESOLUTION = PASS (SDK) / PASS (REST lecture seule) / FAIL`.
8. **REFUNDS DB** — aucun refund inattendu depuis le 2026-08-29. **9. GR-N5TSM0** (DB). **9b. FRANCHISE** (comptages).
10. **RÉCONCILIATION DIRECTE** — par fenêtre : `LEDGER PAYMENT COUNT / STRIPE PAYMENT COUNT / LEDGER PAYMENT SUM / STRIPE PAYMENT SUM`, `LEDGER REFUND COUNT / STRIPE REFUND COUNT / LEDGER REFUND SUM / STRIPE REFUND SUM / checked`, agrégats, `ECARTS`, `REFUND ECARTS`, **`WINDOW EDGE`** (chaque `not_in_stripe_window` **prouvé** `WINDOW_EDGE_ONLY` — même PI à Stripe, `succeeded`, `amount_received` = gross ledger, `created` < début de fenêtre — ou `TRUE_FINANCIAL_MISMATCH`), **`WINDOW VERDICT`** = `PASS` · `PASS (WINDOW_EDGE_ONLY — n ligne(s) prouvée(s), sommes égales après exclusion)` · `FAIL`. `FINANCIAL LEDGER RECONCILIATION = PASS` seulement si les deux fenêtres passent ; `refunds.checked=false` ⇒ FAIL (NOT MEASURED, jamais PASS). `FINANCIAL MONEY MUTATION DURING CHECK = NO — by construction`.
11. **HTTP** — un appel, statut seul → `INTERNAL LEDGER HTTP AUTH`.
12. **LOGS** — queue `~/logs` (codes HTTP + types seulement).

`RESULT` = `PASS` · `PASS (HTTP AUTH OPEN — non-financial)` · `FAIL`. Les deux verdicts sont imprimés en tête du bloc.

**Contrôle négatif prouvé en local** (harnais `nc5` : faux staging + faux Stripe REST + faux `@prisma/client` installé dans la racine factice, 16/16) : fixture correcte → `FINANCIAL PASS` (2 paiements 1450/1410, refund Z1 1450) ; **ligne ledger en trop** → `TRUE_FINANCIAL_MISMATCH` → FAIL ; **montant faux** → FAIL ; **PI Stripe manquant** → `missing_in_ledger` → FAIL ; **refund dupliqué** → FAIL ; PI créé 3 s avant la fenêtre 7 j → `WINDOW_EDGE_ONLY` prouvé → `PASS (WINDOW_EDGE_ONLY)` ; classe secret exposée → `P0 SECURITY INCIDENT`, FAIL ; base prod / clé LIVE → FAIL étape 1 ; aucun secret imprimé. Tests versionnés : `reconcile-helpers` (13), `ledger-check-core` (11), `ledger-check-route` (12), `env-provenance` (10), `fix-server-preamble` (6). Revue financière indépendante : voir closeout.

## LA commande (cPanel Terminal, une seule ligne) — dès que la CI du commit v5 est verte et que `/version.json` porte son SHA

```bash
~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js
```

→ coller **tout** le bloc `GRUBANO PHASE 2 PREFLIGHT v5 (staging)`. Le commit v5 est poussé avec `[no-restart]` (aucun changement de code produit ; le processus Passenger en place n'est pas dérangé) ; l'opérateur ne redémarre que si la provenance manque ou si l'env dérive.

## Hors périmètre de ce train (enregistré, non exécuté)
- **Web-root hardening** (T-41, P1 pré-prod) : `docs/ops/WEB-ROOT-HARDENING-HANDOFF.md` — `.htaccess` **non modifié**.
- **Normalisation de la source du token / TIPS / ALERT_EMAIL hébergeur** : `RUNTIME-SECRET-SOURCE-MATRIX.md` §8 — train infra séparé.
- **Répétition Stripe TEST** : jamais automatique ; solde disponible du compte connecté relu au moment de l'exécution ; phrase fondateur « I AUTHORIZE THE STAGING REFUND REHEARSAL » requise ; aucun fonds fabriqué ; Stripe LIVE intact.
