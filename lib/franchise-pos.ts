import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readOperatorRoles } from '@/lib/operator-roles'

// ── Franchise points-of-sale CRUD — shared owner-scope gate (B3, Agent 44) ───────
//
// A PointOfSale belongs to the FRANCHISOR Operator (PointOfSale.franchiseId). All
// /api/franchise/pos handlers resolve the franchisor from the SESSION operator id
// (session.user.id — NEVER a client value → no IDOR) and require the 'franchise'
// role (primary role ∪ OperatorRole set). The resolved operatorId is the ONLY
// franchiseId the handlers ever read or write — a franchisor can never touch another
// franchisor's POS, nor link a restaurant/brand that is not its own (validated in the
// handlers). This brick is STRUCTURE-only: it writes PointOfSale rows + the
// Restaurant↔POS link, and NEVER touches orders, payment, royalties or the dashboard.

export type FranchiseGate =
  | { ok: false; status: 401 | 403 }
  | { ok: true; operatorId: string }

/** Resolve the signed-in operator from the SESSION and require the 'franchise' role. */
export async function gateFranchise(): Promise<FranchiseGate> {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: string } | undefined)?.id
  if (!id) return { ok: false, status: 401 }
  const op = await prisma.operator.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!op) return { ok: false, status: 403 }
  const roles = await readOperatorRoles(op.id, op.role)
  if (!roles.includes('franchise')) return { ok: false, status: 403 }
  return { ok: true, operatorId: op.id }
}
