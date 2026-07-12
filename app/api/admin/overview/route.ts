import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { computeAdminOverview } from '@/lib/admin-overview'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/overview — platform KPIs, READ-ONLY, cross-operator (ADM1) ────
// Admin-only. Session → operator → role SET (readOperatorRoles) must include 'admin'.
// Returns the same aggregate the /admin index renders SSR. Moves no money, writes
// nothing; every figure is a count or a SUM of stored LedgerEntry cents.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const operator = await prisma.operator
    .findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
    .catch(() => null)
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const overview = await computeAdminOverview()
  return NextResponse.json({ overview })
}
