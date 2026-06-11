#!/usr/bin/env node
// One-shot LEDGER backfill (rail A3). Reads ALL succeeded PaymentIntents from
// Stripe (TEST mode) and inserts the missing LedgerEntry lines so the golden
// equation also covers the history of our tests. IDEMPOTENT: the unique
// [sourceEventId, type] constraint (sourceEventId = the PI id, same key the
// webhook uses) makes re-runs and webhook overlaps no-ops (P2002 → skip).
//
// RUN IN THE APP CONTEXT (stripe + @prisma/client must be resolvable):
//   cd ~/app.grubano.com
//   source ~/nodevenv/app.grubano.com/24/bin/activate
//   export DATABASE_URL="<DATABASE_URL staging>"
//   export STRIPE_SECRET_KEY="<sk_test_...>"
//   node scripts/backfill-ledger.js
// (Locally: env vars are read from the shell; .env.local is NOT auto-loaded.)

const Stripe = require('stripe')
const { PrismaClient, Prisma } = require('@prisma/client')

const key = process.env.STRIPE_SECRET_KEY
if (!key) { console.error('STRIPE_SECRET_KEY manquant'); process.exit(1) }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL manquant'); process.exit(1) }

const stripe = new Stripe(key)
const prisma = new PrismaClient()

async function main() {
  let scanned = 0, inserted = 0, duplicates = 0, skipped = 0, errors = 0

  // Auto-paginated walk over every PI (test volumes are small).
  for await (const pi of stripe.paymentIntents.list({ limit: 100 })) {
    if (pi.status !== 'succeeded') continue
    scanned++

    const restaurantId = pi.metadata && pi.metadata.restaurantId
    if (!restaurantId) {
      console.warn(`SKIP ${pi.id} — pas de metadata.restaurantId (PI hors périmètre Grubano ?)`)
      skipped++
      continue
    }

    const type  = pi.metadata.ticketId ? 'payment' : 'deposit_capture'
    const gross = pi.amount_received != null ? pi.amount_received : (pi.amount || 0)
    const fee   = pi.application_fee_amount || 0
    const dest  = pi.transfer_data && pi.transfer_data.destination
      ? (typeof pi.transfer_data.destination === 'string' ? pi.transfer_data.destination : pi.transfer_data.destination.id)
      : null

    // Real Stripe fee + charge/transfer ids (best-effort).
    let chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : null
    let stripeFee = null
    let transferId = null
    try {
      const full = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge.balance_transaction'] })
      const charge = full.latest_charge && typeof full.latest_charge === 'object' ? full.latest_charge : null
      if (charge) {
        chargeId = charge.id
        const bt = charge.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
        stripeFee = bt ? bt.fee : null
        transferId = typeof charge.transfer === 'string' ? charge.transfer : (charge.transfer ? charge.transfer.id : null)
      }
    } catch (e) {
      console.warn(`facts indisponibles pour ${pi.id}: ${e.message}`)
    }

    try {
      await prisma.ledgerEntry.create({
        data: {
          type,
          restaurantId,
          ticketId:              pi.metadata.ticketId || null,
          reservationId:         pi.metadata.reservationId || null,
          stripePaymentIntentId: pi.id,
          stripeChargeId:        chargeId,
          stripeTransferId:      transferId,
          grossAmount:           gross,
          applicationFeeAmount:  fee,
          stripeFeeAmount:       stripeFee,
          netToRestaurant:       gross - fee,
          routed:                !!dest,
          destinationAccountId:  dest,
          currency:              pi.currency || 'eur',
          sourceEventId:         pi.id,            // same deterministic key as the webhook
          createdAt:             new Date(pi.created * 1000), // the PI's real date
        },
      })
      inserted++
      console.log(`+ ${type} ${pi.id} gross=${gross}c fee=${fee}c net=${gross - fee}c routed=${!!dest}`)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        duplicates++ // already recorded (webhook or previous run) — idempotent
      } else {
        errors++
        console.error(`ERREUR ${pi.id}: ${e.message}`)
      }
    }
  }

  console.log('────────────────────────────────────────')
  console.log(`PI succeeded scannés : ${scanned}`)
  console.log(`Lignes insérées      : ${inserted}`)
  console.log(`Déjà présentes (skip): ${duplicates}`)
  console.log(`Hors périmètre (skip): ${skipped}`)
  console.log(`Erreurs              : ${errors}`)
  process.exit(errors > 0 ? 1 : 0)
}

main().finally(() => prisma.$disconnect())
