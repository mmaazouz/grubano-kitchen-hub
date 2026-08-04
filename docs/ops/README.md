# docs/ops — Ops as Code (Sprint 0 / S0-4)

Référence opérationnelle du déploiement Grubano (o2switch, Passenger, GitHub
Actions). Écrite pendant le Sprint 0 « Préparation conformité » : **documente,
ne change rien** — aucun cron modifié, aucun secret listé, aucune exécution.

| Document | Contenu |
|---|---|
| [crons.md](crons.md) | Crons existants : scripts versionnés, crontab cPanel de référence, jobs GitHub `cron.yml`, routes cron-appelables sans scheduler |
| [flags.md](flags.md) | Feature flags par environnement : inventaire complet, valeurs par défaut, couplages obligatoires, procédure de bascule |
| [redeploiement.md](redeploiement.md) | Procédures de redéploiement staging/prod/local, post-deploy, vérification du build déployé, rollback |
| [logs.md](logs.md) | Où regarder quand quelque chose casse (CI, Passenger, tables d'audit applicatives) |
| [rotation-secrets.md](rotation-secrets.md) | Plan de rotation des secrets — **procédure documentée uniquement**, aucune valeur, aucune exécution |
| [ci-garde-fous.md](ci-garde-fous.md) | (S0-5) Analyse des garde-fous CI : gates actuels, où brancher `check-flags.mjs`, quels tests bloquent une régression |
| [branch-protection.md](branch-protection.md) | (B6) Procédure pas-à-pas pour rendre le check « CI — tests » obligatoire sur les PR — réglage GitHub à cliquer par Mohammed |
| [code-mort-inventaire.md](code-mort-inventaire.md) | (S0-6/B1) Inventaire du code mort prouvé + journal des suppressions exécutées |
| [sql/p0-02-cash-orders-inventory.sql](sql/p0-02-cash-orders-inventory.sql) | (P0-02, vague 1) Inventaire READ-ONLY des commandes non-carte héritées — 3 SELECT prêts à coller (phpMyAdmin/CLI), à exécuter par Mohammed ; grille de lecture en commentaire |

Conventions :
- ✅ = vérifié dans le repo (fichier:ligne ou workflow cité).
- ⚠️ À CONFIRMER SERVEUR = état côté o2switch non vérifiable depuis ce poste
  (DB/SSH inaccessibles en local) — à valider en cPanel Terminal.
- Les valeurs de secrets ne figurent **jamais** ici (noms seulement).
