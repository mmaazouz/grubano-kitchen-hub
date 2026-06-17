import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

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
    select: { operatorId: true },
  })
  if (!restaurant) {
    return { error: NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 }) }
  }

  const isOwner = restaurant.operatorId === operator.id
  const isAdmin = operator.role === 'admin'
  if (!isOwner && !isAdmin) {
    return { error: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  }

  return { operatorId: operator.id, isAdmin }
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

    // ── 🔒 SEC1 — bringing an establishment ONLINE is admin-only ──────────────
    // Setting isActive:true is the publication / re-publication of the restaurant
    // (it becomes visible on /eat). That is a moderation decision reserved to
    // admins. An owner MAY pause / unpublish their own restaurant (true→false)
    // but cannot publish or re-publish it (→true) — that requires an admin.
    // Mirrors the whitelist in PATCH /api/restaurants/[id].
    if (parsed.data.isActive === true && !auth.isAdmin) {
      return NextResponse.json(
        { error: "La mise en ligne de l'établissement doit être validée par un administrateur." },
        { status: 403 },
      )
    }

    const restaurant = await prisma.restaurant.update({
      where:  { id: params.id },
      data:   { isActive: parsed.data.isActive },
      select: { id: true, name: true, isActive: true },
    })
    return NextResponse.json({ restaurant })
  } catch (err) {
    console.error('[restaurant pause PATCH]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
