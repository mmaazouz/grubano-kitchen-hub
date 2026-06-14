import { prisma } from '@/lib/prisma'

// ── Multi-role reader (Phase 1 refonte, Agent 14) ─────────────────────────────
//
// Returns the full role SET for an operator. The legacy single `Operator.role`
// column is KEPT as the PRIMARY role; this unions it with the OperatorRole rows.
//
// TOLERANT by design: before the OperatorRole table exists (pre-db-push) or on
// any DB error, the query throws and we fall back to JUST the primary role — so
// a mono-role account behaves byte-for-byte as before the migration. The primary
// `fallbackRole` is ALWAYS included (even alongside rows), so an un-backfilled or
// partially-backfilled operator can never lose access to its original role.

export async function readOperatorRoles(operatorId: string, fallbackRole: string): Promise<string[]> {
  // An EMPTY base could lock a user out. Operator.role is NOT NULL
  // (@default('restaurant')), but a legacy / hand-inserted NULL degrades to the
  // least-privileged 'consumer' rather than to an empty set.
  const base = fallbackRole && fallbackRole.trim() ? [fallbackRole] : ['consumer']
  try {
    const rows = await prisma.operatorRole.findMany({
      where:  { operatorId },
      select: { role: true },
    })
    const set = new Set<string>(base)
    for (const r of rows) if (r.role) set.add(r.role)
    return Array.from(set)
  } catch {
    // Table not migrated yet / DB error → primary role only (mono-role behaviour).
    return base
  }
}
