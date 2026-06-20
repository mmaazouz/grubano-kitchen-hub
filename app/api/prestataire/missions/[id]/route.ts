import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled, callerPrestataireProfile } from '@/lib/prestataire-account'
import { canTransitionMission } from '@/lib/service-mission'

export const dynamic = 'force-dynamic'

// ── PATCH /api/prestataire/missions/[id] — prestataire advances a mission (P3) ──
// CLONE of /api/supplier/orders/[id]. The PRESTATAIRE (seller) QUOTES a requested mission
// ('quoted' + amount/description/proposed date), DECLINES a request, or marks an accepted
// mission DONE — only on ITS OWN missions (session + ownership), only via VALID transitions
// (lib/service-mission PRESTATAIRE_TRANSITIONS). 404 when PRESTATAIRE_ENABLED is OFF.
// ⚠️ NO money: quoteAmountCents is stored DATA, only displayed — never charged. No
// commission / payout / Connect is computed or moved (payment = P6).

const bodySchema = z.object({
  status:           z.enum(['quoted', 'declined', 'done']),
  quoteAmountCents: z.number().int().min(0).max(100_000_000).nullish(),
  quoteDescription: z.string().trim().max(2000).nullish(),
  proposedDate:     z.string().datetime().nullish(),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })

    const data = bodySchema.parse(await req.json())

    const mission = await prisma.serviceMission.findUnique({
      where: { id: params.id }, select: { prestataireProfileId: true, status: true },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
    if (mission.prestataireProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    if (!canTransitionMission('prestataire', mission.status, data.status)) {
      return NextResponse.json({ error: 'Transition invalide' }, { status: 409 })
    }

    const patch: { status: string; quoteAmountCents?: number; quoteDescription?: string | null; proposedDate?: Date | null } =
      { status: data.status }
    if (data.status === 'quoted') {
      // A quote MUST carry an amount + a description (the resto decides on these).
      if (data.quoteAmountCents == null || !data.quoteDescription) {
        return NextResponse.json({ error: 'Montant et description du devis requis' }, { status: 400 })
      }
      patch.quoteAmountCents  = data.quoteAmountCents   // ← DATA only; never charged (no money moves)
      patch.quoteDescription  = data.quoteDescription
      patch.proposedDate      = data.proposedDate ? new Date(data.proposedDate) : null
    }

    const updated = await prisma.serviceMission.update({
      where: { id: params.id }, data: patch,
      select: { id: true, status: true, quoteAmountCents: true, quoteDescription: true, proposedDate: true },
    })
    return NextResponse.json({ ok: true, mission: updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/prestataire/missions/[id]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
