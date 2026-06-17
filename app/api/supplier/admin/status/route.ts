import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureSupplierOperator } from '@/lib/supplier-account'
import { propagateVerifiedCompanyIdentity } from '@/lib/identity-propagation'

export const dynamic = 'force-dynamic'

// ── POST /api/supplier/admin/status ───────────────────────────────────────────
// ADMIN-only. Sets a supplier's BUSINESS status. This is the moderation lever for
// the auto-onboarding flow + the SUSPEND capability:
//   active     → visible in discovery + can receive new orders; also activates the
//                passwordless Operator and grafts the 'supplier' role (cumul-safe).
//   suspended  → hidden from discovery (where:{status:'active'}) + new orders refused
//                + PAYMENT blocked (the B2B pay route requires status==='active').
//   rejected   → kept out of the marketplace (same effect as suspended for visibility).
//   pending    → back to the manual-review queue.
//
// SAFETY: business status only — it gates VISIBILITY/catalogue, NEVER money. Payouts
// stay independently hard-gated by Stripe Connect KYB (payoutStatus). Idempotent.
// We never DEMOTE the Operator login here (suspending the business hides the catalogue
// and blocks payment; magic-link sign-in already refuses suspended Operators if the
// founder later suspends the account too — out of scope, noted).

const bodySchema = z.object({
  email:  z.string().email(),
  status: z.enum(['active', 'suspended', 'rejected', 'pending']),
})

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
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const email  = parsed.data.email.trim().toLowerCase()
    const status = parsed.data.status

    const profile = await prisma.supplierProfile.findUnique({ where: { email } })
    if (!profile) {
      return NextResponse.json({ error: 'Fournisseur introuvable' }, { status: 404 })
    }

    if (profile.status !== status) {
      await prisma.supplierProfile.update({ where: { id: profile.id }, data: { status } })
    }

    // Activating also provisions/activates the passwordless login + grants the
    // 'supplier' role (never clobbers a non-supplier account that owns this email).
    let bridge: unknown = null
    if (status === 'active') {
      bridge = await ensureSupplierOperator(
        profile.email,
        profile.contactName || profile.companyName,
        { activate: true },
      )
      // B1.3-B "collect once": propagate the verified identity to the account anchor
      // (best-effort; no-op unless the profile is genuinely verified). An admin force-
      // activating a 'review' profile therefore does NOT mark the account 'verified'.
      await propagateVerifiedCompanyIdentity({
        email:              profile.email,
        siren:              profile.siren,
        officialName:       profile.officialName,
        verificationStatus: profile.verificationStatus,
      })
    }

    return NextResponse.json({ ok: true, status, bridge })
  } catch (err) {
    console.error('[POST /api/supplier/admin/status]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
