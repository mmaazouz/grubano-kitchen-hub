// scripts/backfill-brand-restaurant.js
// ─────────────────────────────────────────────────────────────────────────────
// OPTION B — MIGRATION STEP 2 : backfill Brand.restaurantId.
//
// Fills the NEW link added in step 1 (commit 133f4a7): every Brand whose
// restaurantId IS NULL is attached to the Restaurant (establishment) of its
// operator. Today an operator has at most one Restaurant (Restaurant.operatorId
// is still @unique), so the mapping is unambiguous: brand.restaurantId = the id
// of restaurant.findFirst({ where: { operatorId: brand.operatorId } }).
//
// This is DATA ONLY:
//   • No schema change, no route, no component, no application read is modified.
//   • Nothing in the app reads restaurantId yet (that switch is step 3 / commit 3),
//     so the runtime behaviour is UNCHANGED whether or not this runs.
//
// Safety design (mirrors scripts/seed-demo-data.js):
//   1. Loads DATABASE_URL from .env.local if not already in the environment.
//   2. Prints the *masked* target DB (host + db name, password hidden) up front
//      so you can eyeball that it is STAGING before anything happens.
//   3. DRY-RUN BY DEFAULT: a bare run only PRINTS the before/after picture and
//      the exact rows it WOULD change. It performs NO write.
//      To actually write, re-run with the confirmation guard:
//          BACKFILL_CONFIRM=yes node scripts/backfill-brand-restaurant.js
//   4. IDEMPOTENT: only touches rows where restaurantId IS NULL. Re-running after
//      a successful apply updates 0 rows.
//   5. NON-DESTRUCTIVE: it only fills NULLs. Orphan brands (operator has no
//      Restaurant) are LEFT NULL and logged with their operatorId — no fake
//      restaurant is ever invented.
//   6. REVERSIBLE: a trivial inverse exists. Run with --revert (also gated by
//      BACKFILL_CONFIRM=yes) to set every Brand.restaurantId back to NULL.
//
// Usage (cPanel Terminal on STAGING, from the app root):
//   ./node_modules/.bin/prisma generate                 # ensure pinned 5.22.0 client
//   node scripts/backfill-brand-restaurant.js           # 1) preview (no writes)
//   BACKFILL_CONFIRM=yes node scripts/backfill-brand-restaurant.js   # 2) apply
//
//   ⚠️  Run the preview FIRST and confirm the numbers look right.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

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
  console.error('[backfill-brand-restaurant] DATABASE_URL not set (checked env + .env.local). Aborting.')
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
console.log('  GRUBANO — BACKFILL Brand.restaurantId  (Option B step 2)')
console.log('============================================================')
console.log(`  Target database : ${maskedTarget(process.env.DATABASE_URL)}`)
console.log(`  Mode            : ${REVERT ? 'REVERT (set restaurantId -> NULL)' : 'BACKFILL (NULL -> operator restaurant)'}`)
console.log(`  Write           : ${CONFIRM ? 'YES (BACKFILL_CONFIRM=yes)' : 'NO — dry-run preview only'}`)
console.log('  ⚠️  Make ABSOLUTELY sure the target above is your STAGING DB.')
console.log('============================================================')

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function summary() {
  const total       = await prisma.brand.count()
  const filled      = await prisma.brand.count({ where: { NOT: { restaurantId: null } } })
  const nullCount   = await prisma.brand.count({ where: { restaurantId: null } })
  return { total, filled, nullCount }
}

async function runBackfill() {
  // BEFORE picture
  const before = await summary()
  console.log('\n── BEFORE ─────────────────────────────────────────────────')
  console.log(`  Brand total                      : ${before.total}`)
  console.log(`  Brand with restaurantId set      : ${before.filled}`)
  console.log(`  Brand with restaurantId NULL     : ${before.nullCount}`)

  // Resolve each NULL brand to its operator's restaurant (findFirst — works while
  // Restaurant.operatorId is still @unique, and stays correct at <=1 resto).
  const nullBrands = await prisma.brand.findMany({
    where: { restaurantId: null },
    select: { id: true, name: true, operatorId: true },
  })

  const toUpdate = []     // { brandId, restaurantId }
  const orphans  = []     // { brandId, name, operatorId }  (operator has no restaurant)

  for (const b of nullBrands) {
    const resto = await prisma.restaurant.findFirst({
      where: { operatorId: b.operatorId },
      select: { id: true },
    })
    if (resto) toUpdate.push({ brandId: b.id, restaurantId: resto.id, name: b.name })
    else       orphans.push({ brandId: b.id, name: b.name, operatorId: b.operatorId })
  }

  console.log('\n── PLAN ───────────────────────────────────────────────────')
  console.log(`  Brand resolvable (will be filled): ${toUpdate.length}`)
  console.log(`  Brand orphan (no resto -> NULL)  : ${orphans.length}`)
  if (orphans.length) {
    console.log('  Orphan operatorIds (left NULL, no fake resto invented):')
    const byOperator = [...new Set(orphans.map(o => o.operatorId))]
    for (const opId of byOperator) {
      const names = orphans.filter(o => o.operatorId === opId).map(o => o.name)
      console.log(`    - operator ${opId} : ${names.length} brand(s) [${names.join(', ')}]`)
    }
  }

  if (!CONFIRM) {
    console.log('\n[dry-run] No write performed. Re-run with BACKFILL_CONFIRM=yes to apply.')
    return
  }

  // APPLY — only NULL rows are touched (idempotent). Non-destructive: fills NULLs.
  let written = 0
  for (const u of toUpdate) {
    await prisma.brand.update({
      where: { id: u.brandId },
      data:  { restaurantId: u.restaurantId },
    })
    written++
  }

  const after = await summary()
  console.log('\n── AFTER ──────────────────────────────────────────────────')
  console.log(`  Rows written this run            : ${written}`)
  console.log(`  Brand with restaurantId set      : ${after.filled}`)
  console.log(`  Brand with restaurantId NULL     : ${after.nullCount}  (orphans, expected)`)
  console.log('\n[done] Backfill complete. Idempotent — re-running updates 0 rows.')
}

async function runRevert() {
  const before = await summary()
  console.log('\n── BEFORE (revert) ────────────────────────────────────────')
  console.log(`  Brand with restaurantId set      : ${before.filled}  (will be reset to NULL)`)

  if (!CONFIRM) {
    console.log('\n[dry-run] No write performed. Re-run with BACKFILL_CONFIRM=yes to apply the revert.')
    return
  }

  const res = await prisma.brand.updateMany({
    where: { NOT: { restaurantId: null } },
    data:  { restaurantId: null },
  })
  const after = await summary()
  console.log('\n── AFTER (revert) ─────────────────────────────────────────')
  console.log(`  Rows reset to NULL               : ${res.count}`)
  console.log(`  Brand with restaurantId set      : ${after.filled}`)
  console.log('\n[done] Revert complete.')
}

;(async () => {
  try {
    if (REVERT) await runRevert()
    else        await runBackfill()
  } catch (err) {
    console.error('\n[backfill-brand-restaurant] FAILED:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
})()
