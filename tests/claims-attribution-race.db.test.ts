// tests/claims-attribution-race.db.test.ts — T-49 round 13, slice W4: J-M24 (C10, C6, B6, A-S42).
//
// HARD INVARIANT, rehearsed on a REAL database: two concurrent bindings of one unstamped Refund row to two claims —
// exactly one commits. Vitest with a mocked Prisma cannot prove InnoDB lock behaviour (binding rule 6), so this file
// runs attributeWithEvidence through TWO PrismaClient instances (two connections) against a disposable MariaDB of
// o2switch's major version.
//
// OPT-IN ONLY. It runs only when CLAIMS_RACE_DATABASE_URL is set (CI never sets it: no CI, cron or infra change) and it
// REFUSES any target that is not a disposable local database — never staging or production data, including a hosted
// database reached through an SSH tunnel on loopback. No Stripe call (the evidence is injected), no engine call, no e-mail.
//
//   CLAIMS_RACE_DATABASE_URL=mysql://root@127.0.0.1:3310/claims_race npx vitest run tests/claims-attribution-race.db.test.ts
//   CLAIMS_RACE_NEGATIVE=1 … also records the run without the isolation level (the server default, REPEATABLE READ).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Stripe from 'stripe'
import type { PrismaClient } from '@prisma/client'
import { applicationDatabaseUrls, rehearsalTargetRefusal } from './support/rehearsal-target'

vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('the rehearsal never calls Stripe') } }))
vi.mock('@/lib/refund', () => ({
  executeRefund: () => { throw new Error('the rehearsal never calls the engine') },
  isRefundsEnabled: () => false,
  RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000,
}))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'skipped' })) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn(async () => false) }))

const RACE_URL = process.env.CLAIMS_RACE_DATABASE_URL

// D' L5: the guard moved to tests/support/rehearsal-target.ts when a SECOND rehearsal against a real
// database (the financial rail races) needed it. ONE definition of « never point this at real data »;
// the always-run tests of that definition stay HERE, where the rule was first written.

describe('J-M24 — the rehearsal target guard (always runs)', () => {
  it('refuses unset, non-mysql, remote (staging / production), Grubano-named, tunnelled hosted, non-disposable and application URLs; accepts a disposable loopback database', () => {
    expect(rehearsalTargetRefusal(undefined, [])).toMatch(/not set/)
    expect(rehearsalTargetRefusal('postgres://127.0.0.1/claims_race', [])).toMatch(/mysql/)
    expect(rehearsalTargetRefusal('mysql://u:p@app.grubano.com:3306/claims_race', [])).toMatch(/not a local loopback/)
    expect(rehearsalTargetRefusal('mysql://u:p@109.234.165.222:3306/claims_race', [])).toMatch(/not a local loopback/)
    expect(rehearsalTargetRefusal('mysql://u:p@localhost:3306/grubano_prod', [])).toMatch(/Grubano/)
    // A hosted database through an SSH tunnel on loopback: the cPanel prefix names it (database or user).
    expect(rehearsalTargetRefusal('mysql://u:p@127.0.0.1:3307/deyi0010_staging', [])).toMatch(/cPanel account prefix/)
    expect(rehearsalTargetRefusal('mysql://deyi0010_app:p@127.0.0.1:3306/claims_race', [])).toMatch(/cPanel account prefix/)
    // A loopback database that does not say it is disposable.
    expect(rehearsalTargetRefusal('mysql://root:pw@127.0.0.1:3306/app', [])).toMatch(/not named as a disposable/)
    expect(rehearsalTargetRefusal('mysql://root:pw@127.0.0.1:3306/claims_race_but_real', [])).toMatch(/not named as a disposable/)
    expect(rehearsalTargetRefusal('mysql://u:p@127.0.0.1:3306/', [])).toMatch(/no database name/)
    // Equal to an application URL, or the same database name behind other credentials or another port.
    expect(rehearsalTargetRefusal('mysql://u:p@127.0.0.1:3306/claims_race', ['mysql://u:p@127.0.0.1:3306/claims_race'])).toMatch(/equals an application/)
    expect(rehearsalTargetRefusal('mysql://root@127.0.0.1:3310/claims_race', ['mysql://x:y@localhost:3306/claims_race'])).toMatch(/database name equals/)
    // NEGATIVE CONTROL: a disposable loopback rehearsal database is accepted.
    expect(rehearsalTargetRefusal('mysql://root:pw@127.0.0.1:3306/claims_race', [])).toBeNull()
    expect(rehearsalTargetRefusal('mysql://root@127.0.0.1:3310/claims_race_w4', ['mysql://x:y@localhost:3306/deyi0010_app'])).toBeNull()
  })

  it('the application URLs include the DATABASE_URL* lines of .env.local / .env, which vitest does not load — such a value is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-race-guard-'))
    const f = join(dir, '.env.local')
    writeFileSync(f, '# comment\nDATABASE_URL="mysql://u:p@localhost:3306/claims_race"\nexport DATABASE_URL_STAGING=\'mysql://v:q@127.0.0.1:3307/other\'\nNOT_A_DATABASE=1\n')
    const urls = applicationDatabaseUrls({}, [f, join(dir, 'missing.env')])
    expect(urls).toEqual(['mysql://u:p@localhost:3306/claims_race', 'mysql://v:q@127.0.0.1:3307/other'])
    expect(rehearsalTargetRefusal('mysql://u:p@localhost:3306/claims_race', urls)).toMatch(/equals an application/)
    // The checkout's own env files, when present, are read too: each application URL they hold is refused (values never printed).
    for (const app of applicationDatabaseUrls({}, ['.env.local', '.env'])) {
      expect(rehearsalTargetRefusal(app, applicationDatabaseUrls(process.env)) !== null).toBe(true)
    }
  })
})

describe.skipIf(!RACE_URL)('J-M24 — HARD INVARIANT: two concurrent bindings, two real connections (C10)', () => {
  const ORDER = 'o_claims_race'
  const ROW = 'rf_claims_race'
  const RE = 're_claimsrace0001'
  const CLAIMS: Record<string, string> = {
    cl_claims_race_1: 'financial_verification:refund_moved_unattributed: rehearsal one',
    cl_claims_race_2: 'financial_verification:refund_moved_unattributed: rehearsal two',
  }
  let A: PrismaClient
  let B: PrismaClient
  let claims: typeof import('@/lib/claims')

  beforeAll(async () => {
    const refusal = rehearsalTargetRefusal(RACE_URL, applicationDatabaseUrls(process.env))
    if (refusal) throw new Error(`[J-M24] rehearsal REFUSED: ${refusal}`)
    // The singleton client of lib/prisma (closure record) targets the same disposable database.
    process.env.DATABASE_URL = RACE_URL
    execFileSync(process.execPath, [join('node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], {
      env: { ...process.env, DATABASE_URL: RACE_URL }, stdio: 'inherit',
    })
    const { PrismaClient: Client } = await import('@prisma/client')
    A = new Client({ datasources: { db: { url: RACE_URL } } })
    B = new Client({ datasources: { db: { url: RACE_URL } } })
    claims = await import('@/lib/claims')
  }, 180_000)

  afterAll(async () => {
    await A?.$disconnect()
    await B?.$disconnect()
    const { prisma } = await import('@/lib/prisma')
    await prisma.$disconnect()
  })

  async function reset() {
    await A.claim.deleteMany({ where: { orderId: ORDER } })
    await A.refund.deleteMany({ where: { orderId: ORDER } })
    await A.emailDispatch.deleteMany({ where: { trigger: 'claim_closure_record', dedupeKey: { in: Object.keys(CLAIMS).map((id) => `claim:${id}`) } } })
    await A.refund.create({ data: { id: ROW, orderId: ORDER, restaurantId: 'r_claims_race', stripeRefundId: RE, idempotencyKey: `refund:${ORDER}:0`, amountCents: 500, reason: null, status: 'succeeded' } })
    for (const [id, refundError] of Object.entries(CLAIMS)) {
      await A.claim.create({ data: { id, orderId: ORDER, consumerId: 'u_claims_race', restaurantId: 'r_claims_race', reason: 'other', requestedAmountCents: 500, status: 'financial_verification', responseDeadlineAt: new Date(), refundAttempted: true, refundError } })
    }
  }

  const evidence = { id: RE, object: 'refund', status: 'succeeded', amount: 500, payment_intent: null, charge: null, metadata: {} } as unknown as Stripe.Refund

  /** One iteration: both bindings start behind a shared barrier, each on its own connection. */
  async function iteration(clientA: PrismaClient, clientB: PrismaClient) {
    await reset()
    const row = await A.refund.findUniqueOrThrow({ where: { id: ROW } })
    let open!: () => void
    const barrier = new Promise<void>((resolve) => { open = resolve })
    const run = (id: string, client: PrismaClient) => barrier.then(() => claims.attributeWithEvidence({ id }, row, evidence, { adminId: 'rehearsal', client }))
    const pending = Promise.all([run('cl_claims_race_1', clientA), run('cl_claims_race_2', clientB)])
    open()
    const [r1, r2] = await pending
    const after = await A.claim.findMany({ where: { orderId: ORDER }, orderBy: { id: 'asc' } })
    return { r1, r2, after }
  }

  it('20 iterations: exactly one claim {refunded, refundId R}; the other unchanged (FV, original refundError); the loser never ok', async () => {
    const counts = { cl_claims_race_1: 0, cl_claims_race_2: 0, loserErrors: {} as Record<string, number> }
    for (let i = 0; i < 20; i++) {
      const { r1, r2, after } = await iteration(A, B)
      const refunded = after.filter((c) => c.status === 'refunded' && c.refundId === ROW)
      expect(refunded, `iteration ${i}`).toHaveLength(1)
      const winner = refunded[0].id
      const loser = after.find((c) => c.id !== winner)!
      expect(loser, `iteration ${i}`).toMatchObject({ status: 'financial_verification', refundId: null, refundError: CLAIMS[loser.id] })
      const [won, lost] = winner === 'cl_claims_race_1' ? [r1, r2] : [r2, r1]
      expect(won.out.ok, `iteration ${i}`).toBe(true)
      expect(lost.out.ok, `iteration ${i}`).toBe(false)
      if (!lost.out.ok) {
        expect(lost.out.status).toBe(409)
        counts.loserErrors[lost.out.error] = (counts.loserErrors[lost.out.error] ?? 0) + 1
      }
      counts[winner as 'cl_claims_race_1' | 'cl_claims_race_2']++
    }
    // Recorded once in docs/ops/REFUND-FINANCIAL-CONTRACT.md with the server version (read by the operator: no raw SQL here).
    console.log('[J-M24] outcome counts', JSON.stringify(counts))
  }, 300_000)

  it.skipIf(process.env.CLAIMS_RACE_NEGATIVE !== '1')('NEGATIVE CONTROL (recorded) — the isolation level omitted (server default REPEATABLE READ): at least one iteration binds R to BOTH claims', async () => {
    // The client with $transaction forwarding only maxWait / timeout. Every member is read from, and bound to, the real
    // client (a detached $transaction or a getter run against the proxy would not be the client the code uses).
    const withoutIsolation = (c: PrismaClient): PrismaClient => new Proxy(c, {
      get(target, prop) {
        if (prop === '$transaction') {
          return (fn: (tx: unknown) => Promise<unknown>, o?: { maxWait?: number; timeout?: number }) =>
            (target.$transaction as unknown as (f: typeof fn, opts: object) => Promise<unknown>).call(target, fn, { maxWait: o?.maxWait, timeout: o?.timeout })
        }
        const v = Reflect.get(target, prop, target) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
    let doubles = 0
    for (let i = 0; i < 20; i++) {
      const { after } = await iteration(withoutIsolation(A), withoutIsolation(B))
      if (after.filter((c) => c.status === 'refunded' && c.refundId === ROW).length === 2) doubles++
    }
    console.log('[J-M24] negative control (no isolation level): iterations binding R twice =', doubles)
    expect(doubles).toBeGreaterThan(0)
  }, 300_000)
})
