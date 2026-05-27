import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const dishSchema = z.object({
  name:           z.string().min(2),
  description:    z.string().min(10),
  ingredients:    z.array(z.string()).min(1),
  cuisineType:    z.string().min(1),
  suggestedPrice: z.number().positive(),
  photo:          z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await req.json()
    const data = dishSchema.parse(body)
    const userEmail = session.user.email!

    // Find or create Creator record for this operator
    let creator = await prisma.creator.findUnique({ where: { email: userEmail } })
    if (!creator) {
      creator = await prisma.creator.create({
        data: { name: session.user.name ?? 'Créateur', email: userEmail },
      })
    }

    const dish = await prisma.creatorDish.create({
      data: {
        creatorId:      creator.id,
        name:           data.name,
        description:    data.description,
        ingredients:    data.ingredients,
        cuisineType:    data.cuisineType,
        suggestedPrice: data.suggestedPrice,
        photo:          data.photo,
        status:         'pending',
      },
    })

    return NextResponse.json({ dish }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/creators/dishes]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
