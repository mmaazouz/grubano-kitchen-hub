import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureSupplierOperator } from '@/lib/supplier-account'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/supplier/approve ────────────────────────────────────────────────
// ADMIN-only. Approves a pending SupplierProfile (calque of the resto/créateur
// pending → active pattern; suppliers have no AI vetting, so approval is manual).
// Flips the profile to 'active' AND activates the passwordless Operator + grants
// the 'supplier' role to its SET (cumul-safe for an existing account). Body:
// { email } (the email used at registration). Idempotent.
//
// Slice-0 scope note: a dedicated admin review UI is a fast-follow; this route is
// the approval mechanism (an admin can call it; the founder approves new suppliers).

const bodySchema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
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

    const profile = await prisma.supplierProfile.findUnique({ where: { email } })
    if (!profile) {
      return NextResponse.json({ error: 'Fournisseur introuvable' }, { status: 404 })
    }

    if (profile.status !== 'active') {
      await prisma.supplierProfile.update({ where: { id: profile.id }, data: { status: 'active' } })
    }

    // Activate the login account + grant the supplier role (never clobbers a
    // non-supplier account that already owns this email — multi-role cumul).
    const bridge = await ensureSupplierOperator(
      profile.email,
      profile.contactName || profile.companyName,
      { activate: true },
    )

    // B1.3-B "collect once": propagate the entity's already-verified identity to the
    // shared account anchor (best-effort; no-op unless the profile is genuinely
    // verified). Reads the stored result only — verification + silo gating untouched.
    await propagateVerifiedCompanyIdentity({
      email:              profile.email,
      siren:              profile.siren,
      officialName:       profile.officialName,
      verificationStatus: profile.verificationStatus,
    })

    return NextResponse.json({ ok: true, status: 'active', bridge })
  } catch (err) {
    console.error('[POST /api/supplier/approve]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
