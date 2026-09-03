# PHASE 1 — STAGING MIGRATION PROCEDURE (founder-executed)

> The agent cannot reach the o2switch DB and holds **no** credentials (DB password, `INTERNAL_CRON_TOKEN`, Stripe secret). This is the single, exact, copy-paste procedure Mohammed runs in the **cPanel Terminal**. Every command is read-only or strictly additive. **Do not run any refund during the freeze.**
>
> All paths assume staging `~/app.grubano.com`. The migration is the reviewable SQL artifact `prisma/manual-migrations/phase1-loyalty-refund.sql` — **not** `db push --accept-data-loss`.

---

## GATE ORDER (do not reorder)

The agent has already completed steps 1–9 (forensics → contract → implementation → targeted tests → adversarial review → migration artifact → **local disposable rehearsal PASS** → full tests/build). What follows is steps 11–21. **Nothing merges or deploys until the migration is applied on staging.**

---

## A · FRESH BACKUP (step 11–12) — before touching anything

```bash
cd ~/app.grubano.com
source ~/nodevenv/app.grubano.com/24/bin/activate

# 1. Read DB name/user from the app's own env (never printed to screen elsewhere).
DBN=$(node -e "console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))" )
DBU=$(node -e "console.log(new URL(process.env.DATABASE_URL).username)")
DBH=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)")
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=~/backups/grubano-staging-PRE-PHASE1-$STAMP.sql.gz
mkdir -p ~/backups

# 2. Dump (you'll be prompted for the DB password — the agent never sees it).
mysqldump -h "$DBH" -u "$DBU" -p --single-transaction --quick --routines "$DBN" | gzip > "$OUT"

# 3. VERIFY the backup (non-empty + gzip integrity + a content sanity line).
ls -lh "$OUT"                        # expect a non-trivial size (> 100 KB)
gzip -t "$OUT" && echo "gzip integrity: OK"
zcat "$OUT" | grep -c "INSERT INTO \`LoyaltyTransaction\`" # sanity: > 0 loyalty rows
echo "BACKUP: $OUT"
```

**The 30/08 pre-rehearsal backup must remain in place — do NOT overwrite it.** You now have BOTH backups (pre-rehearsal + this pre-migration current one).

---

## B · PRE-MIGRATION BASELINE (step 13) — read-only counts

```bash
node scripts/server/rehearsal-verify.js baseline   # global counts photo
node scripts/server/rehearsal-verify.js order      # the rehearsal customer's exact loyalty state
# Capture, for the record: Orders, LoyaltyTransaction, LoyaltyCustomer counts,
# any pre-existing recoveryOffsetPoints (none expected — new column), Claims (0).
```

Note the numbers (you will compare them after the migration — counts must be **unchanged**, only new columns appear).

---

## C · APPLY THE MIGRATION (step 14) — additive SQL, NO `--accept-data-loss`

```bash
cd ~/app.grubano.com
# The artifact ships with the deploy under prisma/manual-migrations/. Apply it with
# the mysql CLI (it supports the PREPARE guard that makes the file re-runnable):
DBN=$(node -e "console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))")
DBU=$(node -e "console.log(new URL(process.env.DATABASE_URL).username)")
DBH=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)")
mysql -h "$DBH" -u "$DBU" -p "$DBN" < prisma/manual-migrations/phase1-loyalty-refund.sql
```

> If you prefer, `./node_modules/.bin/prisma db push` (flagless) will REFUSE because it wants `--accept-data-loss` for the unique index — that refusal is expected and is exactly why we use the SQL artifact. Do **not** pass the flag.

---

## D · VERIFY MIGRATION INTEGRITY (step 15) — read-only

```bash
mysql -h "$DBH" -u "$DBU" -p "$DBN" -e "
  SHOW COLUMNS FROM LoyaltyTransaction LIKE 'sourceEventId';
  SHOW COLUMNS FROM LoyaltyTransaction LIKE 'actorId';
  SHOW COLUMNS FROM LoyaltyCustomer    LIKE 'recoveryOffsetPoints';
  SHOW INDEX   FROM LoyaltyTransaction WHERE Key_name='LoyaltyTransaction_sourceEventId_type_key';
  SELECT COUNT(*) AS loyalty_rows FROM LoyaltyTransaction;
  SELECT COUNT(*) AS customers FROM LoyaltyCustomer;"
```

Expect: the two columns + `recoveryOffsetPoints` present, the unique index present (`Non_unique = 0`, columns `sourceEventId, type`), and the row counts **identical to the baseline** (additive — nothing lost). Optional final proof of zero drift:

```bash
./node_modules/.bin/prisma db push   # (flagless) → "Your database is now in sync" with NO changes
```

---

## E · THEN (agent-driven, on your go) — steps 16–21

Reply to the agent **“Phase 1 migration applied and verified”** and it will: merge `a1/loyalty-refund` → `develop` (gates re-read, merge-tree clean), deploy staging, prove the exact SHA on `app.grubano.com` + `business.grubano.com`, healthcheck, and run the read-only post-deploy loyalty integrity check. **Only after that** is releasing the refund freeze considered (and Phase 2 begins).

---

## ROLLBACK (only if integrity check D fails)

The change is additive, so rollback is non-destructive to existing data:

```bash
mysql -h "$DBH" -u "$DBU" -p "$DBN" -e "
  ALTER TABLE LoyaltyTransaction DROP INDEX LoyaltyTransaction_sourceEventId_type_key;
  ALTER TABLE LoyaltyTransaction DROP COLUMN sourceEventId;
  ALTER TABLE LoyaltyTransaction DROP COLUMN actorId;
  ALTER TABLE LoyaltyCustomer    DROP COLUMN recoveryOffsetPoints;"
```

This only removes the **new** columns/index (no legacy row is touched). The full restore path remains the fresh backup from step A (`gunzip < <backup>.sql.gz | mysql …`) if ever needed. Because the Phase 1 **code is not deployed** until after the migration (step E), a rollback here leaves staging exactly as it was pre-Phase-1.
