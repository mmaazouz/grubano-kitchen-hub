// tests/support/pay-race-child.ts — ONE contender of the D′ L5 database rehearsal (spec v2 S-08 / S-09).
//
// This file is the body of a SEPARATE OPERATING-SYSTEM PROCESS. The rehearsal bundles it with esbuild (our own
// modules inlined, node_modules left external), then spawns two of them against one disposable MariaDB. Two
// processes, two Prisma clients, two connections: nothing is shared but the database, which is the only thing
// the invariant is about.
//
// WHAT IS REAL HERE, and what is not:
//   REAL — lib/claims: triggerClaimRefund with its whole T1 pre-image, its attempt CAS, its safety rules and its
//          T4 writes; withdrawClaimApproval with its transaction. The race is run against the product code, not
//          against a re-implementation of it, which is the only way a rehearsal can prove anything.
//   FAKE — Stripe (a fixed succeeded payment, no network) and the refund ENGINE, which here only does what the
//          engine does to OUR database: it inserts the refund row carrying the claim's identity and answers ok.
//          No money exists in this rehearsal, by construction: there is no Stripe key and no Stripe call.
//   FAKE — the admin alert sender, so a rehearsal never e-mails anyone.
//
// The `rail_broken` mode is a SYNTHETIC BROKEN IMPLEMENTATION — read-then-write instead of the product's
// compare-and-swap. It exists so the harness can prove it would NOTICE a broken rail; it is never the product.
import { writeFileSync } from 'node:fs'

interface Args { mode: string; url: string; claim: string; at: number; out: string }

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 ? argv[i + 1] : ''
  }
  return { mode: get('mode'), url: get('url'), claim: get('claim'), at: Number(get('at')), out: get('out') }
}

const args = parseArgs(process.argv.slice(2))
// The client of lib/prisma is built from DATABASE_URL at first import, so it is set before anything is imported.
process.env.DATABASE_URL = args.url
process.env.ADMIN_AUDIT_ENABLED = 'true'

async function main(): Promise<void> {
  const { prisma } = await import('@/lib/prisma')
  const claims = await import('@/lib/claims')

  // The barrier: both processes spin until the same absolute instant, so neither starts measurably first.
  while (Date.now() < args.at) { /* spin */ }

  let outcome: unknown
  let threw: string | null = null
  try {
    if (args.mode === 'rail') {
      outcome = await claims.triggerClaimRefund(args.claim)
    } else if (args.mode === 'withdraw') {
      outcome = await claims.withdrawClaimApproval({
        claimId: args.claim,
        adminId: 'rehearsal-admin',
        adminEmail: 'rehearsal@grubano.test',
        reason: 'répétition base de données : retrait concurrent du rail',
        confirm: 'RETIRER',
      })
    } else if (args.mode === 'rail_broken') {
      outcome = await brokenRail(prisma, args.claim)
    } else {
      throw new Error(`unknown mode ${args.mode}`)
    }
  } catch (e) {
    threw = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }

  // The engine calls are counted in the SHARED log the stub appends to (RACE_ENGINE_LOG), across both
  // processes — not here, where each process could only ever see its own.
  writeFileSync(args.out, JSON.stringify({ mode: args.mode, pid: process.pid, outcome, threw }), 'utf8')
  await prisma.$disconnect()
}

/**
 * THE SYNTHETIC BROKEN RAIL — the negative control. It does what a rail WITHOUT a compare-and-swap would do:
 * read the claim, notice it looks payable, then write by primary key. Two of these on one claim both believe
 * they won, and both call the engine — which is exactly what the rehearsal must be able to detect.
 */
async function brokenRail(prisma: typeof import('@/lib/prisma').prisma, claimId: string): Promise<unknown> {
  const before = await prisma.claim.findUnique({
    where:  { id: claimId },
    select: { id: true, orderId: true, status: true, refundAttempted: true, refundId: true, refundError: true, approvedAmountCents: true },
  })
  if (!before || before.status !== 'approved' || before.refundAttempted || before.refundId || before.refundError) {
    return { state: 'already_handled' }
  }
  // The window a compare-and-swap closes and a read-then-write leaves open. Both contenders hold here
  // until the SAME absolute instant, so both are guaranteed to have read before either writes: a
  // negative control that only sometimes reproduces the defect is not a control.
  const writeAt = args.at + 1500
  while (Date.now() < writeAt) { /* spin */ }
  await prisma.claim.update({ where: { id: claimId }, data: { status: 'refunding', refundAttempted: true } })
  const engine = await import('@/lib/refund')
  const result = await engine.executeRefund({ orderId: before.orderId, amountCents: before.approvedAmountCents ?? 0, reason: `claim:${claimId}` })
  return { state: 'broken_attempt', engineOk: result.ok }
}

void main().then(
  () => process.exit(0),
  (e) => {
    try { writeFileSync(args.out, JSON.stringify({ mode: args.mode, fatal: String(e) }), 'utf8') } catch { /* the rehearsal reads the absence */ }
    process.exit(1)
  },
)
