import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles } from '@/lib/creator-roles'

// ── PATCH /api/creators/me/roles — self-service role toggles (Mission 2) ──────
//
// The creator flips their own Chef / Influencer flags from the studio. Rules:
//   - identity by session email → Creator row (the established pattern —
//     Operator.role is never touched, point dur B),
//   - AT LEAST ONE role stays active (400 with a clear message otherwise),
//   - flags only MASK/DISABLE behaviour (the /ref gate, studio sections):
//     no referralCode is ever destroyed.
// Pre-migration window: the UPDATE throws on a missing column → explicit 503
// (feature being deployed) rather than a misleading généric error.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  isChef:       z.boolean().optional(),
  isInfluencer: z.boolean().optional(),
})

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
    }
    const creator = await prisma.creator.findUnique({
      where:  { email: session.user.email },
      select: { id: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 404 })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }

    // Merge the request over the current flags (tolerant read).
    const current = await readCreatorRoles(creator.id)
    const next = {
      isChef:       parsed.data.isChef       ?? current.isChef,
      isInfluencer: parsed.data.isInfluencer ?? current.isInfluencer,
    }
    if (!next.isChef && !next.isInfluencer) {
      return NextResponse.json(
        { error: 'Au moins un rôle doit rester actif — activez Chef créateur ou Influenceur.' },
        { status: 400 },
      )
    }

    try {
      await prisma.creator.update({
        where: { id: creator.id },
        data:  { isChef: next.isChef, isInfluencer: next.isInfluencer },
      })
    } catch (e) {
      // Missing column (deploy before db push) → explicit, retryable.
      console.error('[PATCH /api/creators/me/roles] update failed', e instanceof Error ? e.message : e)
      return NextResponse.json(
        { error: 'Fonctionnalité en cours de déploiement — réessayez dans quelques minutes.' },
        { status: 503 },
      )
    }

    return NextResponse.json({ roles: next })
  } catch (err) {
    console.error('[PATCH /api/creators/me/roles]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
