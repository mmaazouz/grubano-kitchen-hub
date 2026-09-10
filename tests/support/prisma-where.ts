// tests/support/prisma-where.ts — a where clause evaluator for mocked Prisma writes.
//
// WHY THIS EXISTS. Two audits in a row were defeated by the same thing: a mocked
// `updateMany` that returned `{ count: 1 }` whatever the where clause said. A compare-and-set
// is ONLY a guard because of its where clause, so a mock that ignores it cannot detect a
// broken one. That is exactly how a fix whose CAS matched zero rows shipped green, and how
// `status: { in: [...] }`, `refundError: { not: null }` and `responseDeadlineAt: { lte }` —
// the predicates carrying the money invariants — went unverified for two batches.
//
// Two deliberate design choices:
//   • comparison operators are EVALUATED, not skipped;
//   • an operator this helper does not model THROWS. Silence is what made the old mock
//     dangerous, so an unrecognised clause shape must stop the test, never be waved through.
//
// It is intentionally NOT a Prisma emulator. It models the operators the claims money paths
// actually use. Extend `matchOp` when a new one appears; do not add a skip.

/** Prisma comparison operators the claims/refund money paths use today. */
export function matchOp(op: string, expected: unknown, actual: unknown): boolean {
  switch (op) {
    case 'equals': return actual === expected
    case 'not':    return actual !== expected
    case 'in':     return Array.isArray(expected) && (expected as unknown[]).includes(actual)
    case 'notIn':  return Array.isArray(expected) && !(expected as unknown[]).includes(actual)
    case 'lt':     return (actual as number) <  (expected as number)
    case 'lte':    return (actual as number) <= (expected as number)
    case 'gt':     return (actual as number) >  (expected as number)
    case 'gte':    return (actual as number) >= (expected as number)
    default:
      throw new Error(
        `prisma mock: unsupported operator '${op}' — extend tests/support/prisma-where.ts ` +
        'instead of skipping it. A clause the harness cannot evaluate must fail the test, ' +
        'never pass silently.',
      )
  }
}

/**
 * Does `row` satisfy `where`?
 *
 * `id` is skipped on purpose: in these mocks it addresses the row, it is not the guard under
 * test. Everything else is compared — scalars by identity, objects by operator. A `Date` value
 * is treated as a scalar, not as an operator bag.
 */
export function matchWhere(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(where)) {
    if (field === 'id') continue
    const actual = row[field]
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      for (const [op, operand] of Object.entries(expected as Record<string, unknown>)) {
        if (!matchOp(op, operand, actual)) return false
      }
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

/**
 * Build an `updateMany` mock implementation bound to a mutable fixture.
 *
 * `fx.row` is OPT-IN: when it is null the mock keeps the historical permissive behaviour so
 * existing tests that never simulated a row are unaffected. When a row IS supplied, the where
 * clause is enforced for real and a non-matching CAS returns `{ count: 0 }`, exactly as Prisma
 * would. `fx.forcedCount` still overrides the matched count, for the concurrency cases that
 * need to simulate "another writer won".
 */
export function updateManyMock(fx: { row: Record<string, unknown> | null; forcedCount?: number | null }) {
  return ({ where }: { where: Record<string, unknown> }) => {
    const row = fx.row
    if (!row) return Promise.resolve({ count: fx.forcedCount ?? 1 })
    if (!matchWhere(where, row)) return Promise.resolve({ count: 0 })
    return Promise.resolve({ count: fx.forcedCount ?? 1 })
  }
}
