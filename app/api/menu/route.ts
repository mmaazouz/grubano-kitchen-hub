import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

// ── Validation ────────────────────────────────────────────────────────────────

const createSchema = z.object({
  brandId:     z.string(),
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  price:       z.number().positive(),
  comparePrice:z.number().positive().optional(),
  category:    z.string().min(1).max(50),
  calories:    z.number().int().positive().optional(),
  allergens:   z.array(z.string()).default([]),
  labels:      z.array(z.string()).default([]),
  photos:      z.array(z.string()).default([]),
  options:     z.array(z.record(z.unknown())).default([]),
  available:   z.boolean().default(true),
  isPopular:   z.boolean().default(false),
  prepTime:    z.number().int().positive().optional(),
})

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
    const body = await req.json()
    const data = createSchema.parse(body)

    const item = await prisma.menuItem.create({
      data: data as unknown as Prisma.MenuItemUncheckedCreateInput,
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
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
