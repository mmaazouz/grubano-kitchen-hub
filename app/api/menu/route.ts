import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { processDishImage, ALLOWED_IMAGE_TYPES } from '@/lib/dish-photo'

// ── Validation ────────────────────────────────────────────────────────────────

// Nullable optional fields use .nullish() (accepts undefined AND null), NOT
// .optional() (undefined only). The "Manuel" form posts these fields as `null`
// when left blank (newItem() seeds calories: null) — with .optional() that null
// was rejected by Zod → HTTP 400 → the dish was NEVER written to the DB and the
// client swallowed the error. The columns are nullable in Prisma, so null is a
// valid stored value here.
const createSchema = z.object({
  brandId:     z.string().min(1),
  name:        z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  price:       z.number().positive(),
  comparePrice:z.number().positive().nullish(),
  category:    z.string().min(1).max(50),
  calories:    z.number().int().positive().nullish(),
  allergens:   z.array(z.string()).default([]),
  labels:      z.array(z.string()).default([]),
  photos:      z.array(z.string()).default([]),
  options:     z.array(z.record(z.unknown())).default([]),
  available:   z.boolean().default(true),
  isPopular:   z.boolean().default(false),
  prepTime:    z.number().int().positive().nullish(),
  // Optional inline photo. When present the server moderates + uploads it and
  // sets photos=[url] at creation (atomic — never a photoless dish on failure).
  imageBase64: z.string().optional(),
  mediaType:   z.enum(ALLOWED_IMAGE_TYPES).optional(),
})

/** Resolve the calling operator from the session — null on any failure. */
async function callerOperator() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
}

const updateSchema = createSchema.partial().extend({ id: z.string() })

// ── GET /api/menu?brandId= ────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const brandId  = searchParams.get('brandId')
    const category = searchParams.get('category')

    const where: Record<string, unknown> = {}
    if (brandId)  where.brandId  = brandId
    if (category) where.category = category

    const items = await prisma.menuItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })

    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/menu ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // Owner-scope the creation: only an authenticated restaurant/admin can add a
    // dish, and only to a brand they own. The brandId comes from the body but is
    // VERIFIED against the session operator — never trusted blindly.
    const operator = await callerOperator()
    if (!operator) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await req.json()
    const { imageBase64, mediaType, ...data } = createSchema.parse(body)

    const brand = await prisma.brand.findFirst({
      where: operator.role === 'admin'
        ? { id: data.brandId }
        : { id: data.brandId, operatorId: operator.id },
      select: { id: true },
    })
    if (!brand) {
      return NextResponse.json({ error: 'Marque introuvable ou non autorisée' }, { status: 400 })
    }

    // Optional inline photo. Run the full chain (moderate → upload → square)
    // BEFORE creating the dish; on ANY failure return the error and DO NOT create
    // a photoless dish silently. On success photos = [square Cloudinary URL].
    let photos = data.photos
    let warnings: string[] = []
    if (imageBase64) {
      const result = await processDishImage(imageBase64, mediaType ?? 'image/jpeg')
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, ...(result.moderation ? { moderation: result.moderation } : {}) },
          { status: result.status },
        )
      }
      photos   = [result.url]
      warnings = result.warnings
    }

    const item = await prisma.menuItem.create({
      data: { ...data, photos } as unknown as Prisma.MenuItemUncheckedCreateInput,
    })

    return NextResponse.json({ item, warnings }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    // FK / record-not-found at the DB level → a client data problem, surface a
    // clean 400 instead of an opaque 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2025')) {
      return NextResponse.json({ error: 'Marque invalide — plat non créé.' }, { status: 400 })
    }
    console.error('[POST /api/menu]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PUT /api/menu ─────────────────────────────────────────────────────────────

export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { id, ...data } = updateSchema.parse(body)

    const item = await prisma.menuItem.update({
      where: { id },
      data:  data as unknown as Prisma.MenuItemUncheckedUpdateInput,
    })

    return NextResponse.json({ item })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/menu?id= ──────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    await prisma.menuItem.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
