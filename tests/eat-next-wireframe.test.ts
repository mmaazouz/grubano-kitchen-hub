import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── Consumer redesign wireframes — Phase 1 (Agent 127) ─────────────────────────
// Two things matter for a wireframe brick: (a) it is GATED (flag OFF → notFound), and
// (b) it is ISOLATED from the money engine (no money route/lib is imported or called).

const { nav } = vi.hoisted(() => ({ nav: { notFound: vi.fn() } }))
vi.mock('next/navigation', () => ({ notFound: nav.notFound }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/components/eat-next/WireframeNav', () => ({ default: () => null }))

import { isConsumerRedesignEnabled } from '@/lib/consumer-redesign'
import EatNextLayout from '@/app/[locale]/eat-next/layout'

const OLD = process.env.CONSUMER_REDESIGN_ENABLED
beforeEach(() => { vi.clearAllMocks() })
afterAll(() => {
  if (OLD === undefined) delete process.env.CONSUMER_REDESIGN_ENABLED
  else process.env.CONSUMER_REDESIGN_ENABLED = OLD
})

describe('(a) gating — CONSUMER_REDESIGN_ENABLED', () => {
  it('flag helper reads the env (off→false, on→true)', () => {
    process.env.CONSUMER_REDESIGN_ENABLED = 'false'
    expect(isConsumerRedesignEnabled()).toBe(false)
    process.env.CONSUMER_REDESIGN_ENABLED = 'true'
    expect(isConsumerRedesignEnabled()).toBe(true)
  })

  it('layout calls notFound() when OFF, and does NOT when ON', () => {
    // Mirror the real notFound(): it THROWS to halt rendering (so OFF never reaches JSX).
    nav.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })

    process.env.CONSUMER_REDESIGN_ENABLED = 'false'
    expect(() => EatNextLayout({ children: null, params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    expect(nav.notFound).toHaveBeenCalledTimes(1)

    // ON → the gate passes; notFound is NOT called. (The JSX return isn't exercised in a
    // node test runtime — any render-time ReferenceError is irrelevant to the gate.)
    nav.notFound.mockClear()
    process.env.CONSUMER_REDESIGN_ENABLED = 'true'
    try { EatNextLayout({ children: null, params: { locale: 'fr' } }) } catch { /* JSX render in node — ignored */ }
    expect(nav.notFound).not.toHaveBeenCalled()
  })
})

describe('(b) money isolation — wireframes never touch the money engine', () => {
  // Recursively collect every source file in the wireframe surface.
  const roots = ['app/[locale]/eat-next', 'components/eat-next', 'lib/consumer-redesign.ts']
  const files: string[] = []
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e))
    else if (/\.(ts|tsx)$/.test(p)) files.push(p)
  }
  for (const r of roots) walk(join(process.cwd(), r))

  // Forbidden: any money route or money lib (the engine is byte-identical + untouched).
  const FORBIDDEN = [
    /api\/orders/, /\/pay\b/, /webhooks\/stripe/,
    /lib\/commission/, /lib\/ledger/, /lib\/stripe/, /lib\/loyalty/, /lib\/promotions/, /lib\/pricing/,
    /@\/lib\/prisma/, /computeApplicationFee/, /recordLedgerEntry/, /createTicketPayment/,
  ]

  it('collected the wireframe source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(9) // layout + 7 pages + mock + nav + flag
  })

  // Strip comments so we test ACTUAL code, not prose (our comments deliberately MENTION
  // the money routes to state they are NOT used). Keeps the char before `//` so `https://`
  // inside a string survives.
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it('no wireframe file imports/calls any money route or money lib (comments stripped)', () => {
    const offenders: string[] = []
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      for (const re of FORBIDDEN) {
        if (re.test(code)) offenders.push(`${f} :: ${re}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no wireframe file does a fetch() to an /api/orders or pay endpoint', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (/fetch\(\s*['"`][^'"`]*\/api\/(orders|.*pay)/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  // The Stellar-dressed checkout (Agent 129) is STILL a mock: its only navigation target
  // is the tracking screen — it never confirms an order via any money route.
  it('checkout navigates ONLY to /eat-next/track (still a mock, not wired)', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'app/[locale]/eat-next/checkout/page.tsx'), 'utf8'))
    const targets = [...src.matchAll(/router\.push\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    expect(targets).toEqual(['/eat-next/track'])
  })
})
