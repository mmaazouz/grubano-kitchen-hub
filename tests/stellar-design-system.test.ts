import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── Stellar Unity design system — Phase 1 (Agent 128) ──────────────────────────
// It's pure design, so what matters: (a) it touches NO money/data, (b) it is SCOPED
// (the theme can't leak globally — no bare :root), (c) the Tailwind additions are
// additive (existing namespaces preserved). The showcase page is gated by the
// eat-next layout (covered by tests/eat-next-wireframe.test.ts).

const ROOT = process.cwd()
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// Collect the Stellar surface source files.
const files: string[] = []
const walk = (p: string) => {
  const st = statSync(p)
  if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e))
  else if (/\.(ts|tsx)$/.test(p)) files.push(p)
}
walk(join(ROOT, 'components/stellar'))
files.push(join(ROOT, 'app/[locale]/eat-next/design-system/page.tsx'))
files.push(join(ROOT, 'lib/consumer-redesign.ts'))

describe('(a) money/data isolation', () => {
  const FORBIDDEN = [
    /api\/orders/, /\/pay\b/, /webhooks\/stripe/,
    /lib\/commission/, /lib\/ledger/, /lib\/stripe/, /lib\/loyalty/, /lib\/promotions/, /lib\/pricing/,
    /@\/lib\/prisma/, /\bprisma\./,
  ]
  it('no Stellar source imports/uses any money or data layer (comments stripped)', () => {
    const offenders: string[] = []
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      for (const re of FORBIDDEN) if (re.test(code)) offenders.push(`${f} :: ${re}`)
    }
    expect(offenders).toEqual([])
  })
  it('Stellar primitives do NOT import the existing design-system barrel (independent namespace)', () => {
    const offenders = files
      .filter((f) => f.includes(join('components', 'stellar')))
      .filter((f) => /@\/components\/design-system/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('(b) scoping — the theme cannot leak globally', () => {
  const css = readFileSync(join(ROOT, 'app/stellar-theme.css'), 'utf8')
  it('every token block is scoped under .grubano-v2 (no bare :root)', () => {
    expect(css).toContain('.grubano-v2')
    expect(/(^|\})\s*:root\s*\{/.test(css)).toBe(false) // no global :root selector
  })
})

describe('(c) Tailwind additions are additive', () => {
  const tw = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8')
  it('keeps the existing namespaces AND adds the stellar one', () => {
    expect(tw).toContain('grubano:')        // existing namespace preserved
    expect(tw).toContain('bolt:')           // existing namespace preserved
    expect(tw).toContain('stellar:')        // new namespace added
    expect(tw).toContain("'stellar-display'")
  })
})
