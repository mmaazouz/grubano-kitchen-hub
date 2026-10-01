import { describe, it, expect } from 'vitest'
import {
  addToCart, setQtyInCart, removeFromCart, cartCount, cartSubtotalEur,
  EAT_NEXT_CART_KEY,
} from '@/app/[locale]/eat-next/cart-store'

// ── /eat-next real cart store — pure reducer logic (Agent 133) ─────────────────
// Tests the DOM-free reducers + the dedicated storage key (isolation from /eat).

const R1 = { restaurantId: 'r1', restaurantName: 'Gnocchi Bar' }
const R2 = { restaurantId: 'r2', restaurantName: 'Rollix' }
const gnocchi = { itemId: 'd1', name: 'Gnocchi', priceEur: 12.9, qty: 1 }
const burrata = { itemId: 'd2', name: 'Burrata', priceEur: 8.5, qty: 2 }

describe('eat-next cart store — reducers', () => {
  it('addToCart creates a cart for a fresh add', () => {
    const c = addToCart(null, R1, gnocchi)
    expect(c.restaurantId).toBe('r1')
    expect(c.restaurantName).toBe('Gnocchi Bar')
    expect(c.items).toHaveLength(1)
    expect(c.items[0]).toMatchObject({ itemId: 'd1', qty: 1 })
  })

  it('addToCart increments the SAME item (same restaurant)', () => {
    let c = addToCart(null, R1, gnocchi)
    c = addToCart(c, R1, { ...gnocchi, qty: 2 })
    expect(c.items).toHaveLength(1)
    expect(c.items[0].qty).toBe(3)
  })

  it('addToCart appends a DISTINCT item (same restaurant)', () => {
    let c = addToCart(null, R1, gnocchi)
    c = addToCart(c, R1, burrata)
    expect(c.items).toHaveLength(2)
    expect(cartCount(c)).toBe(3) // 1 + 2
  })

  it('MONO-RESTAURANT: adding from another restaurant REPLACES the cart', () => {
    let c = addToCart(null, R1, gnocchi)
    c = addToCart(c, R1, burrata)
    c = addToCart(c, R2, { itemId: 'd9', name: 'Wrap', priceEur: 9, qty: 1 })
    expect(c.restaurantId).toBe('r2')
    expect(c.restaurantName).toBe('Rollix')
    expect(c.items).toHaveLength(1)
    expect(c.items[0].itemId).toBe('d9')
  })

  it('setQtyInCart changes a line qty; qty 0 removes it; emptying returns null', () => {
    let c = addToCart(null, R1, gnocchi)
    c = addToCart(c, R1, burrata)
    c = setQtyInCart(c, 'd2', 5)!
    expect(c.items.find((l) => l.itemId === 'd2')!.qty).toBe(5)
    c = setQtyInCart(c, 'd2', 0)!
    expect(c.items.find((l) => l.itemId === 'd2')).toBeUndefined()
    const emptied = setQtyInCart(c, 'd1', 0)
    expect(emptied).toBeNull() // last line removed → null cart
  })

  it('removeFromCart removes a line; removing the last returns null', () => {
    let c = addToCart(null, R1, gnocchi)
    c = addToCart(c, R1, burrata)
    c = removeFromCart(c, 'd1')!
    expect(c.items.map((l) => l.itemId)).toEqual(['d2'])
    expect(removeFromCart(c, 'd2')).toBeNull()
  })

  it('cartSubtotalEur is the NAÏVE sum price×qty', () => {
    let c = addToCart(null, R1, gnocchi) // 12.9 × 1
    c = addToCart(c, R1, burrata) // 8.5 × 2 = 17
    expect(cartSubtotalEur(c)).toBeCloseTo(12.9 + 17, 5)
    expect(cartSubtotalEur(null)).toBe(0)
  })

  it('uses a DEDICATED storage key, isolated from the /eat cart (grubano_cart)', () => {
    expect(EAT_NEXT_CART_KEY).toBe('grubano:eat-next:cart')
    expect(EAT_NEXT_CART_KEY).not.toBe('grubano_cart')
  })
})
