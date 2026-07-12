// scripts/geocode-restaurants.js
// One-time backfill: geocode all Restaurant rows that have no coords.
//
// Usage (locally OR on the o2switch server):
//   node scripts/geocode-restaurants.js                  → only rows with NULL lat
//   node scripts/geocode-restaurants.js --force          → re-geocode everyone
//   node scripts/geocode-restaurants.js --dry-run        → log only, no writes
//
// The script loads .env.local automatically so a plain `node` invocation
// works in cPanel Terminal too. Uses the BAN (api-adresse.data.gouv.fr) —
// free, no key, ~50 req/s. We pace at 250 ms to stay polite.

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Load DATABASE_URL from .env.local if not already set ───────────────────
if (!process.env.DATABASE_URL) {
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.+)$/)
      if (m) {
        process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '')
        break
      }
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('[geocode] DATABASE_URL not set (checked env + .env.local).')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE   = process.argv.includes('--force')

// ── BAN call (inline so the script has zero TS dependency) ─────────────────
async function geocode(address, city) {
  const q = [address, city].filter(Boolean).join(' ').trim()
  if (!q) return null
  const url = 'https://api-adresse.data.gouv.fr/search/?q=' +
              encodeURIComponent(q) + '&limit=1'
  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 6_000)
    const res     = await fetch(url, {
      signal:  ctrl.signal,
      headers: { 'User-Agent': 'grubano-geocoder/1.0' },
    }).finally(() => clearTimeout(timeout))
    if (!res.ok) return null
    const json   = await res.json().catch(() => null)
    const coords = json && json.features && json.features[0]
                   && json.features[0].geometry
                   && json.features[0].geometry.coordinates
    if (!Array.isArray(coords) || coords.length !== 2) return null
    const [lng, lat] = coords
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    if (!Number.isFinite(lat) || !Number.isFinite(lng))    return null
    return { lat, lng }
  } catch (err) {
    return null
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms))

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const where = FORCE ? {} : { OR: [{ lat: null }, { lng: null }] }
  const restaurants = await prisma.restaurant.findMany({
    where,
    select: { id: true, name: true, address: true, city: true, lat: true, lng: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\n  Geocoding ${restaurants.length} restaurant(s)` +
              (FORCE ? ' (--force)' : ' (NULL coords only)') +
              (DRY_RUN ? ' [DRY RUN]' : '') + '\n')

  let hits = 0, misses = 0

  for (const r of restaurants) {
    const tag = `[${r.id}] ${r.name} — ${r.address}, ${r.city}`
    const coords = await geocode(r.address, r.city)
    if (!coords) {
      misses++
      console.log(`  ✗ ${tag}  (no match)`)
    } else {
      hits++
      console.log(`  ✓ ${tag}  → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`)
      if (!DRY_RUN) {
        await prisma.restaurant.update({
          where: { id: r.id },
          data:  { lat: coords.lat, lng: coords.lng },
        })
      }
    }
    await wait(250)
  }

  console.log(`\n  Done. ${hits} hit, ${misses} miss${DRY_RUN ? ' (no writes)' : ''}.\n`)
}

main()
  .catch(err => { console.error('[geocode]', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
