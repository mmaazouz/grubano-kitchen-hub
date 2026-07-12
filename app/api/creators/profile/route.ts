import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ── /api/creators/profile — self-service edit of the OWN creator profile (P5b) ─
//
// Same contract as the P5a partner-profile routes (/api/supplier/profile,
// /api/logistics/profile):
//   GET   → the caller's own Creator (editable display fields + identity/verified/
//           roles surfaced READ-ONLY for display).
//   PATCH → updates ONLY the editable PROFILE/DISPLAY fields of the caller's own row.
//
// SECURITY:
//   • OWNER-ONLY: the row is always resolved from the SESSION e-mail (Creator.email
//     is @unique) — NEVER from a client-supplied id. update targets where:{ email }
//     → no IDOR.
//   • ROLE: 401 if unauthenticated; 403 if the session e-mail has no Creator row.
//   • WHITELIST: the Zod schema lists ONLY the editable profile fields; zod strips
//     unknown keys and the Prisma `data` is built field-by-field, so locked fields
//     in the body are IGNORED and never written:
//       - youtube  (the VERIFIED channel — changing it would need re-verification)
//       - verified (verification status)        - isChef / isInfluencer (ROLES)
//       - email (login)  - totalEarnings / referralCode / referralLinkSlug (payment
//         / payout / attribution — out of scope; this route NEVER touches money).
//   • VALIDATION mirrors POST /api/creators/apply (name ≥ 2, bio ≥ 10, optional
//     socials). The apply route + the YouTube verification are NOT modified.

const patchSchema = z.object({
  name:      z.string().min(2, 'Nom trop court').max(80),
  bio:       z.string().min(10, 'Bio trop courte (10 caractères minimum)').max(2000),
  instagram: z.string().max(120).optional(),
  tiktok:    z.string().max(120).optional(),
})

async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.email ?? null
}

export async function GET() {
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    // Defence in depth: SELECT only the fields we expose — the payout / attribution
    // columns (totalEarnings, referralCode, referralLinkSlug, followers) and the
    // login e-mail are never even loaded, so they can never accidentally leak.
    const c = await prisma.creator.findUnique({
      where:  { email },
      select: { name: true, bio: true, instagram: true, tiktok: true, youtube: true, verified: true, isChef: true, isInfluencer: true, email: true },
    })
    if (!c) return NextResponse.json({ ok: false, error: 'Profil créateur introuvable' }, { status: 403 })

    return NextResponse.json({
      ok: true,
      profile: {
        // editable
        name:      c.name,
        bio:       c.bio ?? '',
        instagram: c.instagram ?? '',
        tiktok:    c.tiktok ?? '',
        // locked (display only — never editable)
        youtube:      c.youtube ?? null,
        verified:     c.verified,
        isChef:       c.isChef,
        isInfluencer: c.isInfluencer,
        // OWN e-mail, READ-ONLY (display of the account login identity — no leak,
        // no money; the PATCH whitelist never includes email → still immutable).
        email:        c.email,
      },
    })
  } catch (err) {
    console.error('[GET /api/creators/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const email = await sessionEmail()
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    // OWNER + ROLE gate: must already own a Creator row (resolved by session e-mail).
    // No client id is ever read → no IDOR. A non-creator has no row → 403.
    const existing = await prisma.creator.findUnique({ where: { email }, select: { id: true } })
    if (!existing) return NextResponse.json({ ok: false, error: 'Profil créateur introuvable' }, { status: 403 })

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    const d = parsed.data

    // WHITELISTED display fields ONLY. youtube / verified / isChef / isInfluencer /
    // email / totalEarnings / referralCode / referralLinkSlug are never referenced
    // here → impossible to mutate the verified channel, roles, login or payout data.
    await prisma.creator.update({
      where: { email },
      data: {
        name:      d.name.trim(),
        bio:       d.bio.trim(),
        instagram: d.instagram?.trim() || null,
        tiktok:    d.tiktok?.trim() || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/creators/profile]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
