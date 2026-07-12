// ── Wireframe MOCK data (Phase 1, Agent 127) ──────────────────────────────────
// STATIC sample data for the low-fidelity consumer wireframes. NOT real, NOT from
// the DB, NOT money. Exists only so Mohammed can click the end-to-end flow. This
// file imports NOTHING (no prisma, no money lib) — pure literals.

export interface WfRestaurant {
  id: string
  name: string
  cuisine: string
  rating: number
  reviews: number
  deliveryFeeEur: number   // displayed up-front (bataille 2)
  etaMin: number           // displayed up-front (bataille 2)
  minOrderEur: number      // displayed up-front (bataille 2)
  tags: string[]
}

export interface WfDish {
  id: string
  restaurantId: string
  category: string
  name: string
  description: string
  priceEur: number
}

export const WF_CATEGORIES = ['Burgers', 'Pizza', 'Sushi', 'Healthy', 'Pâtes', 'Desserts'] as const

// Intention chips (bataille 3 — search by craving, not just by name).
export const WF_INTENTIONS = [
  'Envie de réconfort', 'Léger ce midi', 'Repas à partager', 'Sans gluten', 'Le moins cher', 'Livré en 20 min',
] as const

export const WF_RESTAURANTS: WfRestaurant[] = [
  { id: 'r1', name: 'Gnocchi Bar',     cuisine: 'Pâtes italiennes', rating: 4.8, reviews: 312, deliveryFeeEur: 1.99, etaMin: 25, minOrderEur: 12, tags: ['Populaire', 'Italien'] },
  { id: 'r2', name: 'Le Riz Gourmand', cuisine: 'Asiatique',        rating: 4.6, reviews: 188, deliveryFeeEur: 2.49, etaMin: 30, minOrderEur: 15, tags: ['Healthy'] },
  { id: 'r3', name: 'Rollix',          cuisine: 'Wraps & bowls',    rating: 4.5, reviews: 95,  deliveryFeeEur: 0,    etaMin: 20, minOrderEur: 10, tags: ['Livraison offerte', 'Rapide'] },
  { id: 'r4', name: 'Bowl Healthy',    cuisine: 'Bowls & salades',  rating: 4.7, reviews: 144, deliveryFeeEur: 1.50, etaMin: 22, minOrderEur: 12, tags: ['Healthy', 'Léger'] },
  { id: 'r5', name: 'Mac & Cheese Co', cuisine: 'Comfort food',     rating: 4.4, reviews: 76,  deliveryFeeEur: 2.99, etaMin: 35, minOrderEur: 14, tags: ['Réconfort'] },
]

export const WF_DISHES: WfDish[] = [
  { id: 'd1', restaurantId: 'r1', category: 'Pâtes',    name: 'Gnocchi 4 fromages',   description: 'Gnocchi maison, crème de 4 fromages, parmesan.', priceEur: 12.9 },
  { id: 'd2', restaurantId: 'r1', category: 'Pâtes',    name: 'Gnocchi truffe',       description: 'Gnocchi, crème de truffe, copeaux.',            priceEur: 15.5 },
  { id: 'd3', restaurantId: 'r1', category: 'Entrées',  name: 'Burrata',              description: 'Burrata crémeuse, tomates, basilic.',           priceEur: 8.5 },
  { id: 'd4', restaurantId: 'r1', category: 'Desserts', name: 'Tiramisu',             description: 'Tiramisu maison au café.',                      priceEur: 5.5 },
]

export function wfRestaurant(id: string): WfRestaurant | undefined {
  return WF_RESTAURANTS.find((r) => r.id === id)
}
export function wfDish(id: string): WfDish | undefined {
  return WF_DISHES.find((d) => d.id === id)
}
export function wfDishesFor(restaurantId: string): WfDish[] {
  return WF_DISHES.filter((d) => d.restaurantId === restaurantId)
}

// A representative cart for the wireframe (illustrative — structure, not real state).
export const WF_CART = {
  restaurant: WF_RESTAURANTS[0],
  lines: [
    { dishId: 'd1', name: 'Gnocchi 4 fromages', priceEur: 12.9, qty: 1 },
    { dishId: 'd3', name: 'Burrata',            priceEur: 8.5,  qty: 1 },
  ],
}

export function eur(n: number): string {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}
