import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// ── GET /api/tables ───────────────────────────────────────────────────────────

export async function GET() {
  try {
    const tables = await prisma.restaurantTable.findMany({
      where:   { active: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json({ tables })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/tables ──────────────────────────────────────────────────────────

const createSchema = z.object({
  name:  z.string().min(1).max(50),
  seats: z.number().int().min(1).max(30),
  x:     z.number().min(0).max(100).default(50),
  y:     z.number().min(0).max(100).default(50),
})

export async function POST(req: Request) {
  try {
    const body  = await req.json()
    const data  = createSchema.parse(body)
    const table = await prisma.restaurantTable.create({ data })
    return NextResponse.json({ table }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── DELETE /api/tables?id= ────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    await prisma.restaurantTable.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
