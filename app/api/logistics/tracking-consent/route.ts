import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/logistics/tracking-consent — courier OPT-IN to live position tracking (Géoloc ÉTAPE 3) ─
//   GET   → { enabled } (the LOGISTICS_TRACKING_ENABLED flag), + { consent } when enabled.
//   PATCH → set trackingConsent (+ stamp trackingConsentAt). Body { consent: boolean }. REVOCABLE
//           (consent:false retire l'accord). Explicit, never on by default.
// OWNER-SCOPED: the courier is resolved from the SESSION email → LogisticsProfile (never a client
// id → no IDOR). GATED: when the flag is OFF (default), GET returns { enabled:false } WITHOUT
// reading trackingConsent and PATCH is 404 WITHOUT writing — so the column is never touched
// (deploy-before-migration safe). Rate-limited on the write.
//
// NB: setting consent here does NOT capture a position — capture is client-side (watchPosition,
// only during an in-course mission) and the /api/logistics/position receiver re-checks consent
// server-side. This endpoint only records the courier's decision.

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // OFF → do NOT read trackingConsent (the column may not exist pre-migration) → gated, inert.
  if (!isLogisticsTrackingEnabled()) {
    return NextResponse.json({ enabled: false })
  }
  const p = await prisma.logisticsProfile.findUnique({ where: { email }, select: { trackingConsent: true } })
  if (!p) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })
  return NextResponse.json({ enabled: true, consent: p.trackingConsent })
}

const patchSchema = z.object({ consent: z.boolean() })

export async function PATCH(req: NextRequest) {
  try {
    // Feature-gated: OFF → the opt-in is not active → never write the column.
    if (!isLogisticsTrackingEnabled()) {
      return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
    }
    const limited = rateLimit(req, 'logistics_tracking_consent', { limitDefault: 30, windowDefault: 60 })
    if (limited) return limited

    const email = await sessionEmail()
    if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const existing = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

    // Owner-scoped write (by session email). Stamp trackingConsentAt on EVERY change (grant or
    // revoke) — the timestamp of the last consent decision, for the RGPD accountability trail.
    const updated = await prisma.logisticsProfile.update({
      where: { email },
      data: { trackingConsent: parsed.data.consent, trackingConsentAt: new Date() },
      select: { trackingConsent: true },
    })
    return NextResponse.json({ ok: true, consent: updated.trackingConsent })
  } catch (err) {
    console.error('[PATCH /api/logistics/tracking-consent]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
