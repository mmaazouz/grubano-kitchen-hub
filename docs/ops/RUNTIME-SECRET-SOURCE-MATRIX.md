# RUNTIME SECRET SOURCE MATRIX — staging `app.grubano.com` (2026-09-05, Phase 2 final preflight)

> **Règle d'évidence** : chaque cellule porte sa source (`CODE` = contrat d'implémentation · `STAGING RUNTIME` = mesuré sur le serveur · `GITHUB` = référence de secret lue par nom · `NOT MEASURED`). **Aucune valeur n'est jamais écrite dans ce document, ni longueur, ni empreinte.**

## 0 · Le chargeur réel (CODE — mesuré par lecture des fichiers de déploiement)

| Fait | Source | Valeur |
|---|---|---|
| Entrée Passenger déployée | `.github/workflows/deploy-staging.yml:101` (`cp -r .next/standalone/. deploy-temp/`) ; exclusions FTP = `.env*`, `.htaccess`, `node_modules/.bin` (jamais `server.js`) | **`.next/standalone/server.js` généré par Next**, patché par `scripts/fix-server.js`. Le `server.js` racine du repo (chargeur strict « maison ») **n'est PAS déployé** — `CLAUDE.md §9` le décrit à tort comme l'entrée serveur ; à corriger par le fondateur. |
| Chargeur d'env | `@next/env` (dotenv 16.3.1 embarqué), appelé par `next-server.js:487 loadEnvConfig(dir, dev=false)` | Fichiers, dans l'ordre : `.env.production.local` › `.env.local` › `.env.production` › `.env`. **Le premier fichier qui définit une clé gagne.** **Une clé déjà présente dans `process.env` (injection hébergeur / Passenger / cPanel) n'est JAMAIS écrasée.** Dans un fichier : `export K=`, espaces initiaux, `K = v`, guillemets, `# commentaire` après valeur non citée acceptés ; **la dernière occurrence gagne**. |
| Moment de lecture | `next-server.js` constructeur → au démarrage du processus (respawn Passenger inclus) ; les routes lisent `process.env.X` **à la requête** | Un écrit `.env.local` devient effectif au prochain démarrage de processus (respawn d'inactivité ≈ 300 s, `restart.txt`, ou MaxRequests 1000). |
| Pourquoi v2/v3 se sont trompés | v2 lisait le fichier en mode laxiste (dernière occurrence) ; v3 a modélisé le chargeur du `server.js` racine (strict, première occurrence) — un fichier qui ne tourne pas. Le chargeur réel est dotenv. Les lignes **canoniques** écrites par v3 sont chargées identiquement par les trois lecteurs → aucun effet indésirable, mais le diagnostic « ligne non chargeable » était infondé. | Corrigé : `scripts/server/env-provenance.js` porte la grammaire dotenv exacte et l'ordre des fichiers ; le préambule injecté par `fix-server.js` mesure l'injection hébergeur **dans le vrai processus**. |

## 1 · Matrice par clé

Colonnes : `HOSTING ENV PRESENT` = clé déjà dans `process.env` **avant** le chargement des fichiers (mesurée par `~/.grubano/env-provenance.json`, écrit par le préambule du `server.js` déployé — lu par l'opérateur v4) · `ENV FILE PRESENT` = définie dans un `.env*` du serveur (mesuré v3/v4, lecture dotenv) · `GITHUB SECRET REFERENCE` = un secret GitHub de ce nom existe (liste par noms, `gh secret list`, repo-level ; **aucun secret d'environnement** `staging`/`production` défini) · `PRECEDENCE` = ce que le processus utilise réellement.

| KEY | PURPOSE | EXPECTED SOURCE | ACTUAL SOURCE | HOSTING ENV PRESENT | ENV FILE PRESENT | GITHUB SECRET REFERENCE | PRECEDENCE | DUPLICATE SOURCES | RISK | ACTION |
|---|---|---|---|---|---|---|---|---|---|---|
| `INTERNAL_CRON_TOKEN` | auth machine des routes internes (`X-Internal-Token`, comparaison constante, lecture à la requête) : ledger/check, invoices/generate, creator-earnings/mature, creator-payouts/run, franchise-settlements/run, onboarding-nudges/run, reconcile-ghost-orders, confirm-sweep, claims/*, refunds/run | `.env.local` serveur (unique) | **DIVERGENT** : le fichier porte une ligne canonique (v3, mesuré) mais la route répond 401 → le processus compare une autre valeur | **→ mesuré par l'opérateur v4** (`INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD`) | YES (v3, canonique, 1 occurrence) | YES (repo, maj 2026-07-03) — utilisé par `cron.yml` (inactif : pas sur `main`) et par `internal-token-probe.yml` (dispatch, statut seul) | hébergeur › `.env.production.local` › `.env.local` › … | **PROBABLE** (hébergeur ≠ fichier, ou fichier `.env.production.local`/`.env` ombrant) — tranché par v4 | **P1 pré-prod** (auth interne non déterministe ; **non bloquant** pour la réconciliation financière qui est directe) | Voir §2 (décision après v4) |
| `CRON_SECRET` | `Authorization: Bearer` de `/api/email-agent` (aucun scheduler, P0-07) et `/api/logistics/positions/sweep` | `.env.local` | idem — non testé en HTTP | v4 | v3 : non listé (à confirmer v4) | YES (repo) | idem | à mesurer | P2 | même contrat que ci-dessus |
| `STRIPE_SECRET_KEY` | SDK Stripe (mode TEST prouvé `sk_test_`) | `.env.local` | `.env.local` (mode TEST mesuré v3 ; `fulfillment`/refunds live cohérents) | v4 | YES | NO (jamais en CI — correct) | hébergeur › fichiers | NO attendu | NONE si v4 confirme `presentBeforeEnvLoad=NO` | rien |
| `STRIPE_WEBHOOK_SECRET` | signature des webhooks (`constructEvent`) | `.env.local` | `.env.local` (webhook 400 non signé mesuré) | v4 | YES (v3) | NO | idem | NO attendu | NONE | rien |
| `NEXTAUTH_SECRET` | JWT NextAuth + `middleware.ts getToken()` | `.env.local` | `.env.local` (sessions fonctionnelles) | v4 | à confirmer v4 | YES (repo — legacy `ENV_LOCAL_CONTENT` retiré ; **non consommé** par deploy-staging) | idem | possible (GitHub ≠ serveur, sans effet : la CI n'écrit plus `.env.local`) | P2 (dérive silencieuse si un jour la CI réécrit l'env) | documenter : le secret GitHub `NEXTAUTH_SECRET` n'est plus une source runtime |
| `SMTP_USER` / `SMTP_PASS` | transport nodemailer (alertes MONEY REVIEW, transactionnels) | `.env.local` | `.env.local` (acceptation fournisseur 250 mesurée v3) | v4 | YES | YES (repo — pour `cron.yml` probes/recap uniquement) | idem | YES (GitHub + serveur, même usage, valeurs non comparées) | P2 | rotation conjointe documentée §3 |
| `DATABASE_URL` | Prisma | `.env.local` | `.env.local` (base nommée staging mesurée) | v4 | YES | `DATABASE_URL_STAGING` / `DATABASE_URL_PROD` (repo — **non consommés** par deploy-staging) | idem | historique | P2 (secrets GitHub obsolètes = confusion) | nettoyer les secrets GitHub non consommés (fondateur) |
| `ANTHROPIC_API_KEY` | SDK Anthropic | `.env.local` | `.env.local` | v4 | à confirmer | YES (repo, non consommé par deploy) | idem | idem | P2 | idem |
| `ALERT_EMAIL` | destination MONEY REVIEW | `.env.local` = `m.maazouz@grubano.com` (mesuré v3) | idem | v4 | YES | YES (repo — pour `cron.yml`) | idem | YES (valeurs non comparées) | P2 | aligner GitHub ↔ serveur à la mise sur `main` de `cron.yml` |
| `REFUNDS_ENABLED` / `LOGISTICS_SIGNUP_ENABLED` / `TIPS_ENABLED` | flags (pas des secrets) | `.env.local` | `.env.local` (runtime prouvé v3 : false / true / false) | v4 | YES | N/A | idem | NO | NONE | rien |

## 2 · Contrat cible (UNE source par environnement) — décision après la mesure v4

| Résultat v4 `INTERNAL_CRON_TOKEN PRESENT BEFORE ENV LOAD` | Cause établie | Fix (une seule source) |
|---|---|---|
| **YES** et `equal(process vs files) = NO` | L'hébergeur (cPanel « Setup Node.js App » → variables d'environnement Passenger) injecte un token **différent** ; Next ne l'écrase jamais → la route compare la valeur hébergeur | **Recommandé** : `.env.local` = source unique de tous les secrets serveur (déjà le cas pour Stripe/SMTP/DB) → **supprimer** la variable `INTERNAL_CRON_TOKEN` de la config Node.js cPanel (fondateur, UI cPanel, aucune valeur à saisir), restart, re-run v4 → 200. Alternative (si le fondateur préfère l'UI cPanel) : supprimer la ligne du `.env.local` et déclarer l'hébergeur autoritaire — à documenter. Puis §3 pour GitHub. |
| **YES** et `equal = YES` | Injection présente mais identique → le 401 vient d'ailleurs (chemin header / proxy) | Escalade route-level (jamais d'affaiblissement) |
| **NO** et un autre fichier `.env*` définit la clé (`definedIn` ≠ `.env.local` seul) | `.env.production.local` ou `.env` ombre `.env.local` | Supprimer la définition dans le fichier ombrant (opérateur fondateur, sans valeur affichée) |
| **NO** et `.env.local` seul | Le processus lit bien le fichier → 401 inexpliqué | Escalade route-level : vérifier que le header traverse Apache/Passenger (test `X-Internal-Token` vs un header témoin), aucune modification d'auth sans revue sécurité |

## 3 · Rotation (procédure documentée, jamais exécutée sans décision fondateur)

1. Générer la nouvelle valeur **sur le serveur** (opérateur : `crypto.randomBytes(32).toString('base64url')`, écrite directement dans `.env.local`, jamais affichée ni collée dans un chat).
2. Restart Passenger (`tmp/restart.txt`) → sonde `GET /api/admin/ledger/check` avec la nouvelle valeur lue **en mémoire** par l'opérateur → 200.
3. GitHub : mettre à jour le secret repo `INTERNAL_CRON_TOKEN` via `gh secret set INTERNAL_CRON_TOKEN < fichier-temporaire` exécuté **sur le serveur** (le fondateur, avec `gh` authentifié) — ou, si `gh` n'y est pas installé, coller la valeur dans l'UI GitHub Secrets **sans jamais la transmettre à l'agent**. Vérifier par `internal-token-probe.yml` (dispatch → `GITHUB SECRET == STAGING RUNTIME TOKEN = YES`). Note : un workflow `workflow_dispatch`-only absent de `main` n'est pas enregistré par GitHub (404 au dispatch, mesuré 2026-09-05) → le fichier porte aussi un déclencheur `push` limité à lui-même, qui l'enregistre et exécute la sonde une fois (statut seul).
4. Crontab cPanel (`scripts/cron/ledger-check-probe.js`, `creator-earnings-mature.js`, `monthly-invoices.js`) : lit `../../.env.local` → aucune action.
5. Production (`grubano.com`) : mêmes étapes sur son `.env.local` et **un secret GitHub distinct** (`INTERNAL_CRON_TOKEN_PROD`) le jour où `cron.yml` cible la prod — **aujourd'hui interdit** (Stripe LIVE intact).

## 4 · Ce que ce document n'établit PAS (NOT MEASURED tant que v4 n'a pas tourné)

- La présence effective d'une variable injectée par l'hébergeur (seule la mesure in-process du préambule le dit).
- L'égalité des valeurs GitHub ↔ serveur (seul `internal-token-probe.yml` le dit, par 200/401).
- Le contenu de la crontab de production.


## 5 · Exposition web de la racine d'application (MESURÉ 2026-09-05, staging, requêtes HEAD publiques — statut seul)

Sur cPanel/Passenger, `.htaccess` de l'app vit dans la racine d'application ⇒ **DocumentRoot Apache = racine de l'app** ; mod_passenger laisse Apache servir tout fichier existant sous cette racine avant de transmettre à Next. Mesure :

| URL | Statut | Lecture |
|---|---|---|
| `/.env.local` | **404** | fichiers `.env*`/dotfiles refusés (règle hébergeur) — **aucun secret exposé** |
| `/.htaccess` | 404 | idem |
| `/server.js` | **200** (4589 B, `application/javascript`) | l'entrée Passenger générée par Next (config inline, chemins) — divulgation d'information, pas de secret |
| `/package.json` | **200** | dépendances et versions |
| `/prisma/schema.prisma` | **200** (172 Ko) | **schéma complet de la base** (modèles, champs, index) — P1 divulgation |
| `/tmp/restart.txt` | **200** | horodatage de restart (bénin) |
| `/scripts/server/phase2-preflight.js` | **200** (46 Ko) | scripts d'exploitation (logique, noms de clés ; aucune valeur) |
| `/lib/ledger-check-core.js` | 404 aujourd'hui → **200 après le déploiement v4** | logique pure de réconciliation (aucun secret) |
| `~/.grubano/env-provenance.json` | hors racine | **non atteignable** par construction (c'est pourquoi le préambule écrit là, pas dans `tmp/`) |

**Classification** : **P1 pré-existant** (divulgation d'information ; pas de fuite de secret : `.env*` refusés). Non bloquant pour la répétition TEST ; **à corriger avant production**.

**Remédiation (fondateur — `.htaccess` serveur, non écrit par la CI ni par l'agent sans décision)** — à ajouter au début du `.htaccess` de `~/app.grubano.com` (Apache 2.4, mod_alias) :

```apache
# Grubano — never serve build/ops files from the app root (Next serves only public/)
RedirectMatch 404 ^/(tmp|lib|scripts|prisma|node_modules|\.next)(/|$)
<FilesMatch "^(server\.js|package\.json|package-lock\.json|VERSION)$">
  Require all denied
</FilesMatch>
```

Vérification après écriture : les HEAD ci-dessus doivent rendre 404/403 ; `/fr/eat` et `/api/restaurants` restent 200 ; `/version.json` (dans `public/`, servi par Next) reste 200. Alternative : `PassengerHighPerformance on` (désactive la passe statique Apache) — à tester sur staging d'abord. L'opérateur v4 imprime cette mesure à chaque run (`APP-ROOT WEB EXPOSURE`).

## 6 · Note runbook répétition (revue sécurité F10)

Tant que la provenance du token n'est pas résolue, **deux identifiants** de provenance différente ouvrent `POST /api/admin/refunds/run` dès que `REFUNDS_ENABLED=true` (session admin **ou** header interne). Règle : la répétition TEST se fait **avec la session admin uniquement**, `REFUNDS_ENABLED=true` pendant la fenêtre la plus courte possible, jamais avant la décision §2. Aujourd'hui `REFUNDS_ENABLED=false` (mesuré) ⇒ le kill-switch précède l'auth ⇒ aucune exposition.


## 7 · MESURE GitHub ↔ runtime (2026-09-05, `internal-token-probe.yml` run 33961506645, statut seul)

`GET /api/admin/ledger/check` avec `secrets.INTERNAL_CRON_TOKEN` (GitHub, repo-level, maj 2026-07-03) → **HTTP 200** ⇒ **GITHUB SECRET == STAGING RUNTIME TOKEN = YES**.

Combiné à la mesure v3 (401 avec la ligne canonique de `.env.local`) : **la valeur que le processus staging compare est celle du secret GitHub, et elle diffère de `.env.local`.** Donc la source runtime effective de `INTERNAL_CRON_TOKEN` n'est **pas** `.env.local` — soit une injection hébergeur (cPanel Node.js « variables d'environnement » / Passenger), soit un fichier `.env.production.local`/`.env` ombrant ; l'opérateur v4 tranche entre les deux (`presentBeforeEnvLoad`, `definedIn`). Conséquences : (1) la CI (`cron.yml`, inactif) parlerait au staging ; (2) le **probe cPanel quotidien** (qui lit `../../.env.local`) est **aveugle** (401) — `~/logs` à lire ; (3) une rotation faite dans `.env.local` seul serait sans effet.

**Décision recommandée (mise à jour §2)** : rendre `.env.local` autoritaire en y écrivant la valeur **effective** (celle qui répond 200) — l'opérateur peut le faire **sans afficher** la valeur uniquement si elle est lisible côté serveur (fichier ombrant : copie ; injection hébergeur : la valeur est dans `process.env` du processus, pas de l'opérateur → le fondateur retire la variable côté cPanel et met à jour GitHub, ou l'inverse). Tant que ce n'est pas fait : `INTERNAL LEDGER HTTP AUTH = FAIL (401 depuis le fichier)` reste **P1 pré-prod**, non bloquant pour la réconciliation directe.


## 8 · Mesures v4 (opérateur fondateur, 2026-09-05) — provenance dans le VRAI processus (document only, aucune normalisation dans le train financier)

| Clé | `presentBeforeEnvLoad` (processus Passenger) | Lecture |
|---|---|---|
| `INTERNAL_CRON_TOKEN` | **YES** | **hébergeur/processus autoritaire** ; valeur ≠ `.env.local` (401 avec le fichier) ; = secret GitHub (200, §7) |
| `TIPS_ENABLED` | **YES** | injecté par l'hébergeur/processus avant le chargement des fichiers (runtime FALSE mesuré) |
| `ALERT_EMAIL` | **YES** | injecté par l'hébergeur/processus avant le chargement des fichiers (runtime `m.maazouz@grubano.com` mesuré) |

Conséquence pour la matrice §1 : pour ces trois clés, `ACTUAL SOURCE = process.env (hébergeur)`, `DUPLICATE SOURCES = YES` (fichier + hébergeur). Décision de normalisation (§2) = **train infra séparé**, après le gate financier ; aucune valeur, empreinte ou longueur n'est jamais écrite.

## 9 · Opérateur v5 — plomberie corrigée (2026-09-05)

v4 n'a pas mesuré la finance : Prisma sans `DATABASE_URL` (l'opérateur ne repeuplait plus `process.env`) et `stripe` absent du runtime standalone (bundlé par Next). v5 charge l'env via **`@next/env`** (le chargeur de l'app), passe l'URL à Prisma explicitement, et utilise un **client REST Stripe lecture seule** (GET, `api.stripe.com` épinglé) quand le SDK n'est pas résolvable — `scripts/server/reconcile-helpers.js`, testé. Le fichier de provenance reste hors racine (`~/.grubano/`). **`.htaccess` jamais touché.**
