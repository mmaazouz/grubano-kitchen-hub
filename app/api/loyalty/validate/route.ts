import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const TIER_THRESHOLDS = [
  { tier: 'platine', min: 400 },
  { tier: 'gold',    min: 200 },
  { tier: 'silver',  min: 100 },
  { tier: 'bronze',  min: 0   },
]

function computeTier(points: number): string {
  return TIER_THRESHOLDS.find(t => points >= t.min)?.tier ?? 'bronze'
}

const schema = z.object({
  email:          z.string().email('Email invalide'),
  uberOrderNumber: z.string().min(3, 'Numéro de commande invalide'),
  amount:         z.number().positive('Montant invalide'),
  brandName:      z.string().min(1, 'Marque requise'),
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

  const { email, uberOrderNumber, amount, brandName } = parsed.data

  try {
    // 1. Trouver le client
    const customer = await prisma.loyaltyCustomer.findUnique({ where: { email } })
    if (!customer) {
      return NextResponse.json(
        { error: 'Aucun compte fidélité trouvé pour cet email.' },
        { status: 404 }
      )
    }

    // 2. Vérifier commande unique
    const existingOrder = await prisma.loyaltyOrder.findUnique({
      where: { uberOrderNumber },
    })
    if (existingOrder) {
      return NextResponse.json(
        { error: 'Cette commande a déjà été validée.' },
        { status: 409 }
      )
    }

    // 3. Trouver la marque
    const brand = await prisma.brand.findFirst({
      where: { name: { contains: brandName } },
    })
    if (!brand) {
      return NextResponse.json(
        { error: `Marque "${brandName}" introuvable.` },
        { status: 404 }
      )
    }

    // 4. Calculer les points (1 pt = 1 €, arrondi à l'entier)
    const pointsEarned = Math.floor(amount)

    // 5. Transaction : créer la commande + mettre à jour les points
    const newPoints = customer.pointsBalance + pointsEarned
    const newTier   = computeTier(newPoints)

    const [order] = await prisma.$transaction([
      prisma.loyaltyOrder.create({
        data: {
          customerId:      customer.id,
          brandId:         brand.id,
          uberOrderNumber,
          amount,
          pointsEarned,
        },
      }),
      prisma.loyaltyCustomer.update({
        where: { id: customer.id },
        data:  { pointsBalance: newPoints, tier: newTier },
      }),
    ])

    return NextResponse.json({
      success: true,
      pointsEarned,
      newBalance: newPoints,
      tier: newTier,
      orderId: order.id,
    })
  } catch (err) {
    console.error('[loyalty/validate]', err)
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
