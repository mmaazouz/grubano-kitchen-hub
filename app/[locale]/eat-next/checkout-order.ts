import type { EatNextCart } from './cart-store'

// ── /eat-next order body builder (Phase 2 brick 2d, Agent 134) ─────────────────
// Builds the EXACT body the EXISTING POST /api/orders expects (createOrderSchema, byte-identical
// route, route.ts:24-49). ⚠️ The client sends NO money: NO total, NO discount, NO commission, NO
// consumerId — the server is the sole authority on amounts (it recomputes everything and sets
// consumerId from token.sub). `price` per item is the menu price in EUROS (what the schema's
// orderItemSchema.price expects); it is a line input, NOT a client-asserted total.

export interface EatNextOrderBody {
  restaurantId: string
  items: { itemId: string; name: string; qty: number; price: number; options: Record<string, unknown>[] }[]
  deliveryAddress: string
  paymentMethod: 'card' // 2d wires the CARD path only (wallet 1-tap = next brick)
  fulfillmentType: 'delivery' | 'pickup'
}

export function buildOrderBody(
  cart: EatNextCart,
  opts: { deliveryAddress: string; fulfillmentType: 'delivery' | 'pickup' },
): EatNextOrderBody {
  return {
    restaurantId: cart.restaurantId,
    items: cart.items.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      qty: l.qty,
      price: l.priceEur, // EUROS — orderItemSchema.price; the server stays the authority on the total
      options: l.options ?? [],
    })),
    deliveryAddress: opts.deliveryAddress,
    paymentMethod: 'card',
    fulfillmentType: opts.fulfillmentType,
  }
}
