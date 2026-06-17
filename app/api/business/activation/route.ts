import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { readOperatorRoles } from '@/lib/operator-roles'
import {
  buildActivationChecklist,
  hasChecklistDefinition,
  type ChecklistSignals,
} from '@/lib/activation-checklist'

export const dynamic = 'force-dynamic'

/**
 * GET /api/business/activation
 *   → 401 if not signed in
 *   → 200 { ok, role, checklist } where checklist = the derived activation
 *     journey for the connected operator.
 *
 * READ-ONLY + OWNER-ONLY: the operator is resolved from the SESSION (email →
 * Operator), never from a client-supplied id, so there is no IDOR. It loads only
 * EXISTING signals (brand/restaurant/menu/Stripe status), computes the checklist
 * in memory via the pure engine, and returns it. No write, no payment logic, no
 * schema dependency. The checklist mirrors the SEC1 publication lock (no owner
 * publish action).
 *
 * v1 ships the 'restaurant' definition. A connected partner without the
 * restaurant role gets an empty (non-discovery) checklist — nothing to nag.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
    }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true, status: true, emailVerifiedAt: true },
    })
    if (!operator) {
      return NextResponse.json({ ok: false, error: 'Utilisateur introuvable' }, { status: 401 })
    }

    // Resolve which checklist to build. v1 = restaurateur: show it when the
    // operator actually holds the restaurant role (primary OR cumulative set),
    // mirroring /api/business/me which keys onboarding off the restaurant role.
    const roles = await readOperatorRoles(operator.id, operator.role)
    const role  = roles.includes('restaurant') ? 'restaurant' : operator.role

    // No definition for this role yet (e.g. a pure creator/supplier on the
    // dashboard) → empty, non-discovery checklist. Skip the resto-scoped reads.
    if (!hasChecklistDefinition(role)) {
      return NextResponse.json({
        ok: true,
        role,
        checklist: buildActivationChecklist(role, {
          accountActive: operator.status === 'active',
          hasBrand: false, hasRestaurant: false, menuItemCount: 0,
          isActive: false, stripeConnected: false, stripeStatus: null,
        }),
      })
    }

    // Restaurateur signals — existing fields only, owner-scoped.
    const [brand, restaurant, menuItemCount] = await Promise.all([
      prisma.brand.findFirst({ where: { operatorId: operator.id }, select: { id: true } }),
      prisma.restaurant.findFirst({
        where:  { operatorId: operator.id, archivedAt: null },
        select: { id: true, isActive: true, stripeAccountStatus: true },
      }),
      prisma.menuItem.count({ where: { brand: { operatorId: operator.id } } }),
    ])

    const signals: ChecklistSignals = {
      accountActive:   operator.status === 'active',
      emailVerified:   operator.emailVerifiedAt !== null,
      hasBrand:        brand !== null,
      hasRestaurant:   restaurant !== null,
      menuItemCount,
      isActive:        restaurant?.isActive ?? false,
      stripeConnected: restaurant?.stripeAccountStatus === 'active',
      stripeStatus:    restaurant?.stripeAccountStatus ?? null,
    }

    return NextResponse.json({
      ok: true,
      role,
      checklist: buildActivationChecklist(role, signals),
    })
  } catch (err) {
    console.error('[GET /api/business/activation]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
