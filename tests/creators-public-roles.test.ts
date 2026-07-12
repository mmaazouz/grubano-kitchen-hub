import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/creators/public/[slug] — role-aware payload (Mission 14B) ────────
// The public profile now surfaces the creator's role flags so the page can
// render a pure influencer as an AMBASSADOR (no "chef créateur" label, no recipe
// sections) while a chef / chef+influencer keeps the full chef page. Tolerant:
// readCreatorRoles degrades a missing column to both-true (the chef view).

const { db } = vi.hoisted(() => ({
  db: {
    creator:         { findFirst: vi.fn() },
    dishSale:        { groupBy: vi.fn() },
    creatorCampaign: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { rolesMock, starsMock, sheetsMock } = vi.hoisted(() => ({
  rolesMock: vi.fn(), starsMock: vi.fn(), sheetsMock: vi.fn(),
}))
vi.mock('@/lib/creator-roles', () => ({ readCreatorRoles: rolesMock }))
vi.mock('@/lib/creator-stars', () => ({ computeStarsForCreators: starsMock }))
vi.mock('@/lib/dish-sheet-db', () => ({ readDishSheets: sheetsMock }))
vi.mock('@/lib/dish-sheet', () => ({ publicFace: () => null }))

import { GET } from '@/app/api/creators/public/[slug]/route'

const get = (slug: string) =>
  GET(new Request(`https://grubano.com/api/creators/public/${slug}`), { params: { slug } })

beforeEach(() => {
  vi.clearAllMocks()
  db.creator.findFirst.mockResolvedValue({
    id: 'cr1', name: 'NoobMaster', bio: 'Gaming', followers: 50000, verified: true,
    instagram: null, tiktok: null, youtube: '@noob',
    referralCode: 'NOOB20', referralLinkSlug: 'noob20',
    dishes: [],
  })
  db.creatorCampaign.findMany.mockResolvedValue([])
  starsMock.mockResolvedValue(new Map())
  sheetsMock.mockResolvedValue(new Map())
  rolesMock.mockResolvedValue({ isChef: false, isInfluencer: true })
})

describe('role passthrough', () => {
  it('surfaces a pure influencer (isChef false / isInfluencer true), recipes empty', async () => {
    const res = await get('noob20')
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.roles).toEqual({ isChef: false, isInfluencer: true })
    expect(rolesMock).toHaveBeenCalledWith('cr1')
    expect(out.recipes).toEqual([])
  })

  it('tolerant default: both-true roles (pre-db-push) → chef view downstream', async () => {
    rolesMock.mockResolvedValue({ isChef: true, isInfluencer: true })
    const out = await (await get('noob20')).json()
    expect(out.roles).toEqual({ isChef: true, isInfluencer: true })
  })

  it('404 when the slug matches no creator', async () => {
    db.creator.findFirst.mockResolvedValue(null)
    expect((await get('ghost')).status).toBe(404)
  })
})
