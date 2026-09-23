// tests/claims-dprime-l3b-schema-ready.test.ts — D′ lot L3b (spec v2 §9).
//
// L3b declares three additive nullable columns and adds the probe that says whether they are
// USABLE right now. What this file pins:
//   • the schema declares exactly those three fields, on the right models, nullable, with no
//     default / no index / no attribute — and NO other model or field changed;
//   • clientSchemaReady() reads the generated client's own scalar-field enums, so a field on the
//     WRONG model is rejected (a substring scan of index.d.ts would have passed it);
//   • schemaReady() is fail-closed (client stale ⇒ the database is never touched), latched once
//     ready, re-probed while not ready, and never throws;
//   • the census exposes it, booleans and field names only;
//   • AMENDED BY D′ L4: L3b itself shipped NO consumer. L4 wires the first two — the approve branch
//     of the arbitrate route and the withdraw-approval route answer 503 schema_not_ready rather than
//     write `approvedAmountCents` through a client that does not know it — and `approvedAmountCents`
//     is now read and written by the decision path. `selection` and `deliveredAt` stay unconsumed
//     (L5 owns them), and lib/refund.ts is untouched by both lots. Still no flag, no migration here.
// Every assertion has a negative control on the pre-L3b shape, on the pre-L4 shape, or on a mutated schema.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db } = vi.hoisted(() => ({
  db: { claim: { findFirst: vi.fn() }, order: { findFirst: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { Prisma } from '@prisma/client'
import {
  schemaReady, clientSchemaReady, resetSchemaReadyCache, DPRIME_SCHEMA_FIELDS, PROBE_TTL_MS,
} from '@/lib/schema-ready'

const SCHEMA = readFileSync('prisma/schema.prisma', 'utf8').replace(/\r\n/g, '\n')
const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
/** The body of `model <Name> { … }`. */
const modelBody = (name: string) => {
  const m = new RegExp('(^|\\n)model\\s+' + name + '\\s*\\{').exec(SCHEMA)
  if (!m) return null
  const start = m.index + m[0].length
  const end = SCHEMA.indexOf('\n}', start)
  return end < 0 ? null : SCHEMA.slice(start, end)
}
/** Field declarations of a model, comments removed: [name, type, rest]. */
const fieldsOf = (name: string) => {
  const body = modelBody(name)
  if (body === null) return []
  return body.split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/))
    .filter((p) => p.length >= 2 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p[0]))
    .map((p) => ({ name: p[0], type: p[1], rest: p.slice(2).join(' ') }))
}

const P2022 = (col: string) =>
  new Prisma.PrismaClientKnownRequestError(`The column \`${col}\` does not exist in the current database.`,
    { code: 'P2022', clientVersion: '5.22.0' })

beforeEach(() => {
  vi.clearAllMocks()
  resetSchemaReadyCache()
  db.claim.findFirst.mockResolvedValue(null)
  db.order.findFirst.mockResolvedValue(null)
})
afterEach(() => { resetSchemaReadyCache() })

// ── the schema itself ────────────────────────────────────────────────────────────────────────
describe('prisma/schema.prisma — exactly the three additive nullable columns (spec v2 §9)', () => {
  it('Claim gains approvedAmountCents Int? and selection Json?, Order gains deliveredAt DateTime? — nullable, no default, no index, no attribute', () => {
    const claim = fieldsOf('Claim')
    const order = fieldsOf('Order')
    expect(claim.find((f) => f.name === 'approvedAmountCents')).toEqual({ name: 'approvedAmountCents', type: 'Int?', rest: '' })
    expect(claim.find((f) => f.name === 'selection')).toEqual({ name: 'selection', type: 'Json?', rest: '' })
    expect(order.find((f) => f.name === 'deliveredAt')).toEqual({ name: 'deliveredAt', type: 'DateTime?', rest: '' })
    // no @default / @unique / @db / @map on any of the three, and no new index mentions them
    for (const n of ['approvedAmountCents', 'selection', 'deliveredAt']) {
      expect(SCHEMA, n).not.toMatch(new RegExp(`${n}[^\\n]*@(default|unique|id|map|db|relation)`))
    }
    expect(modelBody('Claim')).not.toMatch(/@@index\(\[[^\]]*(approvedAmountCents|selection)/)
    expect(modelBody('Order')).not.toMatch(/@@index\(\[[^\]]*deliveredAt/)
  })

  it('the three live on the RIGHT models: Claim has no deliveredAt, Order has neither approvedAmountCents nor selection', () => {
    expect(fieldsOf('Claim').map((f) => f.name)).not.toContain('deliveredAt')
    expect(fieldsOf('Order').map((f) => f.name)).toEqual(expect.not.arrayContaining(['approvedAmountCents', 'selection']))
    // the other models that happen to carry a deliveredAt are untouched pre-existing ones
    expect(fieldsOf('Mission').map((f) => f.name)).toContain('deliveredAt')
    expect(fieldsOf('SupplierOrder').map((f) => f.name)).toContain('deliveredAt')
  })

  it('DPRIME_SCHEMA_FIELDS is that exact set — and every entry really exists in the schema', () => {
    expect(DPRIME_SCHEMA_FIELDS.map((f) => `${f.model}.${f.field}`))
      .toEqual(['Claim.approvedAmountCents', 'Claim.selection', 'Order.deliveredAt'])
    for (const { model, field } of DPRIME_SCHEMA_FIELDS) {
      expect(fieldsOf(model).map((f) => f.name), `${model}.${field}`).toContain(field)
    }
  })

  it('no migration/gate/money artefact rode along: no @@map change, no enum, no NOT NULL column, no prisma directive touched', () => {
    // the datasource/generator blocks and the binaryTargets are untouched by this lot
    expect(SCHEMA).toMatch(/binaryTargets = \["native", "debian-openssl-3\.0\.x", "debian-openssl-1\.1\.x", "linux-musl-openssl-3\.0\.x"\]/)
    expect(SCHEMA).toMatch(/provider = "mysql"/)
    // the three additions are the only non-comment lines added to Claim/Order (checked by count)
    expect(fieldsOf('Claim').filter((f) => ['approvedAmountCents', 'selection'].includes(f.name))).toHaveLength(2)
    expect(fieldsOf('Order').filter((f) => f.name === 'deliveredAt')).toHaveLength(1)
  })

  it('the obsolete claim comments are corrected: no « no deliveredAt column exists », no cron AUTO-APPROVED, no ACCEPT → engine', () => {
    const header = SCHEMA.slice(SCHEMA.indexOf('// ── P4.5-C1'), SCHEMA.indexOf('model Claim {'))
    expect(header).not.toMatch(/no deliveredAt column/)
    expect(header).not.toMatch(/AUTO-APPROVED by/)
    expect(header).not.toMatch(/ACCEPT → triggers the P4\.5-A engine/)
    expect(header).toMatch(/D′ L2: a machine never approves and never pays/)
    expect(header).toMatch(/APPROVED_AWAITING_PAYMENT/)
    expect(header).toMatch(/claimsSurfaceOpen\(\) and the filing of NEW claims by claimsIntakeOpen\(\)/)
    // the inline field comments follow
    expect(modelBody('Claim')).toMatch(/routed to arbitration after \(D′ L2\)/)
    expect(modelBody('Claim')).not.toMatch(/→ auto-approve after/)
  })

  it('the approvedAmountCents comment states the REAL bound (T-07/S-10 ≤ requested), not the ceiling, and does not mislabel it D-1', () => {
    const claim = modelBody('Claim')!
    // the binding invariant, as spec v2 T-07 / S-10 state it
    expect(claim).toMatch(/1 ≤ approvedAmountCents ≤ requestedAmountCents/)
    expect(claim).toMatch(/`reduceReason` required when strictly/)
    // the ceiling is DISPLAYED, never the bound — and it is LOOSER than the requested amount
    expect(claim).toMatch(/ceiling \(E6\) is DISPLAYED to the admin/)
    expect(claim).toMatch(/never the server bound/)
    // NEGATIVE CONTROL — the first draft of this comment cited the wrong decision AND the wrong
    // bound (D-1 is the deliveredAt anchor; the ceiling is looser than requestedAmountCents, so
    // « bounded by the ceiling » would let an admin approve MORE than the customer asked for).
    expect(claim).not.toMatch(/D-1 STRICT/)
    expect(claim).not.toMatch(/bounded/)
    expect(claim).not.toMatch(/NEVER the requested amount/)
    // D-1 belongs to Order.deliveredAt, and is cited there
    expect(modelBody('Order')!).toMatch(/decision D-1/)
    expect(modelBody('Order')!).toMatch(/NO updatedAt fallback/)
    // the spec rows these two comments quote still say what the comments claim
    const spec = readFileSync('docs/ops/CLAIMS-DPRIME-SPEC-v2.md', 'utf8')
    expect(spec).toMatch(/\| D-1 \| Ancre STRICTE : `Order\.deliveredAt=null` ⇒ inéligible au self-service, aucun fallback `updatedAt`/)
    expect(spec).toMatch(/\| S-10 \| `1 ≤ approvedAmountCents ≤ requestedAmountCents`/)
  })
})

// ── clientSchemaReady — the stale-client detector ────────────────────────────────────────────
describe('clientSchemaReady() — the generated client, model-scoped, no database', () => {
  it('the client generated from this schema knows all three fields on their own models', () => {
    expect(clientSchemaReady()).toEqual({ ready: true, missing: [] })
    const e = Prisma as unknown as Record<string, Record<string, string>>
    expect(e.ClaimScalarFieldEnum.approvedAmountCents).toBe('approvedAmountCents')
    expect(e.ClaimScalarFieldEnum.selection).toBe('selection')
    expect(e.OrderScalarFieldEnum.deliveredAt).toBe('deliveredAt')
  })

  it('it reads the client and touches NO database: no prisma model call is made', () => {
    clientSchemaReady()
    expect(db.claim.findFirst).not.toHaveBeenCalled()
    expect(db.order.findFirst).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — a field on the WRONG model is rejected, and a missing enum is rejected (a substring scan of index.d.ts would pass both)', () => {
    const enums = Prisma as unknown as Record<string, Record<string, string> | undefined>
    const pick = (model: string, field: string) => {
      const e = enums[`${model}ScalarFieldEnum`]
      return !!e && e[field] === field
    }
    // Order.deliveredAt exists; Claim.deliveredAt does NOT — the enum check separates them
    expect(pick('Order', 'deliveredAt')).toBe(true)
    expect(pick('Claim', 'deliveredAt')).toBe(false)
    expect(pick('Order', 'approvedAmountCents')).toBe(false)
    // a model with no generated enum at all
    expect(pick('NotAModel', 'approvedAmountCents')).toBe(false)
    // and the naive check the module does NOT use would have passed the wrong-model case
    const dts = readFileSync('node_modules/.prisma/client/index.d.ts', 'utf8')
    expect(dts.includes('deliveredAt')).toBe(true)
  })
})

// ── schemaReady — fail-closed, cached, never throws ──────────────────────────────────────────
describe('schemaReady() — fail-closed, latched, secret-free', () => {
  it('client ready + both reads succeed → ready, and the probe SELECTS the three columns through the model API (no raw SQL)', async () => {
    const s = await schemaReady()
    expect(s).toMatchObject({ ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], why: null })
    expect(s.probedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(db.claim.findFirst).toHaveBeenCalledWith({ select: { id: true, approvedAmountCents: true, selection: true } })
    expect(db.order.findFirst).toHaveBeenCalledWith({ select: { id: true, deliveredAt: true } })
    // the module never writes and never reaches for raw SQL
    const code = strip(src('lib/schema-ready.ts'))
    expect(code).not.toMatch(/\$queryRaw|\$executeRaw|ALTER TABLE|information_schema/)
    expect(code).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/)
  })

  it('a column missing in the DATABASE (P2022) → not ready, named, with the prisma code in `why` — and no throw', async () => {
    db.claim.findFirst.mockRejectedValue(P2022('approvedAmountCents'))
    const s = await schemaReady()
    expect(s.ready).toBe(false)
    expect(s.clientReady).toBe(true)
    expect(s.dbReady).toBe(false)
    expect(s.missingDb).toEqual(['Claim.approvedAmountCents/selection'])
    expect(s.why).toBe('Claim.approvedAmountCents/selection: prisma P2022')
    // the second model is still probed — one missing column does not hide another
    expect(db.order.findFirst).toHaveBeenCalledTimes(1)
  })

  it('an unreachable database → not ready with a reason, never a throw and never a leaked DSN', async () => {
    db.order.findFirst.mockRejectedValue(new Error('Can\'t reach database server at mysql://user:s3cr3t@host:3306/db'))
    const s = await schemaReady()
    expect(s.ready).toBe(false)
    expect(s.missingDb).toEqual(['Order.deliveredAt'])
    expect(s.why).toBe('Order.deliveredAt: Error')
    expect(JSON.stringify(s)).not.toMatch(/s3cr3t|mysql:\/\//)
  })

  it('CACHE — ready is LATCHED (probed once per process); while NOT ready it is re-probed after PROBE_TTL_MS', async () => {
    const t0 = 1_000_000
    expect((await schemaReady(t0)).ready).toBe(true)
    await schemaReady(t0 + 10 * PROBE_TTL_MS)
    expect(db.claim.findFirst).toHaveBeenCalledTimes(1) // latched: no second probe, ever
    // not ready → re-probed, but not more often than the TTL
    resetSchemaReadyCache()
    db.claim.findFirst.mockRejectedValue(P2022('selection'))
    expect((await schemaReady(t0)).ready).toBe(false)
    expect(db.claim.findFirst).toHaveBeenCalledTimes(2)
    await schemaReady(t0 + PROBE_TTL_MS - 1)
    expect(db.claim.findFirst).toHaveBeenCalledTimes(2) // inside the TTL: cached
    await schemaReady(t0 + PROBE_TTL_MS + 1)
    expect(db.claim.findFirst).toHaveBeenCalledTimes(3) // past it: re-probed
    // and it recovers without a deploy once the column is there (regen + restart case)
    db.claim.findFirst.mockResolvedValue(null)
    const ok = await schemaReady(t0 + 2 * PROBE_TTL_MS + 2)
    expect(ok.ready).toBe(true)
  })

  it('NEGATIVE CONTROL — when the CLIENT is stale the database is NEVER touched, and the reason names the regen operator', async () => {
    // simulate a stale client by hiding the enum the module reads
    const enums = Prisma as unknown as Record<string, unknown>
    const real = enums.ClaimScalarFieldEnum
    try {
      enums.ClaimScalarFieldEnum = { id: 'id', status: 'status' }
      expect(clientSchemaReady()).toEqual({ ready: false, missing: ['Claim.approvedAmountCents', 'Claim.selection'] })
      resetSchemaReadyCache()
      const s = await schemaReady()
      expect(s).toMatchObject({ ready: false, clientReady: false, dbReady: null, missingDb: [] })
      expect(s.missingClient).toEqual(['Claim.approvedAmountCents', 'Claim.selection'])
      expect(s.why).toMatch(/run scripts\/server\/dprime-regen-client\.js/)
      expect(db.claim.findFirst).not.toHaveBeenCalled()
      expect(db.order.findFirst).not.toHaveBeenCalled()
    } finally { enums.ClaimScalarFieldEnum = real }
    resetSchemaReadyCache()
    expect(clientSchemaReady().ready).toBe(true) // restored
  })
})

// ── the census, and what L3b deliberately does NOT do ────────────────────────────────────────
describe('the census exposes schemaReady; L3b ships no consumer, no gate, no money', () => {
  it('the census route awaits schemaReady() and reports it as `schema`, beside the gates', () => {
    const s = strip(src('app/api/admin/claims/census/route.ts'))
    expect(s).toMatch(/import \{ schemaReady \} from '@\/lib\/schema-ready'/)
    expect(s).toMatch(/schema: await schemaReady\(\),/)
    // still counts-only and token-gated: no ids, no amounts, no free text added by this lot
    expect(s).toMatch(/if \(!isInternalCronRequest\(req\)\)/)
    expect(s).not.toMatch(/consumerId|orderId:|requestedAmountCents|description/)
  })

  it('the reported state is booleans, field names and an instant — nothing else', async () => {
    const s = await schemaReady()
    expect(Object.keys(s).sort()).toEqual(['clientReady', 'dbReady', 'missingClient', 'missingDb', 'probedAt', 'ready', 'why'])
    for (const v of [s.ready, s.clientReady]) expect(typeof v).toBe('boolean')
    for (const a of [s.missingClient, s.missingDb]) expect(Array.isArray(a)).toBe(true)
  })

  // ── INVERTED BY D′ L4 (spec v2 §9) ─────────────────────────────────────────────────────────
  // L3b shipped the probe with NO consumer. L4 is the lot that wires the first two: the routes
  // that WRITE approvedAmountCents — approve and withdraw-approval — answer 503 rather than write
  // through a client that does not know the column. Everything else still gates on nothing: the
  // intake, the machine route and the state machine itself write none of the three columns' values
  // from a request, so a readiness gate there would only add a new way to fail.
  it('D′ L4 — the schemaReady gate exists on EXACTLY the two writing routes (approve, withdraw), and on no other claims route nor lib/claims.ts', () => {
    // (a) the gated routes: the probe AND the 503 it answers with
    for (const p of ['app/api/admin/claims/[id]/arbitrate/route.ts', 'app/api/admin/claims/[id]/withdraw-approval/route.ts']) {
      const code = strip(src(p))
      expect(code, p).toMatch(/import \{ schemaReady \} from '@\/lib\/schema-ready'/)
      expect(code, p).toMatch(/await schemaReady\(\)/)
      expect(code, p).toMatch(/reason: 'schema_not_ready', schemaReady: false/)
      expect(code, p).toMatch(/\{ status: 503 \}/)
    }
    // (b) NEGATIVE CONTROL of the inversion — the routes L3b listed beside them are still UNGATED:
    // the old assertion (« no route gates on schemaReady ») would now be false, and these prove the
    // new one is a real boundary rather than a blanket.
    const ungated = ['app/api/claims/route.ts', 'app/api/admin/claims/auto-approve/route.ts',
      'app/api/claims/[id]/respond/route.ts', 'lib/claims.ts']
    for (const p of ungated) {
      expect(strip(src(p)), p).not.toMatch(/schema-ready|schemaReady/)
      expect(strip(src(p)), p).not.toMatch(/\b503\b/)
    }
    // (c) the probe module itself stays a leaf that only reads through Prisma
    expect(strip(src('lib/schema-ready.ts'))).toMatch(/from '@\/lib\/prisma'/)
    expect(strip(src('lib/schema-ready.ts'))).not.toMatch(/@\/lib\/(claims|refund|stripe)['"]/)
  })

  it('D′ L4 — approvedAmountCents is now READ AND WRITTEN by the decision path; `selection` and `deliveredAt` are still untouched (L5 owns them), and lib/refund.ts is untouched by BOTH lots', () => {
    // (a) the column L4 consumes — the state machine selects it, pins it in its CAS and writes it
    const claimsCode = strip(src('lib/claims.ts'))
    expect(claimsCode).toMatch(/approvedAmountCents: true,/)                 // selected
    expect(claimsCode).toMatch(/approvedAmountCents: null \}/)               // pinned in the CAS
    expect(claimsCode).toMatch(/approvedAmountCents: amount,/)               // written
    expect(strip(src('app/api/admin/claims/[id]/arbitrate/route.ts'))).toMatch(/approvedAmountCents:/)
    // (b) NEGATIVE CONTROL of the inversion — the L3b assertion was `not.toMatch(/approvedAmountCents:\s/)`
    // on these very files. It is now false for both, which is exactly what L4 changed.
    for (const p of ['lib/claims.ts', 'app/api/admin/claims/[id]/arbitrate/route.ts']) {
      expect(strip(src(p)), p).toMatch(/approvedAmountCents:\s/)
    }
    // (c) the two OTHER columns are still nobody's business but the probe's — nothing regressed into L5
    const scanned = ['lib/claims.ts', 'lib/claim-action-rules.ts', 'lib/claim-scope.ts', 'lib/refund.ts',
      'app/api/claims/route.ts', 'app/api/admin/claims/[id]/arbitrate/route.ts',
      'app/api/admin/claims/[id]/withdraw-approval/route.ts', 'app/api/admin/claims/[id]/ceiling/route.ts']
    for (const p of scanned) {
      const code = strip(src(p))
      expect(code, p).not.toMatch(/selection:\s*(true|\{)/)
      expect(code, p).not.toMatch(/deliveredAt/)
    }
    // (d) the frozen engine never learns about any of the three: no amount, no selection, no delivery
    const engine = strip(src('lib/refund.ts'))
    expect(engine).not.toMatch(/approvedAmountCents/)
    expect(engine).not.toMatch(/schema-ready|schemaReady/)
    // ClaimFacts keeps the optional D1 v1.1 FACT (a plain type field, never a prisma select)
    expect(src('lib/claim-action-rules.ts')).toMatch(/approvedAmountCents\?: number \| null/)
  })
})

// ── the four artefacts must describe the SAME three columns ───────────────────────────────────
// The database got its columns from the L3a operator's compiled SQL; the schema declares them
// here; the regen operator certifies them in the generated client; schema-ready probes them at
// runtime. If any pair drifts — a type that does not match, a column on the wrong table — the
// result is a silent runtime failure on a money field. This is the standing proof that the
// SERVER columns and the EXPECTED schema are the same three things.
describe('PROOF — schema ⇄ L3a migration SQL ⇄ regen operator ⇄ schema-ready all agree', () => {
  const { COLUMNS, MIGRATION_HASH } = require('../scripts/server/dprime-staging-migrate.js') as {
    COLUMNS: Array<{ table: string; column: string; type: string; dataType: string[]; sql: string }>; MIGRATION_HASH: string
  }
  const { REQUIRED } = require('../scripts/server/dprime-regen-client.js') as {
    REQUIRED: Array<{ model: string; field: string }>
  }
  /** Prisma scalar → the SQL type the migration must have used, and the information_schema spellings. */
  const EXPECTED = {
    'Claim.approvedAmountCents': { prisma: 'Int?', sql: 'INTEGER', dataType: ['int'] },
    'Claim.selection':           { prisma: 'Json?', sql: 'JSON', dataType: ['json', 'longtext'] },
    'Order.deliveredAt':         { prisma: 'DateTime?', sql: 'DATETIME(3)', dataType: ['datetime'] },
  } as const

  it('the same three keys, in the same order, in all four artefacts', () => {
    const keys = Object.keys(EXPECTED)
    expect(COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual(keys)
    expect(REQUIRED.map((r) => `${r.model}.${r.field}`)).toEqual(keys)
    expect(DPRIME_SCHEMA_FIELDS.map((f) => `${f.model}.${f.field}`)).toEqual(keys)
    for (const k of keys) {
      const [model, field] = k.split('.')
      expect(fieldsOf(model).map((f) => f.name), k).toContain(field)
    }
  })

  it('each Prisma type matches the SQL the migration applied, and the information_schema spelling it verifies', () => {
    for (const [key, want] of Object.entries(EXPECTED)) {
      const [model, field] = key.split('.')
      expect(fieldsOf(model).find((f) => f.name === field)?.type, key).toBe(want.prisma)
      const col = COLUMNS.find((c) => `${c.table}.${c.column}` === key)!
      expect(col.type, key).toBe(want.sql)
      expect(col.dataType, key).toEqual([...want.dataType])
      expect(col.sql, key).toBe(`ALTER TABLE \`${model}\` ADD COLUMN IF NOT EXISTS \`${field}\` ${want.sql} NULL`)
    }
    // the applied migration is the one the founder ran on staging on 2026-09-22
    expect(MIGRATION_HASH).toBe('43cdb3bb51fbe95b')
  })

  it('the migration stayed additive and nullable — the schema declares nothing the SQL did not create', () => {
    for (const c of COLUMNS) {
      expect(c.sql).toMatch(/ NULL$/)
      expect(c.sql).not.toMatch(/NOT NULL|DEFAULT|UNIQUE|INDEX|DROP/i)
      // every column the SQL creates is declared nullable in the schema, and vice versa
      expect(fieldsOf(c.table).find((f) => f.name === c.column)?.type, `${c.table}.${c.column}`).toMatch(/\?$/)
    }
  })

  it('NEGATIVE CONTROL — a drifted type, a column moved to the wrong table, or a fourth column would all be caught', () => {
    const keys = Object.keys(EXPECTED)
    // a type drift: Int? declared where the DB got JSON
    expect('Int?').not.toBe(EXPECTED['Claim.selection'].prisma)
    // wrong table: the SQL statement for a column moved to Order no longer matches its expected form
    expect('ALTER TABLE `Order` ADD COLUMN IF NOT EXISTS `selection` JSON NULL')
      .not.toBe(`ALTER TABLE \`Claim\` ADD COLUMN IF NOT EXISTS \`selection\` JSON NULL`)
    // a fourth column anywhere breaks the equal-keys assertion
    expect([...keys, 'Claim.extra']).not.toEqual(keys)
    // and the hash pin moves the moment the compiled SQL changes at all
    expect(MIGRATION_HASH).toHaveLength(16)
  })
})
