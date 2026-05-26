import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const registerSchema = z.object({
  name:     z.string().min(2).max(80),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
  role:     z.enum(['consumer', 'restaurant', 'franchise', 'creator']).default('consumer'),
})

// ── POST /api/auth/register ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = registerSchema.parse(body)

    // Check existing
    const existing = await prisma.operator.findUnique({ where: { email: data.email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Un compte avec cet email existe déjà' },
        { status: 409 },
      )
    }

    const hashedPassword = await bcrypt.hash(data.password, 12)

    const operator = await prisma.operator.create({
      data: {
        name:     data.name,
        email:    data.email,
        password: hashedPassword,
        role:     data.role,
        status:   'active',
      },
    })

    return NextResponse.json(
      { id: operator.id, email: operator.email, role: operator.role },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    console.error('[POST /api/auth/register]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
