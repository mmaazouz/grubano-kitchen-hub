// tests/claims-pay-race.db.test.ts — D′ L5: the financial rail, rehearsed on a REAL database, in TWO PROCESSES.
//
// WHY THIS FILE EXISTS. Two invariants of the rail are about what InnoDB does when two writers meet, and a
// mocked Prisma cannot answer that question at all:
//   S-08  ≤ 1 engine call per pre-image — two rails offered the same claim must not both pay it;
//   S-09  a withdrawal and a payment are mutually exclusive — never both, never neither silently.
// The L4 lot proved both in memory and said so. The founder made the database rehearsal a condition of L5, and
// this is it.
//
// TWO OPERATING-SYSTEM PROCESSES, not two connections in one. Each contender is a separate `node` running a
// bundle of tests/support/pay-race-child.ts (esbuild; our modules inlined, node_modules external), with its own
// Prisma client. Nothing is shared but the disposable MariaDB and one append-only log file. The code under test
// is the product's own lib/claims — triggerClaimRefund with its whole T1/T2/T4, and withdrawClaimApproval with
// its transaction — never a re-implementation.
//
// NOTHING CAN MOVE MONEY HERE. Stripe and the refund engine are replaced at bundle time
// (tests/support/race-stubs/*): there is no Stripe client, no key and no request. The « engine » only inserts
// the refund row the real one would insert, and appends one line to the shared log. « Exactly one engine call »
// is therefore MEASURED across the two processes, not inferred from either.
//
// OPT-IN ONLY, and never against real data. It runs when CLAIMS_RACE_DATABASE_URL names a disposable local
// database, and the shared target guard (tests/support/rehearsal-target) refuses anything else — a remote host,
// the o2switch account prefix (a tunnelled hosted database), a name that is not claims_race…, or any URL or
// database name the application itself reads. CI never sets the variable.
//
//   CLAIMS_RACE_DATABASE_URL=mysql://root@127.0.0.1:3310/claims_race npx vitest run tests/claims-pay-race.db.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { applicationDatabaseUrls, rehearsalTargetRefusal } from './support/rehearsal-target'

const RACE_URL = process.env.CLAIMS_RACE_DATABASE_URL
const ORDER = 'o_pay_race'
const RESTO = 'r_race'
const CLAIM = 'cl_pay_race'
const AMOUNT = 500
const ITERATIONS = 20
/** How far ahead of the spawn the two contenders are released. Enough for node to boot, short enough to collide. */
const BARRIER_LEAD_MS = 2_500

let dir = ''
let bundle = ''
let db: PrismaClient

describe('D′ L5 — the rehearsal target guard is the SAME one the attribution rehearsal uses (always runs)', () => {
  it('a remote host, a tunnelled hosted database, a non-disposable name and an application URL are all refused', () => {
    expect(rehearsalTargetRefusal('mysql://u:p@app.grubano.com:3306/claims_race', [])).toMatch(/not a local loopback/)
    expect(rehearsalTargetRefusal('mysql://u:p@127.0.0.1:3307/deyi0010_staging', [])).toMatch(/cPanel account prefix/)
    expect(rehearsalTargetRefusal('mysql://root:pw@127.0.0.1:3306/app', [])).toMatch(/not named as a disposable/)
    expect(rehearsalTargetRefusal('mysql://u:p@127.0.0.1:3306/claims_race', ['mysql://u:p@127.0.0.1:3306/claims_race']))
      .toMatch(/equals an application/)
    // NEGATIVE CONTROL — a disposable loopback database is accepted, so the guard is not simply refusing everything.
    expect(rehearsalTargetRefusal('mysql://root@127.0.0.1:3310/claims_race', ['mysql://x:y@localhost:3306/deyi0010_app'])).toBeNull()
    // Whatever this checkout's own env files hold, none of it is an acceptable target.
    for (const app of applicationDatabaseUrls({}, ['.env.local', '.env'])) {
      expect(rehearsalTargetRefusal(app, applicationDatabaseUrls(process.env)) !== null).toBe(true)
    }
  })
})

describe.skipIf(!RACE_URL)('D′ L5 — two PROCESSES against one disposable MariaDB', () => {
  beforeAll(async () => {
    const refusal = rehearsalTargetRefusal(RACE_URL, applicationDatabaseUrls(process.env))
    if (refusal) throw new Error(`[D′ L5] rehearsal REFUSED: ${refusal}`)
    // The bundle must live INSIDE the checkout: it requires @prisma/client and stripe from node_modules,
    // which node resolves upwards from the file's own directory. node_modules/.cache is already ignored.
    const cache = join(process.cwd(), 'node_modules', '.cache')
    mkdirSync(cache, { recursive: true })
    dir = mkdtempSync(join(cache, 'claims-pay-race-'))
    process.env.DATABASE_URL = RACE_URL

    execFileSync(process.execPath, [join('node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: RACE_URL }, stdio: 'inherit',
    })

    // The contender, bundled once. The three aliases are the whole of « this rehearsal cannot spend »:
    // the engine, Stripe and the alert sender are replaced before a single line of the bundle runs.
    bundle = join(dir, 'child.cjs')
    execFileSync(process.execPath, [
      join('node_modules', 'esbuild', 'bin', 'esbuild'),
      'tests/support/pay-race-child.ts',
      '--bundle', '--platform=node', '--format=cjs', '--packages=external',
      '--tsconfig=tsconfig.json',
      '--alias:@/lib/refund=./tests/support/race-stubs/refund.ts',
      '--alias:@/lib/stripe=./tests/support/race-stubs/stripe.ts',
      '--alias:@/lib/admin-alerts=./tests/support/race-stubs/admin-alerts.ts',
      `--outfile=${bundle}`,
    ], { stdio: 'inherit' })
    expect(existsSync(bundle)).toBe(true)
    // The bundle must not carry a Stripe client: the alias is load-bearing, so it is verified, not assumed.
    const code = readFileSync(bundle, 'utf8')
    expect(code).not.toMatch(/require\(["']stripe["']\)/)
    expect(code).toContain('the rehearsal never creates a refund at Stripe')

    const { PrismaClient: Client } = await import('@prisma/client')
    db = new Client({ datasources: { db: { url: RACE_URL } } })
    await fixtures()
  }, 300_000)

  afterAll(async () => {
    await db?.$disconnect()
    if (dir) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* a temp directory is not evidence */ } }
  })

  /** The operator and restaurant the order's foreign keys need. Created once; they hold no money. */
  async function fixtures(): Promise<void> {
    await db.operator.upsert({
      where:  { id: 'op_race' },
      update: {},
      create: { id: 'op_race', name: 'Rehearsal', email: 'rehearsal@grubano.test' },
    })
    await db.restaurant.upsert({
      where:  { id: RESTO },
      update: {},
      create: { id: RESTO, operatorId: 'op_race', name: 'Rehearsal', city: 'Lyon', address: '1 rue de la Répétition' },
    })
  }

  /** One payable claim on one paid order, and nothing else. Every iteration starts from exactly this. */
  async function reset(): Promise<void> {
    await db.adminAuditLog.deleteMany({ where: { targetId: CLAIM } })
    await db.claim.deleteMany({ where: { orderId: ORDER } })
    await db.refund.deleteMany({ where: { orderId: ORDER } })
    await db.emailDispatch.deleteMany({ where: { dedupeKey: `claim:${CLAIM}` } })
    await db.order.deleteMany({ where: { id: ORDER } })
    await db.order.create({
      data: {
        id: ORDER, restaurantId: RESTO, consumerId: 'u_race', status: 'delivered', paymentStatus: 'paid',
        items: [], subtotal: 18.01, deliveryFee: 1.99, total: 20, deliveryAddress: '1 rue de la Répétition',
        stripePaymentIntentId: 'pi_race',
      },
    })
    await db.claim.create({
      data: {
        id: CLAIM, orderId: ORDER, consumerId: 'u_race', restaurantId: RESTO, reason: 'other',
        requestedAmountCents: AMOUNT, approvedAmountCents: AMOUNT, status: 'approved',
        arbitrationDecision: 'approved', arbitratedAt: new Date(), refundAttempted: false, refundId: null,
        refundError: null, responseDeadlineAt: new Date(), activeOrderKey: ORDER,
      },
    })
  }

  /** Run two contenders as two processes, released by one absolute instant. Returns both answers and the log. */
  async function race(modeA: string, modeB: string, i: number): Promise<{ a: Record<string, unknown>; b: Record<string, unknown>; engineCalls: number }> {
    await reset()
    const outA = join(dir, `a-${i}.json`)
    const outB = join(dir, `b-${i}.json`)
    const log = join(dir, `engine-${i}.log`)
    writeFileSync(log, '', 'utf8')
    const at = Date.now() + BARRIER_LEAD_MS
    const one = (mode: string, out: string) => new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, [bundle, '--mode', mode, '--url', String(RACE_URL), '--claim', CLAIM, '--at', String(at), '--out', out], {
        env: { ...process.env, DATABASE_URL: RACE_URL, RACE_ENGINE_LOG: log, ADMIN_AUDIT_ENABLED: 'true' },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let err = ''
      p.stderr.on('data', (d) => { err += String(d) })
      p.on('error', reject)
      p.on('exit', (codeOut) => (codeOut === 0 || existsSync(out) ? resolve() : reject(new Error(`child ${mode} exited ${codeOut}: ${err.slice(0, 800)}`))))
    })
    await Promise.all([one(modeA, outA), one(modeB, outB)])
    const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
    const engineCalls = readFileSync(log, 'utf8').split('\n').filter((l) => l.trim()).length
    return { a: read(outA), b: read(outB), engineCalls }
  }

  it(`A (S-08) — ${ITERATIONS} iterations, two rails on ONE claim: exactly one engine call and exactly one payment, every time`, async () => {
    const winners: Record<string, number> = {}
    for (let i = 0; i < ITERATIONS; i++) {
      const { a, b, engineCalls } = await race('rail', 'rail', i)
      // THE FINANCIAL INVARIANT: the engine was offered this claim exactly once, across both processes.
      expect(engineCalls, `iteration ${i}: engine calls`).toBe(1)
      const states = [a, b].map((r) => (r.outcome as { state?: string } | undefined)?.state ?? `threw:${String(r.threw)}`)
      expect(states.filter((s) => s === 'refunded'), `iteration ${i}: ${JSON.stringify(states)}`).toHaveLength(1)
      expect(states.filter((s) => s === 'already_handled'), `iteration ${i}: ${JSON.stringify(states)}`).toHaveLength(1)
      const claim = await db.claim.findUniqueOrThrow({ where: { id: CLAIM } })
      expect(claim.status, `iteration ${i}`).toBe('refunded')
      // One claim, one refund row carrying its identity: the loser wrote nothing at all.
      const rows = await db.refund.findMany({ where: { orderId: ORDER } })
      expect(rows, `iteration ${i}`).toHaveLength(1)
      expect(rows[0].reason).toBe(`claim:${CLAIM}`)
      expect(claim.refundId).toBe(rows[0].id)
      const w = states[0] === 'refunded' ? 'A' : 'B'
      winners[w] = (winners[w] ?? 0) + 1
    }
    // ⭐ THE COLLISION ITSELF, asserted. Without this the rehearsal would pass just as well if one process
    // always started measurably first — « exactly one winner » is trivial when only one contender ever runs.
    expect(Object.keys(winners).sort(), 'both processes must win at least once, or they never really collided')
      .toEqual(['A', 'B'])
    // Recorded in docs/ops/REFUND-FINANCIAL-CONTRACT.md with the server version and these counts.
    console.log('[D′ L5 race A] winners', JSON.stringify(winners))
  }, 900_000)

  it(`B (S-09) — ${ITERATIONS} iterations, a withdrawal against the rail: exactly one winner, never both`, async () => {
    const outcomes: Record<string, number> = {}
    for (let i = 0; i < ITERATIONS; i++) {
      const { a, b, engineCalls } = await race('rail', 'withdraw', i)
      const rail = (a.outcome as { state?: string } | undefined)?.state ?? `threw:${String(a.threw)}`
      const wd = b.outcome as { ok?: boolean; status?: number; error?: string } | undefined
      const railPaid = rail === 'refunded'
      const withdrawWon = wd?.ok === true
      // EXACTLY ONE. Both winning would mean an amount was taken back from a claim that had just been paid.
      expect([railPaid, withdrawWon].filter(Boolean), `iteration ${i}: rail=${rail} withdraw=${JSON.stringify(wd)}`).toHaveLength(1)
      const claim = await db.claim.findUniqueOrThrow({ where: { id: CLAIM } })
      if (railPaid) {
        expect(engineCalls, `iteration ${i}`).toBe(1)
        expect(claim.status).toBe('refunded')
        // The withdrawal refused, and refused for a reason that names the money — never « done ».
        expect(wd?.ok).toBe(false)
        expect(claim.approvedAmountCents, `iteration ${i}: a paid claim keeps the amount it was paid`).toBe(AMOUNT)
      } else {
        // The withdrawal won: the decision is back in the admin queue, with NO amount and NO money anywhere.
        expect(engineCalls, `iteration ${i}: a withdrawn claim is never offered to the engine`).toBe(0)
        expect(claim.status).toBe('arbitration')
        expect(claim.approvedAmountCents).toBeNull()
        expect(claim.arbitrationDecision).toBeNull()
        expect(await db.refund.count({ where: { orderId: ORDER } })).toBe(0)
        // S-30: the reversal and its audit row are one transaction.
        expect(await db.adminAuditLog.count({ where: { targetId: CLAIM } })).toBe(1)
      }
      const key = railPaid ? 'rail' : 'withdraw'
      outcomes[key] = (outcomes[key] ?? 0) + 1
    }
    // ⭐ BOTH SIDES MUST HAVE WON at least once. « Exactly one winner » would also hold if the withdrawal
    // never worked at all — the rail would simply win every time — so the test that matters is this one.
    expect(Object.keys(outcomes).sort(), 'the rail AND the withdrawal must each win at least once')
      .toEqual(['rail', 'withdraw'])
    console.log('[D′ L5 race B] winners', JSON.stringify(outcomes))
  }, 900_000)

  it('C (NEGATIVE CONTROL) — a synthetic rail WITHOUT the compare-and-swap is detected: two engine calls on one claim', async () => {
    // This is not the product. It is a read-then-write rail, the shape the CAS exists to forbid, run through the
    // SAME harness. If the harness could not see it, races A and B would prove nothing.
    let doubled = 0
    for (let i = 0; i < 5; i++) {
      const { engineCalls } = await race('rail_broken', 'rail_broken', 1000 + i)
      if (engineCalls > 1) doubled++
    }
    expect(doubled, 'the harness never saw the broken rail pay twice — it cannot detect a broken rail').toBeGreaterThan(0)
  }, 600_000)
})
