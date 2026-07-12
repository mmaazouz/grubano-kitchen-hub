// tests/affiliate-content.test.ts — Studio de contenu 2b (Agent 14).
// PURE engine: prompt builder, robust parse (link guaranteed), rate limiter.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildCaptionPrompt, parseCaptions, rateLimitCheck, __resetRateLimit,
  RATE_LIMIT_MAX, CONTENT_TONES,
} from '@/lib/affiliate-content'

const base = { restaurantName: 'Gnocchi Bar', cuisine: 'italien', dishName: 'Gnocchi truffe', dishPrice: 12.5,
  link: 'https://grubano.com/ref/marco20?to=%2Ffr%2Feat%2Fr%2Frest1', code: 'MARCO20', locale: 'fr' }

describe('buildCaptionPrompt', () => {
  it('embeds the real subject + the exact share link + the 3 tones', () => {
    const p = buildCaptionPrompt(base)
    expect(p).toContain('Gnocchi truffe')
    expect(p).toContain('Gnocchi Bar')
    expect(p).toContain(base.link)                 // exact link verbatim
    expect(p).toContain('enthusiastic')
    expect(p).toContain('punchy')
    expect(p).toContain('storytelling')
    expect(p).toContain('French')                  // locale → language
  })
  it('falls back to the restaurant when no dish', () => {
    const p = buildCaptionPrompt({ ...base, dishName: null, dishPrice: null })
    expect(p).toContain('the restaurant Gnocchi Bar')
  })
})

describe('parseCaptions — robust + link guaranteed', () => {
  const share = base.link
  it('parses a clean payload', () => {
    const raw = JSON.stringify({ captions: [
      { tone: 'enthusiastic', text: `Trop bon ! ${share}` },
      { tone: 'punchy', text: `Go. ${share}` },
      { tone: 'storytelling', text: `Un soir... ${share}` },
    ] })
    const out = parseCaptions(raw, share)!
    expect(out).toHaveLength(3)
    expect(out.every(c => CONTENT_TONES.includes(c.tone))).toBe(true)
  })
  it('APPENDS the share link when the model dropped it', () => {
    const raw = JSON.stringify({ captions: [{ tone: 'punchy', text: 'Délicieux !' }] })
    const out = parseCaptions(raw, share)!
    expect(out[0].text).toContain(share)
  })
  it('drops invalid tones, tolerates surrounding noise, null on garbage', () => {
    const raw = 'sure!\n{"captions":[{"tone":"weird","text":"x"},{"tone":"punchy","text":"Yum"}]}\nthanks'
    const out = parseCaptions(raw, share)!
    expect(out).toHaveLength(1)
    expect(out[0].tone).toBe('punchy')
    expect(parseCaptions('not json at all', share)).toBeNull()
    expect(parseCaptions('', share)).toBeNull()
  })
})

describe('rateLimitCheck — sliding window per influencer', () => {
  beforeEach(() => __resetRateLimit())
  it('allows up to the cap then blocks', () => {
    const key = 'creatorX'
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect(rateLimitCheck(key).ok).toBe(true)
    const blocked = rateLimitCheck(key)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetMs).toBeGreaterThan(0)
  })
  it('is per-key (one influencer hitting the cap never blocks another)', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) rateLimitCheck('A')
    expect(rateLimitCheck('A').ok).toBe(false)
    expect(rateLimitCheck('B').ok).toBe(true)
  })
  it('expires old hits outside the window', () => {
    const key = 'creatorT'
    const t0 = 1_000_000
    for (let i = 0; i < RATE_LIMIT_MAX; i++) rateLimitCheck(key, t0)
    expect(rateLimitCheck(key, t0).ok).toBe(false)
    // 25 h later → the window cleared.
    expect(rateLimitCheck(key, t0 + 25 * 60 * 60 * 1000).ok).toBe(true)
  })
})
