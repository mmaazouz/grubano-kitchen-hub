import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

// ── Validation ────────────────────────────────────────────────────────────────

const createSchema = z.object({
  tableId:      z.string(),
  customerName: z.string().min(1).max(100),
  phone:        z.string().optional(),
  email:        z.string().email().optional(),
  guests:       z.number().int().min(1).max(30),
  date:         z.string().datetime(),
  endTime:      z.string().datetime(),
  type:         z.enum(['quick', 'standard', 'full']).default('standard'),
  allergies:    z.array(z.string()).default([]),
  preOrder:     z.array(z.unknown()).default([]),
  depositAmount:z.number().min(0).default(0),
  noShowPenalty:z.number().min(0).default(0),
  notes:        z.string().max(500).optional(),
})

const patchSchema = z.object({
  id:      z.string(),
  status:  z.enum(['confirmed', 'arrived', 'overrun', 'cancelled', 'noshow']).optional(),
  depositPaid: z.boolean().optional(),
})

// ── GET /api/reservations?date= ──────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date')

    let where: Record<string, unknown> = {}

    if (dateStr) {
      const day   = new Date(dateStr)
      day.setHours(0, 0, 0, 0)
      const next  = new Date(day)
      next.setDate(day.getDate() + 1)
      where = { date: { gte: day, lt: next } }
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: { table: true },
      orderBy: { date: 'asc' },
    })

    return NextResponse.json({ reservations })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/reservations ────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    // Check table availability
    const conflict = await prisma.reservation.findFirst({
      where: {
        tableId: data.tableId,
        status:  { notIn: ['cancelled', 'noshow'] },
        date:    { lt: new Date(data.endTime) },
        endTime: { gt: new Date(data.date) },
      },
    })

    if (conflict) {
      return NextResponse.json(
        { error: `Table déjà réservée de ${new Date(conflict.date).toTimeString().slice(0,5)} à ${new Date(conflict.endTime).toTimeString().slice(0,5)}` },
        { status: 409 },
      )
    }

    const reservation = await prisma.reservation.create({
      data: {
        ...data,
        date:     new Date(data.date),
        endTime:  new Date(data.endTime),
        allergies: data.allergies as unknown as Prisma.InputJsonValue,
        preOrder:  data.preOrder  as unknown as Prisma.InputJsonValue,
      } as unknown as Prisma.ReservationUncheckedCreateInput,
      include: { table: true },
    })

    return NextResponse.json({ reservation }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PATCH /api/reservations ───────────────────────────────────────────────────

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { id, ...data } = patchSchema.parse(body)

    const reservation = await prisma.reservation.update({
      where:   { id },
      data,
      include: { table: true },
    })

    return NextResponse.json({ reservation })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
