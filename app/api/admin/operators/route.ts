import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listAdminUsers } from '@/lib/admin-users'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/operators — users list, READ-ONLY, cross-operator (ADM4). ──────
// PII-sensitive → strict admin-only (resolveAdmin), no export. Returns the same list +
// real stat counts the /admin/users index renders SSR. Nothing is written.
export async function GET() {
  const admin = await resolveAdmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const data = await listAdminUsers()
  return NextResponse.json(data)
}
