import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Passwordless account-AT-payment on the LIVE /eat checkout (Agent 138) ──────
// Reuses Agent 132's mechanism UNCHANGED via an UN-GATED twin route. The money engine and the
// existing password auth stay byte-identical. The critical guarantee: after signIn the cart's
// POST /api/orders carries the session cookie (no 401), because /eat is wrapped in a NextAuth
// SessionProvider and the sheet re-invokes placeOrder directly (not gated on the async hook).

// ── (1) POST /api/eat/consumer-provision — un-gated twin of the eat-next route ──
const { ensureConsumerByEmail } = vi.hoisted(() => ({ ensureConsumerByEmail: vi.fn() }))
vi.mock('@/lib/consumer-signup', () => ({ ensureConsumerByEmail }))

import { POST } from '@/app/api/eat/consumer-provision/route'

function post(body: unknown, ip: string) {
  return new Request('http://localhost/api/eat/consumer-provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureConsumerByEmail.mockResolvedValue({ ok: true })
})

describe('(1) POST /api/eat/consumer-provision (un-gated, reuses ensureConsumerByEmail)', () => {
  it('provisions a consumer + returns generic {ok:true} (200) for a valid email — NO redesign flag needed', async () => {
    const res = await POST(post({ email: 'Buyer@Email.com' }, '10.0.0.1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(ensureConsumerByEmail).toHaveBeenCalledWith('buyer@email.com')
  })

  it('stays generic {ok:true} even when provisioning fails (anti-enumeration)', async () => {
    ensureConsumerByEmail.mockResolvedValueOnce({ ok: false, reason: 'error' })
    const res = await POST(post({ email: 'whoknows@email.com' }, '10.0.0.2'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a malformed email with 400 (input validation, not enumeration)', async () => {
    const res = await POST(post({ email: 'not-an-email' }, '10.0.0.3'))
    expect(res.status).toBe(400)
    expect(ensureConsumerByEmail).not.toHaveBeenCalled()
  })

  it('rate-limits per-email beyond the threshold (429)', async () => {
    const ip = '10.0.0.4'
    const email = 'ratelimit@email.com'
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) statuses.push((await POST(post({ email }, ip))).status)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]) // EMAIL_MAX = 5
    expect(statuses[5]).toBe(429)
    expect(statuses[6]).toBe(429)
  })

  it('is NOT gated by the consumer-redesign flag (no import of it)', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/eat/consumer-provision/route.ts'), 'utf8')
    expect(/consumer-redesign|isConsumerRedesignEnabled/.test(src)).toBe(false)
  })

  it('provisions through ensureConsumerByEmail (role enforced inside the reused lib, not here)', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/eat/consumer-provision/route.ts'), 'utf8')
    expect(/ensureConsumerByEmail/.test(src)).toBe(true)
    // never sets/elevates a role at the route level — role comes only from the reused lib
    expect(/role\s*:/.test(src)).toBe(false)
  })
})

// ── Source-scan wiring (house style: the structural proof of the session/no-401 guarantee) ──
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CART = 'app/[locale]/eat/cart/page.tsx'
const SHEET = 'components/eat/CheckoutAuthSheet.tsx'
const LAYOUT = 'app/[locale]/eat/layout.tsx'
const AUTH = 'app/[locale]/eat/auth/page.tsx'

describe('(2) session model — signIn → cookie → POST /api/orders passes (no 401 bug)', () => {
  it('/eat is wrapped in a NextAuth SessionProvider (EatSessionProvider)', () => {
    const layout = read(LAYOUT)
    expect(/EatSessionProvider/.test(layout)).toBe(true)
    const provider = read('components/EatSessionProvider.tsx')
    expect(/SessionProvider/.test(provider) && /next-auth\/react/.test(provider)).toBe(true)
  })

  it('the cart opens the passwordless sheet for a guest, then continues to placeOrder on connect', () => {
    const cart = stripComments(read(CART))
    // guest → open sheet (not an immediate redirect)
    expect(/authStatus !== 'authenticated'\s*\)\s*\{\s*setAuthSheet\(true\)/.test(cart)).toBe(true)
    // sheet success → continue STRAIGHT to placeOrder (the POST carries the just-set cookie)
    expect(/onConnected=\{\(\)\s*=>\s*\{\s*setAuthSheet\(false\);\s*placeOrder\(\)\s*\}\}/.test(cart)).toBe(true)
    // the checkout button now routes through handleCheckout
    expect(/onClick=\{handleCheckout\}/.test(cart)).toBe(true)
  })

  it('placeOrder still POSTs /api/orders and keeps its 401 → /eat/auth fallback (money path intact)', () => {
    const cart = read(CART)
    expect(/fetch\('\/api\/orders'/.test(cart)).toBe(true)
    expect(/res\.status === 401[\s\S]{0,80}\/eat\/auth/.test(cart)).toBe(true)
  })

  it('the sheet consumes the code via signIn(credentials, …, redirect:false) and calls onConnected on ok', () => {
    const sheet = stripComments(read(SHEET))
    expect(/signIn\('credentials',\s*\{[^}]*otp[^}]*redirect:\s*false\s*\}\)/.test(sheet)).toBe(true)
    expect(/if\s*\(res\?\.ok\)\s*onConnected\(\)/.test(sheet)).toBe(true)
    // it must NOT reproduce the /eat-next standalone-getSession bug
    expect(/getSession/.test(sheet)).toBe(false)
  })

  it('the sheet calls provision then the UNCHANGED mint (via requestMagicLink), and reads otpEnabled', () => {
    // WAVE 1 (2026-08-29) — le mint passe désormais par lib/magic-link-client
    // (requestMagicLink) qui distingue les échecs de TRANSPORT (429/5xx/réseau)
    // du 2xx générique anti-énumération : fini le faux « e-mail envoyé ».
    const sheet = stripComments(read(SHEET))
    expect(/\/api\/eat\/consumer-provision/.test(sheet)).toBe(true)
    expect(/requestMagicLink/.test(sheet)).toBe(true)
    expect(/otpEnabled/.test(sheet)).toBe(true)
    expect(/linkSent/.test(sheet)).toBe(true) // OFF → fallback message
    // le faux succès est mort : un échec transport affiche une erreur, ne « sent » pas
    expect(/sendErrorRate/.test(sheet)).toBe(true)
    expect(/sendErrorDown/.test(sheet)).toBe(true)
    const client = stripComments(read('lib/magic-link-client.ts'))
    expect(/\/api\/auth\/magic-link/.test(client)).toBe(true)
    expect(/status === 429/.test(client)).toBe(true)
    expect(/rate_limited/.test(client)).toBe(true)
    expect(/unavailable/.test(client)).toBe(true)
  })
})

describe('(3) existing auth intact + (4) money isolation', () => {
  it('the password sign-in (/eat/auth) is unchanged — still signIn(credentials, {email,password})', () => {
    const auth = read(AUTH)
    expect(/signIn\('credentials',\s*\{\s*email,\s*password,\s*redirect:\s*false\s*\}\)/.test(auth)).toBe(true)
  })

  it('the sheet keeps the password path reachable (fallback link to /eat/auth)', () => {
    const sheet = read(SHEET)
    expect(/\/eat\/auth/.test(sheet)).toBe(true)
  })

  it('the new route + sheet never import a money lib or recompute amounts', () => {
    for (const f of ['app/api/eat/consumer-provision/route.ts', SHEET]) {
      const code = stripComments(read(f))
      expect(/lib\/commission|lib\/ledger|lib\/pricing|lib\/stripe|webhooks\/stripe|computeApplicationFee|recordLedgerEntry/.test(code)).toBe(false)
    }
  })
})
