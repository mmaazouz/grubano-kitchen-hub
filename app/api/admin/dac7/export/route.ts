import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { aggregateDac7Year, toDac7Csv } from '@/lib/dac7'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/dac7/export?year=YYYY&format=csv|json (P4.4-C) ──────────────────
// ADMIN-ONLY structured DAC7 report for a calendar year. The aggregate carries the
// fiscal identity + per-quarter revenue of EVERY reportable seller → it must NEVER be
// reachable by a partner or a client (no IDOR). Session admin only (401/403). READ-ONLY
// (aggregates the ledger; moves/recomputes no money). NOT the official DGFiP XML.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const url = new URL(req.url)
  const yearParam = Number.parseInt(url.searchParams.get('year') ?? '', 10)
  const now = new Date()
  const year = Number.isInteger(yearParam) && yearParam >= 2020 && yearParam <= now.getUTCFullYear() + 1
    ? yearParam
    : now.getUTCFullYear() - 1 // default: last completed calendar year
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'

  try {
    const report = await aggregateDac7Year(year)
    if (format === 'csv') {
      return new NextResponse(toDac7Csv(report), {
        status: 200,
        headers: {
          'Content-Type':        'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="dac7-${year}.csv"`,
          'Cache-Control':       'private, no-store',
        },
      })
    }
    return new NextResponse(JSON.stringify(report, null, 2), {
      status: 200,
      headers: {
        'Content-Type':        'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="dac7-${year}.json"`,
        'Cache-Control':       'private, no-store',
      },
    })
  } catch (err) {
    console.error('[dac7 export]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
