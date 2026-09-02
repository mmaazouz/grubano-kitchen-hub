-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 — LOYALTY ↔ REFUND RECONCILIATION — reviewable migration artifact.
--
-- WHY a hand-written SQL file (not `prisma db push`): the repo has NO
-- prisma/migrations, and its deploy scripts run `db push --accept-data-loss`,
-- which the Phase 1 founder brief FORBIDS. `db push` also demands
-- --accept-data-loss for ANY unique-index addition (it cannot statically prove
-- the absence of duplicates). This file is the auditable alternative: four
-- STRICTLY ADDITIVE statements, none destructive, none lossy, no dedup.
--
-- WHY it is safe on a POPULATED table (proven in the local disposable rehearsal
-- on a copy seeded WITH duplicate (orderId,type) rows):
--   • the three ADD COLUMN are additive (nullable / DEFAULT) — no row rewritten;
--   • the UNIQUE INDEX is on (sourceEventId, type) where sourceEventId is a NEW,
--     all-NULL column. MySQL/InnoDB treats NULL as distinct in a UNIQUE index
--     (many NULLs allowed), so the index applies to a table full of legacy rows
--     WITHOUT any deduplication and WITHOUT touching (orderId,type) duplicates.
--     If — contrary to expectation — a real non-NULL duplicate existed, step 4
--     would FAIL LOUDLY (error 1062), never silently drop data.
--
-- IDEMPOTENT: guarded so a re-run is a no-op (safe to apply twice).
-- Applies to BOTH LoyaltyTransaction and LoyaltyCustomer. Types mirror Prisma's
-- MySQL mapping (String → varchar(191) utf8mb4_unicode_ci, Int → int).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) LoyaltyTransaction.sourceEventId — the immutable refund source event (re_…).
ALTER TABLE `LoyaltyTransaction`
  ADD COLUMN IF NOT EXISTS `sourceEventId` VARCHAR(191)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- 2) LoyaltyTransaction.actorId — the admin behind an offset_waiver movement.
ALTER TABLE `LoyaltyTransaction`
  ADD COLUMN IF NOT EXISTS `actorId` VARCHAR(191)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

-- 3) LoyaltyCustomer.recoveryOffsetPoints — the D3 internal recovery offset (debt).
ALTER TABLE `LoyaltyCustomer`
  ADD COLUMN IF NOT EXISTS `recoveryOffsetPoints` INT NOT NULL DEFAULT 0;

-- 4) Idempotency: one loyalty effect per (refund source event, type). Multi-NULL
--    safe on the all-NULL legacy rows → no dedup. (No IF NOT EXISTS for indexes in
--    MariaDB 10.x/12.x DDL; the wrapper below makes the whole file re-runnable.)
--    Run this block as-is; on a second run it is a no-op.
SET @idx := (SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'LoyaltyTransaction'
    AND INDEX_NAME = 'LoyaltyTransaction_sourceEventId_type_key');
SET @ddl := IF(@idx = 0,
  'ALTER TABLE `LoyaltyTransaction` ADD UNIQUE INDEX `LoyaltyTransaction_sourceEventId_type_key` (`sourceEventId`, `type`)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── VERIFICATION (read-only; run after applying) ─────────────────────────────
-- Expect: both columns present, the unique index present, legacy row count
-- unchanged, and (orderId,type) duplicates still present (proving no dedup).
--   SHOW COLUMNS FROM `LoyaltyTransaction` LIKE 'sourceEventId';
--   SHOW COLUMNS FROM `LoyaltyCustomer`    LIKE 'recoveryOffsetPoints';
--   SHOW INDEX  FROM `LoyaltyTransaction` WHERE Key_name = 'LoyaltyTransaction_sourceEventId_type_key';
--   SELECT orderId, type, COUNT(*) c FROM `LoyaltyTransaction` GROUP BY orderId, type HAVING c > 1;
