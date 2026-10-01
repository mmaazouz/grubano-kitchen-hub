// scripts/backfill-table-restaurant.js
// ─────────────────────────────────────────────────────────────────────────────
// CHANTIER 2 — MIGRATION STEP 2 : backfill RestaurantTable.restaurantId AND
// Reservation.restaurantId.
//
// Fills the NEW links added in step 1 (commit ba61c1e): every RestaurantTable and
// every Reservation whose restaurantId IS NULL is attached to the MAIN
// establishment — "Resto Test" (id demo-resto-test-profile, operator
// resto@grubano.com). Today the only establishment that has a real dining room is
// Resto Test, so all pre-existing (un-scoped, global) tables/reservations belong
// to it. Dark kitchens have no tables at all → nothing to backfill for them.
//
// This is DATA ONLY:
//   • No schema change, no route, no component is modified here.
//   • The scoped reads/writes land in step 3 (commit 3). Until that ships nothing
//     reads restaurantId, so the runtime behaviour is UNCHANGED whether or not
//     this runs.
//
// Safety design (mirrors scripts/backfill-brand-restaurant.js):
//   1. Loads DATABASE_URL from .env.local if not already in the environment.
//   2. Prints the *masked* target DB (host + db name, password hidden) up front.
//   3. DRY-RUN BY DEFAULT: a bare run only PRINTS the before/after picture. It
//      performs NO write. To actually write:
//          BACKFILL_CONFIRM=yes node scripts/backfill-table-restaurant.js
//   4. VERIFIES the target restaurant exists FIRST — never sets a dangling FK.
//   5. IDEMPOTENT: only touches rows where restaurantId IS NULL (updateMany).
//      Re-running after a successful apply updates 0 rows.
//   6. NON-DESTRUCTIVE: only fills NULLs.
//   7. REVERSIBLE: run with --revert (also gated by BACKFILL_CONFIRM=yes) to set
//      every RestaurantTable/Reservation.restaurantId back to NULL.
//
// Usage (cPanel Terminal on STAGING, from the app root):
//   ./node_modules/.bin/prisma generate                  # ensure pinned 5.22.0 client
//   node scripts/backfill-table-restaurant.js            # 1) preview (no writes)
//   BACKFILL_CONFIRM=yes node scripts/backfill-table-restaurant.js   # 2) apply
//
//   ⚠️  Run the preview FIRST and confirm the numbers look right.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

// Target establishment — the main one with a real dining room.
const TARGET_RESTAURANT_ID = 'demo-resto-test-profile'

// ── 1. Load DATABASE_URL (+ any other vars) from .env.local if not in env ──────
{
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('[backfill-table-restaurant] DATABASE_URL not set (checked env + .env.local). Aborting.')
  process.exit(1)
}

// ── 2. Print the masked target DB so the operator can verify it's staging ──────
function maskedTarget(url) {
  try {
    const u = new URL(url)
    const cred = u.username ? `${u.username}:***@` : ''
    return `${u.protocol}//${cred}${u.host}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL — masked for safety)'
  }
}

const REVERT  = process.argv.includes('--revert')
const CONFIRM = process.env.BACKFILL_CONFIRM === 'yes'

console.log('============================================================')
console.log('  GRUBANO — BACKFILL RestaurantTable/Reservation.restaurantId')
console.log('  (Chantier 2 step 2)')
console.log('============================================================')
console.log(`  Target database   : ${maskedTarget(process.env.DATABASE_URL)}`)
console.log(`  Target restaurant : ${TARGET_RESTAURANT_ID} (Resto Test)`)
console.log(`  Mode              : ${REVERT ? 'REVERT (set restaurantId -> NULL)' : 'BACKFILL (NULL -> Resto Test)'}`)
console.log(`  Write             : ${CONFIRM ? 'YES (BACKFILL_CONFIRM=yes)' : 'NO — dry-run preview only'}`)
console.log('  ⚠️  Make ABSOLUTELY sure the target above is your STAGING DB.')
console.log('============================================================')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function summary() {
  const tablesTotal = await prisma.restaurantTable.count()
  const tablesNull  = await prisma.restaurantTable.count({ where: { restaurantId: null } })
  const resaTotal   = await prisma.reservation.count()
  const resaNull    = await prisma.reservation.count({ where: { restaurantId: null } })
  return { tablesTotal, tablesNull, resaTotal, resaNull }
}

async function runBackfill() {
  // Verify the target establishment exists — never set a dangling FK.
  const target = await prisma.restaurant.findUnique({
    where:  { id: TARGET_RESTAURANT_ID },
    select: { id: true, name: true, operatorId: true },
  })
  if (!target) {
    console.error(`\n[abort] Target restaurant ${TARGET_RESTAURANT_ID} not found. No write performed.`)
    process.exitCode = 1
    return
  }
  console.log(`\n  Target resolved   : ${target.name} (operator ${target.operatorId})`)

  const before = await summary()
  console.log('\n── BEFORE ─────────────────────────────────────────────────')
  console.log(`  RestaurantTable total            : ${before.tablesTotal}`)
  console.log(`  RestaurantTable restaurantId NULL: ${before.tablesNull}  (will be filled)`)
  console.log(`  Reservation total                : ${before.resaTotal}`)
  console.log(`  Reservation restaurantId NULL    : ${before.resaNull}  (will be filled)`)

  if (!CONFIRM) {
    console.log('\n[dry-run] No write performed. Re-run with BACKFILL_CONFIRM=yes to apply.')
    return
  }

  // APPLY — only NULL rows are touched (idempotent, non-destructive).
  const tRes = await prisma.restaurantTable.updateMany({
    where: { restaurantId: null },
    data:  { restaurantId: TARGET_RESTAURANT_ID },
  })
  const rRes = await prisma.reservation.updateMany({
    where: { restaurantId: null },
    data:  { restaurantId: TARGET_RESTAURANT_ID },
  })

  const after = await summary()
  console.log('\n── AFTER ──────────────────────────────────────────────────')
  console.log(`  RestaurantTable rows written     : ${tRes.count}`)
  console.log(`  Reservation rows written         : ${rRes.count}`)
  console.log(`  RestaurantTable restaurantId NULL: ${after.tablesNull}  (expected 0)`)
  console.log(`  Reservation restaurantId NULL    : ${after.resaNull}  (expected 0)`)
  console.log('\n[done] Backfill complete. Idempotent — re-running updates 0 rows.')
}

async function runRevert() {
  const before = await summary()
  console.log('\n── BEFORE (revert) ────────────────────────────────────────')
  console.log(`  RestaurantTable restaurantId set : ${before.tablesTotal - before.tablesNull}  (reset to NULL)`)
  console.log(`  Reservation restaurantId set     : ${before.resaTotal - before.resaNull}  (reset to NULL)`)

  if (!CONFIRM) {
    console.log('\n[dry-run] No write performed. Re-run with BACKFILL_CONFIRM=yes to apply the revert.')
    return
  }

  const tRes = await prisma.restaurantTable.updateMany({
    where: { NOT: { restaurantId: null } },
    data:  { restaurantId: null },
  })
  const rRes = await prisma.reservation.updateMany({
    where: { NOT: { restaurantId: null } },
    data:  { restaurantId: null },
  })
  console.log('\n── AFTER (revert) ─────────────────────────────────────────')
  console.log(`  RestaurantTable rows reset to NULL: ${tRes.count}`)
  console.log(`  Reservation rows reset to NULL    : ${rRes.count}`)
  console.log('\n[done] Revert complete.')
}

;(async () => {
  try {
    if (REVERT) await runRevert()
    else        await runBackfill()
  } catch (err) {
    console.error('\n[backfill-table-restaurant] FAILED:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
})()
