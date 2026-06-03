import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { makeVerifyCode } from '@/lib/verify-code'

const dishConceptSchema = z.object({
  name:        z.string().min(1),
  description: z.string().min(1),
  cuisineType: z.string().min(1),
})

const applySchema = z.object({
  name:         z.string().min(2),
  email:        z.string().email(),
  bio:          z.string().min(10),
  instagram:    z.string().optional(),
  tiktok:       z.string().optional(),
  youtube:      z.string().optional(),
  followers:    z.number().int().min(0).default(0),
  dishConcepts: z.array(dishConceptSchema).min(1).max(3),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = applySchema.parse(body)

    const application = await prisma.creatorApplication.create({
      data: {
        name:         data.name,
        email:        data.email,
        bio:          data.bio,
        instagram:    data.instagram,
        tiktok:       data.tiktok,
        youtube:      data.youtube,
        followers:    data.followers,
        dishConcepts: data.dishConcepts,
      },
    })

    // The applicant proves channel ownership by pasting this code into their
    // YouTube description; POST /api/creators/apply/[id]/verify re-derives it.
    const verifyCode = makeVerifyCode(application.id)

    return NextResponse.json({ applicationId: application.id, verifyCode }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/creators/apply]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
