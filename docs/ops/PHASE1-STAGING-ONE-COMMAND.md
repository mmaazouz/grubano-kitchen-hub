# PHASE 1 — staging migration : UNE seule commande

> Remplace la procédure manuelle multi-étapes par un **opérateur unique, fail-closed, idempotent** : `scripts/server/phase1-staging-migrate.js`. Il fait tout (backup vérifié → baseline → migration additive → vérifications) et décide lui-même **PASS / FAIL**. Le fondateur n'interprète **rien**.

## La commande (cPanel Terminal, une seule ligne)

```bash
~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase1-staging-migrate.js
```

*(Si `node` est déjà dans le PATH du terminal, `cd ~/app.grubano.com && node scripts/server/phase1-staging-migrate.js` fonctionne aussi. Une seule commande dans les deux cas.)*

## Ce que la sortie signifie

**Succès :**
```
========================================
GRUBANO PHASE 1 STAGING MIGRATION
RESULT: PASS
BACKUP: VERIFIED (...)
BASELINE: CAPTURED (...)
MIGRATION: APPLIED (...)
POST-MIGRATION INTEGRITY: PASS
SAFE TO CONTINUE MERGE/DEPLOY: YES
========================================
```
→ **Copie-colle ce bloc dans le chat.** Je reprends la main : merge `a1/loyalty-refund`, déploiement, healthcheck au SHA exact, contrôle fidélité post-déploiement.

**Déjà fait (2ᵉ exécution) :** `RESULT: PASS (ALREADY_APPLIED_AND_VERIFIED)` — sûr, rien n'est réappliqué.

**Échec :**
```
RESULT: FAIL
FAILED STEP: [...]
DATABASE CHANGED: NO / PARTIAL / YES
SAFE TO CONTINUE: NO
ACTION: RETURN THIS OUTPUT TO CLAUDE CODE
```
→ **Copie-colle ce bloc dans le chat.** Le script s'est arrêté avant tout dommage (ou l'indique) ; je diagnostique. Ne relance rien.

## Garanties (prouvées en répétition locale sur base jetable)

- **Fail-closed** : s'arrête à la 1ʳᵉ anomalie. Contrôles négatifs validés : base de PROD → refus ; URL prod → refus ; tables fidélité absentes → refus ; dump vide (0 INSERT) → refus ; état schéma partiel → refus (`DATABASE CHANGED: PARTIAL`) ; `mysqldump` cassé → refus **avant** toute modification (`DATABASE CHANGED: NO`).
- **Backup frais** horodaté (`~/grubano-backups/staging-pre-phase1-<ts>.sql.gz`) — le backup du 30/08 n'est **jamais** écrasé (nom unique). Vérifié : taille, marqueur `-- Dump completed`, nombre d'INSERT > 0, intégrité gzip.
- **Purement additif** : `+LoyaltyTransaction.sourceEventId` (NULL), `+actorId` (NULL), `+LoyaltyCustomer.recoveryOffsetPoints` (INT NOT NULL default 0), `+UNIQUE(sourceEventId, type)`. **Aucun** `DROP`, **aucun** `--accept-data-loss`, **aucune** dé-duplication. Les lignes existantes (dont d'éventuels doublons `orderId,type`) survivent — prouvé (l'index unique porte sur la nouvelle colonne all-NULL, InnoDB autorise le multi-NULL).
- **Idempotent** : une 2ᵉ exécution renvoie `ALREADY_APPLIED_AND_VERIFIED`, ne remigre pas.
- **Aucun secret** : lit `DATABASE_URL` du `.env.local` serveur au runtime ; DSN masqué dans toute sortie. Aucun identifiant demandé, aucun committé.
- **Gel remboursement intact** : l'opérateur touche le **schéma**, jamais l'argent. `REFUNDS_ENABLED` reste FALSE, aucun remboursement n'est initié.

## Rollback (si jamais nécessaire)
La migration étant additive, le rollback ne retire que les nouveaux objets (aucune donnée legacy touchée) :
```sql
ALTER TABLE `LoyaltyTransaction` DROP INDEX `LoyaltyTransaction_sourceEventId_type_key`;
ALTER TABLE `LoyaltyTransaction` DROP COLUMN `sourceEventId`, DROP COLUMN `actorId`;
ALTER TABLE `LoyaltyCustomer` DROP COLUMN `recoveryOffsetPoints`;
```
Ou restauration complète depuis le `.sql.gz` frais. La procédure détaillée d'origine (`PHASE1-STAGING-PROCEDURE.md`, branche `a1/loyalty-refund`) reste la référence longue.
