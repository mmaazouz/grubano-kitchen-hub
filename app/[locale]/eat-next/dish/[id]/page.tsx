import { getDish } from '../../data'
import DishClient from './DishClient'

// SCREEN 4/7 — DISH detail (Agent 127 → Agent 129 Stellar → Agent 130 real data). Loads the REAL
// menu item by id (read-only, available-only) on the server, then hands it to a small client child
// for the qty stepper + add-to-cart navigation. No money, no write.
export const dynamic = 'force-dynamic'

export default async function EatNextDishPage({ params }: { params: { id: string } }) {
  const dish = await getDish(params.id)
  if (!dish) {
    return <div className="p-4 text-stellar-muted-fg">Plat indisponible.</div>
  }
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
