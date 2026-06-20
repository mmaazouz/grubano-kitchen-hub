import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensurePrestataireOperator, isPrestataireEnabled } from '@/lib/prestataire-account'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire/admin/status — ADMIN-only (clone of supplier admin) ──
// Sets a prestataire's BUSINESS status (active|suspended|rejected|pending). On 'active'
// it also activates the passwordless Operator + grafts the 'prestataire' role (cumul-
// safe). SAFETY: business status only — it gates VISIBILITY, NEVER money (no payout is
// even wired in P1). Idempotent. 404 when the role flag is OFF.

const bodySchema = z.object({
  email:  z.string().email(),
  status: z.enum(['active', 'suspended', 'rejected', 'pending']),
})

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
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const email  = parsed.data.email.trim().toLowerCase()
    const status = parsed.data.status

    const profile = await prisma.prestataireProfile.findUnique({ where: { email } })
    if (!profile) {
      return NextResponse.json({ error: 'Prestataire introuvable' }, { status: 404 })
    }

    if (profile.status !== status) {
      await prisma.prestataireProfile.update({ where: { id: profile.id }, data: { status } })
    }

    // Activating also provisions/activates the passwordless login + grants the
    // 'prestataire' role (never clobbers a non-prestataire account that owns this email).
    let bridge: unknown = null
    if (status === 'active') {
      bridge = await ensurePrestataireOperator(
        profile.email,
        profile.contactName || profile.companyName,
        { activate: true },
      )
      await propagateVerifiedCompanyIdentity({
        email:              profile.email,
        siren:              profile.siren,
        officialName:       profile.officialName,
        verificationStatus: profile.verificationStatus,
      })
    }

    return NextResponse.json({ ok: true, status, bridge })
  } catch (err) {
    console.error('[POST /api/prestataire/admin/status]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
