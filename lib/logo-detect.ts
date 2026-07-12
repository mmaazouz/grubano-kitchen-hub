// ── Logo candidate detection (onboarding copilot brique 3 — Agent 92) ─────────────────
//
// PURE HTML parsing — NO LLM. A restaurant logo is reliably advertised by standard meta/
// link tags (og:image, apple-touch-icon, icon, og:logo, twitter:image), so a deterministic
// heuristic beats an LLM call here (no cost, no quota, no latency, fully testable). We
// return an ORDERED list of ABSOLUTE candidate URLs (best logo-ish first); the endpoint
// then fetches each via lib/safe-fetch (SSRF-safe) until one yields a valid raster image.
//
// This module does NO network and NO writes. The candidate URLs are NOT trusted: each is
// re-validated + fetched through the SSRF guards before anything is shown or stored.

export function isLogoPrefillEnabled(): boolean {
  return process.env.ONBOARDING_AI_LOGO_PREFILL_ENABLED === 'true'
}

export const MAX_LOGO_CANDIDATES = 6 // bound how many candidates the endpoint will try

const decodeEntities = (s: string): string =>
  s.replace(/&amp;/gi, '&').replace(/&#x2f;/gi, '/').replace(/&#47;/gi, '/').replace(/&quot;/gi, '"').trim()

// Pull the value of an attribute (content=, href=) from a single tag string.
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  if (!m) return null
  const raw = m[2] ?? m[3] ?? m[4] ?? ''
  return raw ? decodeEntities(raw) : null
}

function absolutize(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * Extract ordered, deduped, absolute logo candidate URLs from page HTML. Priority:
 *   1. og:logo / og:image / twitter:image (the brand's chosen share image — usually the logo)
 *   2. apple-touch-icon (a clean square brand icon)
 *   3. <link rel="icon" | "shortcut icon"> (favicon — last resort)
 * Returns at most MAX_LOGO_CANDIDATES. NEVER throws.
 */
export function extractLogoCandidates(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const push = (href: string | null) => {
    if (!href) return
    const abs = absolutize(href, baseUrl)
    if (abs && /^https?:/i.test(abs) && !out.includes(abs)) out.push(abs)
  }

  const metas = html.match(/<meta\b[^>]*>/gi) ?? []
  const metaContent = (prop: string): string | null => {
    for (const tag of metas) {
      const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase()
      if (key === prop) return attr(tag, 'content')
    }
    return null
  }

  // 1) Open Graph / Twitter brand images (best logo signal).
  push(metaContent('og:logo'))
  push(metaContent('og:image:secure_url'))
  push(metaContent('og:image'))
  push(metaContent('twitter:image'))

  // 2/3) <link rel="...icon..."> — apple-touch-icon before plain favicon.
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  const byRel = (...wanted: string[]): string[] =>
    links
      .filter((tag) => {
        const rel = (attr(tag, 'rel') ?? '').toLowerCase()
        return wanted.some((w) => rel.split(/\s+/).includes(w))
      })
      .map((tag) => attr(tag, 'href'))
      .filter((h): h is string => !!h)

  byRel('apple-touch-icon', 'apple-touch-icon-precomposed').forEach(push)
  byRel('icon', 'shortcut').forEach(push) // "shortcut icon" → rel tokens include "shortcut"

  return out.slice(0, MAX_LOGO_CANDIDATES)
}
