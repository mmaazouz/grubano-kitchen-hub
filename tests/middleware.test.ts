import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// Phase 1 — a multi-role JWT carries `roles` (the SET) + a primary `role`.
const asRoles = (roles: string[]) =>
  getTokenMock.mockResolvedValue({ role: roles[0], roles, sub: 'u1', email: 'u@example.com' })

// P0-38 — les redirections de rôle du middleware ne s'appliquent que ROLES OUVERTS :
// quand le flag racine est OFF, l'espace traverse (le layout de l'arbre répond 404).
// Ces tests historiques exercent le comportement rôles OUVERTS → flags ON explicites ;
// le comportement flag OFF (traversant, sans redirection) est prouvé en fin de fichier.
const ROLE_FLAGS = ['CREATOR_ENABLED', 'SUPPLIER_ENABLED', 'FRANCHISE_ENABLED', 'LOGISTICS_ENABLED']
beforeEach(() => {
  getTokenMock.mockReset()
  for (const f of ROLE_FLAGS) process.env[f] = 'true'
})
afterEach(() => { for (const f of ROLE_FLAGS) delete process.env[f] })

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

describe('middleware — multi-role gating (Phase 1) + legacy non-regression', () => {
  it('a [creator, restaurant] operator reaches BOTH /dashboard and /creators/dashboard', async () => {
    asRoles(['creator', 'restaurant'])
    expect(passed(await middleware(reqFor('/fr/dashboard')))).toBe(true)
    getTokenMock.mockReset(); asRoles(['creator', 'restaurant'])
    expect(passed(await middleware(reqFor('/fr/creators/dashboard')))).toBe(true)
  })

  it('a multi-role set does NOT grant unrelated routes (no consumer → /account bounces)', async () => {
    asRoles(['creator', 'restaurant'])
    expect(redirectTo(await middleware(reqFor('/fr/account')))).toBe('/fr/eat')
  })

  it('LEGACY JWT (role only, no roles[]) still gates exactly as before — non-regression', async () => {
    asRole('restaurant')
    expect(passed(await middleware(reqFor('/fr/dashboard')))).toBe(true)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/dashboard')))).toBe('/fr/eat')
    getTokenMock.mockReset(); asRole('creator')
    expect(passed(await middleware(reqFor('/fr/creators/dashboard')))).toBe(true)
  })
})

describe('middleware — operator FLAT routes gate (security hardening)', () => {
  // A representative sweep of OPERATOR_FLAT_PREFIXES (the restaurateur portal's
  // flat routes that were nav-hidden but URL-reachable before this gate).
  const OPERATOR_ROUTES = [
    '/fr/menu', '/fr/stocks', '/fr/suppliers', '/fr/brands', '/fr/orders',
    '/fr/promotions', '/fr/onboarding', '/fr/analytics', '/fr/loyalty',
    '/fr/customers', '/fr/cashflow', '/fr/pricing', '/fr/more', '/fr/premium',
  ]

  it('lets a restaurant role into EVERY operator flat route (non-regression)', async () => {
    for (const path of OPERATOR_ROUTES) {
      getTokenMock.mockReset(); asRole('restaurant')
      const res = await middleware(reqFor(path))
      expect(passed(res), path).toBe(true)
      expect(redirectTo(res), path).toBeNull()
    }
  })

  it('lets an admin into EVERY operator flat route', async () => {
    for (const path of OPERATOR_ROUTES) {
      getTokenMock.mockReset(); asRole('admin')
      expect(passed(await middleware(reqFor(path))), path).toBe(true)
    }
  })

  it('redirects a CONSUMER off every operator flat route to their home (/eat)', async () => {
    for (const path of OPERATOR_ROUTES) {
      getTokenMock.mockReset(); asRole('consumer')
      expect(redirectTo(await middleware(reqFor(path))), path).toBe('/fr/eat')
    }
  })

  it('redirects a CREATOR off operator routes to the creator space (not /eat)', async () => {
    asRole('creator')
    expect(redirectTo(await middleware(reqFor('/fr/menu')))).toBe('/fr/creators/dashboard')
    getTokenMock.mockReset(); asRole('creator')
    expect(redirectTo(await middleware(reqFor('/fr/stocks')))).toBe('/fr/creators/dashboard')
  })

  it('redirects a FRANCHISE off operator routes to the franchise space', async () => {
    asRole('franchise')
    expect(redirectTo(await middleware(reqFor('/fr/menu')))).toBe('/fr/franchise')
  })

  it('gates operator SUB-routes too (/menu/123, /stocks/x)', async () => {
    asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/menu/abc123')))).toBe('/fr/eat')
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/stocks/x')))).toBe('/fr/eat')
  })

  it('a multi-role {consumer, restaurant} PASSES every operator flat route', async () => {
    for (const path of OPERATOR_ROUTES) {
      getTokenMock.mockReset(); asRoles(['consumer', 'restaurant'])
      expect(passed(await middleware(reqFor(path))), path).toBe(true)
    }
  })

  it('redirects an UNAUTHENTICATED user off an operator route to /login', async () => {
    getTokenMock.mockResolvedValue(null)
    expect(redirectTo(await middleware(reqFor('/fr/menu')))).toBe('/fr/login')
  })

  it('does NOT over-gate: public non-bare routes stay reachable for a consumer', async () => {
    // /chef, /ref, /auth/magic, /design are public — the operator gate must not
    // touch them (no accidental over-gating from the new prefix list).
    for (const path of ['/fr/chef/some-slug', '/fr/ref/CODE', '/fr/auth/magic', '/fr/design']) {
      getTokenMock.mockReset(); asRole('consumer')
      expect(passed(await middleware(reqFor(path))), path).toBe(true)
    }
  })

  it('does NOT regress the existing gates (/dashboard, /account, creators, franchise)', async () => {
    // /dashboard → /eat for a consumer (unchanged)
    asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/dashboard')))).toBe('/fr/eat')
    // /account → /eat for a creator (unchanged)
    getTokenMock.mockReset(); asRole('creator')
    expect(redirectTo(await middleware(reqFor('/fr/account')))).toBe('/fr/eat')
    // /creators/dashboard → /creators for a consumer (unchanged)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/creators/dashboard')))).toBe('/fr/creators')
    // /franchise/dashboard → /franchise for a consumer (unchanged)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/franchise/dashboard')))).toBe('/fr/franchise')
  })
})

describe('middleware — B2B supplier space (Slice 0) + singular/plural non-regression', () => {
  it('keeps the /supplier landing public for every role', async () => {
    for (const role of ['consumer', 'restaurant', 'creator', 'supplier']) {
      getTokenMock.mockReset(); asRole(role)
      expect(passed(await middleware(reqFor('/fr/supplier'))), role).toBe(true)
    }
  })

  it('keeps /supplier/register public (self-serve signup) for a consumer', async () => {
    asRole('consumer')
    expect(passed(await middleware(reqFor('/fr/supplier/register')))).toBe(true)
  })

  it('lets a supplier into /supplier/dashboard', async () => {
    asRole('supplier')
    expect(passed(await middleware(reqFor('/fr/supplier/dashboard')))).toBe(true)
  })

  it('gates /supplier/catalog (Slice 1) — supplier passes, non-supplier bounced', async () => {
    asRole('supplier')
    expect(passed(await middleware(reqFor('/fr/supplier/catalog')))).toBe(true)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/supplier/catalog')))).toBe('/fr/eat')
    // register stays public even though catalog (another sub-route) is gated
    getTokenMock.mockReset(); asRole('consumer')
    expect(passed(await middleware(reqFor('/fr/supplier/register')))).toBe(true)
  })

  it('gates /supplier/orders (Slice 2 supplier) + /marketplace/suppliers (Slice 2 resto)', async () => {
    asRole('supplier')
    expect(passed(await middleware(reqFor('/fr/supplier/orders')))).toBe(true)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/supplier/orders')))).toBe('/fr/eat')
    // resto discovery hosts under operator-gated /marketplace: restaurant passes, consumer bounced
    getTokenMock.mockReset(); asRole('restaurant')
    expect(passed(await middleware(reqFor('/fr/marketplace/suppliers')))).toBe(true)
    getTokenMock.mockReset(); asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/marketplace/suppliers')))).toBe('/fr/eat')
  })

  it('lets an admin and a multi-role {restaurant, supplier} into /supplier/dashboard', async () => {
    asRole('admin')
    expect(passed(await middleware(reqFor('/fr/supplier/dashboard')))).toBe(true)
    getTokenMock.mockReset(); asRoles(['restaurant', 'supplier'])
    expect(passed(await middleware(reqFor('/fr/supplier/dashboard')))).toBe(true)
  })

  it('redirects a non-supplier off /supplier/dashboard to their primary space home', async () => {
    asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/supplier/dashboard')))).toBe('/fr/eat')
    getTokenMock.mockReset(); asRole('creator')
    expect(redirectTo(await middleware(reqFor('/fr/supplier/dashboard')))).toBe('/fr/creators/dashboard')
  })

  it('a pure supplier is NOT granted operator flat routes (bounced to its own space)', async () => {
    asRole('supplier')
    expect(redirectTo(await middleware(reqFor('/fr/menu')))).toBe('/fr/supplier/dashboard')
  })

  it('NON-REGRESSION: the operator /suppliers (plural) directory is NOT leaked public by the /supplier rule', async () => {
    // The singular /supplier landing is public, but the plural /suppliers operator
    // directory must STAY gated to restaurant/admin (the boundary that matters).
    asRole('consumer')
    expect(redirectTo(await middleware(reqFor('/fr/suppliers')))).toBe('/fr/eat')
    getTokenMock.mockReset(); asRole('restaurant')
    expect(passed(await middleware(reqFor('/fr/suppliers')))).toBe(true)
  })

  it('an unauthenticated user on /supplier/dashboard → /login', async () => {
    getTokenMock.mockResolvedValue(null)
    expect(redirectTo(await middleware(reqFor('/fr/supplier/dashboard')))).toBe('/fr/login')
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

  it('consumer hitting /menu (operator flat) settles within 2 hops, no cycle', async () => {
    const r = await followChain('/fr/menu', 'consumer')
    expect(r.settled).toBe(true)
    expect(r.hops).toBeLessThanOrEqual(2)
  })

  it('creator hitting /stocks (operator flat) settles to its own space, no cycle', async () => {
    // creator → /creators/dashboard (gated creator/admin → creator passes there)
    const r = await followChain('/fr/stocks', 'creator')
    expect(r.settled).toBe(true)
    expect(r.hops).toBeLessThanOrEqual(2)
  })
})

describe('middleware — P0-38 : rôle gelé (flag OFF) → espace TRAVERSANT, aucune redirection', () => {
  const OFF = () => { for (const f of ROLE_FLAGS) delete process.env[f] }
  it('restaurateur connecté : les 4 tableaux de bord passent (le layout 404era)', async () => {
    OFF(); asRole('restaurant')
    for (const p of ['/fr/supplier/dashboard', '/fr/logistics/dashboard', '/fr/franchise/dashboard', '/fr/creators/dashboard']) {
      const res = await middleware(reqFor(p))
      expect(passed(res), p).toBe(true)
    }
  })
  it('anonyme : les mêmes chemins passent aussi — pas de détour /login (introuvable, pas gardé)', async () => {
    OFF(); getTokenMock.mockResolvedValue(null)
    for (const p of ['/fr/supplier/dashboard', '/fr/logistics/dashboard', '/fr/franchise/dashboard', '/fr/creators/dashboard']) {
      const res = await middleware(reqFor(p))
      expect(passed(res), p).toBe(true)
    }
  })
  it('contrôle positif flags ON : restaurateur toujours redirigé de /supplier/dashboard', async () => {
    for (const f of ROLE_FLAGS) process.env[f] = 'true'
    asRole('restaurant')
    const res = await middleware(reqFor('/fr/supplier/dashboard'))
    expect(passed(res)).toBe(false)
  })
})
