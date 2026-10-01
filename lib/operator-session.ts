import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// ── Session-scoped operator resolver (marketplace Slice 2/3, Agent 14) ────────
// Resolves the connected restaurateur from the SESSION email (never a client id),
// so marketplace routes scope every read/write to operator.id. Returns null when
// there is no session. Mirrors lib/supplier-account.callerSupplierProfile for the
// supplier side. Server-only (imports next-auth) — never imported by a client page.
export async function callerOperator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator
    .findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
    .catch(() => null)
}

// Same resolver, but returns the FULL role set (Operator.role + OperatorRole rows)
// so callers can scope on a multi-role account. Used by the /customers screens to
// build the ScopedOperator for lib/customer-scope. Returns null when no session.
export async function callerScopedOperator(): Promise<{ id: string; roles: string[] } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const operator = await prisma.operator
    .findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true, operatorRoles: { select: { role: true } } },
    })
    .catch(() => null)
  if (!operator) return null
  return {
    id:    operator.id,
    roles: Array.from(new Set([operator.role, ...operator.operatorRoles.map((r) => r.role)])),
  }
}
