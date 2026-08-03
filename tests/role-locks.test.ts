import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P0-06 — verrouillage serveur des 4 rôles masqués (doctrine Q8) ────────────
// LA liste exhaustive des routes gatées. Chaque route doit répondre 404 sur TOUS
// ses verbes quand le flag de rôle est OFF (défaut) — AVANT toute lecture de
// session/secret/body et AVANT toute écriture. Le patron répliqué est celui de
// PRESTATAIRE_ENABLED (404 en première ligne du handler).
//
// Preuve « avant écriture » : prisma est mocké par un Proxy TRAÇANT — le test
// vérifie qu'AUCUN accès à un modèle prisma n'a lieu quand le flag est OFF.

const { prismaTouched } = vi.hoisted(() => ({ prismaTouched: { count: 0 } }))
vi.mock('@/lib/prisma', () => {
  const modelProxy = new Proxy({}, {
    get: () => { prismaTouched.count++; return (..._a: unknown[]) => Promise.resolve(null) },
  })
  return { prisma: new Proxy({}, { get: () => { prismaTouched.count++; return modelProxy } }) }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const ROLE_FLAGS = ['CREATOR_ENABLED', 'SUPPLIER_ENABLED', 'FRANCHISE_ENABLED', 'LOGISTICS_ENABLED'] as const
const VERBS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const

type Row = { family: string; flag: string; path: string; load: () => Promise<Record<string, unknown>> }
const ROUTES: Row[] = [
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/[slug]/follow/route.ts', load: () => import('@/app/api/creators/[slug]/follow/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/apply/route.ts', load: () => import('@/app/api/creators/apply/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/apply/[id]/verify/route.ts', load: () => import('@/app/api/creators/apply/[id]/verify/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/campaigns/route.ts', load: () => import('@/app/api/creators/campaigns/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/dishes/route.ts', load: () => import('@/app/api/creators/dishes/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/dishes/photo/route.ts', load: () => import('@/app/api/creators/dishes/photo/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/dishes/[id]/route.ts', load: () => import('@/app/api/creators/dishes/[id]/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/dishes/[id]/restore/route.ts', load: () => import('@/app/api/creators/dishes/[id]/restore/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/dishes/[id]/submit/route.ts', load: () => import('@/app/api/creators/dishes/[id]/submit/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/home/route.ts', load: () => import('@/app/api/creators/home/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/leaderboard/route.ts', load: () => import('@/app/api/creators/leaderboard/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/me/roles/route.ts', load: () => import('@/app/api/creators/me/roles/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/my-dishes/route.ts', load: () => import('@/app/api/creators/my-dishes/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/profile/route.ts', load: () => import('@/app/api/creators/profile/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creators/public/[slug]/route.ts', load: () => import('@/app/api/creators/public/[slug]/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creator/connect/route.ts', load: () => import('@/app/api/creator/connect/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creator/earnings/route.ts', load: () => import('@/app/api/creator/earnings/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creator/affiliate-content/route.ts', load: () => import('@/app/api/creator/affiliate-content/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creator/affiliate-opportunities/route.ts', load: () => import('@/app/api/creator/affiliate-opportunities/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/creator/affiliate-stats/route.ts', load: () => import('@/app/api/creator/affiliate-stats/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/admin/creator-earnings/mature/route.ts', load: () => import('@/app/api/admin/creator-earnings/mature/route') },
  { family: 'creator', flag: 'CREATOR_ENABLED', path: 'app/api/admin/creator-payouts/run/route.ts', load: () => import('@/app/api/admin/creator-payouts/run/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/register/route.ts', load: () => import('@/app/api/supplier/register/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/approve/route.ts', load: () => import('@/app/api/supplier/approve/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/admin/status/route.ts', load: () => import('@/app/api/supplier/admin/status/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/catalog/route.ts', load: () => import('@/app/api/supplier/catalog/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/catalog/import/route.ts', load: () => import('@/app/api/supplier/catalog/import/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/clients/route.ts', load: () => import('@/app/api/supplier/clients/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/connect/route.ts', load: () => import('@/app/api/supplier/connect/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/orders/route.ts', load: () => import('@/app/api/supplier/orders/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/orders/[id]/route.ts', load: () => import('@/app/api/supplier/orders/[id]/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/supplier/profile/route.ts', load: () => import('@/app/api/supplier/profile/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/admin/suppliers/route.ts', load: () => import('@/app/api/admin/suppliers/route') },
  { family: 'supplier', flag: 'SUPPLIER_ENABLED', path: 'app/api/admin/suppliers/coherence/route.ts', load: () => import('@/app/api/admin/suppliers/coherence/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/apply/route.ts', load: () => import('@/app/api/franchise/apply/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/approve/route.ts', load: () => import('@/app/api/franchise/approve/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/applications/route.ts', load: () => import('@/app/api/franchise/applications/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/brands/route.ts', load: () => import('@/app/api/franchise/brands/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/connect/route.ts', load: () => import('@/app/api/franchise/connect/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/finances/route.ts', load: () => import('@/app/api/franchise/finances/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/my-dashboard/route.ts', load: () => import('@/app/api/franchise/my-dashboard/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/pos/route.ts', load: () => import('@/app/api/franchise/pos/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/pos/[id]/route.ts', load: () => import('@/app/api/franchise/pos/[id]/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchise/profile/route.ts', load: () => import('@/app/api/franchise/profile/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/franchisee/applications/route.ts', load: () => import('@/app/api/franchisee/applications/route') },
  { family: 'franchise', flag: 'FRANCHISE_ENABLED', path: 'app/api/admin/franchise-settlements/run/route.ts', load: () => import('@/app/api/admin/franchise-settlements/run/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/register/route.ts', load: () => import('@/app/api/logistics/register/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/availability/route.ts', load: () => import('@/app/api/logistics/availability/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/connect/route.ts', load: () => import('@/app/api/logistics/connect/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/earnings/route.ts', load: () => import('@/app/api/logistics/earnings/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/justificatifs/route.ts', load: () => import('@/app/api/logistics/justificatifs/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/route.ts', load: () => import('@/app/api/logistics/missions/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/mine/route.ts', load: () => import('@/app/api/logistics/missions/mine/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/request/route.ts', load: () => import('@/app/api/logistics/missions/request/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/[id]/accept/route.ts', load: () => import('@/app/api/logistics/missions/[id]/accept/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/[id]/cancel/route.ts', load: () => import('@/app/api/logistics/missions/[id]/cancel/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/[id]/decline/route.ts', load: () => import('@/app/api/logistics/missions/[id]/decline/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/[id]/deliver/route.ts', load: () => import('@/app/api/logistics/missions/[id]/deliver/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/missions/[id]/pickup/route.ts', load: () => import('@/app/api/logistics/missions/[id]/pickup/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/position/route.ts', load: () => import('@/app/api/logistics/position/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/profile/route.ts', load: () => import('@/app/api/logistics/profile/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/logistics/withdraw/route.ts', load: () => import('@/app/api/logistics/withdraw/route') },
  { family: 'logistics', flag: 'LOGISTICS_ENABLED', path: 'app/api/admin/logistics/activation/route.ts', load: () => import('@/app/api/admin/logistics/activation/route') },
]

beforeEach(() => { for (const f of ROLE_FLAGS) delete process.env[f]; prismaTouched.count = 0 })
afterEach(() => { for (const f of ROLE_FLAGS) delete process.env[f] })

function reqFor(verb: string) {
  const init: RequestInit = { method: verb, headers: { 'content-type': 'application/json' } }
  if (verb === 'POST' || verb === 'PATCH' || verb === 'PUT') init.body = '{}'
  return new Request('http://x/api/gated', init)
}

describe('P0-06 — flag de rôle OFF → 404 sur chaque verbe de chaque route, zéro accès DB', () => {
  for (const row of ROUTES) {
    it(`${row.path} — 404 OFF (${row.flag})`, async () => {
      const mod = await row.load()
      const verbs = VERBS.filter((v) => typeof mod[v] === 'function')
      expect(verbs.length, 'au moins un handler exporté').toBeGreaterThan(0)
      for (const v of verbs) {
        const h = mod[v] as (r: Request, ctx?: unknown) => Promise<Response>
        const res = await h(reqFor(v), { params: { id: 'x', slug: 'x' } })
        expect(res.status, `${v} ${row.path}`).toBe(404)
      }
      expect(prismaTouched.count, 'AUCUN accès prisma quand le flag est OFF').toBe(0)
    })
  }
})

describe('P0-06 — flag ON → le gate s\'ouvre (la réponse n\'est plus le 404 du gate)', () => {
  const SAMPLE: Array<[string, string, () => Promise<Record<string, unknown>>]> = [
    ['CREATOR_ENABLED', 'GET', () => import('@/app/api/creators/leaderboard/route')],
    ['SUPPLIER_ENABLED', 'POST', () => import('@/app/api/supplier/register/route')],
    ['FRANCHISE_ENABLED', 'GET', () => import('@/app/api/franchise/brands/route')],
    ['LOGISTICS_ENABLED', 'GET', () => import('@/app/api/logistics/profile/route')],
  ]
  for (const [flag, verb, load] of SAMPLE) {
    it(`${flag}=true → contrôle positif (${verb})`, async () => {
      process.env[flag] = 'true'
      const mod = await load()
      const h = mod[verb] as (r: Request, ctx?: unknown) => Promise<Response>
      const res = await h(reqFor(verb), { params: {} })
      expect(res.status).not.toBe(404)
    })
  }
})

describe('P0-06 — webhook fournisseur: DOUBLE flag (rôle ET connect), 404 avant le secret', () => {
  it('tout OFF → 404 ; rôle seul → 404 ; rôle+connect → le gate s\'ouvre (400 secret absent)', async () => {
    delete process.env.SUPPLIER_CONNECT_ENABLED
    delete process.env.STRIPE_SUPPLIER_WEBHOOK_SECRET
    const { POST } = await import('@/app/api/webhooks/stripe-supplier/route')
    expect((await POST(reqFor('POST'))).status).toBe(404)
    process.env.SUPPLIER_ENABLED = 'true'
    expect((await POST(reqFor('POST'))).status).toBe(404)
    process.env.SUPPLIER_CONNECT_ENABLED = 'true'
    const open = await POST(reqFor('POST'))
    expect(open.status).not.toBe(404) // 400 webhook_not_configured — le secret n'est lu qu'APRÈS le gate
    delete process.env.SUPPLIER_CONNECT_ENABLED
  })
})
