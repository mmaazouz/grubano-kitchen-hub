import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { maybeRunPrestataireCoherenceCheck } from '@/lib/prestataire-coherence'

export const dynamic = 'force-dynamic'

// ── /api/prestataire/profile — self-service edit of the OWN profile (clone of P5a) ─
//
// GET   → the caller's own PrestataireProfile (operational fields + identity surfaced
//         READ-ONLY for display).
// PATCH → updates ONLY the OPERATIONAL fields of the caller's own profile.
//
// SECURITY (identical to the supplier profile route):
//   • OWNER-ONLY: the profile is always resolved from the SESSION e-mail — NEVER from a
//     client-supplied id → no IDOR.
//   • ROLE: a caller with no PrestataireProfile gets 403; 401 when unauthenticated.
//   • WHITELIST: the Zod schema lists ONLY operational service fields; zod strips unknown
//     keys, so any identity/vetting/payment/email/status field is SILENTLY IGNORED —
//     siren / officialName / verificationStatus / status / payout* / email can NEVER be
//     changed here (the register route + verifyBusiness are the sole writers of those).
//   • The whole role is gated by PRESTATAIRE_ENABLED → 404 when OFF.

const SERVICE_CATEGORIES = [
  'electricity', 'plumbing', 'haccp', 'cleaning', 'pest_control',
  'fridge_repair', 'kitchen_maintenance', 'accounting', 'training', 'other',
] as const
const MODALITIES = ['on_site', 'remote', 'both'] as const

// OPERATIONAL fields only. Unknown keys (incl. any identity field) are stripped, never
// written. companyName/contactName required; the rest tolerant.
const patchSchema = z.object({
  companyName:       z.string().min(2, 'Nom commercial trop court').max(120),
  contactName:       z.string().min(2, 'Nom du contact trop court').max(80),
  phone:             z.string().max(40).optional(),
  city:              z.string().max(80).optional(),
  serviceCategories: z.array(z.enum(SERVICE_CATEGORIES)).max(SERVICE_CATEGORIES.length).default([]),
  coverageZones:     z.array(z.string().min(1).max(80)).max(50).default([]),
  modality:          z.enum(MODALITIES).default('on_site'),
  indicativeRate:    z.string().max(500).optional(),
})

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  if (!isPrestataireEnabled()) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const p = await prisma.prestataireProfile.findUnique({ where: { email } })
    if (!p) return NextResponse.json({ ok: false, error: 'Profil prestataire introuvable' }, { status: 403 })

    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return NextResponse.json({
      ok: true,
      profile: {
        // editable
        companyName:       p.companyName,
        contactName:       p.contactName,
        phone:             p.phone ?? '',
        city:              p.city ?? '',
        serviceCategories: arr(p.serviceCategories),
        coverageZones:     arr(p.coverageZones),
        modality:          p.modality,
        indicativeRate:    p.indicativeRate ?? '',
        // locked (display only — never editable)
        siren:              p.siren ?? null,
        officialName:       p.officialName ?? null,
        verificationStatus: p.verificationStatus ?? null,
        status:             p.status,
      },
    })
  } catch (err) {
    console.error('[GET /api/prestataire/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  if (!isPrestataireEnabled()) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    // OWNER + ROLE gate: must already own a PrestataireProfile (resolved by session
    // e-mail). No client id is ever read → no IDOR. Non-prestataires have no profile.
    const existing = await prisma.prestataireProfile.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Profil prestataire introuvable' }, { status: 403 })

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // Build the update from WHITELISTED operational fields ONLY. Identity / vetting /
    // payment / email / status columns are never referenced here → impossible to mutate.
    await prisma.prestataireProfile.update({
      where: { email },
      data: {
        companyName:       d.companyName.trim(),
        contactName:       d.contactName.trim(),
        phone:             d.phone?.trim() || null,
        city:              d.city?.trim() || null,
        serviceCategories: d.serviceCategories,
        coverageZones:     d.coverageZones,
        modality:          d.modality,
        indicativeRate:    d.indicativeRate?.trim() || null,
      },
    })

    // Lean signup (Agent 112): saving the offer may complete the "ready to publish" transition
    // (offer filled + ≥1 service) → run the DEPLACED coherence check once. Best-effort +
    // idempotent + quota-safe: never throws, runs vetPrestataire at most once, only flips the
    // marketplace-visibility flag (never status/auth/money).
    await maybeRunPrestataireCoherenceCheck(existing.id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/prestataire/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
