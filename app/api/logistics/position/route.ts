import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'
import { sweepStaleCourierPositions } from '@/lib/courier-position-sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/logistics/position — INERT position receiver (Géoloc ÉTAPE 2, RGPD-sensible) ───
// Stores the courier's SINGLE current point for ONE in-progress mission (last-point upsert, NO
// breadcrumb). This step only RECEIVES + STORES — it NEVER captures a position (courier-side
// capture = Étape 3) and NEVER reads a position back out to anyone (client map = Étape 4).
//
// A point is written ONLY when ALL of these hold (else the request is refused WITHOUT a write):
//   (1) LOGISTICS_TRACKING_ENABLED is ON  → OFF returns 404 BEFORE any DB access, so the table +
//       the trackingConsent column stay dormant (deploy-before-migration safe, byte-identical).
//   (2) the courier has opted in          → LogisticsProfile.trackingConsent === true.
//   (3) the mission is the courier's OWN  → mission.courierId === the session courier's id
//       (owner-scoped by session email → LogisticsProfile → no IDOR; never trusts a body id).
//   (4) the mission is IN COURSE          → status ∈ { accepted, picked_up } (not before
//       acceptance, not after the course ends).
// Rate-limited. The point is deleted the instant the mission ends (lib/courier-position, wired in
// the mission step-handler) — it never survives the course, never lives indefinitely.

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

// Body carries the last coordinates + the mission they belong to. lat/lng are range-checked
// (defense); accuracy (metres) is optional. NO identity field — the courier is ALWAYS the
// session, never the body (owner scope). No timestamp from the client either (server-stamped).
const bodySchema = z.object({
  missionId: z.string().min(1),
  lat:       z.number().min(-90).max(90),
  lng:       z.number().min(-180).max(180),
  accuracy:  z.number().min(0).optional(),
})

export async function POST(req: NextRequest) {
  try {
    // (1) Feature-gated FIRST — OFF → 404 BEFORE any DB access. The CourierPosition table and the
    // trackingConsent column are NEVER touched when OFF (safe deploy-before-migration, inert).
    if (!isLogisticsTrackingEnabled()) {
      return NextResponse.json({ ok: false, error: 'not_found', gated: true }, { status: 404 })
    }
    const limited = rateLimit(req, 'logistics_position', { limitDefault: 60, windowDefault: 60 })
    if (limited) return limited

    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Données invalides' }, { status: 400 })
    const { missionId, lat, lng, accuracy } = parsed.data

    // Owner scope — resolve the courier from the SESSION (never a body id). Read the opt-in here.
    const profile = await prisma.logisticsProfile.findUnique({
      where: { email }, select: { id: true, trackingConsent: true },
    })
    if (!profile) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    // (2) Opt-in REQUIRED — no explicit consent → refuse WITHOUT writing.
    if (!profile.trackingConsent) {
      return NextResponse.json({ ok: false, error: 'consent_required' }, { status: 403 })
    }

    // (3)+(4) The mission must be the courier's OWN and IN COURSE (accepted | picked_up).
    const mission = await prisma.mission.findUnique({
      where: { id: missionId }, select: { courierId: true, status: true },
    })
    // Not this courier's mission (or unknown) → 403. Never reveal or write another courier's data.
    if (!mission || mission.courierId !== profile.id) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
    }
    // Not in course (before acceptance, or already terminal) → refuse WITHOUT writing.
    if (mission.status !== 'accepted' && mission.status !== 'picked_up') {
      return NextResponse.json({ ok: false, error: 'not_in_course' }, { status: 409 })
    }

    // LAST-POINT UPSERT — a new ping REPLACES the previous point (no breadcrumb, no history).
    // Owner-scoped by the resolved profile.id + missionId (the @@unique target).
    await prisma.courierPosition.upsert({
      where:  { courierId_missionId: { courierId: profile.id, missionId } },
      create: { courierId: profile.id, missionId, lat, lng, accuracy: accuracy ?? null },
      update: { lat, lng, accuracy: accuracy ?? null },
    })
    // RGPD (Géoloc ÉTAPE 5) — opportunistic staleness sweep: any activity erases orphaned/stale
    // points past their TTL (belt-and-braces for the F1 residual, in addition to the cron). Cheap
    // (tiny table) + best-effort — never affects this write's response. This courier's just-written
    // point is fresh, so it is never swept.
    try {
      await sweepStaleCourierPositions()
    } catch (e) {
      console.error('[logistics position] stale sweep failed (write unaffected):', e instanceof Error ? e.message : e)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/logistics/position]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
