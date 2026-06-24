import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPartnerStatusEmail } from '@/lib/transactional-emails'

export const dynamic = 'force-dynamic'

// ── POST /api/admin/restaurants/[id]/approve ──────────────────────────────────
// ADMIN-only approval / first publication of an establishment (B2.4 / SEC2). This
// is the ONLY way a never-approved restaurant comes online (the SEC1 invariant:
// an owner can never self-publish a never-approved resto — lib/publication-rule).
//
// On approval: isActive=true, status='published', and approvedAt=now IF it was
// still null. Stamping approvedAt is what later lets the OWNER resume the resto
// after pausing it (the publication rule treats approvedAt!=null as "approved").
// Idempotent: re-approving an already-approved/live resto is a safe no-op (we keep
// the original approvedAt — never re-stamp).
//
// Authorization is from the SESSION only (mirror of POST /api/franchise/approve):
// 401 without a session, 403 if signed in but not an admin — BEFORE any read or
// write. The [id] only SELECTS the target; it never grants authority (no IDOR).
//
// Visibility on /eat stays gated by isActive ONLY (unchanged) — this route flips
// isActive through the admin path, it does not touch the listing filter.

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where:  { id: params.id },
      select: { id: true, approvedAt: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 })
    }

    const updated = await prisma.restaurant.update({
      where: { id: params.id },
      data:  {
        isActive: true,
        status:   'published',
        // Stamp the approval only on first approval — idempotent re-approval keeps
        // the original timestamp.
        ...(restaurant.approvedAt == null ? { approvedAt: new Date() } : {}),
      },
      select: { id: true, name: true, isActive: true, approvedAt: true, status: true },
    })

    // Email B4 (Agent 144) — notify the owner their establishment is validated. POST-success,
    // BEST-EFFORT (never blocks the response); idempotent via sendOnce (partner_validated, resto:<id>)
    // → one validation email per restaurant even if re-approved. No money touched.
    try {
      const owner = await prisma.restaurant.findUnique({
        where:  { id: params.id },
        select: { name: true, operator: { select: { email: true, name: true } } },
      })
      const ownerEmail = owner?.operator?.email
      if (ownerEmail) {
        await sendPartnerStatusEmail({
          role:        'restaurant',
          status:      'validated',
          to:          ownerEmail,
          partnerName: owner?.operator?.name ?? owner?.name ?? 'partenaire',
          dedupeScope: `resto:${params.id}`,
        })
      }
    } catch (e) {
      console.error('[EMAIL MISS] [admin/restaurants/approve] partner email failed (non-fatal):',
        params.id, e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ ok: true, restaurant: updated })
  } catch (err) {
    console.error('[POST /api/admin/restaurants/[id]/approve]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
