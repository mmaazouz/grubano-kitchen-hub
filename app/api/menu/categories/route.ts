import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

// Reads the session → never statically prerendered.
export const dynamic = 'force-dynamic'

// ── /api/menu/categories ──────────────────────────────────────────────────────
// Owner-scoped CRUD for a brand's CUSTOM menu categories. The 4 built-in defaults
// (Entrées / Plats / Desserts / Boissons) are front-end constants — they are NOT
// stored, cannot be created/renamed/deleted here, and the front adds them on top.
// MenuItem.category stays free text; deleting a custom category reclassifies that
// brand's dishes to "Non classé" (a dedicated, retro-compatible value).

// Names that can never be a custom category (the 4 defaults + the orphan sentinel).
const UNCLASSIFIED = 'Non classé'
const RESERVED = ['Entrées', 'Plats', 'Desserts', 'Boissons', UNCLASSIFIED]
// Combining-diacritics range (U+0300–U+036F), built from an ASCII string so the
// source stays ASCII. Strips accents so "ENTRÉES" / "entrees" can't shadow a default.
const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g')
const norm = (s: string) => s.normalize('NFD').replace(COMBINING, '').trim().toLowerCase()
const RESERVED_NORM = new Set(RESERVED.map(norm))

const ALLOWED_ROLES = ['restaurant', 'admin']

async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
}

/** True if the caller owns the brand (admin bypass). */
async function ownsBrand(operator: { id: string; role: string }, brandId: string) {
  const brand = await prisma.brand.findFirst({
    where: operator.role === 'admin' ? { id: brandId } : { id: brandId, operatorId: operator.id },
    select: { id: true },
  })
  return brand !== null
}

// ── GET /api/menu/categories?brandId= ─────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const brandId = new URL(req.url).searchParams.get('brandId')
    if (!brandId) return NextResponse.json({ error: 'brandId requis' }, { status: 400 })
    if (!(await ownsBrand(operator, brandId))) {
      return NextResponse.json({ error: 'Marque non autorisée' }, { status: 403 })
    }

    const categories = await prisma.category.findMany({
      where:   { brandId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select:  { id: true, name: true, position: true },
    })
    return NextResponse.json({ categories })
  } catch (err) {
    console.error('[GET /api/menu/categories]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/menu/categories ─────────────────────────────────────────────────
const createSchema = z.object({
  brandId:  z.string().min(1),
  name:     z.string().trim().min(1).max(50),
  position: z.number().int().min(0).optional(),
})

export async function POST(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { brandId, name, position } = createSchema.parse(await req.json())
    if (!(await ownsBrand(operator, brandId))) {
      return NextResponse.json({ error: 'Marque non autorisée' }, { status: 403 })
    }
    if (RESERVED_NORM.has(norm(name))) {
      return NextResponse.json(
        { error: 'Cette catégorie est un défaut et existe déjà.' },
        { status: 400 },
      )
    }

    try {
      const category = await prisma.category.create({
        data:   { brandId, name, position: position ?? 0 },
        select: { id: true, name: true, position: true },
      })
      return NextResponse.json({ category }, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'Cette catégorie existe déjà.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/menu/categories]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// Shared: fetch a category + its owning operator, enforcing ownership.
async function authorizeCategory(operator: { id: string; role: string }, id: string) {
  const existing = await prisma.category.findUnique({
    where:  { id },
    select: { id: true, name: true, brandId: true, brand: { select: { operatorId: true } } },
  })
  if (!existing) return { error: NextResponse.json({ error: 'Catégorie introuvable' }, { status: 404 }) }
  if (operator.role !== 'admin' && existing.brand.operatorId !== operator.id) {
    return { error: NextResponse.json({ error: 'Catégorie non autorisée' }, { status: 403 }) }
  }
  return { existing }
}

// ── PATCH /api/menu/categories (rename) ───────────────────────────────────────
const patchSchema = z.object({
  id:   z.string().min(1),
  name: z.string().trim().min(1).max(50),
})

export async function PATCH(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const { id, name } = patchSchema.parse(await req.json())
    const auth = await authorizeCategory(operator, id)
    if ('error' in auth) return auth.error
    if (RESERVED_NORM.has(norm(name))) {
      return NextResponse.json(
        { error: 'Cette catégorie est un défaut et existe déjà.' },
        { status: 400 },
      )
    }

    try {
      // Rename the category AND carry its dishes (same brand, old name → new name)
      // so renaming never orphans a dish from its category.
      const [category] = await prisma.$transaction([
        prisma.category.update({
          where:  { id },
          data:   { name },
          select: { id: true, name: true, position: true },
        }),
        prisma.menuItem.updateMany({
          where: { brandId: auth.existing.brandId, category: auth.existing.name },
          data:  { category: name },
        }),
      ])
      return NextResponse.json({ category })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'Cette catégorie existe déjà.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/menu/categories]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/menu/categories?id= ───────────────────────────────────────────
export async function DELETE(req: Request) {
  try {
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!ALLOWED_ROLES.includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const auth = await authorizeCategory(operator, id)
    if ('error' in auth) return auth.error

    // Reclassify this brand's dishes that used the category to "Non classé",
    // then delete the category — atomic, no block, no orphan.
    await prisma.$transaction([
      prisma.menuItem.updateMany({
        where: { brandId: auth.existing.brandId, category: auth.existing.name },
        data:  { category: UNCLASSIFIED },
      }),
      prisma.category.delete({ where: { id } }),
    ])
    return NextResponse.json({ success: true, reclassifiedTo: UNCLASSIFIED })
  } catch (err) {
    console.error('[DELETE /api/menu/categories]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
