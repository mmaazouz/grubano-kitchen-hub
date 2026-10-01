import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'

// ── /api/menu/[id]/availability ───────────────────────────────────────────────
// Stock-out toggle for a single menu item. Operator-only.
//
// PATCH → flips MenuItem.available (true/false). Only the operator who owns the
//         brand the dish belongs to (or an admin) may toggle it. A dish with
//         available=false disappears from the orderable menu on /eat (the
//         consumer routes already filter `where: { available: true }`).
//
// NOTE (TODO, intentionally NOT built — out of scope per brief): a scheduled
// "jusqu'à demain" auto-reactivation. For now a plain boolean toggle suffices.

export const dynamic = 'force-dynamic'

const AvailabilityInput = z.object({
  available: z.boolean(),
})

// Confirm the session user owns the brand the menu item belongs to (or is
// admin). Returns the operator id on success, or a NextResponse to return.
async function authorize(menuItemId: string) {
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

  const menuItem = await prisma.menuItem.findUnique({
    where:  { id: menuItemId },
    select: { id: true, brand: { select: { operatorId: true } } },
  })
  if (!menuItem) {
    return { error: NextResponse.json({ error: 'Plat introuvable' }, { status: 404 }) }
  }

  const isOwner = menuItem.brand.operatorId === operator.id
  const isAdmin = operator.role === 'admin'
  // 404 (not 403) cross-tenant: don't confirm a foreign dish's existence (WP-SEC-02).
  if (!isOwner && !isAdmin) {
    return { error: NextResponse.json({ error: 'Plat introuvable' }, { status: 404 }) }
  }

  return { operatorId: operator.id }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await authorize(params.id)
    if ('error' in auth) return auth.error

    const json   = await req.json().catch(() => ({}))
    const parsed = AvailabilityInput.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Données invalides', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const menuItem = await prisma.menuItem.update({
      where:  { id: params.id },
      data:   { available: parsed.data.available },
      select: { id: true, name: true, available: true },
    })
    return NextResponse.json({ menuItem })
  } catch (err) {
    console.error('[menu availability PATCH]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
