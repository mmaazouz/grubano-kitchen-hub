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
