// ── lib/schema-ready.ts — is the D′ schema actually usable right now? (D′ lot L3b, spec v2 §9) ──
//
// WHY THIS EXISTS. The D′ columns arrive in three separate moves that can be out of step:
//   1. the DATABASE gets them (scripts/server/dprime-staging-migrate.js — done on staging);
//   2. the SCHEMA declares them (this lot);
//   3. the server's GENERATED PRISMA CLIENT learns about them (`prisma generate` on the server).
// Step 3 is the fragile one: the FTPS deploy excludes node_modules/.prisma and the post-deploy SSH
// step is `continue-on-error` and has repeatedly ended in `dial tcp …:22: i/o timeout` — a GREEN
// step that executed nothing. A build can therefore run against a client that does not know
// `approvedAmountCents`, `selection` or `deliveredAt`, where every read of them is undefined and
// every write throws inside a best-effort catch. That is exactly the failure this module makes
// VISIBLE instead of silent.
//
// TWO HALVES, and both must hold:
//   • clientSchemaReady() — synchronous, no database: the generated client's own scalar-field
//     enums (Prisma.ClaimScalarFieldEnum / Prisma.OrderScalarFieldEnum) name the three fields.
//     This is what catches a stale client, and it costs nothing.
//   • the DB half — one LIMIT-1 read per model THROUGH THE PRISMA MODEL API (no raw SQL,
//     CLAUDE.md §12) selecting the new columns. A column missing in the database makes Prisma
//     answer P2022; a client that does not know the field makes it answer with a validation
//     error. Either way we learn it without writing anything.
//
// FAIL-CLOSED and CHEAP: any error → not ready, with a reason. The result is CACHED per process:
// once ready it is latched (a column cannot vanish without a new deploy or a migration), and
// while NOT ready it is re-probed at most every PROBE_TTL_MS so a `prisma generate` + restart is
// picked up without another deploy.
//
// IT DECIDES NOTHING YET. L3b only ADDS the probe and exposes it in the read-only census. The
// consumers named in spec v2 §9 (503 on pay / withdraw / approve / POST claims) arrive with the
// routes they guard, in D′ L4/L5 — this lot ships no gate, no flag and no behaviour change.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** The three additive nullable columns of spec v2 §9, with the table each one lives in. */
export const DPRIME_SCHEMA_FIELDS = [
  { model: 'Claim' as const, field: 'approvedAmountCents', table: 'Claim' },
  { model: 'Claim' as const, field: 'selection', table: 'Claim' },
  { model: 'Order' as const, field: 'deliveredAt', table: 'Order' },
]

export type SchemaReadyState = {
  /** clientReady ∧ dbReady — the only value a caller should branch on. */
  ready: boolean
  /** The generated Prisma client names all three fields on their own models. */
  clientReady: boolean
  /** A Prisma read of the three columns succeeded (null = not probed because the client failed first). */
  dbReady: boolean | null
  /** `Model.field` entries the generated client does not know. */
  missingClient: string[]
  /** `Model.field` entries the database rejected (P2022), or the models whose probe failed. */
  missingDb: string[]
  /** ISO instant of the probe this state came from. */
  probedAt: string
  /** Short, secret-free explanation when not ready. */
  why: string | null
}

/** While NOT ready, re-probe at most this often (a regen + restart must be picked up). */
export const PROBE_TTL_MS = 30_000

let cached: SchemaReadyState | null = null
let cachedAtMs = 0

/**
 * The CLIENT half — synchronous, no database. Reads the generated scalar-field enums, so a field
 * declared on the wrong model is NOT accepted (a plain substring scan of index.d.ts would be).
 */
export function clientSchemaReady(): { ready: boolean; missing: string[] } {
  const enums = Prisma as unknown as Record<string, Record<string, string> | undefined>
  const missing: string[] = []
  for (const { model, field } of DPRIME_SCHEMA_FIELDS) {
    const e = enums[`${model}ScalarFieldEnum`]
    if (!e || e[field] !== field) missing.push(`${model}.${field}`)
  }
  return { ready: missing.length === 0, missing }
}

/** The DB half — one LIMIT-1 read per model through the model API. Never writes. */
async function probeDb(): Promise<{ ready: boolean; missing: string[]; why: string | null }> {
  const missing: string[] = []
  let why: string | null = null
  const note = (label: string, e: unknown) => {
    missing.push(label)
    // P2022 = « the column does not exist in the current database » — the exact case this guards.
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null
    if (!why) why = code ? `${label}: prisma ${code}` : `${label}: ${(e as Error)?.name ?? 'probe failed'}`
  }
  try {
    await prisma.claim.findFirst({ select: { id: true, approvedAmountCents: true, selection: true } })
  } catch (e) { note('Claim.approvedAmountCents/selection', e) }
  try {
    await prisma.order.findFirst({ select: { id: true, deliveredAt: true } })
  } catch (e) { note('Order.deliveredAt', e) }
  return { ready: missing.length === 0, missing, why }
}

/**
 * Is the D′ schema usable right now? Cached per process: latched once ready, re-probed every
 * PROBE_TTL_MS while not. Never throws — an unreachable database is « not ready », with a reason.
 */
export async function schemaReady(now: number = Date.now()): Promise<SchemaReadyState> {
  if (cached && (cached.ready || now - cachedAtMs < PROBE_TTL_MS)) return cached

  const client = clientSchemaReady()
  let state: SchemaReadyState
  if (!client.ready) {
    // The client does not know the fields: do not touch the database — the answer cannot change.
    state = {
      ready: false, clientReady: false, dbReady: null,
      missingClient: client.missing, missingDb: [],
      probedAt: new Date(now).toISOString(),
      why: `generated prisma client lacks ${client.missing.join(', ')} — run scripts/server/dprime-regen-client.js`,
    }
  } else {
    const db = await probeDb()
    state = {
      ready: db.ready, clientReady: true, dbReady: db.ready,
      missingClient: [], missingDb: db.missing,
      probedAt: new Date(now).toISOString(),
      why: db.ready ? null : (db.why ?? 'database probe failed'),
    }
  }
  cached = state
  cachedAtMs = now
  return state
}

/** Tests only: forget the cached probe. */
export function resetSchemaReadyCache(): void {
  cached = null
  cachedAtMs = 0
}
