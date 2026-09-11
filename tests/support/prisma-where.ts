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
    // Round 11: the census counts crash markers with `refundError: { startsWith }`.
    case 'startsWith': return typeof actual === 'string' && actual.startsWith(String(expected))
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
    // ROUND-8 AUDIT FIX (P3): `id` used to be skipped unconditionally, so a guard such as
    // `id: { not: row.id }` was never evaluated. It is still skipped when it merely ADDRESSES the row
    // (a scalar, or a fixture without an id), and evaluated when it is an operator on a row that has one.
    if (field === 'id' && !(expected !== null && typeof expected === 'object' && 'id' in row)) continue
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
export function updateManyMock(fx: {
  row: Record<string, unknown> | null
  forcedCount?: number | null
  /**
   * Apply the write to the simulated row on a match.
   *
   * Off by default so existing suites keep their exact behaviour. Turn it ON when the code under
   * test performs a CHAIN of compare-and-sets, because a static row makes the second CAS fail for
   * a reason that has nothing to do with the logic being tested — the first write simply never
   * happened. With it on, the fixture behaves like a real row: guard, write, next guard.
   */
  applyWrites?: boolean
}) {
  return ({ where, data }: { where: Record<string, unknown>; data?: Record<string, unknown> }) => {
    const row = fx.row
    if (!row) return Promise.resolve({ count: fx.forcedCount ?? 1 })
    if (!matchWhere(where, row)) return Promise.resolve({ count: 0 })
    if (fx.applyWrites && data) Object.assign(row, data)
    return Promise.resolve({ count: fx.forcedCount ?? 1 })
  }
}
