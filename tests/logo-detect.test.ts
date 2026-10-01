import { describe, it, expect } from 'vitest'
import { extractLogoCandidates, isLogoPrefillEnabled, MAX_LOGO_CANDIDATES } from '@/lib/logo-detect'

// ── Logo candidate detection — pure HTML parsing (Agent 92) ───────────────────────────
// Ordered, deduped, absolute candidates from og:image / apple-touch-icon / icon. No network,
// no writes; each returned URL is later re-validated + fetched through the SSRF guards.

describe('extractLogoCandidates', () => {
  it('prioritises og:image then apple-touch-icon then favicon; absolutises relative URLs', () => {
    const html = `
      <head>
        <meta property="og:image" content="https://cdn.example.com/logo-og.png">
        <link rel="apple-touch-icon" href="/touch-icon.png">
        <link rel="icon" href="favicon.ico">
      </head>`
    const out = extractLogoCandidates(html, 'https://example.com/accueil')
    expect(out[0]).toBe('https://cdn.example.com/logo-og.png')
    expect(out).toContain('https://example.com/touch-icon.png')   // relative → absolute
    expect(out).toContain('https://example.com/favicon.ico')
    expect(out.indexOf('https://cdn.example.com/logo-og.png'))
      .toBeLessThan(out.indexOf('https://example.com/favicon.ico')) // og before favicon
  })

  it('dedupes, decodes &amp;, ignores non-http(s), and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => `<meta property="og:image" content="https://x.com/a${i}.png">`).join('')
    const html = `
      <meta property="og:image" content="https://x.com/a.png?u=1&amp;v=2">
      <meta property="og:image" content="https://x.com/a.png?u=1&amp;v=2">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">
      ${many}`
    const out = extractLogoCandidates(html, 'https://x.com')
    expect(out).toContain('https://x.com/a.png?u=1&v=2')                  // &amp; decoded
    expect(out.filter((u) => u === 'https://x.com/a.png?u=1&v=2').length).toBe(1) // deduped
    expect(out.some((u) => u.startsWith('data:'))).toBe(false)            // non-http(s) ignored
    expect(out.some((u) => u.startsWith('javascript:'))).toBe(false)
    expect(out.length).toBeLessThanOrEqual(MAX_LOGO_CANDIDATES)
  })

  it('returns [] (never throws) when there is nothing to find', () => {
    expect(extractLogoCandidates('<html><body>no icons here</body></html>', 'https://x.com')).toEqual([])
    expect(extractLogoCandidates('', 'https://x.com')).toEqual([])
  })
})

describe('isLogoPrefillEnabled — flag (own, distinct from site-prefill)', () => {
  it('only the exact string true enables it', () => {
    delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED
    expect(isLogoPrefillEnabled()).toBe(false)
    process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED = 'true'
    expect(isLogoPrefillEnabled()).toBe(true)
    process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED = '1'
    expect(isLogoPrefillEnabled()).toBe(false)
    delete process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED
  })
})
