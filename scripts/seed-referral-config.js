// scripts/seed-referral-config.js
// Idempotent seed for the singleton ReferralConfig row.
//
// Usage (local dev OR cPanel Terminal on staging+prod):
//   node scripts/seed-referral-config.js
//
// What it does:
//   - Loads DATABASE_URL from .env.local if not set
//   - Upserts a single ReferralConfig row with id "default" using the values
//     Mohammed approved at programme launch
//   - Safe to re-run any time — existing values are preserved (we only set
//     defaults on create; the update side is a no-op)
//
// To change the live config later, edit the row directly (DB GUI or future
// /dashboard/referral settings page). This script does NOT overwrite an
// existing row's values.

'use strict'

const fs   = require('fs')
const path = require('path')

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
  console.error('[seed-referral-config] DATABASE_URL not set (checked env + .env.local).')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Defaults — kept in sync with the @default() values in prisma/schema.prisma
// so a programme that never updates the row still behaves exactly as designed.
// Brique B (Agent 59): canon = 0.30 (was a stale 0.22 here, diverging from the
// schema @default(0.30)). 30 % of Grubano's REAL fee, on the NET margin, for BOTH the
// creator rail AND the new top-level affiliate (uniform; no live impact — nothing paid).
const DEFAULTS = {
  commissionPctOfGrubanoFee: 0.30,  // 30 % of Grubano's fee (canon), not the basket
  durationDays:              90,
  customerDiscountPct:       0.10,
  customerDiscountCapEur:    5,
  active:                    true,
}

const SINGLETON_ID = 'default'

async function main() {
  const config = await prisma.referralConfig.upsert({
    where:  { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...DEFAULTS },
    update: {}, // never overwrite tuned values
  })

  console.log('[seed-referral-config] ReferralConfig row ready:')
  console.log(`  id:                        ${config.id}`)
  console.log(`  commissionPctOfGrubanoFee: ${config.commissionPctOfGrubanoFee}`)
  console.log(`  durationDays:              ${config.durationDays}`)
  console.log(`  customerDiscountPct:       ${config.customerDiscountPct}`)
  console.log(`  customerDiscountCapEur:    ${config.customerDiscountCapEur}`)
  console.log(`  active:                    ${config.active}`)
}

main()
  .catch(err => { console.error('[seed-referral-config]', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
