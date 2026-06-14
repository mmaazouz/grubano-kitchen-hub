import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildOrderLines } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

// ── POST /api/marketplace/orders — place a B2B supply order (resto side, Slice 2)
// A restaurateur submits a per-supplier cart → a SupplyOrder + immutable line
// SNAPSHOTS (price/name/unit captured from the catalogue AT ORDER TIME). Scoped:
// operatorId is the SESSION operator (never the body); items must belong to the
// (active) target supplier and be available. SEPARATE pipeline from B2C
// /api/orders — no loyalty / promo / referral / take-rate. Total = sum of lines.

async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
}

const orderSchema = z.object({
  supplierProfileId: z.string().min(1, 'Fournisseur requis'),
  lines: z.array(z.object({
    catalogItemId: z.string().min(1),
    quantity:      z.number().int().min(1).max(100000),
  })).min(1, 'Au moins un article requis'),
  notes:       z.string().max(1000).nullish(),
  desiredDate: z.string().datetime().nullish(),
})

export async function POST(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data = orderSchema.parse(await req.json())

    // The target supplier must exist AND be active (discovery only shows active).
    const supplier = await prisma.supplierProfile.findUnique({
      where:  { id: data.supplierProfileId },
      select: { id: true, status: true, minimumOrderCents: true },
    })
    if (!supplier || supplier.status !== 'active') {
      return NextResponse.json({ error: 'Fournisseur indisponible' }, { status: 400 })
    }

    // Fetch the referenced items SCOPED to this supplier + available, then snapshot.
    const items = await prisma.supplierCatalogItem.findMany({
      where:  { id: { in: data.lines.map((l) => l.catalogItemId) }, supplierProfileId: supplier.id, available: true },
      select: { id: true, name: true, unit: true, priceCents: true, available: true },
    })
    const built = buildOrderLines(items, data.lines)
    if (!built.ok) return NextResponse.json({ error: built.error ?? 'Articles invalides' }, { status: 400 })

    // Enforce the supplier's minimum order SERVER-SIDE (the UI also guards it, but a
    // direct API call must not be able to bypass the business rule).
    if (built.totalCents < supplier.minimumOrderCents) {
      return NextResponse.json(
        { error: 'Commande inférieure au minimum du fournisseur', minimumOrderCents: supplier.minimumOrderCents },
        { status: 400 },
      )
    }

    const order = await prisma.supplyOrder.create({
      data: {
        operatorId:        operator.id, // ← from the SESSION, never the body
        supplierProfileId: supplier.id,
        status:            'placed',
        totalCents:        built.totalCents,
        notes:             data.notes ?? null,
        desiredDate:       data.desiredDate ? new Date(data.desiredDate) : null,
        lines: { createMany: { data: built.lines } },
      },
      select: { id: true, status: true, totalCents: true },
    })

    return NextResponse.json({ order }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/marketplace/orders]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
