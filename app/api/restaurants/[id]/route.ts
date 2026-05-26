import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ── GET /api/restaurants/:id ──────────────────────────────────────────────────
// Returns full restaurant details + menu grouped by category

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where:   { id: params.id },
      include: {
        operator: {
          select: {
            id:     true,
            name:   true,
            email:  true,
            brands: {
              select: {
                id:        true,
                name:      true,
                menuItems: {
                  where:   { available: true },
                  orderBy: [{ category: 'asc' }, { name: 'asc' }],
                  select: {
                    id:          true,
                    name:        true,
                    description: true,
                    price:       true,
                    comparePrice:true,
                    category:    true,
                    calories:    true,
                    allergens:   true,
                    labels:      true,
                    photos:      true,
                    options:     true,
                    isPopular:   true,
                    prepTime:    true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant introuvable' }, { status: 404 })
    }

    // Flatten all menu items from all brands, grouped by category
    const allItems = restaurant.operator.brands.flatMap(b =>
      b.menuItems.map(item => ({ ...item, brandId: b.id, brandName: b.name })),
    )

    const categories = Array.from(new Set(allItems.map(i => i.category)))
    const menu = categories.map(cat => ({
      category: cat,
      items:    allItems.filter(i => i.category === cat),
    }))

    return NextResponse.json({
      restaurant: {
        id:           restaurant.id,
        name:         restaurant.name,
        description:  restaurant.description,
        coverPhoto:   restaurant.coverPhoto,
        logo:         restaurant.logo,
        cuisine:      restaurant.cuisine,
        rating:       restaurant.rating,
        reviewCount:  restaurant.reviewCount,
        deliveryTime: restaurant.deliveryTime,
        minOrder:     restaurant.minOrder,
        deliveryFee:  restaurant.deliveryFee,
        city:         restaurant.city,
        address:      restaurant.address,
        lat:          restaurant.lat,
        lng:          restaurant.lng,
      },
      menu,
      itemCount: allItems.length,
    })
  } catch (err) {
    console.error('[GET /api/restaurants/:id]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
