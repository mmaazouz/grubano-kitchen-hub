# PHASE 2 — PRÉFLIGHT FINAL v4 : UNE commande fondateur (staging) — réconciliation ledger directe + forensics auth interne

> Contexte : `docs/ops/REFUND-FINANCIAL-CONTRACT.md` §19, `docs/ops/BETA-PRODUCT-FINAL-CLOSEOUT.md` (« PRÉFLIGHT FINAL (v4) »), `docs/ops/RUNTIME-SECRET-SOURCE-MATRIX.md`. L'environnement Claude Code n'a **aucun shell distant** ; les fichiers `.env*` du serveur sont la source de vérité runtime et ne sont **jamais** écrits par la CI. L'opérateur est shippé par le déploiement (`scripts/server/*.js` + `lib/ledger-check-core.js`) et exécuté UNE fois par le fondateur. Aucun paramètre, aucun secret à saisir, aucun secret imprimé (ni valeur, ni longueur, ni empreinte).
>
> **Historique.** v1 : `REFUNDS_ENABLED=true` mesuré → FAIL fermé (correct). v2 : gel technique écrit, mais waitlist livreur fermée par erreur + `ALERT_EMAIL` remplacé + arrêt avant restart (ledger 401). v3 : **PASS serveur** — gel technique OBSERVÉ (`POST /api/admin/refunds/run` sans identifiant → 403 `{gated:true}`), rechargement prouvé, waitlist IN (`LOGISTICS_SIGNUP_ENABLED=true`), livraison OUT, `TIPS_ENABLED=false`, `ALERT_EMAIL=m.maazouz@grubano.com` (250 accepté), aucun refund inattendu, GR-N5TSM0 mesuré — **sauf `GET /api/admin/ledger/check` → 401** avec la ligne canonique du fichier.
>
> **Ce que v4 change de modèle (mesuré par lecture du déploiement).** L'entrée Passenger déployée est **`.next/standalone/server.js` généré par Next** (`deploy-staging.yml` copie `.next/standalone/.` ; le FTP n'exclut que `.env*`/`.htaccess`) — le `server.js` racine du repo n'est pas déployé. Le chargeur d'env est donc **`@next/env` (dotenv)** : `.env.production.local` › `.env.local` › `.env.production` › `.env` (premier fichier gagnant) ; **une clé déjà présente dans `process.env` (injection hébergeur / cPanel / Passenger) n'est jamais écrasée** ; dans un fichier `K = v`, espaces initiaux, `export`, `# commentaire` sont acceptés et la **dernière** occurrence gagne. Le diagnostic v3 « ligne non chargeable » était infondé (sans effet : lignes canoniques). L'hypothèse restante pour le 401 = **valeur injectée par l'hébergeur ≠ fichier** (ou fichier `.env*` ombrant) — c'est ce que v4 **mesure dans le vrai processus**.

## Deux questions, deux verdicts

| Question | Réponse v4 | Où |
|---|---|---|
| **A — Le ledger financier est-il réconcilié ?** | `FINANCIAL LEDGER RECONCILIATION = PASS/FAIL` calculé **directement** sur le serveur avec `lib/ledger-check-core.js` (la logique exacte de la route, extraite sans changement) contre la base staging + Stripe TEST, deux fenêtres (7 j = défaut route ; depuis le 2026-08-28, couvrant la fenêtre flag=true du 29/08). READ-ONLY. Jamais forcé : objet Stripe manquant, ligne en trop, ligne refund dupliquée, refund sans ligne, équation cassée, sommes divergentes → FAIL ; liste refunds indisponible → NOT MEASURED. | étape 10 |
| **B — Pourquoi la route HTTP répond-elle 401 ?** | `INTERNAL LEDGER HTTP AUTH = PASS/FAIL(401)` + cause **mesurée** : `~/.grubano/env-provenance.json` (écrit par le préambule que `scripts/fix-server.js` injecte dans le `server.js` déployé, **avant `require('next')`**) dit si `INTERNAL_CRON_TOKEN` était **déjà dans `process.env` avant tout chargement de fichier** (`presentBeforeEnvLoad`), dans quels fichiers il est défini, et si la valeur hébergeur **égale** celle des fichiers (booléen calculé en mémoire). Scan des fichiers de config hébergeur pour le **nom** de la clé. Un seul appel HTTP (statut). | étapes 2, 5, 11 |

## Ce que fait l'opérateur v4 (`scripts/server/phase2-preflight.js`)

1. **ENV + IDENTITÉ** — staging (schéma + marqueurs Phase 2/F2 + `NEXTAUTH_URL` app.grubano.com + base non « prod » + clé Stripe TEST, lecture **vue fusionnée Next**) ; fichiers `.env*` présents ; **type du `server.js` déployé** (next-standalone / racine / préambule présent) ; `lib/ledger-check-core.js` shippé ; fait shell « `INTERNAL_CRON_TOKEN` présent dans l'env du **terminal** » (≠ Passenger) ; pour chaque clé surveillée : valeur effective Next (secrets = « present, not printed ») · fichiers/occurrences · accord/divergence avec le lecteur strict (racine, non déployé) et le laxiste v2 ; historique des sauvegardes `.env.local.bak*` ; sonde du processus vivant.
2. **SCAN HÉBERGEUR (noms seulement)** — `.htaccess` (SetEnv/PassengerEnvVar), `nodevenv/app.grubano.com/24/bin/activate`, `~/.cl.selector`, `~/.cpanel/nodejs.d`, profils shell : mention du nom `INTERNAL_CRON_TOKEN` / `TIPS_ENABLED` = YES/NO/ABSENT.
3. **RÉ-ASSERTION DE SÛRETÉ (idempotente)** — `REFUNDS_ENABLED=false`, `LOGISTICS_SIGNUP_ENABLED=true`, `ALERT_EMAIL=m.maazouz@grubano.com` en lignes canoniques (attendu : `NO CHANGE NEEDED`). Garde flags argent sur la **vue fusionnée** (tous fichiers) : `REFUNDS`, `CLAIMS*`, `GHOST_ORDER_AUTO_REFUND`, `LOGISTICS_COURIER_ACTIVATION`, `TIPS`, `LOGISTICS_PAYOUT`, `DELIVERY_FULFILLMENT` → **FAIL + restauration + restart refusé** si l'un vaut `true` (même via `.env.production.local`).
4. **ALERTE** — envoi d'un e-mail de test **seulement si** `ALERT_EMAIL` a changé (v3 a déjà mesuré l'acceptation).
5. **PROVENANCE** — lit `~/.grubano/env-provenance.json` ; s'il manque ou date d'avant le `server.js` déployé (ou si l'env a changé) : touche `tmp/restart.txt`, prouve le rechargement par sondes vivantes (403 gated, waitlist 200, tips false), relit. Imprime par clé : `presentBeforeEnvLoad` · `inEnvFiles(fichiers)` · `equal(process vs files)` · `effective`.
6. **SANTÉ ×3** — refunds gated, waitlist ouverte, tips off, aucun 5xx.
7. **REFUNDS DB** — aucun refund inattendu depuis le 2026-08-29.
8. **GR-N5TSM0** — faits DB compacts (disposable ?).
9. **FRANCHISE** — comptages.
10. **RÉCONCILIATION DIRECTE** — voir A. Imprime `LEDGER COUNT / STRIPE COUNT / LEDGER SUM / STRIPE SUM`, `REFUND LEDGER COUNT / STRIPE REFUND COUNT / REFUND LEDGER SUM / STRIPE REFUND SUM / checked`, agrégats, `ECARTS` (ids caviardés), `FINANCIAL MONEY MUTATION DURING CHECK = NO`.
11. **HTTP** — un `GET /api/admin/ledger/check` avec le token **des fichiers** : 200 → `HTTP AUTH PASS` ; 401 → `FAIL (401)` + cause : `presentBeforeEnvLoad=YES ∧ equal=NO` ⇒ **« ROOT CAUSE MEASURED : token injecté par l'hébergeur, différent du fichier »** ; sinon escalade route-level (jamais d'affaiblissement).
12. **LOGS** — queue de `~/logs/*ledger*` (probe cPanel 07:00 ; statuts seuls, ids caviardés).

`RESULT` = `PASS` · `PASS (HTTP AUTH OPEN — non-financial)` · `FAIL` (anomalie financière/sûreté). Les deux verdicts sont imprimés séparément en tête du bloc.

Garanties : **aucun refund, aucune écriture Stripe, aucun argent, aucun schéma, aucune mutation fidélité, aucun secret imprimé.** Contrôles négatifs locaux (harnais `nc4`, faux staging + provenance simulée, 21/21) : hébergeur ≠ fichier → « ROOT CAUSE MEASURED » ; provenance absente → restart + rechargement prouvé + NOT MEASURED ; `.env.production.local` `REFUNDS_ENABLED=true` → FAIL étape 3, restart refusé ; ` TIPS_ENABLED = true` → **effectif pour Next** → FAIL ; base prod → FAIL étape 1 ; dérive waitlist → ré-assertion + backup + rechargement prouvé ; aucun secret imprimé. Tests versionnés : `ledger-check-core` (11), `ledger-check-route` (12), `env-provenance` (10), `fix-server-preamble` (6).

## LA commande (cPanel Terminal, une seule ligne) — dès que la CI du commit v4 est verte et que `/version.json` porte son SHA

```bash
~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-preflight.js
```

→ coller **tout** le bloc `GRUBANO PHASE 2 PREFLIGHT v4 (staging)` dans le chat. Le déploiement v4 **restart** Passenger (pas de `[no-restart]` : le fichier est correct depuis v3) → le nouveau `server.js` écrit `~/.grubano/env-provenance.json` au démarrage ; l'opérateur ne redémarre que si ce fichier manque.

## Comparaison GitHub ↔ runtime (sans valeur) — fait par l'agent, pas par le fondateur
`.github/workflows/internal-token-probe.yml` (dispatch manuel, cible **fixe** `app.grubano.com`) appelle la route avec `secrets.INTERNAL_CRON_TOKEN` et imprime **le statut HTTP seul** : 200 = le secret GitHub égale le token runtime ; 401 = non. Décision et rotation : `RUNTIME-SECRET-SOURCE-MATRIX.md` §2/§3.

## Déjà fait SANS action fondateur (Stripe TEST)
- Endpoint webhook TEST `we_…7ueK` : `refund.updated` + `refund.failed` abonnés (2026-09-04).
- Compte Connect TEST du restaurant de répétition : virements `manual` ; solde disponible **à relire au moment de l'exécution** (0 € le 2026-09-04 ; 13,34 € attendus le 2026-09-08, +13,34 € le 2026-09-09).
- Aucun refund. `REFUNDS_ENABLED` jamais mis à `true` par l'agent. Stripe LIVE jamais touché. Répétition NON autorisée.
