import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'

// ── Admin gate — shared resolver for the admin console (CD ADM2+). ────────────────
// Defence in depth alongside middleware's /admin gate: resolve the connected operator
// from the SESSION (never a client id) and confirm the role SET includes 'admin'.
// Returns the admin operator (with name/email for the shell identity) or null. The
// caller decides the response — a page redirects, an API returns 403.

export interface AdminOperator {
  id: string
  role: string
  name: string | null
  email: string
}

export async function resolveAdmin(): Promise<AdminOperator | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const operator = await prisma.operator
    .findUnique({ where: { email: session.user.email }, select: { id: true, role: true, name: true, email: true } })
    .catch(() => null)
  if (!operator) return null
  const roles = await readOperatorRoles(operator.id, operator.role)
  return roles.includes('admin') ? operator : null
}
