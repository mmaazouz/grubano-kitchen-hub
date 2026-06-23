import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCourierActivationEnabled, ensureLogisticsOperator } from '@/lib/logistics-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/logistics/activation — ADMIN verifies a courier's justificatifs and
// ACTIVATES the account (Agent 125). This is the HUMAN-supervised activation (doc §8 / EU
// dir. 2024).
//
// ⚠️⚠️ GUARDRAIL — the Agent-72 waitlist remains the master switch. This action is a STRICT
// NO-OP unless LOGISTICS_COURIER_ACTIVATION_ENABLED is ON. In production (flag OFF) NO courier
// can be activated, full stop. Defence in depth: (1) this route refuses up-front when the flag
// is OFF; (2) ensureLogisticsOperator ALSO re-checks the flag (logistics-account.ts:132) so the
// login/role grant is impossible regardless. We do NOT flip the flag, do NOT bypass the
// chokepoint. NO money (no payout/commission/Connect — that rail is HELD).

function isAdmin(user: { role?: string; roles?: string[] } | undefined): boolean {
  return !!user && (user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin')))
}

const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user)          return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  // ⭐ MASTER GUARDRAIL: activation is impossible while the waitlist flag is OFF.
  if (!isCourierActivationEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'Activation des livreurs désactivée (liste d’attente).', reason: 'activation_disabled' },
      { status: 409 },
    )
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const email = parsed.data.email.trim().toLowerCase()

    const profile = await prisma.logisticsProfile.findUnique({
      where:  { email },
      select: { id: true, status: true, contactName: true, justificatifsStatus: true },
    })
    if (!profile) return NextResponse.json({ error: 'Livreur introuvable' }, { status: 404 })

    // Compliance: cannot activate without a submitted declaration (or an already-verified one).
    if (profile.justificatifsStatus !== 'submitted' && profile.justificatifsStatus !== 'verified') {
      return NextResponse.json({ ok: false, error: 'Justificatifs non soumis', reason: 'no_justificatifs' }, { status: 400 })
    }

    // Mark verified + activate the profile. (The flag is ON here — checked above.)
    await prisma.logisticsProfile.update({
      where: { id: profile.id },
      data: {
        justificatifsStatus:    'verified',
        justificatifsVerifiedAt: new Date(),
        status:                 'active',
        verifiedAt:             new Date(),
      },
    })

    // Flip the passwordless login to active + graft the 'logistics' role — via the SINGLE
    // chokepoint, which re-checks the flag (belt-and-suspenders; impossible if OFF).
    await ensureLogisticsOperator(email, profile.contactName, { activate: true })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/admin/logistics/activation]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
