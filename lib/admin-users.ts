import { prisma } from '@/lib/prisma'

// ── Admin users (Operators) — read-only, cross-operator (CD ADM4). ────────────────
// PII-sensitive: admin-only (the caller gates), no export, READ-ONLY. Roles are the
// REAL SET (Operator.role ∪ OperatorRole rows) so a multi-role account shows every
// role. HONEST OMISSIONS (SIGNAL): no suspension anywhere (no mechanism writes
// status='suspended') → no « Suspendu » pill/chip/stat; the status pill reflects the
// real Operator.status (active / pending). Counts are by PRIMARY role (Operator.role).

const CAP = 200

export interface AdminUserRow {
  id: string
  name: string
  email: string
  roles: string[]
  status: 'active' | 'pending'
  createdAt: string
}

export interface AdminUsersList {
  rows: AdminUserRow[]
  stats: { total: number; new30: number; restaurateurs: number; suppliers: number }
  capped: boolean
}

export async function listAdminUsers(): Promise<AdminUsersList> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [rowsRaw, total, new30, restaurateurs, suppliers] = await Promise.all([
    prisma.operator.findMany({
      orderBy: { createdAt: 'desc' },
      take:    CAP,
      select:  {
        id: true, name: true, email: true, role: true, status: true, createdAt: true,
        operatorRoles: { select: { role: true } },
      },
    }),
    prisma.operator.count(),
    prisma.operator.count({ where: { createdAt: { gte: since } } }),
    prisma.operator.count({ where: { role: 'restaurant' } }),
    prisma.operator.count({ where: { role: 'supplier' } }),
  ])

  const rows: AdminUserRow[] = rowsRaw.map((o) => {
    const set = new Set<string>()
    if (o.role) set.add(o.role)
    for (const r of o.operatorRoles) if (r.role) set.add(r.role)
    return {
      id: o.id,
      name: o.name,
      email: o.email,
      roles: Array.from(set),
      // suspended is never written (no mechanism) → treated as active per the
      // deferred-suspension decision; pending/pending_review → « En attente ».
      status: o.status === 'pending' || o.status === 'pending_review' ? 'pending' : 'active',
      createdAt: o.createdAt.toISOString(),
    }
  })

  return { rows, stats: { total, new30, restaurateurs, suppliers }, capped: total > CAP }
}
