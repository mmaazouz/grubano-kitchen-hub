import { NextRequest, NextResponse } from 'next/server'
import { safeEqual } from '@/lib/safe-compare'
import { runGeolocRetentionSweep } from '@/lib/courier-position-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/logistics/positions/sweep — Géoloc ÉTAPE 5 — periodic RGPD retention sweep (cron). ──
// CRON_SECRET-protected (constant-time compare, fail-closed when the secret is unset — calque
// /api/email-agent). Runs the BOUNDED retention sweep: erase stale/orphaned CourierPosition rows
// (past their TTL — the F1 safety net) + anonymise client delivery coords on old terminal orders
// (R5). Each half is independently flag-gated → a no-op when its feature is OFF, so SCHEDULING this
// cron before activation is harmless (it just returns zero counts). Idempotent.

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? ''
  const auth = req.headers.get('authorization') ?? ''
  if (secret.length === 0 || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runGeolocRetentionSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[POST /api/logistics/positions/sweep]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
