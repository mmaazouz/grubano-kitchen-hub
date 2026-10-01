import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isFranchiseEnabled } from '@/lib/franchise-account'

const applySchema = z.object({
  name:       z.string().min(2),
  // Agent 115 — lean signup: city + phone DEFERRED to the dashboard (edited later on the Operator
  // account via PATCH /api/franchise/profile). They are NOT inputs to the admin approval
  // (/api/franchise/approve reads only email/name/siret), so the approval gate is byte-identical.
  // FranchiseApplication.city/phone are now nullable (migration) → the create (data: {...data})
  // simply omits them. zod (non-strict) silently strips any stale city/phone still posted.
  email:      z.string().email(),
  siret:      z.string().optional(),
  rib:        z.string().optional(),
  hasKitchen: z.boolean().default(false),
  brandName:  z.string().min(1),
  motivation: z.string().min(10),
})

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const session = await getServerSession(authOptions)
    const body    = await req.json()
    const data    = applySchema.parse(body)

    const application = await prisma.franchiseApplication.create({
      data: {
        ...data,
        operatorId: session?.user ? (session.user as { id?: string }).id : undefined,
      },
    })

    return NextResponse.json({ application }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/franchise/apply]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
