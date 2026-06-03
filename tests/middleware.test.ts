import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────
// getToken is the only auth dependency; we drive it per-test to simulate roles.
const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

// The real next-intl middleware would try to negotiate locales / redirect; we
// only care that control REACHED it (= the request "passed" the auth guard).
// A marker header lets tests distinguish "passed through" from "redirected".
vi.mock('next-intl/middleware', () => ({
  default: () => () =>
    new Response(null, { status: 200, headers: { 'x-mw': 'intl-pass' } }),
}))

import { middleware } from '@/middleware'

const ORIGIN = 'https://app.grubano.com'
const reqFor = (path: string) => new NextRequest(`${ORIGIN}${path}`)

/** true when the middleware fell through to the intl handler (no auth bounce). */
const passed = (res: Response) => res.headers.get('x-mw') === 'intl-pass'
/** the redirect target pathname, or null when not a redirect. */
const redirectTo = (res: Response) => {
  const loc = res.headers.get('location')
  return loc ? new URL(loc).pathname : null
}

const asRole = (role: string) =>
  getTokenMock.mockResolvedValue({ role, sub: 'u1', email: 'u@example.com' })

beforeEach(() => {
  getTokenMock.mockReset()
})

describe('middleware — role routing after locale strip', () => {
  it('lets a restaurant role through to /dashboard', async () => {
    asRole('restaurant')
    const res = await middleware(reqFor('/fr/dashboard'))
    expect(passed(res)).toBe(true)
    expect(redirectTo(res)).toBeNull()
  })

  it('redirects a consumer off /dashboard (to /eat, no loop)', async () => {
    asRole('consumer')
    const res = await middleware(reqFor('/fr/dashboard'))
    expect(redirectTo(res)).toBe('/fr/eat')
  })

  it('keeps the /franchise ROOT public for every role', async () => {
    for (const role of ['consumer', 'restaurant', 'creator', 'franchise']) {
      getTokenMock.mockReset()
      asRole(role)
      const res = await middleware(reqFor('/fr/franchise'))
      expect(passed(res), `role ${role}`).toBe(true)
    }
  })

  it('keeps the /creators ROOT public for every role', async () => {
    for (const role of ['consumer', 'restaurant', 'creator', 'franchise']) {
      getTokenMock.mockReset()
      asRole(role)
      const res = await middleware(reqFor('/fr/creators'))
      expect(passed(res), `role ${role}`).toBe(true)
    }
  })

  it('redirects /franchise/dashboard without franchise/restaurant/admin to /{locale}/franchise (not /eat)', async () => {
    asRole('consumer')
    const res = await middleware(reqFor('/fr/franchise/dashboard'))
    expect(redirectTo(res)).toBe('/fr/franchise')
  })

  it('lets a franchise role into /franchise/dashboard', async () => {
    asRole('franchise')
    const res = await middleware(reqFor('/fr/franchise/dashboard'))
    expect(passed(res)).toBe(true)
  })

  it('lets a restaurant role into /franchise/dashboard (franchisee IS a restaurateur)', async () => {
    asRole('restaurant')
    const res = await middleware(reqFor('/fr/franchise/dashboard'))
    expect(passed(res)).toBe(true)
  })

  it('redirects /creators/dashboard without creator/admin to /{locale}/creators', async () => {
    asRole('consumer')
    const res = await middleware(reqFor('/fr/creators/dashboard'))
    expect(redirectTo(res)).toBe('/fr/creators')
  })

  it('lets a creator role into /creators/dashboard', async () => {
    asRole('creator')
    const res = await middleware(reqFor('/fr/creators/dashboard'))
    expect(passed(res)).toBe(true)
  })

  it('admin passes every dashboard', async () => {
    for (const path of ['/fr/dashboard', '/fr/franchise/dashboard', '/fr/creators/dashboard']) {
      getTokenMock.mockReset()
      asRole('admin')
      const res = await middleware(reqFor(path))
      expect(passed(res), path).toBe(true)
    }
  })

  it('redirects an unauthenticated user on a protected route to /{locale}/login', async () => {
    getTokenMock.mockResolvedValue(null)
    const res = await middleware(reqFor('/fr/dashboard'))
    expect(redirectTo(res)).toBe('/fr/login')
  })
})

describe('middleware — anti-infinite-loop (bounded redirects)', () => {
  // Follow the redirect chain like a browser would. A correct config reaches a
  // public page (which "passes") within a couple of hops; a loop never settles.
  const followChain = async (start: string, role: string, maxHops = 6) => {
    asRole(role)
    let path = start
    let hops = 0
    const visited: string[] = []
    while (hops < maxHops) {
      const res = await middleware(reqFor(path))
      if (passed(res)) return { settled: true, hops, visited }
      const next = redirectTo(res)
      if (next === null) return { settled: true, hops, visited }
      if (visited.includes(next)) return { settled: false, hops, visited } // cycle
      visited.push(next)
      path = next
      hops++
    }
    return { settled: false, hops, visited }
  }

  it('consumer hitting /dashboard settles within 2 hops, no cycle', async () => {
    const r = await followChain('/fr/dashboard', 'consumer')
    expect(r.settled).toBe(true)
    expect(r.hops).toBeLessThanOrEqual(2)
  })

  it('consumer hitting /franchise/dashboard settles within 2 hops, no cycle', async () => {
    const r = await followChain('/fr/franchise/dashboard', 'consumer')
    expect(r.settled).toBe(true)
    expect(r.hops).toBeLessThanOrEqual(2)
  })

  it('consumer hitting /creators/dashboard settles within 2 hops, no cycle', async () => {
    const r = await followChain('/fr/creators/dashboard', 'consumer')
    expect(r.settled).toBe(true)
    expect(r.hops).toBeLessThanOrEqual(2)
  })
})
