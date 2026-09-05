# WEB-ROOT HARDENING — HANDOFF (train infra séparé, PRÉ-PRODUCTION P1) — préparé le 2026-09-05

> Ce train **n'a pas été exécuté**. Il est découplé du gate financier Phase 2 (décision fondateur). Il ne doit démarrer qu'en session dédiée, avec le protocole ci-dessous. **Aucune modification de `.htaccess` n'a été faite par le préflight financier.**

## 1 · Faits mesurés (HEAD publics, statut seul, staging `app.grubano.com`, 2026-09-05)

| Classe | Chemins | Statut | Lecture |
|---|---|---|---|
| **Secrets** | `/.env`, `/.env.local`, `/.env.production`, `/.env.production.local`, `/.env.local.bak`, `/.env.local.bak-before-beta-flags`, `/.env.local.bak-phase2-2026-09-04T17-48-54-236Z`, `/.env.local.bak-phase2-2026-09-05T09-17-32-014Z` (fondateur), `/.env.example`, `/.htaccess`, `/.git/HEAD`, `/.git/config`, `/.gitignore`, `/deploy_key.pub`, `*.sql` (5 noms), `/logs/error.log`, `/cron.log` | **404** | **AUCUNE FUITE DE SECRET CONFIRMÉE** — la règle hébergeur refuse les dotfiles |
| — | `/deploy_key` | 307 → `/fr/login` (route Next, pas un fichier) ; `/logs/` 308 → `/logs` (redirection Next) | pas un fichier servi |
| **Source / ops** | `/server.js` (4,6 Ko), `/package.json`, `/prisma/schema.prisma` (172 Ko — schéma complet), `/tmp/restart.txt`, `/scripts/server/*.js`, `/lib/ledger-check-core.js` | **200** | divulgation d'information (structure, dépendances, logique ops) — **P1 PRÉ-PRODUCTION** |

**Sévérité : P1 PRÉ-PRODUCTION** (règle fondateur : promotion en P0 uniquement si un fichier portant un identifiant/secret devient lisible). L'opérateur v5 remesure ces classes à chaque run (`APP-ROOT WEB EXPOSURE`, `CONFIRMED SECRET LEAK`) et passe en **FAIL P0** si une classe secret répond 200.

**Cause** : sur cPanel/Passenger, le `.htaccess` de l'app vit dans la racine d'application ⇒ DocumentRoot Apache = racine Passenger ; Apache sert tout fichier existant sous cette racine avant de transmettre à Next (qui ne sert que `public/`). Une protection des dotfiles existe déjà côté hébergeur (mesurée : `.env*`, `.htaccess`, `.git/*` → 404) — **le train doit d'abord identifier OÙ cette protection est implémentée** (règle globale Apache o2switch ? `.htaccess` parent ? `.htaccess` de l'app ?) et **étendre cette politique qui fonctionne** plutôt qu'inventer un mécanisme parallèle.

## 2 · Pourquoi pas maintenant

`.htaccess` porte à la fois le **contrôle d'accès web** et la **configuration Passenger / environnement** (`PassengerEnabled`, `PassengerAppRoot`, `PassengerStartupFile`, `PassengerNodejs`, pool, timeouts ; potentiellement des variables injectées — la provenance v4 a mesuré `INTERNAL_CRON_TOKEN`, `TIPS_ENABLED`, `ALERT_EMAIL` présents dans `process.env` **avant** le chargement des fichiers `.env*`). Une erreur de syntaxe = **500 global** ; une règle mal placée peut altérer l'injection d'env. Le gate financier ne doit pas dépendre de ce risque.

## 3 · Exigences du train (obligatoires)

1. **Sauvegarde** de `.htaccess` (et de toute config autoritaire identifiée) avec horodatage, mode 600, hors racine web (`~/.grubano/`).
2. **Identification de la protection existante** des dotfiles (lecture seule : `.htaccess` de l'app, `~/.htaccess`, `/etc/apache2/conf.d/*` si lisible, `~/.cl.selector`) → étendre cette politique.
3. **Validation de syntaxe** si possible (`apachectl -t` indisponible en hébergement mutualisé → au minimum : diff minimal, directives standard `RedirectMatch 404` / `<FilesMatch> Require all denied`, pas de `SetEnv`/`Passenger*` touché).
4. **Baseline santé exacte AVANT** : `/fr/eat` 200, `/api/restaurants` 200 + JSON, `/version.json` 200, un asset `/_next/static/…` 200, `POST /api/admin/refunds/run {}` 403 gated, `/fr/business/logistics` 200, `tipsEnabled:false`, `~/.grubano/env-provenance.json` (flags critiques inchangés).
5. **Plus petit changement sûr** : une seule écriture atomique (fichier temporaire + rename), règles limitées à `^/(tmp|lib|scripts|prisma|node_modules|\.next)(/|$)` et aux fichiers `server.js`, `package.json`, `package-lock.json`, `VERSION`.
6. **Vérifications immédiates APRÈS** (≤ 60 s) : les chemins exposés → 404/403 ; baseline (4) intégralement identique.
7. **Rollback AUTOMATIQUE** (l'opérateur restaure la sauvegarde et touche `tmp/restart.txt`) si : `/fr/eat` ≠ 200 **OU** `/api/restaurants` ≠ 200 **OU** un asset Next ≠ 200 **OU** Passenger ne répond pas (5xx/timeout) **OU** un flag runtime critique change (`refunds/run` ≠ 403 gated, waitlist ≠ 200, `tipsEnabled` ≠ false, provenance divergente). Le fondateur ne répare jamais staging à la main.
8. **Idempotence** : re-run = no-op ; marqueur de bloc `# grubano-webroot-hardening v1` pour détecter la présence.
9. **Preuve** : bloc imprimé AVANT / APRÈS avec statuts ; aucun secret.
10. **Production** : seulement après succès staging **et** décision fondateur ; jamais dans le même train.

## 4 · Ticket

`docs/ops/GO-LIVE-TICKETS.md` — **T-41 « APP ROOT SOURCE EXPOSURE HARDENING »**, sévérité **P1**, bloquant **pré-production**, train infra séparé, ce document = handoff.
