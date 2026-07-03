import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listAdminRestaurants } from '@/lib/admin-establishments'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/restaurants — establishments list, READ-ONLY, cross-operator (ADM2)
// Admin-only (resolveAdmin). Returns the same list + real stat counts the /admin/
// establishments index renders SSR. No money moves, nothing is written.
export async function GET() {
  const admin = await resolveAdmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const data = await listAdminRestaurants()
  return NextResponse.json(data)
}
