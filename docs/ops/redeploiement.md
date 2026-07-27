# Redéploiement — procédures de référence (S0-4)

## Chemins de déploiement ✅

| Chemin | Déclencheur | Cible | Gates bloquants |
|---|---|---|---|
| `deploy-staging.yml` | push sur `develop` (ou dispatch) | `app.grubano.com` (FTP `/app.grubano.com/`) | suite vitest complète (`test:ci`) puis `check-translations` |
| `deploy-production.yml` | push sur `main` (ou dispatch) | `grubano.com` (FTP `/grubano.com/`) | idem + health check prod BLOQUANT |
| `prepare-deploy.ps1` (local Windows) | manuel | ZIP à uploader en cPanel | vérifs internes (standalone, node_modules/next, zip) |

Étapes communes CI : `npm ci` → check translations → `prisma generate` →
`npm run build` → `fix-server.js` (patch chemins Windows) → assemblage
`deploy-temp/` (standalone AVEC son node_modules trimmé + `.next/static` +
`prisma/schema.prisma` + `scripts/server/*.js` + `scripts/cron/*.js` + `public/`)
→ **stamp build-info (S0-3)** → FTPS → tâches SSH post-deploy → restart
Passenger (3 mécanismes redondants : 2×SSH + FTPS `restart.txt`).

Garde-fous FTP à ne jamais retirer : exclusions `node_modules` (symlink nodevenv
côté serveur), `.env*` (source de vérité serveur), `.htaccess` (non-writable).

## Vérifier QUEL build tourne (S0-3) ✅

```bash
curl -s https://app.grubano.com/version.json   # staging
```

```bash
curl -s https://www.grubano.com/version.json   # production
```

Compare `commit` avec `git rev-parse origin/develop` (staging) ou
`origin/main` (prod). Le fichier `VERSION` est aussi à la racine du deploy.
Chaque run CI fait cette vérification (étape « Verify deployed build »,
non-bloquante — Passenger peut encore être en train de redémarrer).

## Post-deploy manuel (si besoin, cPanel Terminal)

```bash
chmod -R 755 ~/app.grubano.com/.next/
chmod 600    ~/app.grubano.com/.env.local
mkdir -p ~/app.grubano.com/tmp && touch ~/app.grubano.com/tmp/restart.txt
```

Schéma modifié depuis le dernier push → `bash ~/app.grubano.com/scripts/server/prisma-push.sh`
(utilise `./node_modules/.bin/prisma` pinné 5.22.0 — JAMAIS le prisma global v7).

## Rollback (procédure de référence — jamais testée à chaud, à répéter avant bêta)

Le deploy FTP ne garde pas d'ancien build côté serveur → le rollback = re-déployer
un commit antérieur :

1. Identifier le dernier bon commit : `git log --oneline develop` + le
   `version.json` actuellement servi (dit exactement ce qui tourne).
2. `git revert <mauvais commits>` sur `develop` (JAMAIS de force-push) → le push
   déclenche un deploy staging normal, gates compris.
3. Cas d'urgence sans revert propre : Actions → « Deploy to Staging » →
   « Run workflow » sur le tag/branche du bon commit (workflow_dispatch accepte
   n'importe quelle ref portant le workflow).
4. Vérifier `version.json` == commit attendu + health check.
5. Production : même logique via `main` (merge du revert depuis `develop`),
   jamais de commit direct sur `main`.

## Pièges connus (⭐ mémoire projet)

- `Cannot find module 'next'` → le node_modules standalone a été supprimé du deploy.
- Page blanche → `.next/static` non copié, ou artefacts stale (le post-deploy
  `prune-next.js` les purge).
- 500 partout → `.env.local` serveur incomplet (`NEXTAUTH_SECRET` manquant).
- Root prod `grubano.com` : redirect 307 www caché — les health checks doivent
  viser `www.grubano.com` ou accepter 2xx/3xx.
