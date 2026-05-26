import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name:  z.string().min(2, 'Nom trop court'),
  email: z.string().email('Email invalide'),
  phone: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  const { name, email, phone } = parsed.data

  try {
    // Vérifier si le client existe déjà
    const existing = await prisma.loyaltyCustomer.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'Un compte existe déjà avec cet email.' },
        { status: 409 }
      )
    }

    const customer = await prisma.loyaltyCustomer.create({
      data: {
        name,
        email,
        phone: phone ?? null,
        pointsBalance: 10,          // bonus de bienvenue
        tier: 'bronze',
      },
    })

    return NextResponse.json({
      success: true,
      customer: {
        id:           customer.id,
        name:         customer.name,
        email:        customer.email,
        pointsBalance: customer.pointsBalance,
        tier:         customer.tier,
        referralCode: customer.referralCode,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[loyalty/register]', err)
    return NextResponse.json({ error: 'Erreur serveur. Réessaie.' }, { status: 500 })
  }
}
