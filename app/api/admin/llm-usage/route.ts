import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUsageOverview } from '@/lib/llm'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/llm-usage — per-partner LLM usage overview (step 2, Agent 14) ─
// ADMIN-only, READ-ONLY. Reads the LlmUsage metering table: per-operator estimated
// cost for the current day + month, the configured quota, and remaining budget
// (busiest partners first). Visibility for cost governance; gates nothing.
export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  const isAdmin = user?.role === 'admin' || (Array.isArray(user?.roles) && user!.roles!.includes('admin'))
  if (!isAdmin) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const overview = await getUsageOverview()
    return NextResponse.json(overview)
  } catch (err) {
    console.error('[GET /api/admin/llm-usage]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
