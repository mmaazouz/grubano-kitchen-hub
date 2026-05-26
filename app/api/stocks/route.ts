import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// ── GET /api/stocks?brandId= ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brandId') ?? undefined

  try {
    const items = await prisma.stockItem.findMany({
      where:   brandId ? { brandId } : undefined,
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
  const body   = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 },
    )
  }

  const { id, brandId, name, quantity, unit, minThreshold, dlc } = parsed.data

  try {
    if (id) {
      const item = await prisma.stockItem.update({
        where: { id },
        data:  { quantity, unit, minThreshold, dlc: dlc ? new Date(dlc) : null },
      })
      return NextResponse.json(item)
    } else {
      const item = await prisma.stockItem.create({
        data: { brandId, name, quantity, unit, minThreshold, dlc: dlc ? new Date(dlc) : null },
      })
      return NextResponse.json(item, { status: 201 })
    }
  } catch {
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
