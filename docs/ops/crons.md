# Crons — état de référence (S0-4, documenté sans modification)

Trois couches distinctes. Rien n'a été modifié pendant le Sprint 0.

## 1. Scripts cron versionnés (`scripts/cron/`) ✅

Déployés sur le serveur par les workflows de deploy (seul `scripts/cron/*.js`
est shippé — jamais le reste de `scripts/`, cf. `deploy-staging.yml`).

| Script | Rôle | Cible |
|---|---|---|
| `scripts/cron/ledger-check-probe.js` | Sonde de cohérence du ledger (lecture seule) + alerte email si écart | `/api/admin/ledger/check` |
| `scripts/cron/monthly-invoices.js` | Factures de commission du mois précédent | `/api/admin/invoices/generate` |
| `scripts/cron/creator-earnings-mature.js` | Maturation des gains créateurs | `/api/admin/creator-earnings/mature` |

Env requis par ces scripts : `SITE_URL`, `INTERNAL_CRON_TOKEN`, `ALERT_EMAIL`,
`SMTP_HOST/USER/PASS` (noms seulement — valeurs dans `.env.local` serveur /
GitHub Secrets).

## 2. Crontab cPanel (serveur o2switch) ⚠️ À CONFIRMER SERVEUR

Constat d'audit (M-vague, juillet 2026) : **3 crontabs actifs = les 3 scripts
ci-dessus**, mais le crontab lui-même n'est **pas versionné**. Le relevé de
référence exact (`crontab -l`) doit être copié ici lors de la prochaine session
cPanel — c'est le seul morceau d'ops qui ne vit pas dans le repo.

Modèle attendu (à remplacer par le relevé réel) :

```cron
# À COPIER DEPUIS `crontab -l` EN CPANEL TERMINAL — modèle indicatif
20 3 * * * cd ~/app.grubano.com && node scripts/cron/ledger-check-probe.js
25 3 * * * cd ~/app.grubano.com && node scripts/cron/creator-earnings-mature.js
0  7 1 * * cd ~/app.grubano.com && node scripts/cron/monthly-invoices.js
```

## 3. Workflow GitHub `cron.yml` ✅ (inerte en schedule tant que pas sur `main`)

`.github/workflows/cron.yml` (WP-OPS-01) orchestre les jobs périodiques via la
variable de repo `CRON_TARGET_BASE_URL` (jamais de défaut prod ; guard qui
échoue si absente). **GitHub ne déclenche `schedule` que depuis la branche par
défaut (`main`)** → tant que le fichier n'y est pas, seul `workflow_dispatch`
fonctionne. Chaque job est idempotent et no-op quand son flag est OFF.

| Groupe | Cadence | Actions |
|---|---|---|
| frequent | `15 * * * *` | `POST /api/email-agent` (Bearer `CRON_SECRET`) |
| sweep | `*/20 * * * *` | `POST /api/logistics/positions/sweep` (rétention géoloc, no-op flags OFF) |
| daily | `20 3 * * *` | `ledger-check-probe.js` + `creator-earnings-mature.js` + `POST /api/admin/claims/auto-approve` + `POST /api/admin/creator-payouts/run` + `POST /api/admin/onboarding-nudges/run` + `GET /api/admin/reconcile-ghost-orders` (read-only) |
| monthly | `0 7 1 * *` | `monthly-invoices.js` + `POST /api/admin/franchise-settlements/run` |

## 4. Routes cron-appelables SANS scheduler actif ✅ (le « trou » constaté)

11 routes lisent `CRON_SECRET` ou `INTERNAL_CRON_TOKEN`. Couverture :

| Route | Scheduler |
|---|---|
| `/api/email-agent` | cron.yml (frequent) — inerte hors `main` |
| `/api/logistics/positions/sweep` | cron.yml (sweep) — inerte hors `main` |
| `/api/admin/ledger/check` | script + cPanel crontab ✅ actif |
| `/api/admin/creator-earnings/mature` | script + cPanel crontab ✅ actif |
| `/api/admin/invoices/generate` | script + cPanel crontab ✅ actif |
| `/api/admin/claims/auto-approve` | cron.yml (daily) — inerte hors `main` |
| `/api/admin/creator-payouts/run` | cron.yml (daily) — inerte hors `main` |
| `/api/admin/onboarding-nudges/run` | cron.yml (daily) — inerte hors `main` |
| `/api/admin/reconcile-ghost-orders` | cron.yml (daily) — inerte hors `main` |
| `/api/admin/franchise-settlements/run` | cron.yml (monthly) — inerte hors `main` |
| `/api/admin/refunds/run` | **AUCUN scheduler nulle part** (moteur refunds, flag OFF) |

Conséquence opérationnelle : aujourd'hui seuls les 3 crontabs cPanel tournent
réellement. Le reste ne s'exécute que si quelqu'un dispatch `cron.yml` à la
main. La mise sur `main` de `cron.yml` (au go-live) activera les schedules —
c'est une **décision volontaire**, pas un effet de bord.

> Décision hors périmètre Sprint 0 : brancher un scheduler sur
> `/api/admin/refunds/run` n'a de sens qu'après l'arbitrage REFUNDS.
