import { describe, it, expect } from 'vitest'
import { tabForStatus, HIDDEN_ORDER_STATUSES } from '@/lib/orders-feed'

// ── Orders v2 — the status→tab mapping helper (pure) ──────────────────────────
// todo = received ; inProgress = preparing/ready/picked_up (en route) + any
// unknown status (never lost) ; done = delivered/cancelled.
describe('tabForStatus', () => {
  it("'received' → todo (awaiting the resto's accept/refuse)", () => {
    expect(tabForStatus('received')).toBe('todo')
  })

  it.each(['preparing', 'ready', 'picked_up'])(
    "'%s' → inProgress (kitchen / en route)",
    (s) => { expect(tabForStatus(s)).toBe('inProgress') },
  )

  it.each(['delivered', 'cancelled'])(
    "'%s' → done (history)",
    (s) => { expect(tabForStatus(s)).toBe('done') },
  )

  it('an unknown/edge status falls into inProgress — never lost', () => {
    expect(tabForStatus('overrun')).toBe('inProgress')
    expect(tabForStatus('weird_future_status')).toBe('inProgress')
    expect(tabForStatus('')).toBe('inProgress')
  })

  it('a ghost status (hidden by the a1b3724 filter) still maps without throwing', () => {
    // These never reach the client (filtered server-side) but the helper is total.
    for (const s of HIDDEN_ORDER_STATUSES) {
      expect(['todo', 'inProgress', 'done']).toContain(tabForStatus(s))
    }
  })
})
