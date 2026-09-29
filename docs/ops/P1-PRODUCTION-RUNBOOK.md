# P1 — PRODUCTION FERMÉE : RUNBOOK EXÉCUTABLE (PROD-5 → PROD-8)

> Rédigé le 2026-09-29 sur `171437d8` (develop). **Aucune action de ce runbook n'a été exécutée.**
> Rien n'a été touché sur le serveur, sur `main`, sur la production, sur Stripe, ni sur la visibilité du dépôt.
> Aucune valeur de secret n'apparaît dans ce document — uniquement des **noms**.

**Cible P1** : `grubano.com` sert réellement l'application Grubano actuelle — infrastructure, base production,
pipeline, sauvegarde et restauration fonctionnels — avec **les rails financiers LIVE et l'accès commercial
encore fermés**. C'est une **production technique**, pas une production commerciale (§7).

**Ce runbook ne fait pas** : ouvrir un drapeau argent · installer une clé Stripe LIVE · déplacer de l'argent ·
créer un chemin d'armement distant · remplir un fait légal · rendre le dépôt privé · lancer L11.

---

## 0 · L'ordre est imposé, et il est contre-intuitif

L'ordre naturel serait : *créer la base → pousser le schéma → déployer le code*. **Il est faux ici**, pour une
raison mesurée : le `prisma/schema.prisma` **présent sur le serveur de production** date du 30/05/2026
(18 550 o, 27 modèles) alors que celui du dépôt fait aujourd'hui 178 654 o et 77 modèles. Un `db push` lancé
depuis `~/grubano.com` **avant** un déploiement créerait le schéma de **mai** — une base d'apparence saine,
fausse de 50 modèles, sur laquelle l'application tournerait en 500 silencieux.

Second fait : le pipeline **exclut `node_modules` en totalité** (le chemin serveur est un lien symbolique
nodevenv ; Pure-FTPd répond 550 et **avorte toute la synchro**). L'application tourne donc sur les modules du
nodevenv, qui doivent avoir reçu un `npm install`. Et `node_modules/.prisma` est exclu aussi : **le client
Prisma se génère sur le serveur**, jamais par FTP.

Troisième fait : le pipeline **n'écrit jamais `.env.local`** et exclut `.env*`. Le fichier serveur est la
source de vérité — donc il doit exister avant le premier démarrage **utile**.

> **CORRECTION D'ORDRE (2026-09-29, second préflight).** La première version de ce runbook plaçait PROD-5
> en étape 2. C'était une erreur, et elle est apparue en répondant à une question précise du fondateur :
> « PROD-5 peut-il être exécuté sans déclencher aucune production publique ? ». **Non, pas à cette place.**
> Aujourd'hui `grubano.com` répond 500 sur toutes les pages ; si la cause est l'absence de `.env.local`,
> alors **créer ce fichier peut RÉVEILLER le demi-build de mai** et mettre en ligne, sur le domaine public,
> une application de mai 2026 branchée sur une base vide. Rien ne l'exige : le déploiement n'a pas besoin de
> `.env.local` pour déposer des fichiers (l'étape SSH ne fait qu'un `chmod … || true`), et le premier
> démarrage **utile** n'arrive qu'après PROD-6b. **PROD-5 descend donc après le déploiement #1**, ce qui
> supprime entièrement la fenêtre. Un runbook dont l'ordre n'a pas été interrogé par « qu'est-ce que ça
> rend public ? » est un runbook à moitié écrit.

D'où la séquence :

| # | Étape | Pourquoi ici | Effet public |
|---|---|---|---|
| 1 | **PROD-6a** créer la base + son utilisateur, **vide** | `DATABASE_URL` doit pointer quelque part de réel | **aucun** |
| 2 | **PROD-5c** aligner le secret `DATABASE_URL_PROD` | il alimente `Generate Prisma client` + `Build` et date de mai | **aucun** |
| 3 | **PROD-14** le bloc `.htaccess` — **répété sur staging d'abord** | le déploiement #1 rendra le **schéma courant** (77 modèles) publiquement lisible ; poser le bloc avant, c'est ne jamais l'exposer | ferme une exposition |
| 4 | **PROD-7** promotion `develop` → `main` | `deploy-production.yml` ne se déclenche que depuis la branche par défaut | **aucun** — le job `deploy` **attend votre approbation** |
| 5 | **Déploiement #1** — **partiellement rouge attendu** | il livre le schéma courant, le code et le `package.json` ; Passenger ne peut pas encore démarrer | le site reste en 500 |
| 6 | **PROD-5b** nodevenv + `npm install` | le pipeline ne livre aucun `node_modules` ; le `package.json` vient d'arriver | **aucun** |
| 7 | **PROD-5** `.env.local` (600) | **ici, et pas plus tôt** : le code courant est déjà sur le disque, donc aucun réveil du build de mai | **aucun** (toujours pas de schéma) |
| 8 | **PROD-6b** `db push` + `prisma generate` + restart | **maintenant seulement** le schéma poussé est le bon | **le site se met à servir** — catalogue vide, `/pay` refuse |
| 9 | **Vérification #2** — vert attendu | la porte DB passe : le client Prisma **déployé** atteint la base | — |
| 10 | **PROD-8** sauvegarde `--production` + **restauration répétée** | on ne sait sauvegarder que ce qu'on a su restaurer | **aucun** |

**Ce qui rend cette production « fermée » à l'étape 8 n'est pas un mur, c'est l'absence de matière** : base
vide ⇒ aucun restaurant publié et aucun restaurant `active` ⇒ `/pay` refuse par 409 ; aucune clé Stripe ⇒
aucun appel Stripe possible ; aucun drapeau argent ⇒ les rails refusent. Un visiteur voit un catalogue vide.
Une restriction par IP serait tentante mais **casserait les quatre portes du déploiement**, qui sondent depuis
les runners GitHub.

**Le déploiement #1 sera ROUGE et c'est correct** — mais **pas uniformément**, et la nuance compte pour le
diagnostic. Mesuré sur la production le 2026-09-29 : `/server.js` → **200** (878 o), `/package.json` → **200**
(2 089 o), `/prisma/schema.prisma` → **200** (18 550 o), tandis que `/fr/eat` et `/version.json` → **500**.
Autrement dit : **Apache sert directement les fichiers qui EXISTENT et ne passe à Passenger que les chemins
absents.** `/version.json` répond 500 aujourd'hui **parce que le fichier n'existe pas** (le demi-déploiement de
mai ne l'a jamais estampillé), pas parce que Passenger l'intercepterait.

Conséquence exacte au déploiement #1, à connaître **avant** de lire le run :

| Étape | Attendu | Pourquoi |
|---|---|---|
| `Deploy via FTP` | ✅ exit 0 | le téléversement ne dépend pas du runtime |
| `Verify deployed build (version.json)` | ✅ **VERT** | le fichier existe désormais et **Apache le sert lui-même** — il prouve le téléversement, **rien** sur le processus |
| `Health check (production @ expected SHA)` | ❌ rouge | il lit une **page**, donc Passenger |
| `Database reachable … (BLOCKING)` | ❌ rouge | `/api/restaurants` passe par Passenger, et le schéma n'existe pas |
| `Client bundle integrity` | ❌ rouge | il lit des pages servies |

**Un `version.json` vert pendant que le reste est rouge n'est donc pas une contradiction : c'est la preuve
mesurée que ce contrôle ne dit rien du runtime.** La porte DB imprime elle-même ses trois causes probables, la
première étant « the production schema was never created ». **Un rouge sur les trois dernières n'est pas un
incident ; un vert le serait** — il voudrait dire que l'ancien processus de mai sert encore.

⚠️ **Le déploiement #1 ne part pas tout seul.** Le job `deploy` de `deploy-production.yml` (ligne 71) déclare
`environment: production`, et cet environnement GitHub porte une règle `required_reviewers: [mmaazouz]`. Le job
`test` tourne d'abord, puis **le déploiement ATTEND votre approbation** dans l'onglet Actions. La promotion et
le premier téléversement sont donc deux décisions séparées, et c'est vous qui tenez la seconde.

---

## 1 · PROD-5 — `.env.local` de production

### 1.1 Classe A — obligatoires pour DÉMARRER

Sans elles : 500 sur toutes les routes, ou une authentification cassée.

| Nom | Rôle | Source attendue | TEST/LIVE | Absente en production fermée ? |
|---|---|---|---|---|
| `DATABASE_URL` | DSN MySQL Prisma. 72 sites de lecture. | cPanel → MySQL® Databases, après PROD-6a | — | **NON** |
| `NEXTAUTH_SECRET` | Signe et vérifie les JWT. `middleware.ts:178` appelle `getToken({ req })` sans secret explicite : NextAuth le lit dans l'environnement et **jette** s'il manque ⇒ 500 sur toute route gatée. | Généré pour la production, **distinct de staging** (`openssl rand -base64 32`) | — | **NON** |
| `NEXTAUTH_URL` | Base des callbacks et des redirections ; `app/api/auth/magic-link/route.ts:54` s'en sert comme origine autorisée. | `https://grubano.com` | — | **NON** |
| `NODE_ENV` | Le `server.js` standalone la pose lui-même. La déclarer ne change rien mais rend le fichier lisible. | `production` | — | oui (posée par le serveur) |

### 1.2 Classe B — obligatoires avant les SMOKE TESTS

Sans elles l'application démarre, mais un parcours ne se teste pas de bout en bout.

| Nom | Rôle | Source attendue | TEST/LIVE | Absente en production fermée ? |
|---|---|---|---|---|
| `INTERNAL_CRON_TOKEN` | Jeton des routes cron internes (17 sites). Absent ⇒ les crons refusent — **côté sûr**, mais aucun cron ne se teste. | Généré pour la production | — | oui, si aucun cron n'est testé |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Envoi transactionnel (confirmation de commande, magic-link, alertes). Absents ⇒ l'e-mail échoue. | cPanel → Comptes e-mail | — | oui pour la production **technique** ; **NON** avant une vraie commande |
| `ALERT_EMAIL` | Destinataire des alertes admin (PI périmé, incident). Absent ⇒ l'alerte ne part nulle part. | Une boîte réellement lue | — | oui, mais alors vous êtes aveugle |
| `CRON_SECRET` | Protège `/api/email-agent`. | Généré pour la production | — | oui |
| `ANTHROPIC_API_KEY` | Fonctions IA (scan de plat, briefing, prefill d'onboarding). Absente ⇒ ces routes seules échouent. | Console Anthropic | — | oui |
| `SITE_URL` | Base des liens absolus dans les crons. **Défaut déjà correct en production** : `https://www.grubano.com`. | — | — | oui (défaut correct) |
| `RATE_LIMIT_ENABLED` | Limitation de débit. C'est un drapeau de **protection** : l'oublier laisse le trou ouvert. | `true` | — | déconseillé : posez-le à `true` |

### 1.3 Classe C — obligatoires uniquement avant Stripe LIVE

| Nom | Rôle | Source attendue | TEST/LIVE | Absente en production fermée ? |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Clé serveur. `lib/stripe.ts:getStripe()` jette `stripe_not_configured` si absente ⇒ `/pay` répond 500 « Paiement non configuré ». | Dashboard Stripe | **TEST** pour PROD-11 ; LIVE seulement à l'étape LIVE | **OUI** — et son absence est la protection la plus forte (§7) |
| `STRIPE_PUBLISHABLE_KEY` | Clé front (Elements). | Dashboard Stripe | TEST puis LIVE | OUI |
| `STRIPE_WEBHOOK_SECRET` | Vérification de signature du webhook « Your account ». Absente ⇒ 500 `Webhook not configured`. | Dashboard → Webhooks | TEST puis LIVE | OUI, sauf pour PROD-11 |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Idem pour l'endpoint « Connected accounts » (`account.updated`). | Dashboard → Webhooks Connect | TEST puis LIVE | OUI |
| `STRIPE_FEE_PCT` / `STRIPE_FEE_FIXED_CENTS` | Modèle de frais utilisé par le calcul fidélité. **Défauts 0.029 / 25** déjà conformes au tarif standard. | — | — | oui (défauts corrects) |

### 1.4 Classe D — obligatoires avant l'ouverture restaurant / client

| Nom | Rôle | Source attendue | TEST/LIVE | Absente en production fermée ? |
|---|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Upload des photos de plats (`lib/dish-photo.ts`). Absentes ⇒ `cloudinary_not_configured`. | Console Cloudinary | — | oui, jusqu'à ce qu'un restaurant charge une photo |
| `YOUTUBE_API_KEY` | Vérification d'audience créateur. | Google Cloud | — | oui |
| `ALERT_EMAIL` | (voir classe B) — devient **obligatoire** : c'est le seul canal d'incident. | — | — | **NON** |

### 1.5 Ce qui doit rester ABSENT — et pourquoi c'est une décision, pas un oubli

| Nom | Conséquence si posé |
|---|---|
| `ALLOW_PLATFORM_FALLBACK` | **Danger-flag d'ouverture** : à `true`, une commande d'un restaurant sans Connect actif est encaissée en PI nu, **100 % de l'argent — part restaurant comprise — reste sur le compte Grubano, et aucun rail de reversement restaurant n'existe.** Doit rester absent. |
| Les 14 drapeaux de `MONEY_FLAGS_MUST_BE_FALSE` | `REFUNDS_ENABLED`, `CLAIMS_ENABLED`, `CLAIMS_AUTO_APPROVE_ENABLED`, `CLAIM_AUTO_RESOLVE_ENABLED`, `GHOST_ORDER_AUTO_REFUND_ENABLED`, `LOGISTICS_COURIER_ACTIVATION_ENABLED`, `TIPS_ENABLED`, `LOGISTICS_PAYOUT_ENABLED`, `DELIVERY_FULFILLMENT_ENABLED`, `CHARGEBACKS_ENABLED`, `PUNITIVE_CAPTURE_ENABLED`, `AFFILIATE_CONNECT_ENABLED`, `FRANCHISE_SETTLEMENT_ENABLED`, `CREATOR_PAYOUT_ENABLED`. Absent = OFF : la posture sûre est le **silence**, pas `=false`. |
| `QA_*`, `SEED_DEMO_*`, `PHASE2_*`, `DPRIME_*`, `NOTION_TOKEN` | Variables d'outillage local ou de répétition staging. `scripts/qa` n'est même pas déployé. Aucune n'a sa place dans un `.env.local` de production. |

### 1.6 Les quatre noms-LEURRES — à ne pas poser en croyant régler PROD-10

`.env.example` propose `GRUBANO_LEGAL_NAME`, `GRUBANO_SIREN`, `GRUBANO_VAT_NUMBER`, `GRUBANO_LEGAL_ADDRESS`
— et **`BREVO_API_KEY`**. Vérifié : **aucun code ne lit ces cinq noms** (0 occurrence de `process.env.<nom>`
dans `app/`, `lib/`, `scripts/`, `middleware.ts`). `.env.example` est périmé sur ce point.

Conséquence à connaître avant PROD-10 : **l'identité légale ne se remplit pas par variable d'environnement.**
La seule source est `lib/legal-info.ts`, compilé dans le build ⇒ remplir les faits légaux demande **un commit
et un redéploiement**, pas une édition de fichier sur le serveur.

### 1.7 Le canal qui GAGNE sur `.env.local`

`@next/env` **n'écrase jamais** une clé déjà présente dans `process.env`. Ordre effectif :

```
process.env (cPanel Node.js selector / Passenger / CloudLinux / le shell)
  > .env.production.local > .env.local > .env.production > .env
```

Ce dépôt a **déjà mesuré** trois clés injectées en production par le panneau « Environment variables » du
sélecteur Node.js de cPanel. Un drapeau argent posé là **gagne silencieusement** sur un `.env.local` propre.
**Avant le premier démarrage : ouvrir cPanel → Setup Node.js App → l'application `grubano.com` → vérifier que
la liste des variables d'environnement est VIDE**, ou au minimum qu'elle ne contient aucun nom du §1.5.

### 1.8 Fiche d'action — PROD-5

| | |
|---|---|
| **Répertoire** | `~/grubano.com` |
| **Utilisateur** | `deyi0010` (cPanel Terminal ou éditeur de fichiers cPanel) |
| **Préconditions** | **le déploiement #1 a eu lieu** (sinon créer ce fichier peut réveiller le build de mai sur le domaine public — voir la correction d'ordre au §0) ; PROD-5b fait ; la base de PROD-6a est créée et son DSN est connu ; le panneau de variables du sélecteur Node.js est vérifié vide (§1.7) ; **première commande : prouver qu'aucune clé Stripe n'est déjà posée** (§14.3) |
| **Fichiers touchés** | `~/grubano.com/.env.local` — **créé** |
| **Commande exacte** | Par l'**éditeur de fichiers cPanel** (recommandé : aucune valeur ne transite par un historique de shell), puis dans le Terminal : |

```bash
chmod 600 ~/grubano.com/.env.local
ls -l ~/grubano.com/.env.local
```

| | |
|---|---|
| **Sortie attendue** | `-rw------- 1 deyi0010 deyi0010 … .env.local` |
| **Test de succès** | `grep -c '^[A-Z]' ~/grubano.com/.env.local` renvoie le nombre de variables posées ; `stat -c '%a' ~/grubano.com/.env.local` renvoie `600`. **Le test d'application vient au déploiement #2**, pas ici. |
| **Condition STOP** | le mode n'est pas `600` ; ou le fichier contient un nom du §1.5 ; ou le DSN pointe sur `…_staging` ⇒ **NE PAS DÉMARRER**, corriger d'abord |
| **Rollback immédiat** | `rm ~/grubano.com/.env.local` puis `touch ~/grubano.com/tmp/restart.txt`. L'application revient à l'état 500 actuel — c'est-à-dire l'état d'avant. |
| **Réversible** | **OUI**, totalement. Aucune donnée, aucun argent, aucun objet externe. |

⚠️ Ne **jamais** copier le `.env.local` de staging. Il porte le DSN staging, l'`NEXTAUTH_URL` staging et des
drapeaux de répétition. Un `NEXTAUTH_SECRET` partagé rendrait en outre un JWT staging valide en production.

---

## 2 · PROD-5b — le nodevenv (l'étape que le tableau ne montrait pas)

Le pipeline **exclut `node_modules` et `node_modules/**`** : l'application tourne sur les modules du nodevenv.
Si le nodevenv de `grubano.com` n'a jamais reçu de `npm install`, le déploiement réussit et l'application
échoue sur `Cannot find module 'next'`.

| | |
|---|---|
| **Répertoire** | `~/grubano.com` |
| **Utilisateur** | `deyi0010` |
| **Préconditions** | l'application Node est déclarée dans cPanel → Setup Node.js App, version **24**, racine `grubano.com`, fichier de démarrage `server.js` |
| **Fichiers touchés** | le `node_modules` du nodevenv (hors dépôt) |
| **Commande exacte** | |

```bash
source ~/nodevenv/grubano.com/24/bin/activate
cd ~/grubano.com
node -v
npm install --omit=dev
ls node_modules/next/package.json
```

| | |
|---|---|
| **Sortie attendue** | `v24.x` ; `npm install` termine sans `ERR!` ; le `package.json` de `next` est listé |
| **Test de succès** | `node -e "require.resolve('next')"` ne jette pas |
| **Condition STOP** | `node -v` ne renvoie pas 24 (le sélecteur cPanel pointe une autre version) ; ou `npm install` échoue sur un quota disque |
| **Rollback immédiat** | aucun besoin : ajouter des modules ne casse rien. En cas de doute, `rm -rf` du `node_modules` du nodevenv puis re-`npm install`. |
| **Réversible** | **OUI** |

> **Pourquoi cette étape vient APRÈS le déploiement #1** : `~/grubano.com/package.json` arrive par le
> déploiement (il vient du standalone). Celui présent aujourd'hui sur le serveur date de mai — un
> `npm install` exécuté avant le déploiement installerait l'arbre de dépendances de mai.
---

## 3 · PROD-5c — le secret GitHub `DATABASE_URL_PROD`

`deploy-production.yml` passe `DATABASE_URL: ${{ secrets.DATABASE_URL_PROD }}` aux étapes
`Generate Prisma client` (ligne 92) et `Build` (ligne 97). Le secret **existe déjà** dans le dépôt — il date
donc du demi-déploiement de mai et pointe vraisemblablement sur une base qui n'est plus la bonne.

Après PROD-6a, mettre `DATABASE_URL_PROD` **à la même valeur** que le `DATABASE_URL` du `.env.local` serveur.
Chemin : GitHub → Settings → Secrets and variables → Actions → `DATABASE_URL_PROD` → Update.

| | |
|---|---|
| **Test de succès** | le job `deploy` atteint `Build` sans erreur Prisma |
| **Condition STOP** | le secret contient `…_staging` ⇒ le build de production se ferait contre la base de staging |
| **Rollback** | remettre l'ancienne valeur (GitHub ne la conserve pas : notez-la hors dépôt **avant** de la remplacer si vous voulez pouvoir revenir) |
| **Réversible** | oui, si vous avez noté l'ancienne valeur ailleurs |

> À l'exécution c'est le `.env.local` du serveur qui gouverne, jamais ce secret. `NEXTAUTH_SECRET` est le même
> secret GitHub pour staging et production : sans effet, parce qu'il ne sert qu'au build. Les deux runtimes
> doivent en revanche avoir des `NEXTAUTH_SECRET` **différents** dans leurs `.env.local` respectifs (§1.8).

---

## 4 · PROD-6 — la base de production

### 4.1 PROD-6a — créer la base et son utilisateur (cPanel, **pas** le shell)

Sur un hébergement cPanel mutualisé, l'utilisateur MySQL de l'application **n'a pas** le privilège global
`CREATE DATABASE`. La création passe donc obligatoirement par l'interface, et c'est une bonne chose : elle
scope les privilèges à **une seule** base.

| | |
|---|---|
| **Répertoire / interface** | cPanel → **MySQL® Databases** (pas de shell) |
| **Utilisateur** | le compte cPanel `deyi0010` |
| **Préconditions** | quota de bases disponible ; le nom choisi **ne finit pas par `_staging`** |
| **Fichiers touchés** | aucun fichier du dépôt |
| **Actions exactes** | 1. *Create New Database* → nom `grubano` (cPanel préfixe ⇒ `deyi0010_grubano`). 2. *Add New User* → un utilisateur **distinct** de celui de staging, mot de passe généré par cPanel. 3. *Add User To Database* → associer **uniquement** à `deyi0010_grubano`. |
| **Privilèges** | cochez **ALL PRIVILEGES sur cette base**. C'est déjà la minimalité qui compte ici : cPanel ne donne jamais de privilège **global**, et l'utilisateur de production **n'a aucun grant sur `deyi0010_grubano_staging`** — c'est cette séparation-là qui protège, pas le détail des cases. Si vous voulez resserrer plus tard : `db push` a besoin de `CREATE, ALTER, DROP, INDEX, REFERENCES` ; le runtime de `SELECT, INSERT, UPDATE, DELETE` ; `mysqldump --routines --triggers` de `SELECT, LOCK TABLES, SHOW VIEW, TRIGGER`. Retirer `DROP` empêcherait toute évolution future de schéma. |
| **Sortie attendue** | la base apparaît dans « Current Databases » avec **0 tables** et l'utilisateur associé |
| **Test de succès** | dans le Terminal : `mysql -u deyi0010_<user> -p -e "SHOW DATABASES; SELECT DATABASE();"` → la base est listée, `deyi0010_grubano_staging` **n'est pas** listée |
| **Condition STOP** | la base apparaît avec des tables (ce n'est pas une base vierge) ; ou `SHOW DATABASES` liste la base de staging (les privilèges débordent) |
| **Rollback immédiat** | cPanel → MySQL® Databases → *Delete Database*. Vierge, donc sans perte. |
| **Réversible** | **OUI** tant qu'elle est vide. **IRRÉVERSIBLE dès qu'elle contient une commande réelle.** |

### 4.2 Ne jamais pointer sur staging — les quatre contrôles

1. **Nommage** : le prédicat du dépôt est `/_staging$/`. Une base de production s'appelle `deyi0010_grubano`,
   jamais `deyi0010_grubano_staging`.
2. **`NEXTAUTH_URL`** : `https://grubano.com` en production ; `app.grubano.com` en staging. Les opérateurs
   croisent les deux signaux (base **et** URL) et **refusent l'ambiguïté** dans les deux sens.
3. **Séparation d'utilisateur** : l'utilisateur de production ne voit pas la base de staging (test ci-dessus).
4. **Les opérateurs refusent par nom** : `phase1-staging-migrate.js` et `dprime-staging-migrate.js` refusent
   la production ; `staging-backup.js` refuse un DSN de production sur son chemin staging et refuse
   `--production` pointé sur staging. Ces refus sont exécutés par des tests, pas seulement documentés.

### 4.3 PROD-6b — appliquer le schéma **de l'application actuelle**

**Précondition non négociable : le déploiement #1 a déjà eu lieu.** Sinon `~/grubano.com/prisma/schema.prisma`
est celui du 30/05 et vous créeriez le schéma de mai.

| | |
|---|---|
| **Répertoire** | `~/grubano.com` |
| **Utilisateur** | `deyi0010` (cPanel Terminal) |
| **Préconditions** | PROD-5 fait ; PROD-5b fait ; base **vide** ; déploiement #1 terminé (FTP exit 0) |
| **Fichiers touchés** | aucun fichier — **la base** est modifiée (création du schéma) |
| **Commandes exactes** | |

```bash
source ~/nodevenv/grubano.com/24/bin/activate
cd ~/grubano.com

# 1. PROUVER qu'on va pousser le schéma COURANT, pas celui de mai
wc -c prisma/schema.prisma
grep -c '^model ' prisma/schema.prisma

# 2. PROUVER que la base est vide (0 = vierge)
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.\$queryRawUnsafe('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()').then(r=>{console.log('tables:',r[0].n);return p.\$disconnect()})"

# 3. Créer le schéma — SANS --accept-data-loss
npx prisma@5.22.0 db push

# 4. Régénérer le client pour le binaryTarget du serveur
npx prisma@5.22.0 generate

# 5. Redémarrer Passenger
touch ~/grubano.com/tmp/restart.txt
```

| | |
|---|---|
| **Sortie attendue** | `178654` (± la taille du jour) · `77` · `tables: 0` · `Your database is now in sync with your Prisma schema.` · `Generated Prisma Client (v5.22.0)` |
| **Test de succès** | (a) `grep -c '^model ' prisma/schema.prisma` == le nombre de tables comptées après le push ; (b) `curl -s -o /dev/null -w '%{http_code}' https://grubano.com/api/restaurants` → **200** ; (c) `curl -s https://grubano.com/api/restaurants` → liste **vide** (`[]` ou `{"restaurants":[]}`) : une base vierge et joignable |
| **Condition STOP** | **`wc -c` renvoie ~18 550 ou `grep -c '^model '` renvoie 27** ⇒ c'est le schéma de mai, le déploiement n'a pas eu lieu : **ARRÊT**. · **`tables:` ≠ 0** ⇒ la base n'est pas vierge : **ARRÊT**, ne pas pousser. · **Prisma réclame `--accept-data-loss`** ⇒ **ARRÊT** : sur une base vierge il n'y a rien à perdre, donc cette demande signifie que la base n'est pas vierge ou que le schéma diverge. **Ne jamais satisfaire cette demande en ajoutant le drapeau.** |
| **Rollback immédiat** | base vierge ⇒ cPanel → *Delete Database*, la recréer, reprendre. Aucune donnée perdue **parce qu'il n'y en avait aucune** — ce rollback cesse d'exister dès la première commande réelle. |
| **Réversible** | **OUI** tant que la base est vide. **NON ensuite.** |

### 4.4 Pourquoi `db push` est la bonne méthode **aujourd'hui**, et ce qui protège demain

`prisma db push` est approprié **ici et une seule fois** :

- Il n'existe **aucun** `prisma/migrations` dans ce dépôt : `prisma migrate deploy` n'aurait rien à appliquer.
- Sur une base **vierge**, `db push` est total et déterministe : il crée le schéma à partir de
  `schema.prisma`. La notion de « perte de données » est **vide** — il n'y a pas de donnée.
- `--accept-data-loss` n'est demandé par Prisma que lorsque le push **supprimerait** quelque chose. Sur une
  base vierge, jamais. **Sa demande est donc un signal d'alarme, pas une formalité.**

Ce qui protège les évolutions **futures** :

| Protection | État |
|---|---|
| `--accept-data-loss` retiré de `deploy-production.sh` et `deploy-staging.sh` | ✅ PROD-1, `6dd99d1f`, épinglé par un test sur les lignes **exécutables** |
| Opérateurs additifs `ALTER TABLE … ADD COLUMN IF NOT EXISTS` avec sauvegarde vérifiée | ✅ `phase1-staging-migrate.js`, `dprime-staging-migrate.js` |
| Schéma poussé **avant** le code, puis régénération du client | ✅ procédure §7 de CLAUDE.md |
| Les opérateurs de migration refusent la production **par nom** | ✅ et les refus sont exécutés par des tests |
| `npm run prisma:migrate` = `prisma migrate dev` — **qui propose de RÉINITIALISER la base** | ❌ **toujours présent dans `package.json`** (ligne 20). À retirer. Classé 🟢 mais c'est le seul script du dépôt qui puisse vider une base par accident. |
| Un garde **mécanique** empêchant `db push --accept-data-loss` contre production | ❌ **n'existe pas**. La protection est procédurale. |

**Décision proposée (pas exécutée)** : après PROD-6b, créer une **migration de référence** (`prisma migrate
diff` → `prisma/migrations/0_init`, puis `migrate resolve --applied 0_init`) et passer toute évolution
ultérieure par `migrate deploy`, qui **ne supprime jamais** sans migration écrite et relue. C'est le correctif
structurel au dernier trou du tableau. Il demande un commit ⇒ votre arbitrage.

---

## 5 · PROD-7 — `develop` → `main`

### 5.1 État actuel — mesuré

| Fait | Valeur mesurée |
|---|---|
| `main` (tête) | `7e030375` « Update site info for publish » — arbre **Lovable/Vite/Cloudflare** : `src/`, `vite.config.ts`, `bun.lock`, `bunfig.toml`, `wrangler.jsonc`, `.lovable`, **aucun `.github/`** |
| `develop` (tête) | `171437d8` — l'application Next.js actuelle |
| Base commune | **AUCUNE** : `git merge-base origin/main origin/develop` sort **1** — histoires non apparentées |
| Branche par défaut | **`main`** |
| Conséquence | `deploy-production.yml` n'existe pas sur la branche par défaut ⇒ `workflow_dispatch` et `schedule` sont **inatteignables** aujourd'hui |
| `main` protégée | **OUI** : `enforce_admins: true` (aucune exception pour vous), `allow_force_pushes: false`, `allow_deletions: false`, revue de PR requise (**0 approbation** nécessaire), `required_status_checks.strict: true` avec **0 check obligatoire** |
| Archive déjà en place | `origin/backup/main-pre-promotion-2026-07-12` pointe **exactement** sur `7e030375` — `main` n'a pas bougé depuis le 12/07 |
| Tentative antérieure | `origin/promote/security-develop-to-main` porte déjà un commit de fusion `12d0edaa` (12/07) — **jamais fusionné**. `develop` a avancé de **400 commits** depuis. |

**Ce que la protection impose, et qui vous arrange** : vous **ne pouvez pas** pousser directement sur `main`,
ni forcer, même en tant que propriétaire. La promotion **doit** passer par une pull request. C'est exactement
le mécanisme auditable que vous demandez, et il est imposé par GitHub plutôt que par ma discipline.

### 5.2 Stratégie retenue — fusion à deux parents, arbre de `develop` à l'identique

Le mécanisme existe déjà dans ce dépôt (`12d0edaa` en est la preuve) : un commit de fusion dont **parent 1**
est la tête de `main`, **parent 2** la tête de `develop`, et dont **l'arbre est celui de `develop` au
bit près**. Rien n'est réécrit, rien n'est forcé, l'historique Lovable reste atteignable.

**J'ai rejoué la recette à blanc** dans un worktree jetable, sur `origin/main` + `171437d8`, puis supprimé le
worktree. Résultat mesuré :

```
parents : 7e030375 (Lovable) + 171437d8 (develop)
git diff --stat <fusion> origin/develop  → VIDE  (arbre identique)
résidu Vite dans l'arbre obtenu         → 0     (src/, vite.config, bun.lock, wrangler, .lovable : aucun)
commits atteignables depuis la fusion   → 1278  (l'histoire Lovable est conservée)
git merge-base <fusion> origin/develop  → 171437d8  ⇒ develop devient un ANCÊTRE
```

Cette dernière ligne est l'enjeu réel : **après cette promotion, toute promotion suivante est une fusion
ordinaire**, avec une vraie base commune. Le problème des histoires non apparentées ne se pose qu'une fois.

**Pourquoi pas `-X theirs` avec `--allow-unrelated-histories`** : sans ancêtre commun, Git ne sait pas que
`src/` a été « supprimé » — il le **conserverait**. On obtiendrait un arbre hybride Next + Vite. C'est
précisément le « résidu Vite susceptible de brouiller les déploiements » que vous voulez éviter.
`read-tree --reset` remplace l'arbre en entier : c'est la seule forme qui garantit 0 résidu.

### 5.3 Commandes préparatoires (locales, aucune poussée)

| | |
|---|---|
| **Répertoire** | `C:\Users\Lenovo\grubano` |
| **Utilisateur** | vous, sur votre poste |
| **Préconditions** | arbre de travail propre (`git status --porcelain` vide) ; `git fetch origin` récent ; vous êtes sur `develop` |
| **Fichiers touchés** | aucun fichier du dépôt — seulement `.git` et une nouvelle branche **locale** |
| **Commandes exactes** | |

```bash
cd /c/Users/Lenovo/grubano
git fetch origin --prune
git status --porcelain            # doit être VIDE

# 1. Archiver l'état actuel de main — la branche existe déjà, on ajoute un TAG immuable
git tag -a lovable-site-final -m "Site Lovable/Vite servi par main jusqu'a la promotion Grubano" origin/main
git push origin lovable-site-final

# 2. Construire la fusion de promotion sur une branche dediee
git checkout -B promote/prod-2026-09-XX origin/main
git merge -s ours --no-commit --allow-unrelated-histories origin/develop
git read-tree --reset -u origin/develop
git commit -m "merge: promote develop to main — Grubano production"

# 3. PROUVER avant de pousser : arbre identique, zero residu, deux parents
git diff --stat HEAD origin/develop                      # doit etre VIDE
git ls-tree -r --name-only HEAD | grep -cE '^(src/|vite\.config|bun\.lock|bunfig|wrangler|\.lovable)'   # doit etre 0
git log -1 --format='%p'                                 # doit afficher DEUX sha
git log -1 --format='p1=%h %s' HEAD^1
git log -1 --format='p2=%h %s' HEAD^2

# 4. Pousser la BRANCHE seulement (main n'est pas touchee)
git push -u origin promote/prod-2026-09-XX
```

| | |
|---|---|
| **Sortie attendue** | `git diff --stat` **vide** ; le `grep -c` renvoie **0** ; `%p` affiche deux SHA ; `p1` = `7e030375 Update site info for publish` ; `p2` = la tête de `develop` |
| **Test de succès** | les quatre preuves de l'étape 3 |
| **Condition STOP** | `git diff --stat HEAD origin/develop` **non vide** ⇒ l'arbre n'est pas celui de `develop`, **ne poussez pas** · le `grep -c` > 0 ⇒ résidu Vite, **ne poussez pas** · `%p` n'affiche qu'un seul SHA ⇒ le second parent n'a pas été enregistré (`MERGE_HEAD` perdu) : recommencez à l'étape 2 |
| **Rollback immédiat** | `git checkout develop && git branch -D promote/prod-2026-09-XX` ; si déjà poussée : `git push origin --delete promote/prod-2026-09-XX`. Le tag : `git push origin --delete lovable-site-final`. |
| **Réversible** | **OUI** entièrement : `main` n'a pas bougé, rien n'est réécrit, aucun déploiement n'est déclenché (le workflow de production ne se déclenche que sur `main`). |

### 5.4 La fusion (pull request) — c'est elle qui déclenche le déploiement #1

| | |
|---|---|
| **Interface** | GitHub → Pull requests → New → base `main` ← compare `promote/prod-2026-09-XX` |
| **Préconditions** | les quatre preuves du §5.3 ; PROD-6a et PROD-5 **faits** (sinon le déploiement #1 échouera pour une raison de plus) ; `DATABASE_URL_PROD` mis à jour (PROD-5c) |
| **Sortie attendue** | le check `test` du workflow « CI — tests » tourne sur la PR et passe ; le bouton de fusion est disponible (0 approbation requise) |
| **Méthode de fusion** | **« Create a merge commit »** — et **rien d'autre** |
| **Condition STOP** | **« Squash and merge » détruirait le second parent** : `develop` ne deviendrait pas un ancêtre de `main`, et **chaque promotion future reposerait le problème des histoires non apparentées**. « Rebase and merge » réécrirait 400 commits. Si seul « Squash » est proposé, **arrêtez** et changez le réglage du dépôt (Settings → General → Pull Requests → *Allow merge commits*). |
| **Effet immédiat** | la fusion pousse sur `main` ⇒ `on: push: branches: [main]` déclenche **`deploy-production.yml`**. Le job `test` tourne, puis le job `deploy` **s'arrête et attend votre approbation** (`environment: production`, `required_reviewers: [mmaazouz]`, vérifié le 2026-09-29). **Rien n'est téléversé avant que vous cliquiez.** C'est le déploiement #1, et il sera partiellement rouge (§0). |
| **Rollback immédiat** | `main` est protégée contre le force-push : on ne « défait » pas la promotion, **on en pousse une autre**. Si l'arbre promu est mauvais : ouvrir une seconde PR qui remet l'arbre voulu (même recette, `read-tree --reset -u <bon-sha>`). La production, elle, se rollback par redéploiement (§5.6). |
| **Réversible** | la **branche** ne redevient pas ce qu'elle était (pas de force-push) ; le **contenu** est toujours re-poussable ; l'histoire Lovable reste intacte (branche + tag). |

### 5.5 Conséquences Git — la liste complète

1. `main` porte l'arbre de `develop`, **au bit près**. `git diff main origin/develop` : vide.
2. L'histoire Lovable reste **atteignable** depuis `main` (1278 commits) **et** archivée deux fois :
   `origin/backup/main-pre-promotion-2026-07-12` + le tag `lovable-site-final`.
3. `git log main -- src/` continue de montrer l'histoire Vite. Rien n'est réécrit, aucun SHA ne change.
4. `develop` devient un **ancêtre** de `main` ⇒ promotions futures = `git merge origin/develop` ordinaire.
5. `deploy-production.yml` devient **atteignable** : `workflow_dispatch` apparaît dans l'interface Actions.
6. ⚠️ **`cron.yml` devient ACTIF.** GitHub ne déclenche `schedule` que depuis la branche par défaut. Trois
   planifications dormantes s'allument : `*/20 * * * *` (sweep), `20 3 * * *` (daily), `0 7 1 * *` (mensuel).
   Elles visent la variable de dépôt `CRON_TARGET_BASE_URL`, **vérifiée = `https://app.grubano.com`** — donc
   **staging**, pas production. Vérifiez-le **avant** de fusionner : cette variable est le seul garde-fou entre
   trois planifications et votre production. Le lot mensuel `0 7 1 * *` est précisément celui des factures,
   que PROD-4 refuse désormais par 409 tant que l'identité légale est vide.
7. ⚠️ `refund-rehearsal.yml` devient dispatchable depuis `main`. **Je ne le déclencherai pas** — L11 attend
   votre phrase exacte.
8. `origin/promote/security-develop-to-main` (12/07) devient de l'histoire morte : à supprimer après
   promotion, pour qu'il n'y ait qu'un seul mécanisme visible.

### 5.6 Rollback de PRODUCTION vers un SHA antérieur

Le rollback de branche et le rollback de production sont deux choses différentes. Le second se fait par
**redéploiement d'un ref antérieur**, sans toucher `main` :

```bash
# Etiqueter CHAQUE mise en production, immediatement apres un deploiement vert
git tag -a prod-2026-09-XX -m "production verte, SHA <sha>" <sha> && git push origin prod-2026-09-XX

# Rollback = redeployer le tag precedent
gh workflow run deploy-production.yml --ref prod-2026-09-WW
```

| | |
|---|---|
| **Précondition** | le ref visé doit **contenir** `deploy-production.yml` — vrai pour tout tag créé après la promotion, **faux pour tout tag antérieur** |
| **Test de succès** | `/version.json` sert le SHA du tag redéployé ; `/api/restaurants` 200 |
| **Condition STOP** | si le rollback vise un SHA dont le **schéma** diffère, un redéploiement de code **ne défait pas** une migration de base. Le rollback de schéma est PROD-8, pas celui-ci. |
| **Réversible** | oui, le code. **La base, non** — d'où PROD-8. |

⚠️ **Le déploiement #1 n'a pas de cible de rollback.** Il n'existe aucun tag `prod-*` et le seul état
antérieur est le demi-déploiement de mai, qui répond 500 sur tout. Le « rollback » du premier déploiement est
donc : **le 500 que vous avez déjà**. Ce n'est pas un problème — c'est la raison pour laquelle le premier
déploiement ne peut pas être une régression.
---

## 6 · PROD-8 — sauvegarde **et restauration prouvée**

Un fichier de dump n'est pas une sauvegarde. Une sauvegarde est un fichier **dont on a rechargé le contenu
ailleurs et vérifié qu'il rendait le schéma et les comptes attendus**. C'est exactement votre exigence, et
c'est aussi l'état honnête du dépôt : la restauration est aujourd'hui **une seule phrase** dans
`PHASE1-STAGING-PROCEDURE.md`, avec un exercice réussi sur un clone **local**, et **aucun opérateur de
restauration**. Côté production : rien, jamais.

### 6.1 Étape 1 — la sauvegarde `--production`

| | |
|---|---|
| **Répertoire** | `~/grubano.com` |
| **Utilisateur** | `deyi0010` |
| **Préconditions** | PROD-6b fait ; `mysqldump` disponible (`command -v mysqldump`) ; `~/grubano-backups` accessible ; espace disque suffisant |
| **Fichiers touchés** | **créé** : `~/grubano-backups/production-<label>-<timestamp>.sql.gz`. Aucune écriture en base (`COUNT(*)` en lecture seule). |
| **Commande exacte** | |

```bash
source ~/nodevenv/grubano.com/24/bin/activate
cd ~/grubano.com
GRUBANO_BACKUP_CONFIRM="I AUTHORIZE A PRODUCTION DATABASE BACKUP" \
  node scripts/server/staging-backup.js --production --label pre-launch
```

| | |
|---|---|
| **Sortie attendue** | une première ligne `[db-backup] TARGET=PRODUCTION` suivie du DSN **masqué** (`mysql://***:***@…/deyi0010_grubano`) et du label, puis le bloc : `RESULT: PASS` · `BACKUP FILE:` · `SIZE:` · `SHA256:` · `DUMP:` · `MANIFEST:` · **`DATABASE CHANGED: NO`** |
| **Test de succès** | `RESULT: PASS` **et** `DATABASE CHANGED: NO` **et** le nom de fichier commence par `production-` |
| **Condition STOP** | `RESULT: FAIL` — l'opérateur imprime `FAILED STEP` et `ACTION`, suivez-les et ne continuez pas. Trois refus à connaître : attestation absente ou inexacte ⇒ `2 production-proof: GRUBANO_BACKUP_CONFIRM is not the exact attestation sentence` · `--production` sur un shell **staging** ⇒ refus (c'est le cas dangereux : **une fausse sauvegarde est celle qu'on restaurera**) · base non identifiable ⇒ refus |
| **Rollback immédiat** | `rm <fichier>`. L'opération est en lecture seule : il n'y a rien à défaire en base. |
| **Réversible** | **OUI** — sans effet de bord par construction |

### 6.2 Étape 2 — contrôle du fichier, **hors** du serveur

| | |
|---|---|
| **Répertoire** | votre poste, un dossier **hors du dépôt** |
| **Préconditions** | le fichier téléchargé par cPanel → File Manager |
| **Commandes exactes** | |

```bash
gzip -t production-pre-launch-<ts>.sql.gz            # integrite gzip
sha256sum production-pre-launch-<ts>.sql.gz          # doit EGALER le SHA256 imprime par l'operateur
zcat production-pre-launch-<ts>.sql.gz | grep -c '^CREATE TABLE'
zcat production-pre-launch-<ts>.sql.gz | grep -c '^INSERT INTO'
zcat production-pre-launch-<ts>.sql.gz | tail -1     # doit contenir "-- Dump completed"
```

| | |
|---|---|
| **Sortie attendue** | `gzip -t` silencieux ; sha256 **identique** ; `CREATE TABLE` = 77 ; le marqueur présent |
| **Test de succès** | les quatre à la fois. Un sha256 différent = **transfert corrompu**, recommencez le téléchargement. |
| **Condition STOP** | `CREATE TABLE` ≠ 77 ⇒ des tables manquent (droits insuffisants) : **la sauvegarde est incomplète**, corrigez les privilèges et recommencez |
| **Rollback / Réversible** | aucun effet, **OUI** |

⚠️ Ne jamais committer un dump. `.gitignore` n'en protège pas : **c'est le dossier de destination qui protège**.

### 6.3 Étape 3 — restaurer dans une base JETABLE **distincte**

| | |
|---|---|
| **Interface puis répertoire** | cPanel → MySQL® Databases, puis `~/grubano.com` |
| **Préconditions** | étape 2 verte ; quota de bases disponible ; `mysql` client présent (`command -v mysql`) |
| **Fichiers touchés** | aucun ; **la base jetable** est écrite |
| **Actions exactes** | 1. cPanel → *Create New Database* → `restoretest` ⇒ `deyi0010_restoretest`. 2. Associer un utilisateur (le même que production convient : le point est de tester le dump, pas les droits). 3. Puis : |

```bash
# cnf temporaire 0600 — evite le mot de passe en ligne de commande et dans l'historique
umask 077 && cat > ~/.restore.cnf <<'CNF'
[client]
user=deyi0010_<user>
password=<mot de passe>
CNF
chmod 600 ~/.restore.cnf

gunzip -c ~/grubano-backups/production-pre-launch-<ts>.sql.gz \
  | mysql --defaults-extra-file=~/.restore.cnf deyi0010_restoretest

echo "exit=$?"
```

| | |
|---|---|
| **Sortie attendue** | aucune sortie, `exit=0` |
| **Test de succès** | `exit=0` **et** l'étape 4 verte |
| **Condition STOP** | **la cible n'est pas `deyi0010_restoretest`.** Relisez la ligne `mysql … <base>` **avant** de la valider : une restauration dans `deyi0010_grubano` **écrase la production**. C'est la seule commande irréversible de tout ce runbook. · Toute erreur `ERROR 1142`/`1044` = privilèges : **arrêtez**, ne « réparez » pas en élargissant les droits de l'utilisateur de production |
| **Rollback immédiat** | cPanel → *Delete Database* `deyi0010_restoretest` |
| **Réversible** | **OUI** pour la base jetable. **IRRÉVERSIBLE** si la cible était la production. |
| **Après** | `rm ~/.restore.cnf` — **systématiquement**, y compris en cas d'échec |

### 6.4 Étape 4 — vérification **Prisma** sur la restauration

C'est le contrôle qui distingue « un fichier s'est rechargé » de « la restauration est exploitable par
l'application ». `migrate diff --exit-code` sort **0** si la base restaurée correspond **exactement** au
`schema.prisma` de l'application, et **2** s'il y a la moindre dérive.

```bash
source ~/nodevenv/grubano.com/24/bin/activate
cd ~/grubano.com
RESTORE_URL="mysql://deyi0010_<user>:<motdepasse>@localhost:3306/deyi0010_restoretest"

npx prisma@5.22.0 migrate diff \
  --from-url "$RESTORE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
echo "exit=$?"
```

| | |
|---|---|
| **Sortie attendue** | `No difference detected.` et `exit=0` |
| **Test de succès** | `exit=0` |
| **Condition STOP** | `exit=2` ⇒ la base restaurée **ne correspond pas** au schéma de l'application : la sauvegarde est inexploitable telle quelle. Lisez le diff imprimé — il nomme chaque écart. **Ne « corrigez » pas la base restaurée** : corrigez la sauvegarde. · `exit=1` ⇒ erreur de connexion, DSN ou privilèges |
| **Rollback / Réversible** | lecture seule sur la base jetable, **OUI** |

⚠️ `RESTORE_URL` contient un mot de passe : préférez-la dans une variable d'une seule session shell, et
n'exportez jamais ce DSN dans un fichier du dépôt.

### 6.5 Étape 5 — tables et données attendues

```bash
mysql --defaults-extra-file=~/.restore.cnf -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='deyi0010_restoretest'"

mysql --defaults-extra-file=~/.restore.cnf -N -e \
  "SELECT table_name, table_rows FROM information_schema.tables
    WHERE table_schema='deyi0010_restoretest' AND table_rows > 0 ORDER BY table_name"
```

| | |
|---|---|
| **Sortie attendue** | **77** ; puis une liste dont chaque ligne correspond au **MANIFEST** imprimé à l'étape 1 |
| **Test de succès** | le compte de tables égale `grep -c '^model ' prisma/schema.prisma` **et** chaque table non vide du manifeste apparaît |
| **Condition STOP** | une table du manifeste est **absente** ou **vide** dans la restauration ⇒ dump partiel : **la sauvegarde ne vaut rien**, recommencez l'étape 1 après avoir corrigé les privilèges |
| **Réversible** | lecture seule, **OUI** |

> `table_rows` d'InnoDB est une **estimation**. Pour les tables qui portent de l'argent — `Order`, `Refund`,
> `LedgerEntry`, `Invoice`, `InvoiceCounter`, `Payout`, `Claim`, `Dispute`, `FranchiseRoyalty` — faites un
> `SELECT COUNT(*)` explicite et comparez au manifeste. Une estimation qui « a l'air bonne » n'est pas une
> égalité.

### 6.6 Étape 6 — destruction propre

| | |
|---|---|
| **Interface** | cPanel → MySQL® Databases → *Delete Database* `deyi0010_restoretest` |
| **Préconditions** | étapes 4 et 5 **vertes et notées** (vous détruisez la preuve : consignez les nombres avant) |
| **Commandes exactes** | supprimer la base par cPanel, puis : `rm -f ~/.restore.cnf` et vérifier `ls -la ~/.restore.cnf` → `No such file` |
| **Test de succès** | la base a disparu de « Current Databases » ; le `.cnf` n'existe plus ; le dump `.gz` est **conservé** (c'est lui la sauvegarde) |
| **Condition STOP** | ne supprimez **jamais** une base dont le nom ne contient pas `restoretest` |
| **Rollback** | la base jetable est jetable par définition — il n'y a rien à récupérer |
| **Réversible** | sans objet |

**Ce que PROD-8 démontre, quand les six étapes sont vertes** : la production peut être sauvegardée, le fichier
est intègre hors serveur, il se recharge, la base rechargée **correspond exactement** au schéma de
l'application, et les tables d'argent ont le bon nombre de lignes. À ce moment-là — et pas avant — la phrase
« on a des sauvegardes » est vraie.

---

## 7 · L'ordre des environnements Stripe : production **technique** ≠ production **commerciale**

### 7.1 Les drapeaux qui restent `false` (= absents)

Les 14 de `MONEY_FLAGS_MUST_BE_FALSE` : `REFUNDS_ENABLED` · `CLAIMS_ENABLED` ·
`CLAIMS_AUTO_APPROVE_ENABLED` · `CLAIM_AUTO_RESOLVE_ENABLED` · `GHOST_ORDER_AUTO_REFUND_ENABLED` ·
`LOGISTICS_COURIER_ACTIVATION_ENABLED` · `TIPS_ENABLED` · `LOGISTICS_PAYOUT_ENABLED` ·
`DELIVERY_FULFILLMENT_ENABLED` · `CHARGEBACKS_ENABLED` · `PUNITIVE_CAPTURE_ENABLED` ·
`AFFILIATE_CONNECT_ENABLED` · `FRANCHISE_SETTLEMENT_ENABLED` · `CREATOR_PAYOUT_ENABLED`.

Plus `ALLOW_PLATFORM_FALLBACK`, qui doit rester **absent** : c'est un danger-flag d'**ouverture**, dont l'oubli
est du bon côté.

Depuis T-123, les deux derniers rails money-OUT sont **exigés `false` par `npm run check:flags`, qui garde un
BUILD** dans les deux pipelines : un déploiement qui les trouverait ouverts **échoue avant de livrer**.

### 7.2 Les routes financières qui doivent refuser — et le code exact

| Route | Attendu en production fermée | Signification |
|---|---|---|
| `POST /api/admin/refunds/run` | **403** `{gated:true}` | le rail de remboursement est fermé dans le **processus** (401 signifierait ouvert) |
| `POST /api/admin/claims/pay-approved` | **403** | le rail de paiement des réclamations est fermé |
| `POST /api/claims` | **403** `gated` ou `200 {"enabled":false}` | la surface réclamation est fermée |
| Règlement franchiseur | `{status:'skipped', reason:'rail_closed'}` | refus **à l'entrée** (T-116), avant toute lecture |
| Versement partenaire | aucun `transfers.create` atteignable | `CREATOR_PAYOUT_ENABLED` absent |
| `POST /api/webhooks/stripe` sans signature | **400** `Missing stripe-signature` | — |
| `POST /api/webhooks/stripe` signature invalide | **400** `Invalid signature` | — |

Ces sondes sont **non authentifiées** et sûres : elles se lancent depuis n'importe où.

```bash
for p in api/admin/refunds/run api/admin/claims/pay-approved api/claims; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' -X POST https://grubano.com/$p \
    -H 'content-type: application/json' -d '{}')"
done
```

**Attendu : `403 403 403`** (ou `200` avec `{"enabled":false}` sur la dernière). Un **401** sur la première
signifie que le rail de remboursement est **OUVERT** : arrêt immédiat, re-gel.

### 7.3 Comportement attendu de `/pay` — trois serrures indépendantes

1. **Aucune clé Stripe** ⇒ `lib/stripe.ts:getStripe()` jette `stripe_not_configured` ⇒ `/pay` répond
   **500 « Paiement non configuré. »**. Seule la route de paiement échoue ; le reste de l'application vit.
2. **Restaurant sans Connect actif** ⇒ **409 `restaurant_not_payable`**. La condition est
   `stripeAccountId && stripeAccountStatus === 'active'`, évaluée **au point d'étranglement argent**, pas
   seulement à l'approbation : un compte qui passe `active` → `restricted` après coup est refusé lui aussi.
3. **`ALLOW_PLATFORM_FALLBACK` absent** ⇒ aucun repli plateforme. C'est déterminant : avec ce repli,
   l'argent d'une commande — **part restaurant comprise** — resterait sur le compte Grubano, et
   **il n'existe aucun rail de versement restaurant** dans ce dépôt (le modèle est *destination charge* :
   Stripe verse le restaurant directement, `Payout` n'a pas de rôle `restaurant`, aucun `payouts.create`).

En production fermée, la serrure 2 suffit à elle seule : **la base est vide, donc aucun restaurant n'est
payable.** La serrure 1 est la plus forte et la moins coûteuse : **ne posez aucune clé Stripe.**

### 7.4 Une clé LIVE mal configurée — la réponse honnête

**Rien dans l'application ne vérifie le mode de la clé.** `getStripe()` accepte n'importe quelle valeur. Les
seuls contrôles `sk_test_` du dépôt vivent dans les opérateurs de répétition (`phase2-*.js`), qui refusent une
clé non-TEST et refusent même un `PaymentIntent` avec `livemode: true`. L'application, elle, ne regarde pas.

Ce qui vous protège réellement, par ordre de force :

| Protection | Force |
|---|---|
| **Ne poser aucune clé Stripe** dans le `.env.local` de production fermée | **absolue** — aucun appel Stripe n'est possible |
| **Base vide ⇒ aucun restaurant `active`** ⇒ `/pay` refuse par 409 | forte, tant qu'aucun restaurant n'est onboardé |
| **Cohérence de mode imposée par Stripe** : un `acct_` créé en TEST est inconnu en LIVE et inversement ⇒ une inversion de clé **échoue bruyamment**, elle ne débite pas en silence | forte, et c'est la bonne nouvelle |
| Les opérateurs `phase2-*` refusent une clé non-TEST | réelle mais **hors** de l'application |
| Un garde applicatif refusant `sk_live_` sans acquittement explicite | **n'existe pas** |

**Décision proposée (non exécutée) — PROD-13** : ajouter dans `lib/stripe.ts` un refus lorsque
`STRIPE_SECRET_KEY` commence par `sk_live_` **sans** une variable d'acquittement explicite
(`STRIPE_LIVE_ACKNOWLEDGED`). Un fichier, un test, aucun changement de comportement en TEST. C'est le seul
garde-fou qui transforme « on a fait attention » en « le logiciel refuse ». Votre arbitrage.

### 7.5 Ce qui distingue les deux productions

| | Production **technique** (P1) | Production **commerciale** |
|---|---|---|
| `grubano.com` sert l'application | ✅ | ✅ |
| Base production, sauvegarde et restauration prouvées | ✅ | ✅ |
| Clé Stripe | **aucune** (ou TEST, le temps de PROD-11) | LIVE |
| Restaurant Connect `active` | **aucun** | le pilote |
| Les 14 drapeaux argent | absents | absents sauf décision nommée |
| Faits légaux / CGV | placeholders ⇒ factures refusées par 409 | remplis, contrat P2B signé |
| Catalogue visible du public | vide | le pilote publié (admin-only) |
| Une vraie commande possible ? | **NON** — `/pay` refuse | oui |
| L11 | pas requis | **requis avant le premier argent LIVE** |

**La frontière opérationnelle est le §7.2 :** tant que les trois sondes répondent `403 403 403` et que
`/pay` refuse, vous êtes en production **technique**, quelle que soit l'apparence du site.

---

## 8 · PROD-11 — le webhook TEST vers la production

### 8.1 Ce que ce test prouve — et ce qu'il exige

Il éprouve **la chaîne complète** : DNS → TLS → WAF/rate-limit o2switch → routage Next → vérification de
signature → traitement → journalisation → code HTTP. C'est le seul bloqueur d'infrastructure
pré-production jamais éprouvé sur l'hôte de production : **un webhook filtré = un paiement confirmé jamais
enregistré**, et cette panne est invisible à tout contrôle fondé sur un 200.

**Il exige deux variables**, et c'est contre-intuitif : `app/api/webhooks/stripe/route.ts:83` appelle
`getStripe().webhooks.constructEvent(...)`. La vérification de signature passe donc par le client Stripe :

| Situation | Réponse observée | Piège |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` absent | **500** `Webhook not configured` | clair |
| `STRIPE_SECRET_KEY` absente, secret présent | **400** `Invalid signature` | **trompeur** : l'exception de `getStripe()` est avalée dans la boucle d'essai des secrets et l'on conclut « signature invalide » |

Donc pour PROD-11, posez temporairement **`STRIPE_SECRET_KEY` (TEST)** et **`STRIPE_WEBHOOK_SECRET`** (TEST),
puis **retirez la clé** après le test si vous voulez revenir à la serrure la plus forte (§7.3).

### 8.2 Procédure

| | |
|---|---|
| **Interfaces** | Dashboard Stripe (mode **TEST**) → Developers → Webhooks ; puis cPanel Terminal pour les journaux |
| **Préconditions** | production verte (§0 étape 7) ; `STRIPE_SECRET_KEY` TEST et `STRIPE_WEBHOOK_SECRET` TEST dans `~/grubano.com/.env.local` ; `touch tmp/restart.txt` effectué **après** l'ajout |
| **Fichiers touchés** | `.env.local` (temporairement) ; les journaux Passenger |
| **Actions exactes** | 1. Stripe TEST → Webhooks → *Add endpoint* → `https://grubano.com/api/webhooks/stripe`, événements `payment_intent.succeeded`, `charge.refunded`, `refund.updated`, `refund.failed`. 2. Copier le `whsec_` dans `.env.local`, `touch tmp/restart.txt`. 3. Dashboard → l'endpoint → *Send test webhook* → `payment_intent.succeeded`. 4. **Renvoyer le MÊME événement** (*Resend*) — c'est le test d'idempotence. |

| Contrôle | Attendu |
|---|---|
| **DNS + HTTPS** | Stripe affiche une réponse, pas un timeout ni une erreur TLS |
| **WAF / rate-limit** | **aucun 403 de l'hôte** ni 429. Un 403 **d'Apache** (page HTML) ≠ un 403 **de l'application** (JSON) : lisez le corps, pas seulement le code |
| **Routage** | la réponse est du **JSON** de l'application, pas une page d'erreur Passenger |
| **Signature** | **200** `{"received":true,…}`. Avec un faux `whsec_` : **400** `Invalid signature` — faites ce contrôle négatif, sinon vous n'avez prouvé que « ça répond » |
| **Traitement** | pour un PI inexistant en base : **200 `{"received":true,"matched":false}`**. C'est le bon résultat : il prouve toute la chaîne sauf l'effet métier, qu'il n'y a pas lieu de produire |
| **Idempotence** | le **renvoi** du même événement rend le **même** corps et ne produit **aucun** second effet. C'est la régression T-102 — un webhook redélivré doublait une addition dine-in |
| **Journaux** | `tail -200 ~/logs/*.log` ou cPanel → Errors : les lignes `[stripe webhook]` apparaissent, **aucune valeur de secret** |
| **Codes HTTP** | 200 nominal · 400 sans signature · 400 signature invalide · 500 secret absent |

| | |
|---|---|
| **Test de succès** | les huit contrôles, **dont les deux négatifs** (faux `whsec_` ⇒ 400 ; absence d'en-tête ⇒ 400) |
| **Condition STOP** | un 403/429 **de l'hôte** ⇒ le WAF ou le rate-limit o2switch filtre Stripe : **ne passez pas en LIVE**, c'est le bloqueur qu'on cherchait. Ouvrez un ticket o2switch pour autoriser les plages d'IP sortantes de Stripe. · un 200 avec un **faux** `whsec_` ⇒ la vérification de signature ne fonctionne pas : **arrêt immédiat**, n'importe qui pourrait forger un paiement |
| **Rollback immédiat** | supprimer l'endpoint dans Stripe TEST ; retirer les deux variables de `.env.local` ; `touch tmp/restart.txt` |
| **Réversible** | **OUI**. Aucun argent : Stripe TEST, et le rail de remboursement reste fermé. |

---

## 9 · PROD-10 — reclassé 🔴 **BLOQUANT AVANT LE PREMIER RESTAURANT / LA PREMIÈRE COMMANDE RÉELLE**

Pas bloquant pour le premier déploiement technique fermé. Bloquant **avant** le premier restaurant tiers réel
et **avant** toute première commande réelle. Deux raisons factuelles : votre décision « restaurants tiers dès
le lancement » fait entrer le règlement **P2B** (contrat bilatéral signé exigé avant la première commande d'un
tiers), et une facture numérotée **ne se dé-émet pas** — c'est pourquoi PROD-4 refuse désormais par 409.

**Fait technique à connaître avant de commencer** : l'identité légale **ne se remplit pas par variable
d'environnement**. Les noms `GRUBANO_LEGAL_NAME`, `GRUBANO_SIREN`, `GRUBANO_VAT_NUMBER`,
`GRUBANO_LEGAL_ADDRESS` que propose `.env.example` **ne sont lus par aucun code** (§1.6). La seule source est
`lib/legal-info.ts`, compilé dans le build ⇒ **un commit et un redéploiement**.

### 9.1 Faits pour les CLIENTS (mentions légales, CGV, confidentialité)

19 valeurs sont requises par `isLegalInfoComplete()` ; **2 sont déjà remplies** (`host.nom` = o2switch,
`host.adresse`). Les **17 autres** sont des placeholders `[[À COMPLÉTER — …]]`. Je n'en invente aucune.

| Champ (`lib/legal-info.ts`) | Ce que j'attends de vous |
|---|---|
| `editor.raisonSociale` | la raison sociale exacte de la société éditrice |
| `editor.formeJuridique` | SAS / SARL / SASU / EI / autre |
| `editor.capitalSocial` | le capital social, avec sa devise |
| `editor.siren` | 9 chiffres |
| `editor.siret` | 14 chiffres, celui du **siège** |
| `editor.rcsVille` | la ville du greffe |
| `editor.tvaIntra` | TVA intracommunautaire **ou** la mention exacte si non assujetti (champ non requis par la porte, mais il apparaît sur les factures) |
| `editor.siegeAdresse` | l'adresse du siège social |
| `editor.email` | l'e-mail de contact **de l'éditeur** — distinct du canal support déjà configuré dans l'application (`lib/support-contact.ts`) : une page légale nomme l'éditeur, pas le support |
| `editor.telephone` | téléphone (non requis par la porte) |
| `editor.directeurPublication` | la personne responsable de la publication |
| `host.contact` | le contact de l'hébergeur (o2switch) |
| `mediation.nom` / `.url` / `.adresse` | le médiateur de la consommation — **obligation française**, et `no_mediator` est un bloqueur **nommé séparément** de l'incomplétude générale, précisément pour qu'il ne soit pas levé par accident. Décision déjà prise : souscrire maintenant, afficher « médiateur en cours de désignation », ne pas retenir un pilote fermé pour ça |
| `privacy.dpoContact` | contact DPO / responsable protection des données |
| `privacy.retentionAccount` | durée de conservation des comptes |
| `privacy.retentionOrders` | durée de conservation des commandes et factures (attention : une obligation comptable peut fixer ce chiffre) |
| `privacy.nonEuTransfer` | transferts hors UE et garanties, **ou** « Néant » |
| `LEGAL_SUBPROCESSORS[…]` | le nom réel du fournisseur e-mail/SMTP — le seul sous-traitant encore `confirmed: false` |
| `CGV_EFFECTIVE_DATE` | la date d'entrée en vigueur. `null` aujourd'hui ⇒ **les CGV n'engagent personne** |
| `CGV_COUNSEL_REVIEWED` | à passer `true` **après** relecture par un avocat, pas avant |

### 9.2 Faits pour les RESTAURANTS PARTENAIRES (contrat P2B)

Certains de ces faits sont **déjà décidés et implémentés** : ils ont besoin d'être **transcrits** au contrat,
pas inventés. Je les distingue de ceux que vous seul pouvez fournir.

| Sujet | État dans le code | Ce que j'attends de vous |
|---|---|---|
| **Commission Grubano** | ✅ décidé (A0, 10/06/2026), source unique `lib/commission.ts` : **sur place 5 %**, **click & collect 8 %**, **livraison 12 %**, **réservation 0 %** ; frais Stripe **absorbés par la plateforme** (ni le resto ni le client ne voient de ligne de frais) ; surcharge possible par restaurant ; offre fondateur bornée à 0 % jusqu'à une date | confirmer que ces taux sont ceux du contrat, et le taux du **pilote** (0 % ou grille) |
| **Fréquence et règles de règlement** | ✅ **Grubano ne règle pas le restaurant.** Le modèle est *destination charge* : Stripe verse le restaurant **directement** sur son compte Connect, selon le calendrier de versement **de ce compte**. Il n'existe aucun rail de versement restaurant dans le logiciel | confirmer que le contrat décrit bien ce mécanisme, et le calendrier de versement retenu côté Stripe |
| **Responsabilité de la commande** | ⚠️ à écrire : le logiciel ne tranche pas | qui est le vendeur au client final — le restaurant ou Grubano ? Ce point détermine TVA, rétractation et responsabilité produit |
| **Annulation** | partielle : la machine à états `Order` connaît `cancelled` | qui peut annuler, jusqu'à quand, avec quelle conséquence financière |
| **Remboursement** | ✅ `REFUNDS_ENABLED` **fermé** ⇒ aucun remboursement automatique n'est possible aujourd'hui | le contrat doit dire la vérité de ce build : remboursement **hors application** pendant la phase fermée, et qui le porte |
| **Litiges / chargebacks** | ✅ `CHARGEBACKS_ENABLED` **fermé** ⇒ un litige est **enregistré** mais le restaurant **n'est pas débité** ; la refacturation n'existe pas | qui porte un chargeback pendant la phase fermée ? Le code dit aujourd'hui : **la plateforme** |
| **Données personnelles** | partiel : `/customers` masqué, droits RGPD outillés | le restaurant est-il sous-traitant ou responsable conjoint ? Il faut un accord de traitement |
| **Éléments contractuels restaurant** | ⚠️ à écrire | durée, résiliation, préavis, exclusivité (ou non), SLA, propriété du catalogue et des photos, droit applicable, juridiction. Le P2B ajoute : motifs et préavis de **déréférencement**, et un dispositif de **réclamation interne** |

### 9.3 Faits pour les FACTURES

`lib/invoice.issuerIdentity()` lit **quatre** champs, verbatim, et rien d'autre :

| Champ facture | Source |
|---|---|
| `name` | `LEGAL_INFO.editor.raisonSociale` |
| `address` | `LEGAL_INFO.editor.siegeAdresse` |
| `siren` | `LEGAL_INFO.editor.siren` |
| `vat` | `LEGAL_INFO.editor.tvaIntra` |

Depuis PROD-4, `/api/admin/invoices/generate` refuse par **409 `legal_identity_incomplete`** tant que
`isLegalInfoComplete()` est faux — **avant** l'authentification et **avant** toute émission, sans drapeau ni
contournement. Le cron cPanel `0 7 1 * *` se heurte donc à ce refus au lieu d'émettre une série numérotée au
nom de personne. **Tant que ce 409 tient, rien d'irréversible ne peut se produire côté facturation.**

⚠️ Deux faits non tranchés que je ne comblerai pas : le **régime de TVA** (assujetti ou non, et le taux
applicable par canal) et la **nature de la facture** — Grubano facture-t-il sa commission au restaurant, ou
émet-il la facture de la commande au nom du restaurant ? Les deux choix produisent des séries de numérotation
différentes et ne se corrigent pas après émission.
---

## 10 · PROD-12 — le dépôt public : revue exécutée (read-only)

**Périmètre** : l'intégralité de l'historique Git, toutes les références (1 283 commits, 111 branches locales),
pas seulement `HEAD`. Aucun fichier modifié, aucune visibilité changée.

### 10.1 Ce que j'ai cherché, et ce que j'ai trouvé

| # | Contrôle | Résultat |
|---|---|---|
| 1 | Fichiers `.env*`, `deploy_key`, `*.pem`, `*.p12`, `id_rsa`, `*.key` **jamais** ajoutés ? | ✅ **aucun** — seuls `.env.example` et trois documents qui *parlent* de secrets existent |
| 2 | Clés Stripe : `sk_live_`, `sk_test_…`, `rk_live_`, `whsec_…` | ✅ **0 commit** sur l'historique complet |
| 3 | Autres clés : `sk-ant-api03-…`, `ntn_…` (Notion), `xkeysib-…` (Brevo), `AKIA…` (AWS), `AIza…` (Google) | ✅ **0 commit** |
| 4 | Clés privées : `BEGIN … PRIVATE KEY` | ✅ **0 commit** |
| 5 | DSN avec identifiants (`mysql://user:pass@`) | ⚠️ 9 commits détectés → **les 9 inspectés** : 100 % de gabarits et de fixtures (`USER:PASSWORD@`, `user:pass@host:port`, `guard:…@127.0.0.1:1/guard_never_connected`). **Aucun DSN réel.** |
| 6 | Adresses e-mail personnelles (gmail/outlook/free/orange…) | ✅ **2 occurrences**, toutes deux dans des tests : votre propre adresse dans un test d'initiales, et un nom fictif. **Aucune PII de tiers.** |
| 7 | URLs internes / architecture serveur | 🔴 **exposé** — voir §10.2 |
| 8 | Scripts opérateur sensibles | 🔴 **exposé** — voir §10.2 |
| 9 | Documents à données commerciales ou personnelles | 🟠 `EMAIL-FACTUAL-PACK` (5,2 Mo) contient des IP, presque toutes **publiques par construction** (enregistrements SPF) ; `docs/ops/sql` : un seul fichier d'inventaire |
| 10 | Identifiants déjà fuités | 🔴 **OUI, et c'est déjà arrivé** — voir §10.3 |

### 10.2 Ce qui est réellement exposé

**Carte opérationnelle complète.** `deyi0010` (utilisateur cPanel) apparaît **81 fois dans 33 fichiers** ;
`/home/deyi0010`, `muscadier.o2switch.net`, les chemins nodevenv, **les deux noms de base**
(`deyi0010_grubano` / `…_staging`) et les horaires de cron : **88 occurrences dans 47 fichiers**. Un nom
d'utilisateur + un nom de base + un hôte, c'est deux tiers d'une cible de credential-stuffing.

**Playbook financier.** Tout `scripts/server/` est public — les opérateurs de fenêtre, les gardes argent, le
clean-room — et `docs/ops/` décrit **quelle route porte de l'argent, quel drapeau la ferme, et comment le
drapeau se pose**. C'est précisément la documentation qu'un attaquant écrirait s'il devait la produire
lui-même. Elle n'ouvre rien à elle seule : le rail exige un drapeau **et** un accès au serveur. Mais elle
supprime entièrement le travail de reconnaissance.

**Les journaux GitHub Actions sont publics.** Sur un dépôt public, n'importe qui peut lire les logs de run.
`deploy-production.yml` téléverse en `log-level: verbose` : les valeurs de secrets sont masquées par GitHub,
mais **l'arborescence complète du serveur, fichier par fichier, ne l'est pas**. Sur des runs de production
cela devient un plan du répertoire servi par Apache.

### 10.3 La fuite qui a déjà eu lieu

`scripts/server/neutralize-public-credentials.js` existe pour une raison écrite dans son propre en-tête :
**les mots de passe de 7 comptes staging ont été versionnés publiquement dans ce dépôt.** Les 7 adresses sont
toutes `@grubano.com` (aucune PII de tiers), dont une portait le rôle **admin**. Neutralisés en base le
2026-08-29 — `password = NULL`, `status = 'suspended'`, jetons purgés, sessions NextAuth supprimées, une ligne
`AdminAuditLog`. Le remède est bon, et **les mots de passe restent dans l'historique Git à jamais.**

Conséquence pour la production : **ces 7 adresses ne doivent jamais exister avec un mot de passe dans la base
de production.** La base étant vierge, c'est vrai aujourd'hui ; c'est une règle à ne pas casser.

### 10.4 Verdict et recommandation

**Le dépôt ne contient aucun matériel d'identification** : 0 clé, 0 secret de webhook, 0 clé privée, 0 DSN
réel, 0 fichier `.env`. Sur ce point l'hygiène a tenu, sur 1 283 commits, et c'est remarquable.

**Ma recommandation est néanmoins : passez-le PRIVÉ avant d'y mettre la moindre trace de production.** Trois
raisons, dans cet ordre :

1. **Les runbooks sont un playbook.** Ils nomment les routes d'argent, leurs serrures et la façon de les
   ouvrir. Tant que rien ne bouge d'argent, le coût est théorique. Dès la première vraie commande, il ne
   l'est plus.
2. **Les journaux Actions de production seront publics**, en verbose, avec l'arborescence du serveur.
3. **« On fera attention » a déjà échoué ici** — 7 mots de passe versionnés. Ce n'est pas un reproche :
   c'est la mesure du risque résiduel d'un dépôt public sur lequel travaillent plusieurs agents.

**Le coût de passer privé est mesuré et il est presque nul** : 0 fork, 0 étoile, 0 observateur, 1 seul
collaborateur, pas de GitHub Pages. **Rien ne dépend de la visibilité publique.**

**Le seul vrai coût, à ne pas découvrir en route** : un dépôt public a des minutes GitHub Actions
**illimitées** ; un dépôt privé consomme le quota du compte (2 000 min/mois sur Free, 3 000 sur Pro). Vos
déploiements staging durent **23 à 41 min** (mesuré sur les 10 derniers runs, moyenne ~27 min) et la
production doublera la cadence. Cela fait **≈ 70 à 110 runs par mois** avant dépassement. C'est vivable, mais
cela se surveille — et c'est la seule chose qui pourrait bloquer le pipeline après le changement.

**Décision qui vous appartient.** Je n'ai rien changé.

---

## 11 · L11 — la recherche de cible, aussi loin qu'elle va d'ici

### 11.1 L'état, sans ambiguïté

L11 reste **autorisé** (le STOP conditionnel sur `CHARGEBACKS_ENABLED` n'est **pas** déclenché, vérifié de
façon adversariale ; préflight **9/10** prouvé). Il ne bloque pas la construction de la production technique
fermée. Il bloque l'autorisation finale d'utiliser les écritures financières **LIVE**.

Deux bloqueurs subsistent, inchangés :
- **l'armement exige un shell serveur** — par conception, et vous avez confirmé qu'aucun chemin d'armement
  distant ne doit être construit ;
- **la cible historique n'est plus valable** : `GR-N5TSM0` (`cmtju919h0001h7t6bkn5tsm0`) a été remboursée le
  09/09, donc l'anomalie « un remboursement existe déjà sur la commande » refuserait la fenêtre.

### 11.2 Ce que j'ai pu faire d'ici, et la limite exacte

Je ne peux pas exécuter le precheck : il tourne sur le serveur, lit la base de staging et interroge Stripe. Et
vous avez demandé qu'aucune action serveur ne soit exécutée.

Ce que j'ai fait à la place : **dériver du code le prédicat d'éligibilité exact**, pour que la recherche soit
une lecture et pas un tâtonnement. Et un fait à connaître : **`phase2-refund-gate.js` n'est pas un chercheur,
c'est un oracle.** Il évalue la cible qu'on lui nomme — par défaut la commande historique, codée en dur
ligne 38 — et n'a aucun mode « liste les commandes éligibles ». **Il n'existe aucun opérateur de recherche.**

### 11.3 La requête de candidats — lecture seule, aucune écriture

À exécuter sur **staging**, dans cPanel Terminal. Elle ne fait que lire.

```sql
SELECT o.id,
       CONCAT('GR-', UPPER(RIGHT(o.id, 6)))              AS ref,
       o.total, o.status, o.paymentStatus, o.fulfillmentType, o.createdAt,
       r.stripeAccountStatus
FROM `Order` o
JOIN `Restaurant` r          ON r.id = o.restaurantId
LEFT JOIN `Refund` rf        ON rf.orderId = o.id
LEFT JOIN `FranchiseRoyalty` fr ON fr.orderId = o.id
LEFT JOIN `Dispute` d        ON d.orderId = o.id
LEFT JOIN `LedgerEntry` le   ON le.stripePaymentIntentId = o.stripePaymentIntentId
                             AND le.type = 'refund'
WHERE o.paymentStatus = 'paid'
  AND o.stripePaymentIntentId IS NOT NULL
  AND r.stripeAccountId IS NOT NULL
  AND r.stripeAccountStatus = 'active'
GROUP BY o.id, r.stripeAccountStatus
HAVING COUNT(rf.id) = 0        -- aucune ligne Refund, meme pending
   AND COUNT(fr.id) = 0        -- pas une commande de franchise
   AND COUNT(d.id)  = 0        -- aucun litige
   AND COUNT(le.id) = 0        -- aucune ligne de ledger de type refund
ORDER BY o.createdAt DESC
LIMIT 20;
```

Chaque clause correspond à un refus du precheck :

| Clause | Refus correspondant |
|---|---|
| `paymentStatus = 'paid'` + `stripePaymentIntentId IS NOT NULL` | pas de PI ⇒ « Stripe object precheck NOT MEASURED » |
| `COUNT(rf.id) = 0` | « a refund already exists on the order — not the first rehearsal any more » |
| `COUNT(fr.id) = 0` | « franchise royalty present — franchise is OUT OF BETA » |
| `COUNT(d.id) = 0` | un litige ouvert interdit la fenêtre |
| `COUNT(le.id) = 0` | une ligne de ledger `refund` signifie qu'un remboursement a déjà été comptabilisé |
| `stripeAccountStatus = 'active'` | *destination charge* : sans Connect actif il n'y a pas de reprise à observer |

### 11.4 Puis le precheck, cible nommée — read-only, sur staging

```bash
source ~/nodevenv/app.grubano.com/24/bin/activate
cd ~/app.grubano.com
PHASE2_REFUND_ORDER_ID="<id retourne par la requete>" \
  node scripts/server/phase2-refund-gate.js
```

| | |
|---|---|
| **Sortie recherchée** | `RESULT: PASS` (ou `WAIT`) — **toute** ligne `ANOMALY` disqualifie la cible |
| **Ce que ça ne fait pas** | aucune écriture, aucun drapeau touché, aucun appel Stripe en écriture. Le mode `window` demande une phrase d'autorisation séparée. |
| **Rappel** | **je ne déclencherai pas `refund-rehearsal.yml`** avant votre phrase exacte : `WINDOW LIVE — DISPATCH L11`. |

**Décision proposée (non exécutée)** : écrire `phase2-refund-candidates.js` — un opérateur **lecture seule**
qui exécute ce prédicat et imprime les candidats avec leur raison d'exclusion. Ce serait la version outillée
de la requête ci-dessus, du même style que les autres opérateurs (refus fail-closed, aucune écriture, aucun
secret imprimé). Il ne peut rien ouvrir : il ne fait que `SELECT`.

---

## 12 · Les décisions qui manquent

Rien de ce qui suit n'a été exécuté. Aucune n'est un prérequis à P1 sauf mention contraire.

| # | Décision | Pourquoi elle se pose maintenant | Recommandation |
|---|---|---|---|
| D1 | **Dépôt public ou privé** (PROD-12) | les journaux Actions de production seront publics ; les runbooks sont un playbook | **privé**, en surveillant le quota Actions (§10.4) |
| D2 | **Migration de référence + `migrate deploy`** | c'est le seul correctif **mécanique** au risque `--accept-data-loss` ; aujourd'hui la protection est procédurale | à faire **juste après** PROD-6b, sur base encore vide |
| D3 | **Garde `sk_live_` dans `lib/stripe.ts`** (PROD-13) | rien dans l'application ne vérifie le mode de la clé | à faire **avant** de poser une clé LIVE |
| D4 | **Retirer `prisma:migrate` de `package.json`** | `prisma migrate dev` propose de **RÉINITIALISER** la base ; c'est le seul script du dépôt qui puisse en vider une par accident | oui, trivial |
| D5 | **Opérateur de candidats L11** (§11.4) | il n'existe aucun chercheur, seulement un oracle | oui si vous voulez éviter du SQL à la main |
| D6 | **Nettoyer les 5 noms morts de `.env.example`** | `GRUBANO_LEGAL_*` et `BREVO_API_KEY` font croire que l'identité légale se règle par variable | oui, trivial — et ça évite une erreur sur PROD-10 |
| D7 | **Discriminant d'application dans le rapport de provenance** | staging et production partagent le même compte cPanel, donc le même `~/.grubano/env-provenance.json` : le fichier ne dit pas **quelle** application l'a écrit | oui, une ligne — sinon cette preuve est ambiguë en production |
| D8 | **Vérifier « Allow merge commits »** avant la PR de promotion | si seul « Squash » est proposé, la promotion détruit le second parent et **chaque promotion future reposera le problème des histoires non apparentées** | à vérifier **avant** §5.4 |
| D9 | **Les 17 faits légaux + les 8 faits contractuels** (PROD-10) | bloquant avant le premier restaurant tiers et la première commande réelle, pas avant P1 | à lancer en parallèle de P1 : le délai est juridique, pas technique |
| D10 | **Le taux de commission du pilote** | la grille est décidée (5/8/12/0 %), mais l'offre fondateur (`commissionFreeUntil`) est un choix commercial | à trancher avant l'onboarding du pilote |
| D11 | **Responsabilité de la commande** (vendeur au client final) | détermine TVA, rétractation, responsabilité produit — et le logiciel ne tranche pas | avis juridique requis |

---

## 13 · Rappel des interdits tenus dans ce lot

Aucune action serveur · aucun changement sur `main` · aucun déploiement de production · aucune écriture Stripe ·
aucun changement de visibilité Git · aucun drapeau ouvert · aucun chemin d'armement distant · `CERTIFIED_SHAS`
intact · aucun fait légal inventé · aucune valeur de secret dans ce document · `refund-rehearsal.yml` non
déclenché.

**Une seule action locale a été exécutée** : la recette de promotion du §5.2 a été **rejouée à blanc** dans un
worktree Git jetable, sur `origin/main` + `171437d8`, pour vérifier que les commandes que je vous donne
produisent bien l'arbre annoncé. Le worktree a été supprimé, aucune branche n'a été créée, rien n'a été
poussé, et `git status` est resté vide. Je préfère vous remettre une recette **mesurée** plutôt qu'une recette
plausible.

---

## 14 · Ce que le PRÉFLIGHT P1 a ajouté (2026-09-29, mesuré après la première version de ce runbook)

### 14.1 PROD-14 — les sources de l'application sont publiquement téléchargeables depuis la production

Mesuré sur `https://grubano.com`, requêtes HEAD, aucun corps lu :

| Chemin | Code | Taille |
|---|---|---|
| `/server.js` | **200** | 878 o |
| `/package.json` | **200** | 2 089 o |
| `/prisma/schema.prisma` | **200** | 18 550 o |
| `/.env.local` · `/.env` · `/.htaccess` | **403** | — |
| `/version.json` · `/VERSION` · `/fr/eat` | 500 | page Passenger |

Les fichiers cachés sont bien bloqués — **mais pas les sources**. `prisma/schema.prisma` est le **modèle de
données complet** (tables d'argent incluses) et `package.json` la **liste de dépendances avec versions**, qui
est la matière première d'un ciblage de vulnérabilités. C'est vrai **depuis mai**, sur la production actuelle.

⚠️ **Passer le dépôt en privé (D1) ne ferme PAS ce trou** : la fuite vient du serveur, pas de GitHub. Après le
déploiement #1 la production servira le `schema.prisma` **courant** (77 modèles au lieu de 27) — donc le
déploiement **aggrave** l'exposition si rien n'est fait.

> 🚫 **LA RECETTE QUI SE TROUVAIT ICI A ÉTÉ RETIRÉE, ET C'EST LE CORRECTIF LE PLUS IMPORTANT DE CE
> PARAGRAPHE.** Elle proposait un `<FilesMatch "\.(prisma|json|js|ts|map|lock)$">` + `Require all denied`.
> **`.js` y était, et chaque bundle client sous `/_next/static/` est un `.js`** : appliquée telle quelle, elle
> rendait le site inerte — le P0 du 2026-09-06. Le paragraphe l'accompagnait bien d'une condition STOP, mais
> **le mécanisme de livraison de ce runbook est un copier-coller humain** : laisser deux recettes
> contradictoires dans un document qu'on colle à la main, c'est livrer la mauvaise une fois sur deux. Une
> revue adversariale l'a classée bloquante, à juste titre.
>
> **La seule recette est désormais le fichier versionné** [`docs/ops/htaccess/PROD-14-deny-sources.htaccess`](htaccess/PROD-14-deny-sources.htaccess),
> détaillé au §16.3 : une portée **par CHEMIN**, jamais par extension.
| **Rollback** | retirer le bloc du `.htaccess` par cPanel ; effet immédiat, aucun redémarrage |
| **Réversible** | **OUI** |

Classé 🟠 : **pas** bloquant pour créer une production fermée (aucun identifiant n'est exposé), **bloquant
avant le premier client réel**. À faire de préférence **juste après** le déploiement #1, quand le
`schema.prisma` courant vient d'atterrir.

### 14.2 Qui paie réellement les frais Stripe — une contradiction à trancher par la mesure

`lib/commission.ts` affirme en en-tête : « Stripe fees INCLUDED in the commission (the platform absorbs
them) ». Mais `lib/stripe.ts:114` pose **`on_behalf_of: connect.destination`** sur chaque charge routée — et
`on_behalf_of` désigne le **marchand de règlement**. C'est ce paramètre, pas un commentaire, qui détermine sur
quel solde Stripe prélève ses frais.

**Les deux ne peuvent pas être vrais à la fois, et je ne vais pas deviner lequel l'est** : c'est le chiffre
central du contrat restaurant.

**Le dépôt contient déjà la mesure.** `retrieveChargeFacts()` (`lib/stripe.ts:153`) lit
`latest_charge.balance_transaction` **avec la clé plateforme et sans en-tête `stripeAccount`** — donc la
balance transaction **de la plateforme** — et le webhook écrit sa valeur dans
`LedgerEntry.stripeFeeAmount` (« REAL Stripe processing fee ») pour **chaque** paiement. Une requête lecture
seule sur staging tranche :

```sql
SELECT createdAt, grossAmount, applicationFeeAmount, stripeFeeAmount, netToRestaurant, routed
FROM `LedgerEntry`
WHERE type = 'payment' AND routed = 1
ORDER BY createdAt DESC
LIMIT 5;
```

| Résultat | Interprétation |
|---|---|
| `stripeFeeAmount` **> 0** | la balance transaction **de la plateforme** porte les frais ⇒ **Grubano les absorbe**, le commentaire a raison, `on_behalf_of` ne déplace pas les frais |
| `stripeFeeAmount` **= 0 ou NULL** | les frais sont prélevés sur le **compte connecté** ⇒ **le restaurant les paie sur son net**, le commentaire est faux, et le tableau D10 doit être réécrit |

**Ne rien écrire au contrat avant d'avoir lu ces cinq lignes.** Aucune écriture, aucun appel Stripe : une
lecture de la base de staging.

### 14.3 PROD-5 — la première ligne : prouver qu'aucune clé Stripe n'est présente

Je ne peux pas prouver d'ici le contenu d'un fichier serveur. Ce que j'ai prouvé : **aucun chemin automatisé
ne peut en installer une** — 0 secret GitHub `STRIPE_*` (21 secrets listés), 0 clé Stripe sur l'historique Git
complet, et le pipeline n'écrit jamais de fichier d'environnement (il exclut `.env*`). Reste le seul canal
possible : une main humaine. La vérification tient en une commande **lecture seule**, à exécuter en **premier**
dans PROD-5 :

```bash
grep -c '^\s*STRIPE' ~/grubano.com/.env.local 2>/dev/null; echo "exit=$?"
ls -l ~/grubano.com/.env.local 2>&1
```

| | |
|---|---|
| **Attendu** | `No such file or directory` et `exit=2` — **le fichier n'existe pas encore**, c'est l'état voulu avant PROD-5 |
| **Acceptable** | le fichier existe et `grep -c` renvoie **`0`** |
| **Condition STOP** | `grep -c` renvoie **≥ 1** ⇒ une clé Stripe est déjà posée en production : **arrêt**, retirez-la et redémarrez avant toute autre étape |

**Et le fait qui compte plus que tout le reste** : il n'existe **qu'un seul** `new Stripe(...)` dans toute
l'application (`lib/stripe.ts:19`), derrière `getStripe()`, qui **jette** `stripe_not_configured` sans clé.
Les huit sites d'écriture financière passent **tous** par lui. Donc **sans clé Stripe, même un drapeau argent
ouvert par accident ne peut déplacer aucun argent** — l'appel échoue avant d'atteindre Stripe. C'est la
serrure la plus forte de toute la production fermée, et elle est gratuite.

### 14.4 Les crons — configuration vérifiée, capacité non contrainte

Vérifié : **chaque** job de `cron.yml` cible `${{ needs.guard.outputs.base }}` = la variable de dépôt
`CRON_TARGET_BASE_URL`, **mesurée = `https://app.grubano.com`**. Le job `guard` **échoue** si la variable est
vide, et « ce workflow ne prend jamais la production par défaut ». Aucun job ne code une URL en dur. Les trois
scripts Node (`ledger-check-probe`, `creator-earnings-mature`, `monthly-invoices`) lisent `SITE_URL`, que le
workflow renseigne depuis la même sortie de garde — **mais leur défaut interne est
`https://www.grubano.com`**, donc la production : la seule chose qui les en empêche est que le workflow
positionne toujours la variable, et que le garde refuse une variable vide.

Ce que le garde ne fait **pas** : refuser une variable qui **désigne la production**. La protection est donc
une **configuration**, pas une contrainte. Une seule édition de variable suffirait à envoyer, au tick suivant
(20 min), le rattrapage d'e-mails, les relances d'onboarding et — le 1er du mois — le lot de factures et le
règlement franchiseur contre la production.

**Correctif proposé (une ligne dans le garde)** : refuser explicitement une base de production tant qu'une
seconde variable ne l'autorise pas nommément. Même doctrine que T-123 : la protection doit **refuser**, pas
**surveiller**.

Inventaire de ce que chaque planification ferait si elle atteignait la production, pour mémoire :

| Planification | Jobs | Effet externe possible |
|---|---|---|
| `*/20 * * * *` | `positions/sweep` · `orders/confirm-sweep` | ⚠️ **envoie des e-mails** de confirmation de commande (idempotent, `sendOnce`). Sur une base vide : rien à envoyer. |
| `20 3 * * *` | sonde ledger · maturation créateur · `creator-payouts/run` · relances onboarding · réconciliation ghost-orders · alertes claims dormantes · réconciliation refunds | ⚠️ plusieurs **e-mails** ; `creator-payouts/run` → **404** (rôle fermé) ; aucune écriture d'argent |
| `0 7 1 * *` | factures mensuelles · `franchise-settlements/run` | ✅ factures **refusées 409** par PROD-4 ; règlement → **404** (rôle fermé) |

Contrôle live exécuté sur staging (POST non authentifié) : `refunds/run` **403 `gated:true`** ·
`claims/pay-approved` **403** · `claims` **403 `gated:true`** · `franchise-settlements/run` **404** ·
`creator-payouts/run` **404**. Les deux derniers refusent par **404 avant 403** — le rôle se masque avant que
le drapeau argent ne parle : deux couches, la plus stricte d'abord.

---

## 15 · B2 livré · PROD-14 préparé · D10 mesuré · D2 dérive analysée (2026-09-29)

### 15.1 B2 — le garde cron est LIVRÉ, et il refuse

Doctrine T-123 : refus explicite, pas surveillance. La décision vit désormais **une seule fois**, dans
`scripts/cron/cron-target-guard.js`, et **deux** appelants l'utilisent.

**Ce qui était faux.** Le job `guard` vérifiait **une** chose : que `CRON_TARGET_BASE_URL` n'était pas
**vide**. Il transmettait ensuite son contenu à tous les jobs. La protection était donc une
**configuration**, pas une contrainte. Et, séparément, les trois scripts Node retombaient sur
`https://www.grubano.com` quand `SITE_URL` était absente — **un défaut silencieux vers la cible la plus
dangereuse**, alors que le crontab cPanel (`docs/ops/crons.md`) ne pose **aucune** `SITE_URL` sur ses lignes
de commande : la cible dépendait donc de la présence de `SITE_URL` dans le `.env.local` du serveur.

**La règle est une LISTE BLANCHE, pas une liste noire.** Une liste noire de noms d'hôtes de production
laisserait passer un domaine **mal tapé**, et « je me suis trompé de domaine » est au moins aussi probable que
« j'ai tapé production ». La cible doit donc s'identifier **positivement** comme staging.

| Entrée | Verdict |
|---|---|
| `https://app.grubano.com` · `https://business.grubano.com` (± `/`, ± espaces, ± casse) | **ALLOWED** staging |
| `https://grubano.com` · `https://www.grubano.com` | **REFUSÉ** — production |
| … les mêmes **avec** `CRON_ALLOW_PRODUCTION="I AUTHORIZE GRUBANO PRODUCTION CRONS"` | ALLOWED production |
| `http://app.grubano.com` | **REFUSÉ** — le jeton cron voyage dans un en-tête |
| `https://app.grubano.com/api` · `?x=1` · `#f` | **REFUSÉ** — une base est une origine |
| `app.grubano.com` · `ftp://…` · `https://u:p@…` | **REFUSÉ** — malformée |
| vide / absente / non-chaîne | **REFUSÉ** — « ce workflow ne prend jamais la production par défaut » |
| `https://app.grubano.com.attacker.test` · `grubano.com.attacker.test` · `appgrubano.com` · `app.grubano.co` | **REFUSÉ** — inconnue |
| une inconnue **avec** l'attestation | **REFUSÉ QUAND MÊME** |

Ce dernier point est délibéré : **« nous avons autorisé la production » ne doit jamais devenir « nous avons
autorisé ce que quelqu'un a tapé ».** L'attestation ne déverrouille que des hôtes de production **reconnus**.

**Preuve que staging reste la seule cible admise, mesurée :**

- `vars.CRON_TARGET_BASE_URL` = `https://app.grubano.com` (lu par API) ;
- `vars.CRON_ALLOW_PRODUCTION` **n'existe pas** — la seule variable du dépôt est `CRON_TARGET_BASE_URL` ;
- le job `guard` délègue au module et **échoue** sinon ⇒ les quatre autres jobs (`needs: guard`) ne
  démarrent pas ;
- **chaque** job tire sa cible de `needs.guard.outputs.base` ; **aucun** ne code un hôte (assertion sur le
  YAML **parsé**, pas sur le texte, pour que les commentaires ne puissent pas satisfaire le contrôle) ;
- les **trois** cadences sont épinglées et inchangées (`*/20 * * * *`, `20 3 * * *`, `0 7 1 * *`).

**Tests adversariaux — 28, et quatre mutations prouvent qu'ils mordent :**

| Mutation | Tests devenus rouges |
|---|---|
| un hôte inconnu devient ALLOWED | **4** |
| l'attestation devient un simple test de vérité (`if (e[VAR])`) | **1** (les 8 quasi-correspondances) |
| l'ancien défaut silencieux remis dans un script | **1** (le scanner de source) |
| le garde **retiré** d'un script (version pré-B2) | **5**, dont les trois refus **exécutés** |

Les refus sont **exécutés**, pas relus : chaque script est lancé dans un arbre jetable **dont la racine n'a
pas de `.env.local`** — parce que le chargeur résout `__dirname/../../.env.local`, si bien qu'une exécution
depuis le dépôt hériterait de l'environnement du développeur et rendrait toutes les assertions vides. Et les
**contrôles positifs ne touchent pas le réseau** : une cible staging valide **sans** `INTERNAL_CRON_TOKEN`
échoue sur le contrôle *suivant* — la preuve que le garde a laissé passer, sans qu'aucune requête ne parte.

**Deux épingles déplacées, et la seconde a été trouvée par la suite, pas par moi.**
`tests/claims-closure-imports.test.ts` et `tests/claims-r13-absent-surfaces.test.ts` épinglent **tous les
deux** le hash de `cron.yml`. J'ai déplacé le premier et manqué le second parce que j'avais cherché
`scripts/cron` au lieu du hash. **C'est la forme T-108, payée une fois de plus** : un contrôle qui existe en
deux endroits est un contrôle qui se met à jour à moitié. Les deux notes se renvoient maintenant l'une à
l'autre.

**Ce que B2 n'a PAS fait** : aucune cadence ajoutée ou modifiée, aucun job, aucun workflow, aucun secret,
`main` intacte, aucun déploiement de production. Le job `guard` a gagné un `checkout` et un appel `node`.

⚠️ **UNE CONSÉQUENCE OPÉRATIONNELLE À ANTICIPER, sur staging, au prochain déploiement.** Les trois scripts
sont livrés par le pipeline (`scripts/cron/*.js`). Dès qu'ils atterrissent, le **crontab cPanel** — dont les
lignes ne posent **aucune** `SITE_URL` — dépend entièrement de ce que contient le `.env.local` du serveur :

| `SITE_URL` dans `~/app.grubano.com/.env.local` | Avant B2 | Après B2 |
|---|---|---|
| `https://app.grubano.com` | visait staging | visait staging — **inchangé** |
| absente | **visait la PRODUCTION en silence** | **REFUS bruyant**, exit 1, rien n'est appelé |
| `https://www.grubano.com` | visait la production | **REFUS bruyant** |

Les deux derniers cas exigent **une ligne** : ajouter `SITE_URL=https://app.grubano.com` à
`~/app.grubano.com/.env.local`. Les trois lignes du crontab se remettront à viser staging, cette fois
**explicitement**. Et si vous préférez le voir plutôt que le supposer, les journaux `~/logs/` diront lequel
des trois cas était vrai : une ligne `[CRON TARGET] FATAL` est la réponse.

> Note de sûreté sur la livraison : si une synchro FTP partielle livrait les trois scripts **sans**
> `cron-target-guard.js`, ils planteraient sur `MODULE_NOT_FOUND`. C'est un échec **fermé** — aucun appel
> n'est émis — donc le bon sens de la panne.

### 15.2 PROD-14 — préparé, MESURÉ sur les deux hôtes, **non appliqué**

Nouvel opérateur **lecture seule** : `scripts/server/web-exposure-probe.js`. HTTP uniquement, aucune base,
aucun Stripe, aucune écriture. `node scripts/server/web-exposure-probe.js https://<hôte>` → PASS/FAIL.

**Pourquoi une sonde et pas un test unitaire** : le défaut n'est pas dans le dépôt, il est dans ce qu'Apache
sert. Seule une requête HTTP contre l'hôte réel peut l'observer — et seule la même requête peut prouver le
correctif.

**Pourquoi les contrôles POSITIFS sont le cœur du dispositif** : la règle évidente interdit `.js`, et **chaque
bundle client sous `/_next/static/` est un `.js`**. Une règle mal portée transforme le site en squelette
permanent aux formulaires inertes — exactement le P0 du 2026-09-06, que tous les contrôles fondés sur un 200
laissaient passer. Une sonde qui ne vérifierait que les refus **déclarerait un succès sur un site mort**.
Chaque exécution vérifie donc les deux sens, et énumère les bundles **réellement référencés** par les pages
servies.

**BASELINE MESURÉE — `https://app.grubano.com` (staging), 2026-09-29 : FAIL, 8 exposés, 0 cassés, 44 bundles vérifiés**

| Chemin exposé | Taille | Ce que c'est |
|---|---|---|
| `/prisma/schema.prisma` | **175 899 o** | le **modèle de données complet et COURANT**, tables d'argent incluses |
| `/scripts/server/phase2-refund-gate.js` | **74 066 o** | **l'opérateur de la fenêtre de remboursement** |
| `/scripts/server/staging-backup.js` | 14 366 o | l'opérateur de sauvegarde |
| `/scripts/cron/monthly-invoices.js` | 7 254 o | le cron de facturation |
| `/lib/ledger-check-core.js` | 8 156 o | le cœur du contrôle de ledger |
| `/server.js` | 5 512 o | l'entrée Passenger |
| `/package.json` | 2 961 o | dépendances **et versions** |
| `/.next/BUILD_ID` | 21 o | l'identifiant de build |

**Staging est donc PIRE que la production**, et c'est vrai maintenant : les scripts opérateur que vous nommez
sont publiquement téléchargeables. La production, elle, n'expose que ses trois fichiers de mai
(`schema.prisma` 18 550 o, `package.json` 2 089 o, `server.js` 878 o) — **et le déploiement #1 la mettra au
niveau de staging.**

Les fichiers cachés sont correctement bloqués sur les deux hôtes : `/.env.local`, `/.env`,
`/.env.production`, `/.htaccess` → **404**.

**LE CORRECTIF PROPOSÉ — par CHEMIN, jamais par extension**

`<FilesMatch "\.js$">` tuerait les bundles. `RedirectMatch 404` agit sur le **chemin**, laisse
`/_next/static/` intact, et répond **404 plutôt que 403** — plus strict, parce qu'un 404 ne confirme pas
l'existence (doctrine « 404 avant 403 »).

```apache
# PROD-14 — ne jamais servir les sources, manifestes, scripts opérateur ni configuration.
# Portée par CHEMIN : /_next/static/ (tous les bundles .js et .css) n'est pas touché.
RedirectMatch 404 ^/(prisma|scripts|lib|tests|messages|docs|components|app)(/|$)
RedirectMatch 404 ^/\.next(/|$)
RedirectMatch 404 ^/(package(-lock)?\.json|tsconfig\.json|next\.config\.js|server\.js|test-server\.js|vitest\.config\.ts|postcss\.config\.js|tailwind\.config\.ts|i18n\.ts|navigation\.ts|middleware\.ts)$
```

| | |
|---|---|
| **Interface** | cPanel → Gestionnaire de fichiers → `~/app.grubano.com/.htaccess` (**répétition d'abord**), puis `~/grubano.com/.htaccess` |
| **Utilisateur** | `deyi0010` |
| **Préconditions** | **copier le `.htaccess` actuel dans un fichier daté AVANT toute édition** (il n'est pas récupérable depuis le dépôt : le pipeline ne l'écrit plus et il répond 553 en FTP) ; **ajouter en tête**, ne rien remplacer |
| **Fichiers touchés** | `.htaccess` uniquement. Aucun fichier applicatif, aucune base, aucun redémarrage. |
| **Test de succès** | `node scripts/server/web-exposure-probe.js https://app.grubano.com` → **`RESULT: PASS`**, `EXPOSED 0`, `BROKEN 0`, et **`BUNDLES CHECKED` > 0** |
| **Condition STOP** | `BROKEN` > 0 ⇒ **retirez le bloc immédiatement** : une route légitime ou un bundle est cassé. · `BUNDLES CHECKED: 0` ⇒ **le PASS ne prouve rien** (la sonde le dit elle-même) : les pages ne se servent pas, corrigez cela d'abord. · `/version.json` ≠ 2xx ⇒ le health-check du déploiement est cassé. |
| **Rollback immédiat** | retirer le bloc du `.htaccess` par cPanel. Effet immédiat, aucun redémarrage, aucune donnée en jeu. |
| **Réversible** | **OUI**, totalement |
| **Ordre recommandé** | **répéter sur staging d'abord.** Le risque réel n'est pas le refus, c'est la portée : selon l'ordre des modules Apache, un `RedirectMatch` peut voir l'URI avant ou après une réécriture. Staging le dira gratuitement. |

⚠️ **Le déploiement #1 aggrave l'exposition de la production** (schéma de mai → schéma courant, 27 → 77
modèles). Soit le bloc est posé **avant** le déploiement #1, soit immédiatement après, mais pas « plus tard ».

### 15.3 D10 — MESURÉ. Grubano absorbe les frais Stripe. Le commentaire avait raison.

Mesure **lecture seule**, faite là où se trouve la vérité : **l'objet Stripe**, jamais la ligne DB (règle du
dépôt). Clé `sk_test_` vérifiée, `livemode` faux sur les 100 charges lues, **aucune écriture**.

**Côté PLATEFORME** — 100 charges lues, **69 routées** (*destination charge*), **46** avec leur balance
transaction étendue :

```
46 / 46  →  bt.fee > 0, fee_details = [stripe_fee: N]
 0 / 46  →  bt.fee = 0
```

**Côté COMPTE CONNECTÉ** — les balance transactions du compte du restaurant, pour la même charge :

```
charge 14,50 € · app_fee 116 c · on_behalf_of = le compte connecté
  plateforme : amount 1450 · fee  71 · net 1379 · details[stripe_fee:71]
  restaurant : amount 1450 · fee 116 · net 1334 · details[application_fee:116]
```

**Les deux côtés disent la même chose, et c'est sans ambiguïté :** le compte du restaurant n'est débité que de
**la commission** (`application_fee`) — **il n'y a aucune ligne `stripe_fee` chez lui**. Les frais Stripe
apparaissent **uniquement** sur le solde plateforme. Arithmétique vérifiée : plateforme
`1450 − 71 − 1334 = 45` = commission − frais Stripe.

⇒ **`on_behalf_of` ne déplace PAS la charge des frais.** Il fixe la tarification et le libellé du marchand de
règlement ; la plateforme reste débitée. Le commentaire de `lib/commission.ts` est **exact**, et il est
maintenant **mesuré** au lieu d'être affirmé.

**Le taux réel des frais.** Quatre charges ajustent exactement **3,15 % + 0,25 €** :
1450→71 · 1410→69 · 1900→85 · 3050→121. **C'est un taux de carte de TEST, pas le tarif LIVE.** En LIVE, une
carte de consommateur EEE est facturée **1,5 % + 0,25 €** ; une carte hors EEE ou commerciale, davantage. Le
tableau ci-dessous prend donc le tarif **LIVE EEE**, et donne la colonne TEST en contrôle.

**Commande exemple : 30 € de sous-total produits.** Aucun frais de livraison, aucune promo, aucun pourboire,
aucune franchise. Frais Stripe LIVE EEE = 30 × 1,5 % + 0,25 = **0,70 €**.

| Taux | Commission Grubano | Frais Stripe · payés par | Brut restaurant | **Reçu restaurant** | Marge brute Grubano | **Marge après Stripe** |
|---|---|---|---|---|---|---|
| **5 %** sur place | 1,50 € | 0,70 € · **Grubano** | 28,50 € | **28,50 €** | 1,50 € | **0,80 €** |
| **8 %** click & collect | 2,40 € | 0,70 € · **Grubano** | 27,60 € | **27,60 €** | 2,40 € | **1,70 €** |
| **12 %** livraison | 3,60 € | 0,70 € · **Grubano** | 26,40 € | **26,40 €** | 3,60 € | **2,90 €** |
| **0 %** réservation / offre fondateur | 0,00 € | 0,70 € · **Grubano** | 30,00 € | **30,00 €** | 0,00 € | **−0,70 €** |

Au taux TEST mesuré (1,20 € de frais) les marges après frais deviennent **0,30 / 1,20 / 2,40 / −1,20 €**.

**La distinction que vous demandiez s'effondre, et c'est la réponse** : « brut restaurant » et « reçu
restaurant » sont **égaux**. Le net du restaurant est `montant − commission`, et **les frais Stripe ne le
touchent pas**. Le restaurant n'a aucun frais de transaction à supporter.

**Trois conséquences chiffrées :**

1. **L'offre fondateur à 0 % n'est pas « gratuite » : elle coûte 0,70 € par commande de 30 €** — et le coût
   croît avec le panier (0,015 × montant + 0,25).
2. **Seuil de rentabilité** (`taux × S = 1,5 % × S + 0,25 €`) : **5 % ⇒ 7,14 €** · **8 % ⇒ 3,85 €** ·
   **12 % ⇒ 2,38 €** · **0 % ⇒ jamais**. Au taux TEST mesuré : 13,51 € · 5,15 € · 2,82 €.
3. **Le petit panier est déjà couvert** : `SMALL_ORDER_FEE_CENTS` (défaut **1,00 €** sous un seuil de
   **12,00 €**) est **retenu dans l'application fee en plus de la commission** — Grubano le garde. Sous 12 €,
   même une commande à 0 % rapporte ≈ +0,30 €. **La seule zone de perte est donc 0 % au-dessus de 12 €.**

Asymétrie structurelle à connaître : la commission porte sur le **sous-total produits**, les frais Stripe sur
le **montant total encaissé**. Un frais de livraison de 3 € — reversé à 100 % au restaurant — coûte donc
≈ 4,5 c de frais Stripe à Grubano **sans aucune commission dessus**.

Je ne choisis pas de taux. La grille est mesurée ; l'arbitrage est le vôtre.

### 15.4 D2 — la dérive staging : ce qui est mesurable d'ici l'est, et il est NUL

Vous avez demandé de comprendre la dérive **avant** tout baseline. Le `migrate diff` exige la base de
staging, donc un shell serveur — mais la partie **statique** se vérifie ici, et je l'ai faite : les deux
opérateurs additifs ajoutent **7 objets**, et chacun correspond à sa déclaration Prisma, **nom pour nom**.

| DDL de l'opérateur | Déclaration `schema.prisma` | Correspond ? |
|---|---|---|
| `LoyaltyTransaction.sourceEventId VARCHAR(191) NULL` | `sourceEventId String?` | ✅ (`String` → `VARCHAR(191)`) |
| `LoyaltyTransaction.actorId VARCHAR(191) NULL` | `actorId String?` | ✅ |
| `LoyaltyCustomer.recoveryOffsetPoints INTEGER NOT NULL DEFAULT 0` | `recoveryOffsetPoints Int @default(0)` | ✅ |
| `CREATE UNIQUE INDEX LoyaltyTransaction_sourceEventId_type_key (sourceEventId, type)` | `@@unique([sourceEventId, type])` | ✅ **nom ET ordre des colonnes** — l'opérateur a délibérément suivi la convention de nommage Prisma |
| `Claim.approvedAmountCents INTEGER NULL` | `approvedAmountCents Int?` | ✅ |
| `Claim.selection JSON NULL` | `selection Json?` | ✅ |
| `Order.deliveredAt DATETIME(3) NULL` | `deliveredAt DateTime?` | ✅ (`DateTime` → `DATETIME(3)`) |

Le nom d'index était le seul vrai piège : un index créé sous un autre nom aurait produit une dérive
permanente et invisible. Il est correct.

**Donc les deux opérateurs connus n'introduisent AUCUNE dérive par construction.** Toute dérive résiduelle
viendrait de changements de schéma effectués **après** le dernier `db push` sur staging — ce que seul le
serveur peut dire, en une commande :

```bash
source ~/nodevenv/app.grubano.com/24/bin/activate
cd ~/app.grubano.com
npx prisma@5.22.0 migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
echo "exit=$?"
```

| Sortie | Ce qu'on en fait |
|---|---|
| `No difference detected.` / `exit=0` | staging est aligné ⇒ le baseline `0_init` peut être déclaré `--applied` sur staging **et** production |
| `exit=2` + un diff | **NE PAS baseliner.** Le diff imprimé nomme chaque écart. Il faut décider, écart par écart, s'il s'agit d'un manque sur staging (à appliquer par un opérateur additif) ou d'une déclaration en avance dans `schema.prisma` |
| `exit=1` | erreur de DSN ou de privilèges, aucune conclusion |

⚠️ **Et un piège d'ordre** : `migrate resolve --applied 0_init` doit être exécuté sur **chaque**
environnement. Si production est baselinée et staging non, le prochain `migrate deploy` sur staging tentera
d'appliquer `0_init` **à une base non vide** et échouera.

---

## 16 · PROD-14 staging, PROD-6a, PROD-5c — tout est prêt, et rien ne peut être exécuté d'ici

### 16.1 Le fait qui gouverne les trois : je n'ai pas accès au serveur

Les trois actions autorisées sont des **actions fondateur**, et ce n'est pas une préférence de ma part :

| Action | Ce qu'elle exige | Mon accès |
|---|---|---|
| PROD-14 sur staging | éditer `~/app.grubano.com/.htaccess` (cPanel) | **aucun** — pas de session cPanel |
| … par FTP à la place ? | `O2SWITCH_FTP_USER` / `_PASS` | ce sont des **secrets GitHub** : je ne peux pas lire leur valeur |
| … par SSH ? | `O2SWITCH_SSH_KEY` | secret GitHub, **et** SSH depuis les runners a expiré **3 fois sur 3** vers cet hôte |
| … par le pipeline ? | réécrire `.htaccess` depuis le workflow | **non** : PROD-2 a retiré cette écriture précisément parce qu'elle répond **553** ou **écrase la configuration Passenger vivante**. Le rétablir annulerait un correctif P0 pour tenter une écriture qui échoue. |
| PROD-6a | créer une base dans cPanel → MySQL® Databases | **aucun** — interface cPanel |
| PROD-5c | modifier le secret GitHub `DATABASE_URL_PROD` | la **valeur** est le DSN avec son mot de passe : je ne l'ai pas et je ne dois pas la manipuler |

C'est la même frontière que pour l'armement de L11, et elle est **voulue**. Ce que je peux faire, et ce que
j'ai fait : rendre chaque action **un copier-coller**, et sa vérification **mécanique**.

### 16.2 PROD-14 — l'état AVANT, mesuré, et il est pire que ce que j'avais rapporté

`node scripts/server/web-exposure-probe.js https://app.grubano.com` → **`RESULT: FAIL` · 14 exposés ·
0 cassés · 44 bundles vérifiés (JS 35 · CSS 9)**.

La liste DENY de la sonde a été **élargie par la mesure**, pas par la mémoire — et elle a trouvé six
chemins que la première version manquait :

| Chemin | Taille | Pourquoi il compte |
|---|---|---|
| `/prisma/schema.prisma` | 175 899 o | le modèle de données courant complet |
| `/node_modules/.prisma/client/schema.prisma` | **175 004 o** | **une SECONDE copie du même modèle**, par un chemin auquel je n'avais pas pensé |
| `/messages/fr.json` | **470 616 o** | **toute la copie de l'application**, admin et légal inclus |
| `/.next/routes-manifest.json` | **48 547 o** | **chaque route de l'application**, chemins admin et API internes inclus |
| `/scripts/server/phase2-refund-gate.js` | 74 066 o | l'opérateur de la fenêtre de remboursement |
| `/scripts/server/staging-backup.js` | 14 366 o | l'opérateur de sauvegarde |
| `/scripts/cron/monthly-invoices.js` | 7 254 o | le cron de facturation |
| `/scripts/cron/cron-target-guard.js` | **9 291 o** | **le garde B2 — livré il y a vingt minutes et déjà publiquement téléchargeable** |
| `/lib/ledger-check-core.js` · `/lib/claims-payable-core.js` | 8 156 · 6 337 o | le cœur du contrôle de ledger, et son frère |
| `/node_modules/next/package.json` | 9 992 o | l'arbre de dépendances est web-lisible en entier |
| `/.next/required-server-files.json` | 4 690 o | la configuration Next résolue |
| `/.next/BUILD_ID` | 21 o | l'identifiant de build |
| `/public/version.json` · `/public/manifest.webmanifest` | 212 · 642 o | contenu inoffensif, mais **la mise en page du serveur parle** |

**La dernière ligne du tableau B2 est la leçon du lot** : chaque déploiement élargit l'exposition. Le garde
cron que vous venez de valider est devenu lisible par tout le monde au moment même où il est arrivé sur le
serveur.

### 16.3 La règle, resserrée par la mesure

Fichier prêt à coller, versionné : **`docs/ops/htaccess/PROD-14-deny-sources.htaccess`**.

```apache
RedirectMatch 404 ^/(prisma|scripts|lib|messages|public|node_modules)(/|$)
RedirectMatch 404 ^/\.next(/|$)
RedirectMatch 404 ^/(package(-lock)?\.json|server\.js)$
```

**Chaque jeton correspond à un 200 mesuré.** Et j'ai **retiré** de ma première version `tests`, `docs`,
`components`, `app`, `tsconfig.json`, `next.config.js`, `i18n.ts`, `navigation.ts`, `middleware.ts`,
`vitest/postcss/tailwind.config` : tous mesurés à **404**, donc absents du serveur. **Une règle qui ne nomme
que ce qui existe ne peut pas casser ce qui n'existe pas** ; chaque jeton spéculatif n'était qu'un risque de
collision pour zéro bénéfice.

Trois refus valent une justification, parce qu'ils paraissent risqués et ne le sont pas :

- **`messages/`** — les traductions sont chargées par un `import()` **serveur** (`i18n.ts:16`) et **jamais**
  fetchées par le navigateur. Vérifié : zéro référence `"/messages` dans `app`, `lib`, `components`.
- **`node_modules/`** — le client ne lit ses bundles que sous `/_next/static/`. Passenger lit le disque, pas
  HTTP.
- **`public/`** — ces fichiers sont servis **à la racine** par Next (`/favicon.ico`, `/icons/…` mesurés 200).
  Zéro référence au préfixe `/public/` dans le code, et le service worker ne précache que `/_next/static/`,
  `/_next/data/`, `/api/`, `/icons/`, `/offline.html`.

**Pourquoi l'ordre des directives ne devrait pas poser problème ici** : le `.htaccess` attendu est celui que
l'ancien workflow écrivait — **huit directives Passenger, aucune `RewriteRule`, aucune directive mod_alias**
(récupéré de `6dd99d1f^`). Sans règle de réécriture concurrente, un `RedirectMatch` en tête agit avant que le
gestionnaire Passenger ne soit consulté. **Mais le `.htaccess` vivant peut avoir été enrichi depuis** — d'où
la copie datée obligatoire et la répétition sur staging.

**Ce que la sonde vérifie, item par item contre votre liste :**

| Votre exigence | Couvert par |
|---|---|
| `/prisma/schema.prisma` → 403/404 | DENY (et la seconde copie sous `node_modules/.prisma`) |
| `/package.json` → 403/404 | DENY |
| `/server.js` → 403/404 | DENY |
| `/scripts/server/**` → 403/404 | DENY × 3 fichiers réels |
| autres sources/configs → 403/404 | DENY `lib`, `messages`, `.next`, `public`, `node_modules` |
| `/_next/static/**` accessible | énumération des bundles **réellement référencés** par 2 pages servies |
| chunks JS 200 | **compté séparément** ; `JS 200 = 0` est un échec nommé |
| CSS 200 | **compté séparément** ; `CSS 200 = 0` est un échec nommé |
| assets publics 200 | `/favicon.ico` `/manifest.webmanifest` `/sw.js` `/offline.html` `/icons/icon-192.png` `/fonts/OFL-cairo.txt` |
| `/version.json` accessible | ALLOW, et c'est la porte du déploiement |
| routes applicatives non cassées | `/fr/eat` `/fr/auth/magic` `/fr/eat/auth` `/api/restaurants` |

### 16.4 PROD-6a — la preuve read-only est écrite, et ses refus sont exécutés

Nouvel opérateur **lecture seule** : `scripts/server/prod-db-verify.js`. Il répond **exactement** à vos cinq
points et s'arrête là : base existe · utilisateur existe · connexion possible · nom explicitement production ·
aucune table inattendue. Plus un sixième, gratuit : **le grant ne doit pas toucher une base `_staging`**.

**Il ne judge que le DSN, et c'est dit dans son en-tête.** Tous les autres opérateurs croisent `DATABASE_URL`
avec `NEXTAUTH_URL` ; c'est juste pour eux, qui tournent dans l'application qu'ils jugent. Celui-ci ne peut
pas : à PROD-6a, `~/grubano.com` n'a **pas encore** de `node_modules` (le pipeline n'en livre aucun et
PROD-5b vient après le déploiement #1), donc le seul client Prisma disponible est celui de **staging**. Croiser
`NEXTAUTH_URL` là-bas refuserait précisément l'exécution voulue. La règle est donc resserrée sur ce qui est
réellement jugé — **le DSN** — et un DSN en `_staging` est refusé, un DSN non identifiable comme production
aussi (liste blanche).

```bash
cd ~/app.grubano.com
source ~/nodevenv/app.grubano.com/24/bin/activate
read -rsp 'production DSN: ' DATABASE_URL && export DATABASE_URL && echo
node scripts/server/prod-db-verify.js
unset DATABASE_URL
```

`read -rs` n'affiche rien et, contrairement à un préfixe `VAR=… commande`, **ne laisse aucune copie dans
l'historique**. Le DSN est masqué dans chaque ligne imprimée.

**Sortie attendue** : `RESULT: PASS` · `DATABASE EXISTS: YES` · `CONNECTION: OK` · `USER EXISTS: YES` ·
`NAME IS PRODUCTION: YES` · `GRANTS ON A STAGING DATABASE: NO` · `TABLES PRESENT: 0` ·
`UNEXPECTED APPLICATION TABLES: 0` · `DATABASE CHANGED: NO`.

**Cinq refus exécutés** (aucun n'atteint la base) : DSN absent · DSN non parseable · DSN sans nom de base ·
nom en `_staging` · nom non identifiable. **Et un contrôle positif exécuté** : un DSN de forme production
franchit le garde et échoue à l'étape **4 (connexion)** — la preuve que l'opérateur ne refuse pas tout.

**Conditions STOP** : `TABLES PRESENT` ≠ 0 ⇒ la base n'est pas vierge, **PROD-6b n'est plus la première
création délibérée**, arrêt. · `GRANTS ON A STAGING DATABASE: YES` ⇒ séparation rompue, corriger dans cPanel
avant d'aller plus loin. · `GRANTS: NOT MEASURED` ⇒ le serveur a refusé `SHOW GRANTS`, vérifiez l'association
à la main.

### 16.5 PROD-5c — et pourquoi il ne peut pas venir « ensuite seulement »

PROD-5c aligne le secret GitHub `DATABASE_URL_PROD` sur le DSN de la nouvelle base. Il n'a **aucun** effet
runtime : ce secret n'alimente que `Generate Prisma client` et `Build` dans le job `deploy` (lignes 92 et 97).
À l'exécution, c'est le `.env.local` du serveur qui gouverne — et il n'existera qu'à l'étape 7.

Il est donc **strictement compatible** avec votre objectif, et pour une raison structurelle plutôt que par
prudence : **PROD-5c ne peut pas installer une clé Stripe, ni ouvrir un drapeau, ni réveiller un build.** Il
change une valeur utilisée au moment de la compilation, sur un runner GitHub.

Deux points de méthode :

1. **Notez l'ancienne valeur hors dépôt avant de la remplacer.** GitHub ne la conserve pas, et sans elle le
   rollback de PROD-5c n'existe pas.
2. **Le DSN doit être identique à celui du `.env.local`** (étape 7). Deux DSN divergents donneraient un build
   compilé contre une base et un runtime branché sur une autre — une panne qui ne se voit qu'au premier client.

Et le rappel qui compte pour la posture « production technique fermée » : **aucune clé Stripe à cette étape.**
Il n'existe qu'un seul `new Stripe(...)` dans toute l'application (`lib/stripe.ts:19`), derrière `getStripe()`
qui **jette** sans clé, et les huit sites d'écriture financière passent tous par lui. **Sans clé, même un
drapeau argent ouvert par accident ne peut déplacer aucun argent.** C'est la serrure la plus forte de P1, et
elle consiste à ne rien faire.
