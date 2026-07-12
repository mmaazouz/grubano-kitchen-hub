import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/suppliers — ADMIN supplier moderation console (Agent 85) ──────
// READ-ONLY list of every SupplierProfile with its business status + the stored
// vetting / registry-verification VERDICT (displayed, NEVER recomputed here).
// ADMIN-only, with the SAME guard as /api/admin/influencer-verifications (session
// role/roles, 401 then 403). Optional ?status= filter.
//
// Activate / suspend is the EXISTING admin route POST /api/supplier/admin/status
// (admin-only, idempotent, BUSINESS-STATUS only — never money). This route only
// READS profiles → 100% off the money path: it imports NO payment/Connect/payout
// lib and selects NO Stripe/Connect/payout field (payouts stay hard-gated by KYB).

function isAdmin(user: { role?: string; roles?: string[] } | undefined): boolean {
  return !!user && (user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin')))
}

const VALID_STATUS = ['pending', 'active', 'suspended', 'rejected'] as const

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user)          return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const statusParam = new URL(req.url).searchParams.get('status')
  const where = statusParam && (VALID_STATUS as readonly string[]).includes(statusParam)
    ? { status: statusParam }
    : {}

  const suppliers = await prisma.supplierProfile.findMany({
    where,
    // pending first (action needed), then most recently registered.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id:                 true,
      email:              true,
      companyName:        true,
      contactName:        true,
      city:               true,
      status:             true,
      // marketplace visibility gate (Agent 111) — surfaces the coherence review queue.
      marketplaceCoherencePending: true,
      // the stored verdicts — DISPLAYED, not recomputed.
      vettingVerdict:     true,
      vettingReason:      true,
      vettingAt:          true,
      verificationStatus: true,
      siren:              true,
      officialName:       true,
      createdAt:          true,
    },
  })

  return NextResponse.json({ ok: true, suppliers })
}
