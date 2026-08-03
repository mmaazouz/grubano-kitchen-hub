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

## 2. Crontab cPanel (serveur o2switch) ✅ RELEVÉ SERVEUR 26-27/07/2026

**Source : relevé `crontab -l` effectué par Mohammed en cPanel Terminal les
26-27/07/2026** (clôture M7). C'est la référence versionnée du seul morceau
d'ops qui ne vivait pas dans le repo. 3 jobs actifs, sorties dans `~/logs/` :

```cron
# Relevé serveur 26-27/07/2026 — 3 jobs actifs, logs dans ~/logs/
30 6 * * * node scripts/cron/creator-earnings-mature.js   # quotidien 06:30
0  7 * * * node scripts/cron/ledger-check-probe.js        # quotidien 07:00
0  8 1 * * node scripts/cron/monthly-invoices.js          # mensuel, le 1er 08:00
```

Écarts vs les hypothèses documentées précédemment (modèle indicatif retiré) :
- Horaires réels ≠ modèle deviné (le modèle supposait 03:20/03:25/07:00) —
  **le relevé fait foi**.
- ⚠️ **Doublon programmé au go-live** : le groupe `daily` de `cron.yml`
  (GitHub, `20 3 * * *` UTC) exécute AUSSI `ledger-check-probe.js` +
  `creator-earnings-mature.js`, et son groupe `monthly` (`0 7 1 * *` UTC)
  exécute AUSSI `monthly-invoices.js`. Tant que `cron.yml` n'est pas sur
  `main`, seul le crontab cPanel tourne. Le jour où `cron.yml` s'active,
  ces 3 jobs tourneront DEUX fois par période (idempotents par conception,
  mais bruit d'alertes/emails doublé) → décision go-live : couper l'un des
  deux schedulers pour ces 3 jobs.

## 3. Workflow GitHub `cron.yml` ✅ (inerte en schedule tant que pas sur `main`)

`.github/workflows/cron.yml` (WP-OPS-01) orchestre les jobs périodiques via la
variable de repo `CRON_TARGET_BASE_URL` (jamais de défaut prod ; guard qui
échoue si absente). **GitHub ne déclenche `schedule` que depuis la branche par
défaut (`main`)** → tant que le fichier n'y est pas, seul `workflow_dispatch`
fonctionne. Chaque job est idempotent et no-op quand son flag est OFF.

| Groupe | Cadence | Actions |
|---|---|---|
| ~~frequent~~ | — | **RETIRÉ (P0-07)** — le groupe horaire `POST /api/email-agent` a été supprimé de `cron.yml` par décision fondateur : automatisation à effet externe (emails rédigés par LLM envoyés à de vrais clients/créateurs/restaurateurs) sans validation humaine. |
| sweep | `*/20 * * * *` | `POST /api/logistics/positions/sweep` (rétention géoloc, no-op flags OFF) |
| daily | `20 3 * * *` | `ledger-check-probe.js` + `creator-earnings-mature.js` + `POST /api/admin/creator-payouts/run` + `POST /api/admin/onboarding-nudges/run` + `GET /api/admin/reconcile-ghost-orders` (read-only) — **`POST /api/admin/claims/auto-approve` RETIRÉ (P0-07)** : auto-approbation des réclamations en timeout 24 h **et remboursement**, sans admin dans la boucle. |
| monthly | `0 7 1 * *` | `monthly-invoices.js` + `POST /api/admin/franchise-settlements/run` |

## 4. Routes cron-appelables SANS scheduler actif ✅ (le « trou » constaté)

11 routes lisent `CRON_SECRET` ou `INTERNAL_CRON_TOKEN`. Couverture :

| Route | Scheduler |
|---|---|
| `/api/email-agent` | **AUCUN scheduler (P0-07)** — job `frequent` retiré de cron.yml. La route existe toujours et reste appelable avec `CRON_SECRET`, mais plus rien ne la déclenche automatiquement. |
| `/api/logistics/positions/sweep` | cron.yml (sweep) — inerte hors `main` |
| `/api/admin/ledger/check` | script + cPanel crontab ✅ actif |
| `/api/admin/creator-earnings/mature` | script + cPanel crontab ✅ actif |
| `/api/admin/invoices/generate` | script + cPanel crontab ✅ actif |
| `/api/admin/claims/auto-approve` | **AUCUN scheduler (P0-07)** — step retiré du groupe `daily`. Route et lib intactes : un admin peut encore la déclencher délibérément, mais elle n'est plus planifiée. |
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
