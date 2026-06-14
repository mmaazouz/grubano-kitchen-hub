import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeVerifyCode } from '@/lib/verify-code'

// ── POST /api/creators/apply/[id]/verify — distinct YouTube buckets (14B-A) ───
// Path A returns ONE actionable reason per failure instead of a single
// "introuvable": youtube_config (no API key), youtube_unresolved (bad link),
// youtube_unavailable (stats unreadable), code_not_found (ownership). The happy
// path still verifies — and forwards the role to the (role-aware) vetting.

const { db } = vi.hoisted(() => ({
  db: {
    creatorApplication: { findUnique: vi.fn(), update: vi.fn() },
    creator:            { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { vetMock } = vi.hoisted(() => ({ vetMock: vi.fn() }))
vi.mock('@/lib/creator-vetting', () => ({ vetCreator: vetMock }))

const { yt } = vi.hoisted(() => ({
  yt: {
    hasYouTubeKey:        vi.fn(),
    resolveChannelId:     vi.fn(),
    getChannelStats:      vi.fn(),
    getRecentVideoTitles: vi.fn(),
  },
}))
vi.mock('@/lib/youtube', () => yt)

import { POST } from '@/app/api/creators/apply/[id]/verify/route'

const verify = (id: string, body: Record<string, unknown>) =>
  POST(
    new Request(`https://business.grubano.com/api/creators/apply/${id}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    { params: { id } },
  )

const APP = {
  id: 'app1', name: 'NoobMaster', email: 'noob@example.fr',
  bio: 'Streamer gaming depuis 2018.', instagram: null, tiktok: null,
  youtube: 'https://youtube.com/@noobmaster', followers: 0,
  status: 'pending', dishConcepts: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.creatorApplication.findUnique.mockResolvedValue({ ...APP })
  db.creatorApplication.update.mockResolvedValue({})
  db.creator.findUnique.mockResolvedValue(null)
  db.creator.findFirst.mockResolvedValue(null)
  db.creator.upsert.mockResolvedValue({ id: 'cr1', verified: true, referralLinkSlug: 'noobab12' })
  yt.hasYouTubeKey.mockReturnValue(true)
  yt.resolveChannelId.mockResolvedValue({ channelId: 'UCchannel', viaSearch: false })
  yt.getChannelStats.mockResolvedValue({ subscriberCount: 50000, title: 'NoobMaster', description: 'x', topicCategories: ['Video game culture'] })
  yt.getRecentVideoTitles.mockResolvedValue(['speedrun', 'rage quit'])
  vetMock.mockResolvedValue({ verdict: 'pass', reason: 'audience réelle', foodRelevance: 0 })
})

describe('Path A — distinct failure buckets', () => {
  it('no API key → youtube_config (no Creator created, resolver never called)', async () => {
    yt.hasYouTubeKey.mockReturnValue(false)
    const out = await (await verify('app1', { roles: { chef: false, influencer: true } })).json()
    expect(out).toMatchObject({ ok: false, reason: 'youtube_config' })
    expect(yt.resolveChannelId).not.toHaveBeenCalled()
    expect(db.creator.upsert).not.toHaveBeenCalled()
  })
  it('unresolvable link → youtube_unresolved', async () => {
    yt.resolveChannelId.mockResolvedValue(null)
    const out = await (await verify('app1', {})).json()
    expect(out).toMatchObject({ ok: false, reason: 'youtube_unresolved' })
  })
  it('channel found but stats unreadable → youtube_unavailable', async () => {
    yt.getChannelStats.mockResolvedValue(null)
    const out = await (await verify('app1', {})).json()
    expect(out).toMatchObject({ ok: false, reason: 'youtube_unavailable' })
  })
  it('stats ok but ownership code missing on a PRECISE match → code_not_found (retry)', async () => {
    yt.getChannelStats.mockResolvedValue({ subscriberCount: 50000, title: 'NoobMaster', description: 'no code here', topicCategories: [] })
    const out = await (await verify('app1', {})).json()
    expect(out).toMatchObject({ ok: false, reason: 'code_not_found' })
    expect(vetMock).not.toHaveBeenCalled()
  })
  it('code missing on a SEARCH match → youtube_unresolved, NOT a code_not_found loop', async () => {
    // The fuzzy search fallback likely matched a stranger's channel: send the
    // user to fix the link instead of looping on the retry screen.
    yt.resolveChannelId.mockResolvedValue({ channelId: 'UCstranger', viaSearch: true })
    yt.getChannelStats.mockResolvedValue({ subscriberCount: 999999, title: 'Someone Else', description: 'a popular unrelated channel', topicCategories: [] })
    const out = await (await verify('app1', {})).json()
    expect(out).toMatchObject({ ok: false, reason: 'youtube_unresolved' })
    expect(vetMock).not.toHaveBeenCalled()
  })
})

describe('Path A — happy path (gaming influencer accepted)', () => {
  it('code present + vet pass + subs over threshold → approved, role forwarded to vetting', async () => {
    const code = makeVerifyCode('app1')
    yt.getChannelStats.mockResolvedValue({
      subscriberCount: 50000, title: 'NoobMaster',
      description: `Gaming channel. Grubano: ${code}`, topicCategories: ['Video game culture'],
    })
    const out = await (await verify('app1', { roles: { chef: false, influencer: true } })).json()
    expect(out.ok).toBe(true)
    expect(out.status).toBe('approved')
    expect(vetMock).toHaveBeenCalledWith(expect.objectContaining({ roles: { chef: false, influencer: true } }))
    expect(db.creator.upsert).toHaveBeenCalled()
  })
})
