import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computePartnerBalance, type PartnerBalance } from '@/lib/partner-balance'

export const dynamic = 'force-dynamic'

// ── GET /api/partner/balance — the SESSION partner's balance(s) (P4.2) ────────
// READ-ONLY. Returns earned / paid / available (cents) for each payable entity the
// connected partner owns, resolved ENTIRELY from the SESSION (creator + supplier
// by session email, restaurant(s) by the session operator id) — never a client id
// (no IDOR). 401 without a session. NO write, NO money movement (= P4.3).
//
// Franchise + logistics are intentionally omitted (their payable balance is not
// defined until P4.3 — see lib/partner-balance).

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const balances: Array<PartnerBalance & { name?: string }> = []

  // Creator (by session email).
  const creator = await prisma.creator.findUnique({ where: { email }, select: { id: true } })
  if (creator) balances.push(await computePartnerBalance('creator', creator.id))

  // Supplier (by session email).
  const supplier = await prisma.supplierProfile.findUnique({ where: { email }, select: { id: true } })
  if (supplier) balances.push(await computePartnerBalance('supplier', supplier.id))

  // Restaurant(s) owned by the session operator (one balance per establishment).
  if (operatorId) {
    const restaurants = await prisma.restaurant.findMany({
      where:  { operatorId, archivedAt: null },
      select: { id: true, name: true },
    })
    for (const r of restaurants) {
      const bal = await computePartnerBalance('restaurant', r.id)
      balances.push({ ...bal, name: r.name })
    }
  }

  return NextResponse.json({ balances })
}
