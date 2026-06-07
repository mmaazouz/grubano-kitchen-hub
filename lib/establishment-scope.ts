// Server-only helper to resolve the caller's CURRENT establishment, owner-scoped.
//
// Chantier 2 (step 3): tables/reservations are scoped per establishment. Both the
// /api/tables and /api/reservations routes need the same resolution:
//   1. who is the connected operator (restaurant/admin) — 401/403 otherwise,
//   2. which of THEIR establishments are we acting on.
//
// Resolution order for (2):
//   • an EXPLICIT id (query param on GET, body field on writes) — but only if it
//     belongs to the caller; a foreign/unknown id is REJECTED (403), never
//     silently ignored (the lesson from the brand-by-city bug),
//   • otherwise the durable selected-establishment cookie (grubano_estab),
//   • otherwise the operator's OLDEST restaurant (pickEstablishment fallback).
// restaurantId is null only when the operator has no establishment at all.
//
// This module imports next/headers, so it is SERVER-ONLY — kept separate from the
// isomorphic lib/establishment.ts (which the client switcher imports).

import { cookies } from 'next/headers'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { ESTABLISHMENT_COOKIE, pickEstablishment } from '@/lib/establishment'

export type EstablishmentScope =
  | { ok: true; operatorId: string; role: string; ownedIds: string[]; restaurantId: string | null }
  | { ok: false; status: 401 | 403; error: string }

const ALLOWED_ROLES = ['restaurant', 'admin']

export async function resolveEstablishmentScope(
  explicit?: string | null,
): Promise<EstablishmentScope> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { ok: false, status: 401, error: 'Non autorisé' }
  }
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) {
    return { ok: false, status: 401, error: 'Non autorisé' }
  }
  if (!ALLOWED_ROLES.includes(operator.role)) {
    return { ok: false, status: 403, error: 'Accès refusé' }
  }

  const restaurants = await prisma.restaurant.findMany({
    where:   { operatorId: operator.id },
    orderBy: { createdAt: 'asc' },
    select:  { id: true },
  })
  const ownedIds = restaurants.map((r) => r.id)

  // Explicit target wins — but it MUST be one the caller owns.
  if (explicit) {
    if (!ownedIds.includes(explicit)) {
      return { ok: false, status: 403, error: 'Établissement non autorisé' }
    }
    return { ok: true, operatorId: operator.id, role: operator.role, ownedIds, restaurantId: explicit }
  }

  // Otherwise the selected-establishment cookie, falling back to the oldest.
  const current = pickEstablishment(restaurants, cookies().get(ESTABLISHMENT_COOKIE)?.value)
  return { ok: true, operatorId: operator.id, role: operator.role, ownedIds, restaurantId: current?.id ?? null }
}
