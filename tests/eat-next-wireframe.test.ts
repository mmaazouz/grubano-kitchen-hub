import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── Consumer redesign wireframes — Phase 1 (Agent 127) ─────────────────────────
// Two things matter for a wireframe brick: (a) it is GATED (flag OFF → notFound), and
// (b) it is ISOLATED from the money engine (no money route/lib is imported or called).

const { nav } = vi.hoisted(() => ({ nav: { notFound: vi.fn() } }))
vi.mock('next/navigation', () => ({ notFound: nav.notFound }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn(), getTranslations: vi.fn(async () => (k: string) => k) }))
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

  it('layout calls notFound() when OFF, and does NOT when ON', async () => {
    // Mirror the real notFound(): it THROWS to halt rendering. The layout is an ASYNC server
    // component (Agent 135 — it awaits getTranslations), so a thrown notFound() surfaces as a
    // REJECTED promise rather than a synchronous throw.
    nav.notFound.mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })

    process.env.CONSUMER_REDESIGN_ENABLED = 'false'
    await expect(EatNextLayout({ children: null, params: { locale: 'fr' } })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(nav.notFound).toHaveBeenCalledTimes(1)

    // ON → the gate passes; notFound is NOT called. (A render-time error in the node test runtime
    // is irrelevant to the gate — we only assert notFound was not invoked.)
    nav.notFound.mockClear()
    process.env.CONSUMER_REDESIGN_ENABLED = 'true'
    await EatNextLayout({ children: null, params: { locale: 'fr' } }).catch(() => { /* JSX render in node — ignored */ })
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

  // Forbidden: the money ENGINE must never be re-implemented inside /eat-next.
  // NOTE (Agent 130, brick 2a): `@/lib/prisma` is NO LONGER forbidden — the navigation screens READ
  // real restaurants/menus via a read-only data module (reads allowed, writes not — see the mutation
  // scan below).
  // NOTE (Agent 134, brick 2d): `/api/orders` + `/pay` are NO LONGER forbidden — the checkout now
  // CALLS those PUBLIC routes (byte-identical, server is the money authority). What stays forbidden:
  // importing a money LIB or the webhook (no client-side money RECOMPUTE; the engine is reused, never
  // forked). consumerId/total/discount are server-set — verified by the order-body unit test.
  const FORBIDDEN = [
    /webhooks\/stripe/,
    /lib\/commission/, /lib\/ledger/, /lib\/stripe/, /lib\/loyalty/, /lib\/promotions/, /lib\/pricing/,
    /computeApplicationFee/, /recordLedgerEntry/, /createTicketPayment/,
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

  // (Agent 134, brick 2d) The checkout now CALLS /api/orders + /pay (byte-identical routes), but its
  // NAVIGATION must stay inside the redesign: it goes to its OWN /eat-next/track/[orderId], never to
  // /eat or the API's trackingUrl (which points at /eat). Every router.push target in the checkout
  // must start with '/eat-next'.
  it('checkout navigations stay within /eat-next (never /eat or an external trackingUrl)', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'app/[locale]/eat-next/checkout/page.tsx'), 'utf8'))
    const targets = Array.from(src.matchAll(/router\.push\(\s*[`'"]([^`'"$]*)/g), (m) => m[1])
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) expect(t.startsWith('/eat-next')).toBe(true)
  })

  // READ-ONLY (Agent 130): the data layer may READ Prisma but must never MUTATE. No file in the
  // eat-next surface may call a Prisma write method or raw SQL — only findMany/findFirst/findUnique/
  // count are allowed (comments stripped so prose mentioning a method does not trip the scan).
  it('no eat-next file performs a Prisma mutation or raw SQL — reads only', () => {
    const MUTATION = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$(execute|query)Raw/
    const offenders: string[] = []
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      if (MUTATION.test(code)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  // (Agent 136) The track screen MIRRORS /eat's webhook-race handling by POSTing the EXISTING
  // (byte-identical) /api/orders/[id]/confirm route — it only CALLS it (no money recompute, no write).
  it('track/[orderId] POSTs the confirm route (webhook-race email mirror of /eat)', () => {
    const src = readFileSync(join(process.cwd(), 'app/[locale]/eat-next/track/[orderId]/page.tsx'), 'utf8')
    expect(/fetch\(`\/api\/orders\/\$\{orderId\}\/confirm`,\s*\{\s*method:\s*'POST'\s*\}\)/.test(src)).toBe(true)
  })

})
