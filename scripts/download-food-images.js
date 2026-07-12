#!/usr/bin/env node
/**
 * Download food photos from the Unsplash CDN into public/images/food/...
 *
 * Run: node scripts/download-food-images.js [--force]
 *
 * Reads the curated catalog from lib/food-images.ts (re-export wrapped via
 * a CJS-friendly inline mirror so this script has zero TS/build dependencies).
 *
 * Idempotent: existing files are skipped unless --force is passed.
 */

const fs   = require('node:fs')
const path = require('node:path')
const https= require('node:https')

// ── Inline mirror of the catalog (keep in sync with lib/food-images.ts) ──
const FOOD = {
  pizza: [
    ['1565299624946-b28f40a0ae38','margherita'],['1574071318508-1cdbab80d002','basil'],
    ['1604382354936-07c5d9983bd3','pepperoni'],['1593560708920-61dd98c46a4e','slice'],
    ['1513104890138-7c749659a591','table'],['1571997478779-2adcbbe9ab2f','fresh'],
    ['1590947132387-155cc02f3212','artisan'],['1542528180-a1208c5169a5','meat'],
    ['1555072956-7758afb20e8f','slice-up'],['1571066811602-716837d681de','dough'],
  ],
  burgers: [
    ['1568901346375-23c9450c58cd','classic'],['1571091718767-18b5b1457add','fries'],
    ['1572802419224-296b0aeee0d9','cheese'],['1550317138-10000687a72b','gourmet'],
    ['1586816001966-79b736744398','double'],['1561758033-d89a9ad46330','chicken'],
    ['1607013251379-e6eecfffe234','closeup'],['1626700051175-6818013e1d4f','smash'],
    ['1597600159211-d6c104f408d1','bacon'],['1551782450-a2132b4ba21d','street'],
  ],
  asian: [
    ['1617196034796-73dfa7b1fd56','ramen'],['1569718212165-3a8278d5f624','sushi'],
    ['1579871494447-9811cf80d66c','pho'],['1607301405390-d831c242f59b','rolls'],
    ['1546069901-ba9599a7e63c','poke'],['1535007813616-79dc02ba4021','dumplings'],
    ['1626804475297-41608ea09aeb','pad-thai'],['1611143669185-af224c5e3252','banh-mi'],
    ['1559314809-0d155014e29e','ramen-bowl'],['1579952363873-27f3bade9f55','sushi-plate'],
  ],
  healthy: [
    ['1512621776951-a57141f2eefd','salad'],['1490645935967-10de6ba17061','acai'],
    ['1505253758473-96b7015fcd40','grain'],['1559054663-e8d23213f55c','smoothie'],
    ['1574484284002-952d92456975','quinoa'],['1540420773420-3366772f4999','medi'],
    ['1607532941433-304659e8198a','poke-veg'],['1623428187969-5da2dcea5ebf','vegan'],
    ['1518779578993-ec3579fee39f','plate'],['1546069901-ba9599a7e63c','fresh-bowl'],
  ],
  desserts: [
    ['1565958011703-44f9829ba187','chocolate'],['1551024506-0bccd828d307','croissant'],
    ['1488477181946-6428a0291777','cheesecake'],['1563729784474-d77dbb933a9e','tiramisu'],
    ['1551404973-761c83cd8339','eclair'],['1571115177098-24ec42ed204d','macaron'],
    ['1606313564200-e75d5e30476c','cookies'],['1535920527002-b35e96722eb9','donut'],
    ['1581798459219-318e76aecc7b','cupcake'],['1567620905732-2d1ec7ab7445','tart'],
  ],
  wraps: [
    ['1564671165093-20688ff1fffa','wrap'],['1565299585323-38d6b0865b47','wrap-veg'],
    ['1606755962773-d324e0a13086','sandwich'],['1554433607-66b5efe9d304','panini'],
    ['1601312378427-822b2b41da35','taco'],['1599974579688-8dbdd335c77f','burrito'],
    ['1521305916504-4a1121188589','club'],['1626700051175-6818013e1d4f','street-wrap'],
    ['1568901346375-23c9450c58cd','roll'],['1565299624946-b28f40a0ae38','pita'],
  ],
  pasta: [
    ['1551183053-bf91a1d81141','spaghetti'],['1608897013039-887f21d8c804','carbonara'],
    ['1473093295043-cdd812d0e601','penne'],['1556761175-5973dc0f32e7','pasta-dish'],
    ['1621996346565-e3dbc646d9a9','lasagna'],['1612874742237-6526221588e3','ravioli'],
    ['1611270629569-8b357cb88da9','gnocchi'],['1551892374-ecf8754cf8b0','linguine'],
    ['1563379091339-03b21ab4a4f8','creamy'],['1525755662778-989d0524087e','plate'],
  ],
  drinks: [
    ['1544145945-f90425340c7e','coffee'],['1497515114629-f71d768fd07c','cocktail'],
    ['1437418747212-8d9709afab22','lemonade'],['1622597467836-f3285f2131b8','smoothie'],
    ['1556679343-c7306c1976bc','juice'],
  ],
}

const COVERS = [
  ['1517248135467-4c7edcad34c4','bistro'],['1414235077428-338989a2e8c0','terrace'],
  ['1555396273-367ea4eb4db5','kitchen'],['1552566626-52f8b828add9','cafe'],
  ['1559339352-11d035aa65de','pizzeria'],['1466978913421-dad2ebd01d17','dining'],
  ['1559925393-8be0ec4767c8','street'],['1528605248644-14dd04022da1','sushi-bar'],
  ['1546069901-ba9599a7e63c','bowls'],['1592861956120-e524fc739696','modern'],
]

const ROOT = path.resolve(__dirname, '..')
const FORCE = process.argv.includes('--force')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const req = https.get(url, { timeout: 20000 }, (res) => {
      // Follow Unsplash CDN redirects.
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        return download(res.headers.location, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`HTTP ${res.statusCode} ${url}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(undefined)))
    })
    req.on('error', (err) => { try { fs.unlinkSync(dest) } catch {} ; reject(err) })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
  })
}

async function run() {
  let total = 0
  let downloaded = 0
  let skipped = 0
  let failed = 0
  const failures = []

  // ── Food categories ──
  for (const [cat, list] of Object.entries(FOOD)) {
    const dir = path.join(ROOT, 'public', 'images', 'food', cat)
    ensureDir(dir)
    for (const [id, slug] of list) {
      total++
      const dest = path.join(dir, `${slug}.jpg`)
      if (fs.existsSync(dest) && !FORCE) { skipped++; continue }
      const url = `https://images.unsplash.com/photo-${id}?w=800&h=600&fit=crop&q=80&auto=format`
      try {
        await download(url, dest)
        downloaded++
        process.stdout.write(`  ✓ ${cat}/${slug}.jpg\n`)
      } catch (err) {
        failed++
        failures.push(`${cat}/${slug}: ${err.message}`)
        process.stdout.write(`  ✗ ${cat}/${slug}.jpg — ${err.message}\n`)
      }
    }
  }

  // ── Restaurant covers ──
  const coverDir = path.join(ROOT, 'public', 'images', 'restaurants')
  ensureDir(coverDir)
  for (const [id, slug] of COVERS) {
    total++
    const dest = path.join(coverDir, `${slug}.jpg`)
    if (fs.existsSync(dest) && !FORCE) { skipped++; continue }
    const url = `https://images.unsplash.com/photo-${id}?w=1200&h=720&fit=crop&q=80&auto=format`
    try {
      await download(url, dest)
      downloaded++
      process.stdout.write(`  ✓ covers/${slug}.jpg\n`)
    } catch (err) {
      failed++
      failures.push(`covers/${slug}: ${err.message}`)
      process.stdout.write(`  ✗ covers/${slug}.jpg — ${err.message}\n`)
    }
  }

  console.log(`\nDone. ${downloaded} downloaded, ${skipped} skipped, ${failed} failed (of ${total}).`)
  if (failures.length) {
    console.log('Failures:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(failures.length === total ? 1 : 0)
  }
}

run().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
