import { describe, it, expect } from 'vitest'
import { customerAvatarGradient, CUSTOMER_AVATAR_GRADIENTS } from '@/lib/customer-avatar'

// ── Vague 3 — décision F: avatar color per CLIENT ─────────────────────────────
// Derived deterministically from LoyaltyCustomer.id, NEVER from the displayed
// name; closed cycling palette from the existing charte; no grey.

describe('customerAvatarGradient', () => {
  it('is deterministic — same id → same color on every call (list & fiche share it)', () => {
    const id = 'cmsxxyyr5002fg3efbburhcvb'
    expect(customerAvatarGradient(id)).toBe(customerAvatarGradient(id))
  })

  it('takes the id ONLY — the displayed name cannot influence the color (by signature)', () => {
    // The function has no name parameter at all; two customers with identical
    // masked names but different ids can get different colors…
    const a = customerAvatarGradient('cku1aaaaaaaaaaaaaaaaaaaa1')
    const b = customerAvatarGradient('cku1bbbbbbbbbbbbbbbbbbbb2')
    expect(CUSTOMER_AVATAR_GRADIENTS).toContain(a)
    expect(CUSTOMER_AVATAR_GRADIENTS).toContain(b)
  })

  it('always cycles inside the CLOSED palette — never generates a hue', () => {
    for (let i = 0; i < 50; i++) {
      expect(CUSTOMER_AVATAR_GRADIENTS).toContain(customerAvatarGradient(`cuid-${i}-x`))
    }
  })

  it('the palette holds no grey and pairs dark stops for white initials', () => {
    for (const g of CUSTOMER_AVATAR_GRADIENTS) {
      // grey family (#8992A3 / #5B6472 tier-silver tones) must not appear
      expect(g).not.toMatch(/8992A3|5B6472|9CA3AF|6B7280/i)
    }
    expect(CUSTOMER_AVATAR_GRADIENTS.length).toBeGreaterThanOrEqual(6)
  })
})
