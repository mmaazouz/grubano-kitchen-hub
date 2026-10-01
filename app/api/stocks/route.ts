import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

export const dynamic = 'force-dynamic'

// 🔒 SEC. This route had NO auth: GET read ANY brand's stock (IDOR via ?brandId=,
// or the WHOLE platform without it) and POST created/updated stock on ANY brandId
// with no session at all (unauthenticated write). Every handler now requires the
// connected restaurateur (restaurant/admin) and is fenced to brands they OWN.

/** The caller's own brand ids (empty when they own none). */
async function ownedBrandIds(operatorId: string): Promise<string[]> {
  const brands = await prisma.brand.findMany({ where: { operatorId }, select: { id: true } })
  return brands.map((b) => b.id)
}

// ── GET /api/stocks?brandId= ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status })
  }
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brandId') ?? undefined

  try {
    const owned = await ownedBrandIds(scope.operatorId)
    // A requested brandId must be one the caller owns; otherwise scope to ALL of
    // their brands. Either way the query can only ever return the operator's stock.
    const brandFilter =
      brandId !== undefined
        ? (owned.includes(brandId) ? { brandId } : { brandId: '__none__' })
        : { brandId: { in: owned } }

    const items = await prisma.stockItem.findMany({
      where:   brandFilter,
      orderBy: [{ brandId: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(items)
  } catch {
    return NextResponse.json([], { status: 200 })   // DB not ready → empty array
  }
}

// ── POST /api/stocks ──────────────────────────────────────────────────────────
const upsertSchema = z.object({
  id:           z.string().optional(),
  brandId:      z.string().min(1),
  name:         z.string().min(1, 'Nom requis'),
  quantity:     z.number().min(0),
  unit:         z.string().default('kg'),
  minThreshold: z.number().min(0).default(0),
  dlc:          z.string().datetime().optional().nullable(),
})

export async function POST(req: NextRequest) {
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status })
  }

  const body   = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
  }
  const { id, brandId, name, quantity, unit, minThreshold, dlc } = parsed.data

  try {
    const owned = await ownedBrandIds(scope.operatorId)
    // The target brand MUST belong to the caller (blocks cross-tenant writes).
    if (!owned.includes(brandId)) {
      return NextResponse.json({ error: 'Marque non autorisée' }, { status: 403 })
    }

    if (id) {
      // On update, the EXISTING row must also belong to one of the caller's brands
      // (an attacker can't move a foreign item under their own brandId).
      const existing = await prisma.stockItem.findUnique({ where: { id }, select: { brandId: true } })
      if (!existing) {
        return NextResponse.json({ error: 'Article introuvable' }, { status: 404 })
      }
      if (!owned.includes(existing.brandId)) {
        return NextResponse.json({ error: 'Article non autorisé' }, { status: 403 })
      }
      const item = await prisma.stockItem.update({
        where: { id },
        data:  { quantity, unit, minThreshold, dlc: dlc ? new Date(dlc) : null },
      })
      return NextResponse.json(item)
    }

    const item = await prisma.stockItem.create({
      data: { brandId, name, quantity, unit, minThreshold, dlc: dlc ? new Date(dlc) : null },
    })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
