import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { decidePublication } from '@/lib/publication-rule'

// ── /api/restaurants/[id]/pause ───────────────────────────────────────────────
// Pause / resume a restaurant. Operator-only.
//
// PATCH → flips Restaurant.isActive. When isActive=false the restaurant stops
//         appearing in the consumer listing and can no longer take new orders:
//         /api/restaurants (GET) already filters `where: { isActive: true }`,
//         so a paused restaurant is hidden from /eat with no extra work here.
//
// Only the owning operator (or an admin) may pause their own restaurant.

export const dynamic = 'force-dynamic'

const PauseInput = z.object({
  // isActive=false → paused (not taking orders). isActive=true → live.
  isActive: z.boolean(),
})

// Confirm the session user owns the restaurant (or is admin). Returns the
// operator id on success, or a NextResponse to return immediately.
async function authorize(restaurantId: string) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }) }
  }

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { error: NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 401 }) }
  }

  const restaurant = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { operatorId: true, isActive: true, approvedAt: true },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }

  const isOwner = restaurant.operatorId === operator.id
  const isAdmin = operator.role === 'admin'
  if (!isOwner && !isAdmin) {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }

  return { operatorId: operator.id, isAdmin, currentIsActive: restaurant.isActive, approvedAt: restaurant.approvedAt }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const json   = await req.json().catch(() => ({}))
    const parsed = PauseInput.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    // ── 🔒 SEC1/SEC2 — publication rule (approvedAt) ──────────────────────────
    // Single tested decision (lib/publication-rule). The SEC1 invariant holds: an
    // owner can resume an ALREADY-approved resto (approvedAt!=null) but can NEVER
    // bring a never-approved one online — the first go-live is admin-only (the
    // approval console). Going offline always works; a live-but-unstamped resto
    // going offline stamps approvedAt so the owner can resume it later (pause-
    // capture). Visibility on /eat stays gated by isActive ONLY (unchanged).
    const decision = decidePublication({
      isAdmin:         auth.isAdmin,
      requested:       parsed.data.isActive,
      currentIsActive: auth.currentIsActive,
      approvedAt:      auth.approvedAt,
    })
    if (decision.rejected) {
      return NextResponse.json(
        { error: "La première mise en ligne de l'établissement doit être validée par un administrateur." },
        { status: 403 },
      )
    }

    const restaurant = await prisma.restaurant.update({
      where:  { id: params.id },
      data:   {
        isActive: decision.setIsActive,
        ...(decision.stampApprovedAt ? { approvedAt: new Date() } : {}),
      },
      select: { id: true, name: true, isActive: true },
    })
    return NextResponse.json({ restaurant })
  } catch (err) {
    console.error('[restaurant pause PATCH]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
