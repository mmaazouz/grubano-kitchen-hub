import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Role-aware creator vetting — Mission 14 (Agent 14) ────────────────────────
// Founder decision: an INFLUENCER's value is their AUDIENCE, not cooking. So a
// pure influencer (influencer ✔ / chef ✘) is judged on the OPEN brand-safety
// barème — ANY niche (gaming, lifestyle…) passes; reject ONLY for brand-safety
// or a fake/empty audience. Chef / chef+influencer keep the CULINARY barème,
// byte-for-byte. Ownership proof (the YouTube code) lives in the verify route
// and is untouched.
//
// An LLM verdict cannot run deterministically in CI, so we prove the two halves
// that DO determine the outcome:
//   1) POLICY — the prompt sent per role (the OPEN vs CULINARY barème).
//   2) PLUMBING — a mocked model verdict flows through vetCreator unchanged.

// vetCreator now calls the central gateway (lib/llm), so we mock THAT, not the SDK.
const { llmMock } = vi.hoisted(() => ({ llmMock: vi.fn() }))
vi.mock('@/lib/llm', () => ({ llmComplete: llmMock }))

import { vetCreator, buildCreatorVettingPrompt, type VetCreatorInput } from '@/lib/creator-vetting'

// Canned gateway result: { text } in the strict JSON shape the parser expects.
const reply = (verdict: string, reason = 'ok', foodRelevance = 0) => ({
  text: JSON.stringify({ verdict, reason, foodRelevance }),
})

// A gaming channel — off-topic for FOOD, but a perfectly real, brand-safe audience.
const GAMING: Omit<VetCreatorInput, 'roles'> = {
  channelTitle:       'NoobMaster FR',
  channelDescription: 'Lets plays FPS et speedruns tous les soirs',
  bio:                'Streamer gaming depuis 2018',
  dishConcepts:       [],
  channelTopics:      ['Video game culture', 'Action game'],
  recentVideoTitles:  ['Je teste le nouveau FPS', 'Speedrun à 3h du mat', 'Rage quit compilation'],
}

const CULINARY: Omit<VetCreatorInput, 'roles'> = {
  channelTitle:       'Chez Marco',
  channelDescription: 'Recettes italiennes maison',
  bio:                'Chef italien, pâtes fraîches',
  dishConcepts:       [{ name: 'Gnocchi truffe', description: 'Gnocchi maison crème de truffe', cuisineType: 'italien' }],
  channelTopics:      ['Food'],
  recentVideoTitles:  ['Gnocchi maison', 'La vraie carbonara'],
}

let savedKey: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key' // else vetCreator short-circuits to safeFallback
})
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedKey
})

// ── 1) POLICY — the prompt selected per role (pure, no LLM) ────────────────────
describe('buildCreatorVettingPrompt — role routing', () => {
  const CHEF_MARK = 'credible, relevant FOOD / cooking creator'
  const INFL_MARK = 'BRAND-SAFETY reviewer'

  it('influencer-only → OPEN brand-safety barème (any niche, no culinary requirement)', () => {
    const p = buildCreatorVettingPrompt({ ...GAMING, roles: { chef: false, influencer: true } })
    expect(p).toContain(INFL_MARK)
    expect(p).toContain('niche does NOT matter')
    expect(p).toContain('Do NOT require ANY food')
    expect(p).toContain('Do NOT require a minimum audience size')
    expect(p).not.toContain(CHEF_MARK) // never imposes the culinary test
  })

  it('chef-only → CULINARY barème (unchanged), not the influencer one', () => {
    const p = buildCreatorVettingPrompt({ ...CULINARY, roles: { chef: true, influencer: false } })
    expect(p).toContain(CHEF_MARK)
    expect(p).toContain('off-topic (not about food) OR inappropriate')
    expect(p).not.toContain(INFL_MARK)
  })

  it('chef+influencer → CULINARY barème (a chef still needs cooking content)', () => {
    const p = buildCreatorVettingPrompt({ ...CULINARY, roles: { chef: true, influencer: true } })
    expect(p).toContain(CHEF_MARK)
    expect(p).not.toContain(INFL_MARK)
  })

  it('no roles (legacy client) → CULINARY barème (backward-compatible)', () => {
    const p = buildCreatorVettingPrompt({ ...CULINARY })
    expect(p).toContain(CHEF_MARK)
    expect(p).not.toContain(INFL_MARK)
  })
})

// ── 2) PLUMBING — a mocked verdict flows through, with the right prompt sent ───
describe('vetCreator — influencer-only OPEN barème', () => {
  it('gaming channel + model "pass" → ACCEPTED, and the OPEN prompt was sent', async () => {
    llmMock.mockResolvedValue(reply('pass', 'audience gaming réelle et brand-safe'))
    const out = await vetCreator({ ...GAMING, roles: { chef: false, influencer: true } })
    expect(out.verdict).toBe('pass')
    const sentPrompt = llmMock.mock.calls[0][0].content
    expect(sentPrompt).toContain('BRAND-SAFETY reviewer')
    expect(sentPrompt).not.toContain('credible, relevant FOOD / cooking creator')
  })

  it('disqualifying content + model "reject" → REJECTED (brand safety)', async () => {
    llmMock.mockResolvedValue(reply('reject', 'contenu adulte / illégal'))
    const out = await vetCreator({
      ...GAMING,
      recentVideoTitles: ['contenu adulte explicite'],
      roles: { chef: false, influencer: true },
    })
    expect(out.verdict).toBe('reject')
  })

  it('empty / fake channel + model "reject" → REJECTED (audience not real)', async () => {
    llmMock.mockResolvedValue(reply('reject', 'chaîne vide, aucune vidéo réelle'))
    const out = await vetCreator({
      channelTitle: '', channelDescription: '', bio: '', dishConcepts: [],
      channelTopics: [], recentVideoTitles: [],
      roles: { chef: false, influencer: true },
    })
    expect(out.verdict).toBe('reject')
  })
})

describe('vetCreator — chef barème intact', () => {
  it('chef-only non-culinary + model "reject" → REJECTED, and the CULINARY prompt was sent', async () => {
    llmMock.mockResolvedValue(reply('reject', 'chaîne gaming, pas de contenu culinaire'))
    const out = await vetCreator({ ...GAMING, roles: { chef: true, influencer: false } })
    expect(out.verdict).toBe('reject')
    const sentPrompt = llmMock.mock.calls[0][0].content
    expect(sentPrompt).toContain('credible, relevant FOOD / cooking creator')
    expect(sentPrompt).not.toContain('BRAND-SAFETY reviewer')
  })

  it('chef-only culinary + model "pass" → ACCEPTED', async () => {
    llmMock.mockResolvedValue(reply('pass', 'créateur culinaire crédible'))
    const out = await vetCreator({ ...CULINARY, roles: { chef: true, influencer: false } })
    expect(out.verdict).toBe('pass')
  })
})
