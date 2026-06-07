import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { z } from 'zod'

// Reads the session/cookie → never statically prerendered.
export const dynamic = 'force-dynamic'

// ── GET /api/tables ───────────────────────────────────────────────────────────
// Owner-scoped: only the tables of the caller's CURRENT establishment (explicit
// ?restaurantId= if owned, else the selected-establishment cookie, else oldest).
// A dark kitchen (no establishment / no table) returns an empty list.

export async function GET(req: Request) {
  try {
    const explicit = new URL(req.url).searchParams.get('restaurantId')
    const scope = await resolveEstablishmentScope(explicit)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    if (!scope.restaurantId) {
      // Operator has no establishment yet → no tables to show.
      return NextResponse.json({ tables: [] })
    }

    const tables = await prisma.restaurantTable.findMany({
      where:   { active: true, restaurantId: scope.restaurantId },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ tables })
  } catch (err) {
    console.error('[GET /api/tables]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/tables ──────────────────────────────────────────────────────────
// Creates a table ON the selected establishment. restaurantId comes from the
// CURRENT establishment (explicit body id if owned, else cookie/oldest) — never
// resolved by city or a silent default (the brand-bug lesson).

const createSchema = z.object({
  name:         z.string().min(1).max(50),
  seats:        z.number().int().min(1).max(30),
  x:            z.number().min(0).max(100).default(50),
  y:            z.number().min(0).max(100).default(50),
  // Optional explicit target establishment; verified against the caller below.
  restaurantId: z.string().min(1).optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { restaurantId: bodyRestaurantId, ...data } = createSchema.parse(body)

    const scope = await resolveEstablishmentScope(bodyRestaurantId ?? null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    if (!scope.restaurantId) {
      return NextResponse.json(
        { error: 'Sélectionnez un établissement avant de créer une table.' },
        { status: 400 },
      )
    }

    const table = await prisma.restaurantTable.create({
      data: { ...data, restaurantId: scope.restaurantId },
    })
    return NextResponse.json({ table }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/tables]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/tables?id= ────────────────────────────────────────────────────
// Soft-delete (active=false). Owner-scoped: the table must belong to one of the
// caller's establishments.

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const table = await prisma.restaurantTable.findUnique({
      where:  { id },
      select: { restaurantId: true },
    })
    if (!table) {
      return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    }
    // A scoped table must belong to the caller. A legacy NULL-restaurantId table
    // (pre-backfill) is allowed through for backward compatibility.
    if (table.restaurantId && !scope.ownedIds.includes(table.restaurantId)) {
      return NextResponse.json({ error: 'Table non autorisée' }, { status: 403 })
    }

    await prisma.restaurantTable.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tables]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
