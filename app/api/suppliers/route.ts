import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// ── GET /api/suppliers ────────────────────────────────────────────────────────

export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy:  { name: 'asc' },
      include:  { products: { orderBy: { name: 'asc' } } },
    })
    return NextResponse.json({ suppliers })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/suppliers ───────────────────────────────────────────────────────

const createSchema = z.object({
  name:       z.string().min(1).max(100),
  specialty:  z.string().optional(),
  zone:       z.string().optional(),
  leadTime:   z.string().default('24h'),
  minOrder:   z.number().min(0).default(0),
  phone:      z.string().optional(),
  email:      z.string().email().optional(),
  apiEnabled: z.boolean().default(false),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = createSchema.parse(body)
    const supplier = await prisma.supplier.create({ data })
    return NextResponse.json({ supplier }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
