import { describe, it, expect } from 'vitest'
import { buildOrderBody } from '@/app/[locale]/eat-next/checkout-order'
import type { EatNextCart } from '@/app/[locale]/eat-next/cart-store'

// ── /eat-next order body contract (Agent 134, brick 2d) ────────────────────────
// The body MUST be a valid createOrderSchema payload AND must carry NO client-controlled money:
// no total, no discount, no commission, no consumerId — the server is the sole authority.

const cart: EatNextCart = {
  restaurantId: 'rest1',
  restaurantName: 'Gnocchi Bar',
  items: [
    { itemId: 'd1', name: 'Gnocchi', priceEur: 12.9, qty: 2 },
    { itemId: 'd2', name: 'Burrata', priceEur: 8.5, qty: 1, options: [{ size: 'L' }] },
  ],
}

describe('buildOrderBody — POST /api/orders contract', () => {
  const body = buildOrderBody(cart, { deliveryAddress: '12 rue de la République', fulfillmentType: 'delivery' })

  it('matches createOrderSchema shape (restaurantId + items + deliveryAddress + paymentMethod card + fulfillmentType)', () => {
    expect(body.restaurantId).toBe('rest1')
    expect(body.deliveryAddress).toBe('12 rue de la République')
    expect(body.paymentMethod).toBe('card')
    expect(body.fulfillmentType).toBe('delivery')
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toEqual({ itemId: 'd1', name: 'Gnocchi', qty: 2, price: 12.9, options: [] })
    expect(body.items[1]).toEqual({ itemId: 'd2', name: 'Burrata', qty: 1, price: 8.5, options: [{ size: 'L' }] })
  })

  it('sends NO client-controlled money or identity (server is the authority)', () => {
    const keys = Object.keys(body)
    for (const forbidden of ['total', 'subtotal', 'discount', 'commission', 'applicationFee', 'consumerId', 'amount']) {
      expect(keys).not.toContain(forbidden)
    }
    // items carry only the schema fields — no per-line total/amount.
    for (const it of body.items) {
      expect(Object.keys(it).sort()).toEqual(['itemId', 'name', 'options', 'price', 'qty'])
    }
  })

  it('every item has qty>=1 and price>0 (createOrderSchema constraints)', () => {
    for (const it of body.items) {
      expect(it.qty).toBeGreaterThanOrEqual(1)
      expect(it.price).toBeGreaterThan(0)
    }
  })

  it('carries the pickup fulfillmentType through', () => {
    const b = buildOrderBody(cart, { deliveryAddress: 'Sur place 12345', fulfillmentType: 'pickup' })
    expect(b.fulfillmentType).toBe('pickup')
    expect(b.paymentMethod).toBe('card')
  })
})
