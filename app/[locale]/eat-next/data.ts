import 'server-only'
import { prisma } from '@/lib/prisma'

// ── /eat-next READ-ONLY data layer (Phase 2 brick 2a, Agent 130) ───────────────
// Replaces the static mock (./mock) for the 4 NAVIGATION screens (home, search via
// the API, restaurant, dish) with REAL restaurants/menus. Reads the SAME Prisma
// models + the SAME visibility gates as the existing /eat app (app/api/restaurants/*):
//   • list   → { isActive: true, archivedAt: null }
//   • detail → { archivedAt: null }
//   • menu   → MenuItem { available: true }
// STRICTLY read-only: only findMany / findFirst / findUnique — NO mutation, NO money
// lib, NO write. Prices are already stored in EUROS (Float), so they map straight to
// the Stellar PriceTag's amountEur. `cuisine` is a JSON string[] → we surface the
// first tag for display. /eat and its API routes are NOT touched (byte-identical).

export interface EatNextRestaurant {
  id: string
  name: string
  cuisine: string // display: first cuisine tag (Restaurant.cuisine is a JSON string[])
  rating: number
  reviewCount: number
  deliveryFeeEur: number // Restaurant.deliveryFee — stored in EUROS
  etaMin: number // Restaurant.deliveryTime — minutes
  minOrderEur: number // Restaurant.minOrder — stored in EUROS
}

export interface EatNextDish {
  id: string
  name: string
  description: string
  priceEur: number // MenuItem.price — stored in EUROS
  category: string
}

export interface EatNextMenuCategory {
  category: string
  items: EatNextDish[]
}

export interface EatNextRestaurantDetail extends EatNextRestaurant {
  description: string
  menu: EatNextMenuCategory[]
}

const firstCuisine = (c: unknown): string =>
  Array.isArray(c) && typeof c[0] === 'string' ? c[0] : ''

// Home / discovery list — same gate as GET /api/restaurants (non-geo path).
export async function listRestaurants(): Promise<EatNextRestaurant[]> {
  const rows = await prisma.restaurant.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: { rating: 'desc' },
    take: 30,
    select: {
      id: true, name: true, cuisine: true, rating: true, reviewCount: true,
      deliveryTime: true, minOrder: true, deliveryFee: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cuisine: firstCuisine(r.cuisine),
    rating: r.rating,
    reviewCount: r.reviewCount,
    deliveryFeeEur: r.deliveryFee,
    etaMin: r.deliveryTime,
    minOrderEur: r.minOrder,
  }))
}

// Restaurant detail + menu grouped by category — same gate as GET /api/restaurants/[id]
// (detail = archivedAt:null; menu items = available:true; sorted category→name).
export async function getRestaurant(id: string): Promise<EatNextRestaurantDetail | null> {
  const r = await prisma.restaurant.findFirst({
    where: { id, archivedAt: null },
    select: {
      id: true, name: true, description: true, cuisine: true, rating: true,
      reviewCount: true, deliveryTime: true, minOrder: true, deliveryFee: true,
      brands: {
        select: {
          menuItems: {
            where: { available: true },
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, description: true, price: true, category: true },
          },
        },
      },
    },
  })
  if (!r) return null

  const items = r.brands.flatMap((b) => b.menuItems)
  const categories = Array.from(new Set(items.map((i) => i.category)))
  const menu: EatNextMenuCategory[] = categories.map((category) => ({
    category,
    items: items
      .filter((i) => i.category === category)
      .map((i) => ({ id: i.id, name: i.name, description: i.description ?? '', priceEur: i.price, category: i.category })),
  }))

  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    cuisine: firstCuisine(r.cuisine),
    rating: r.rating,
    reviewCount: r.reviewCount,
    deliveryFeeEur: r.deliveryFee,
    etaMin: r.deliveryTime,
    minOrderEur: r.minOrder,
    menu,
  }
}

// Single dish by id — surfaced only when its menu item is available.
export async function getDish(id: string): Promise<EatNextDish | null> {
  const d = await prisma.menuItem.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, price: true, category: true, available: true },
  })
  if (!d || !d.available) return null
  return { id: d.id, name: d.name, description: d.description ?? '', priceEur: d.price, category: d.category }
}
