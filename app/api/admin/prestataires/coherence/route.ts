import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/prestataires/coherence — ADMIN clears the visibility gate (Agent 112, D2) ──
// Calque of /api/admin/suppliers/coherence. The lean-signup coherence check
// (lib/prestataire-coherence) keeps a fresh prestataire HIDDEN (marketplaceCoherencePending=true)
// until it passes; a 'doubt'/'bad' verdict leaves it pending for human review. This is the admin
// override: an admin reviews such a prestataire and APPROVES it → marketplaceCoherencePending=false
// (visible). 404 when the role flag is OFF (the role does not exist), then ADMIN-only (401/403),
// idempotent, ONE-DIRECTIONAL (clear only). NON-money, NON-status: it flips ONLY the visibility
// flag — never status / auth / payouts.

function isAdmin(user: { role?: string; roles?: string[] } | undefined): boolean {
  return !!user && (user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin')))
}

const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const limited = rateLimit(req, 'admin_prestataire_coherence', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; email?: string; role?: string; roles?: string[] } | undefined
  if (!user)          return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    const profile = await prisma.prestataireProfile.findUnique({
      where:  { email },
      select: { id: true, marketplaceCoherencePending: true },
    })
    if (!profile) return NextResponse.json({ error: 'Prestataire introuvable' }, { status: 404 })

    // Idempotent: only write when actually pending (clear → visible).
    if (profile.marketplaceCoherencePending) {
      await prisma.prestataireProfile.update({
        where: { id: profile.id },
        data:  { marketplaceCoherencePending: false },
      })
    }

    await recordAdminAudit({
      actorId:    user.id ?? '',
      actorEmail: user.email ?? null,
      action:     'prestataire.coherence',
      targetType: 'prestataire',
      targetId:   email,
      metadata:   {},
      req,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/admin/prestataires/coherence]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
