import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listAdminLedger } from '@/lib/admin-ledger'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/ledger?days=7|30|90 — accounting journal, READ-ONLY (ADM5 🔒). ─
// Admin-only (resolveAdmin). Returns the accurate period decomposition (golden
// equation) + the capped rows the /admin/payments screen renders. Nothing is written;
// no money movement is possible from here.
export async function GET(req: Request) {
  const admin = await resolveAdmin()
  if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const days = new URL(req.url).searchParams.get('days') ?? '30'
  return NextResponse.json(await listAdminLedger(days))
}
