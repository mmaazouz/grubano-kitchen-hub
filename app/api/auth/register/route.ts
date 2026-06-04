import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

// SECURITY: `role` is deliberately NOT accepted from the request body. This
// endpoint only ever creates a CONSUMER account — the role is forced
// server-side below. A client-supplied role here would be a privilege-escalation
// vector (anyone could mint a `restaurant`/`admin` account). Partner accounts go
// through POST /api/partners/register, which forces role='restaurant' + email
// verification. Any extra key (e.g. a stray `role`) is silently stripped by Zod.
const registerSchema = z.object({
  name:     z.string().min(2).max(80),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
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
        role:     'consumer',   // forced server-side — never client-controlled
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
