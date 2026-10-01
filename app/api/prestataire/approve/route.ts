import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensurePrestataireOperator, isPrestataireEnabled } from '@/lib/prestataire-account'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire/approve — ADMIN-only (clone of /api/supplier/approve) ─
// Approves a pending PrestataireProfile: flips it to 'active' AND activates the
// passwordless Operator + grants the 'prestataire' role to its SET (cumul-safe). Body:
// { email }. Idempotent. Gates VISIBILITY only — NEVER money. 404 when the role flag is
// OFF (the role does not exist then). A dedicated admin review UI is a fast-follow.

const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  if (!isPrestataireEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  const isAdmin = user?.role === 'admin' || (Array.isArray(user?.roles) && user!.roles!.includes('admin'))
  if (!isAdmin) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    const profile = await prisma.prestataireProfile.findUnique({ where: { email } })
    if (!profile) {
      return NextResponse.json({ error: 'Prestataire introuvable' }, { status: 404 })
    }

    if (profile.status !== 'active') {
      await prisma.prestataireProfile.update({ where: { id: profile.id }, data: { status: 'active' } })
    }

    // Activate the login account + grant the prestataire role (never clobbers a
    // non-prestataire account that already owns this email — multi-role cumul).
    const bridge = await ensurePrestataireOperator(
      profile.email,
      profile.contactName || profile.companyName,
      { activate: true },
    )

    // "collect once": propagate the entity's already-verified identity to the shared
    // account anchor (best-effort; no-op unless the profile is genuinely verified).
    await propagateVerifiedCompanyIdentity({
      email:              profile.email,
      siren:              profile.siren,
      officialName:       profile.officialName,
      verificationStatus: profile.verificationStatus,
    })

    return NextResponse.json({ ok: true, status: 'active', bridge })
  } catch (err) {
    console.error('[POST /api/prestataire/approve]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
