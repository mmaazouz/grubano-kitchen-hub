import { notFound } from 'next/navigation'
import { getDish } from '../../data'
import DishClient from './DishClient'

// SCREEN 4/7 — DISH detail (Agent 127 → Agent 130 real data → Agent 136 hardening). Loads the REAL
// menu item by id (read-only) on the server, then hands it to a small client child for the qty
// stepper + add-to-cart navigation. notFound() when the dish is not visible (unavailable, or its
// parent restaurant is archived) — consistent with the restaurant page's notFound() gate. No money,
// no write.
export const dynamic = 'force-dynamic'

export default async function EatNextDishPage({ params }: { params: { id: string } }) {
  const dish = await getDish(params.id)
  if (!dish) notFound()
  return (
    <DishClient
      itemId={dish.id}
      name={dish.name}
      description={dish.description}
      priceEur={dish.priceEur}
      category={dish.category}
      restaurantId={dish.restaurantId}
      restaurantName={dish.restaurantName}
    />
  )
}
