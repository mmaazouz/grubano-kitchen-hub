import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { maybeRunSupplierCoherenceCheck } from '@/lib/supplier-coherence'

export const dynamic = 'force-dynamic'

// ── /api/supplier/profile — self-service edit of the OWN supplier profile (P5a) ─
//
// GET   → the caller's own SupplierProfile (operational fields + a few identity
//         fields surfaced READ-ONLY for display).
// PATCH → updates ONLY the OPERATIONAL fields of the caller's own profile.
//
// SECURITY:
//   • OWNER-ONLY: the profile is always resolved from the SESSION e-mail — NEVER
//     from a client-supplied id. There is no way to address another supplier's row
//     → no IDOR. The update targets `where: { email }` (the session e-mail).
//   • ROLE: a caller with no SupplierProfile for their session e-mail gets 403 (not
//     a supplier). 401 when unauthenticated.
//   • WHITELIST: the Zod schema lists ONLY operational fields; zod strips unknown
//     keys, so any identity/vetting/payment/email field in the body is SILENTLY
//     IGNORED and the write object is built solely from the parsed operational
//     fields — siren / officialName / verificationStatus / status / verifiedAt /
//     payout* / email can NEVER be changed here (changing them would bypass the
//     official-registry verification). The register route + verifyBusiness are the
//     sole writers of those.
//   • VALIDATION mirrors POST /api/supplier/register (same enums / bounds).

// Mirrors the register route's CATEGORIES (kept in sync with the supplier.cat* i18n).
const CATEGORIES = ['fresh', 'meat', 'fish', 'dairy', 'drinks', 'grocery', 'packaging'] as const

// OPERATIONAL fields only. NOT strict → unknown keys (incl. any identity field) are
// stripped, never written. companyName/contactName required; the rest tolerant.
const patchSchema = z.object({
  companyName:     z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:     z.string().min(2, 'Nom du contact trop court').max(80),
  phone:           z.string().max(40).optional(),
  city:            z.string().max(80).optional(),
  categories:      z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).default([]),
  deliveryZones:   z.array(z.string().min(1).max(80)).max(50).default([]),
  minimumOrderEur: z.number().min(0).max(100000).default(0),
  leadTimeDays:    z.number().int().min(0).max(60).default(1),
  paymentTerms:    z.string().max(500).optional(),
})

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const p = await prisma.supplierProfile.findUnique({ where: { email } })
    if (!p) return NextResponse.json({ ok: false, error: 'Profil fournisseur introuvable' }, { status: 403 })

    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return NextResponse.json({
      ok: true,
      profile: {
        // editable
        companyName:     p.companyName,
        contactName:     p.contactName,
        phone:           p.phone ?? '',
        city:            p.city ?? '',
        categories:      arr(p.categories),
        deliveryZones:   arr(p.deliveryZones),
        minimumOrderEur: (p.minimumOrderCents ?? 0) / 100,
        leadTimeDays:    p.leadTimeDays,
        paymentTerms:    p.paymentTerms ?? '',
        // locked (display only — never editable)
        siren:              p.siren ?? null,
        officialName:       p.officialName ?? null,
        verificationStatus: p.verificationStatus ?? null,
        status:             p.status,
      },
    })
  } catch (err) {
    console.error('[GET /api/supplier/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    // OWNER + ROLE gate: must already own a SupplierProfile (resolved by session
    // e-mail). No client id is ever read → no IDOR. Non-suppliers have no profile.
    const existing = await prisma.supplierProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Profil fournisseur introuvable' }, { status: 403 })

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // Build the update from WHITELISTED operational fields ONLY. Identity / vetting /
    // payment / email columns are never referenced here → impossible to mutate.
    await prisma.supplierProfile.update({
      where: { email },
      data: {
        companyName:       d.companyName.trim(),
        contactName:       d.contactName.trim(),
        phone:             d.phone?.trim() || null,
        city:              d.city?.trim() || null,
        categories:        d.categories,
        deliveryZones:     d.deliveryZones,
        minimumOrderCents: Math.round(d.minimumOrderEur * 100),
        leadTimeDays:      d.leadTimeDays,
        paymentTerms:      d.paymentTerms?.trim() || null,
      },
    })

    // Lean signup étape 2 (Agent 111): saving the offer may complete the "ready to publish"
    // transition (offer filled + ≥1 catalogue item) → run the DEPLACED coherence check once.
    // Best-effort + idempotent + quota-safe: never throws, runs vetSupplier at most once,
    // only flips the marketplace-visibility flag (never status/auth/money).
    await maybeRunSupplierCoherenceCheck(existing.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/supplier/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
