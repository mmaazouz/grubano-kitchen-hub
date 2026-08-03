import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { isLogisticsAvailabilityEnabled } from '@/lib/logistics-availability'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/logistics/availability — courier « en ligne / disponible » toggle (Géoloc ÉTAPE 1) ─
// A simple ON/OFF availability boolean — ZÉRO géolocalisation (no position, no GPS, no map).
//   GET   → { enabled } (the LOGISTICS_AVAILABILITY_ENABLED flag), + { isOnline } when enabled.
//   PATCH → set isOnline (+ a lastSeenAt heartbeat). Body carries ONLY { isOnline: boolean }.
// OWNER-SCOPED: the courier is resolved from the SESSION email → LogisticsProfile (never a
// client id → no IDOR). GATED: when the flag is OFF (default), GET returns { enabled:false }
// WITHOUT reading isOnline, and PATCH is 404 WITHOUT writing — so the two new columns are never
// touched (deploy-before-migration is safe). Rate-limited on the write.

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // OFF → do NOT read isOnline (the column may not exist pre-migration) → byte-identical, gated.
  if (!isLogisticsAvailabilityEnabled()) {
    return NextResponse.json({ enabled: false })
  }
  const p = await prisma.logisticsProfile.findUnique({ where: { email }, select: { isOnline: true } })
  if (!p) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })
  return NextResponse.json({ enabled: true, isOnline: p.isOnline })
}

const patchSchema = z.object({ isOnline: z.boolean() })

export async function PATCH(req: NextRequest) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // Feature-gated: OFF → the toggle is not active → never write the new columns.
    if (!isLogisticsAvailabilityEnabled()) {
      return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
    }
    const limited = rateLimit(req, 'logistics_availability', { limitDefault: 30, windowDefault: 60 })
    if (limited) return limited

    const email = await sessionEmail()
    if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const existing = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })

    const parsed = patchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

    // Owner-scoped write (by session email) — set the switch + stamp the heartbeat.
    const updated = await prisma.logisticsProfile.update({
      where: { email },
      data:  { isOnline: parsed.data.isOnline, lastSeenAt: new Date() },
      select: { isOnline: true },
    })
    return NextResponse.json({ ok: true, isOnline: updated.isOnline })
  } catch (err) {
    console.error('[PATCH /api/logistics/availability]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
