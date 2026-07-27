# Rotation des secrets — PROCÉDURE DOCUMENTÉE UNIQUEMENT (S0-4)

> ⚠️ Ce document ne contient AUCUNE valeur et n'exécute RIEN. La rotation
> elle-même est planifiée au maillon « bascule prod » du plan d'exécution
> (décision Mohammed), pas pendant le Sprint 0.

## Principe général (ordre à respecter pour chaque secret)

1. **Générer** la nouvelle valeur (côté fournisseur ou localement, jamais dans le repo).
2. **Mettre à jour tous les consommateurs** AVANT de révoquer l'ancienne :
   - `.env.local` serveur (cPanel Terminal, `chmod 600`, jamais par FTP) ;
   - GitHub → Settings → Secrets and variables → Actions (même nom) ;
   - staging ET prod si le secret existe dans les deux.
3. **Restart** : `touch ~/<site>/tmp/restart.txt` (Passenger recharge l'env).
4. **Vérifier** (voir colonne Vérification) avant de révoquer l'ancienne valeur.
5. **Révoquer** l'ancienne valeur côté fournisseur.
6. Consigner date + périmètre de la rotation (sans valeur) dans le canal Notion.

Règle absolue : jamais deux secrets tournés en même temps sur le même service —
sinon impossible d'attribuer une panne.

## Inventaire (NOMS seulement) et procédure par secret

| Secret | Vit où | Comment tourner | Vérification |
|---|---|---|---|
| `NEXTAUTH_SECRET` | `.env.local` serveur + GitHub Secret | Générer 32+ octets aléatoires (`openssl rand -base64 32`). ⚠️ Invalide TOUTES les sessions JWT en cours (déconnexion générale) — à faire en heure creuse. | Login opérateur OK ; middleware ne 500 pas |
| `DATABASE_URL` (+ `DATABASE_URL_STAGING`/`_PROD` en CI) | `.env.local` serveur + GitHub Secrets | Créer un NOUVEAU user MySQL en cPanel avec les mêmes droits, basculer l'URL, vérifier, puis supprimer l'ancien user (jamais l'inverse) | Health check + une lecture authentifiée (`/dashboard`) |
| `ANTHROPIC_API_KEY` | `.env.local` serveur + GitHub Secret | Console Anthropic : créer la clé, basculer, révoquer l'ancienne | Scan IA d'un plat en staging |
| `SMTP_HOST/USER/PASS` | `.env.local` serveur + GitHub Secrets (cron) | Côté fournisseur email ; basculer serveur + secrets cron ensemble | `EmailLog` passe `sent` sur un email de test |
| `CRON_SECRET` | `.env.local` serveur + GitHub Secret | Générer, basculer des DEUX côtés dans la même fenêtre (sinon les crons 401) | `curl -X POST .../api/email-agent -H "Authorization: Bearer <nouveau>"` → 200 |
| `INTERNAL_CRON_TOKEN` | `.env.local` serveur + GitHub Secret | Idem `CRON_SECRET` (routes admin internes) | `ledger-check-probe.js` en dispatch manuel → OK |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | `.env.local` serveur | Dashboard Stripe → API keys → roll. En mode TEST aujourd'hui ; la rotation LIVE fait partie de la bascule prod | Paiement test 4242… aboutit |
| `O2SWITCH_FTP_PASS` | GitHub Secret | cPanel → comptes FTP → changer le mot de passe, puis le Secret | Deploy staging vert |
| `O2SWITCH_SSH_KEY` | GitHub Secret | Générer une nouvelle paire, ajouter la pub en cPanel → SSH, basculer le Secret, retirer l'ancienne pub | Étape SSH du deploy verte |
| `ENV_LOCAL_CONTENT` | GitHub Secret (⚠️ constat : actuellement NON utilisé par les workflows — le `.env.local` serveur est la source de vérité) | Si réintroduit un jour : régénérer à partir du `.env.local` serveur APRÈS toute rotation, sinon il redéploierait des valeurs périmées | n/a tant qu'inutilisé — candidat à suppression (décision Lot B) |
| `DOCS_DISPATCH_TOKEN` | GitHub Secret | GitHub → fine-grained PAT scopé `grubano-docs` (Contents: write), régénérer, basculer | Étape « Trigger docs rebuild » verte au prochain deploy prod |
| `NOTION_TOKEN` | poste dev uniquement (`.env.local` local, jamais déployé) | Notion → intégrations → régénérer | `node scripts/notion-sync.js read` OK |
| `ALERT_EMAIL` | GitHub Secret (pas un secret sensible — adresse d'alerte) | Changer l'adresse si besoin | Alerte de la sonde ledger reçue |

## Cas particuliers

- **Fuite suspectée** : tourner IMMÉDIATEMENT le secret concerné (étapes 1-5
  compressées), puis auditer `AdminAuditLog`/logs serveur sur la période.
- **`NEXTAUTH_SECRET` et `DATABASE_URL` ne se tournent jamais le même jour**
  (les deux cassent la session/l'app : diagnostic impossible si les deux bougent).
- **Après CHAQUE rotation** : `curl -s .../version.json` pour confirmer que le
  build qui tourne est bien celui attendu (élimine « mauvais build » comme
  variable pendant le diagnostic).
