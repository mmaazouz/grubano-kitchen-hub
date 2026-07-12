import { describe, it, expect } from 'vitest'

// Smoke test — proves the Vitest harness boots and runs before real suites land.
describe('harness sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
