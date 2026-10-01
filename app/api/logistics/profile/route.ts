import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const dynamic = 'force-dynamic'

// ── /api/logistics/profile — self-service edit of the OWN courier profile (P5a) ─
// Calqued 1:1 on /api/supplier/profile. Same OWNER-ONLY (session e-mail, no client
// id → no IDOR), ROLE (no LogisticsProfile → 403), WHITELIST (operational only,
// identity/vetting/email stripped & never written) and VALIDATION (mirrors POST
// /api/logistics/register) guarantees.

const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const

// OPERATIONAL fields only. NOT strict → identity keys in the body are stripped.
const patchSchema = z.object({
  partnerType:  z.enum(['independent', 'company']),
  contactName:  z.string().min(2, 'Nom du contact trop court').max(80),
  contactPhone: z.string().max(40).optional(),
  missionTypes: z.array(z.enum(MISSION_TYPES)).min(1, 'Choisissez au moins un type de mission').max(MISSION_TYPES.length),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1, 'Choisissez au moins un véhicule').max(VEHICLE_TYPES.length),
  zones:        z.array(z.string().min(1).max(80)).max(50).default([]),
})

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const p = await prisma.logisticsProfile.findUnique({ where: { email } })
    if (!p) return NextResponse.json({ ok: false, error: 'Profil logistique introuvable' }, { status: 403 })

    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return NextResponse.json({
      ok: true,
      profile: {
        // editable
        partnerType:  p.partnerType,
        contactName:  p.contactName,
        contactPhone: p.contactPhone ?? '',
        missionTypes: arr(p.missionTypes),
        vehicleTypes: arr(p.vehicleTypes),
        zones:        arr(p.zones),
        // locked (display only — never editable)
        siren:              p.siren ?? null,
        officialName:       p.officialName ?? null,
        verificationStatus: p.verificationStatus ?? null,
        status:             p.status,
      },
    })
  } catch (err) {
    console.error('[GET /api/logistics/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const existing = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Profil logistique introuvable' }, { status: 403 })

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // WHITELISTED operational fields ONLY — identity / vetting / email never touched.
    await prisma.logisticsProfile.update({
      where: { email },
      data: {
        partnerType:  d.partnerType,
        contactName:  d.contactName.trim(),
        contactPhone: d.contactPhone?.trim() || null,
        missionTypes: d.missionTypes,
        vehicleTypes: d.vehicleTypes,
        zones:        d.zones,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/logistics/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
