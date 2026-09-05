import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { getStripe } from '@/lib/stripe'
import { rateLimit } from '@/lib/rate-limit'
import { safeEqual } from '@/lib/safe-compare'
import { reconcileLedger, resolveWindow } from '@/lib/ledger-check-core'

// ── GET /api/admin/ledger/check?from=&to= ─────────────────────────────────────
// THE incoherence detector n°1 (rail A3 + A5). The reconciliation itself lives in
// lib/ledger-check-core.js (PURE, shared with the server-side read-only operator);
// this file is ONLY the HTTP wrapper: rate limit → auth → window → core → JSON.
// Response: { ok, internalOk, reconciliationOk, refundsOk, ledgerCount, stripeCount,
//             ledgerSum, stripeSum, refunds, aggregates, ecarts } — ok:true only when
//             everything matches. Financial data, read-only.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  // Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_ledger_check', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  try {
    // ── Auth (A6, ADDITIVE machine access) — UNCHANGED CONTRACT ───────────────
    // Two ways in, in order:
    //   1. X-Internal-Token: a fixed-string header that, when it matches
    //      INTERNAL_CRON_TOKEN (read from process.env AT REQUEST TIME, trimmed),
    //      opens the route to the cron probe without a session. The token MUST be
    //      set as an env var AND be non-empty — anything else falls through to the
    //      session gate (no accidental open-to-the-world if the env is mis-configured).
    //      The header value is compared RAW (no "Bearer" prefix, no trim, case-sensitive)
    //      in constant time.
    //   2. Otherwise, the original operator session gate: ADMIN ONLY (platform-wide
    //      financials — a restaurateur reads their OWN finances via the owner-scoped
    //      /api/restaurants/[id]/finance/*).
    const internalToken    = req.headers.get('x-internal-token')
    const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
    const isInternal =
      internalExpected.length > 0 &&
      typeof internalToken === 'string' &&
      safeEqual(internalToken, internalExpected) // ADM7: constant-time

    if (!isInternal) {
      const session = await getServerSession(authOptions)
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
      }
      const operator = await prisma.operator.findUnique({
        where:  { email: session.user.email },
        select: { role: true },
      })
      // 🔒 SEC: ADMIN ONLY (see above).
      if (!operator || operator.role !== 'admin') {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
    }

    const { searchParams } = new URL(req.url)
    const win = resolveWindow(searchParams.get('from'), searchParams.get('to'))
    if (win.error !== undefined || !win.from || !win.to) {
      return NextResponse.json({ error: win.error ?? 'Période invalide (from/to ISO, from < to)' }, { status: 400 })
    }

    const result = await reconcileLedger({ prisma, stripe: getStripe(), from: win.from, to: win.to })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'stripe_not_configured') {
      return NextResponse.json({ error: 'Paiement non configuré.' }, { status: 500 })
    }
    console.error('[ledger check]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
