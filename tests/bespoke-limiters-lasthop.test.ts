import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveClientIp } from '@/lib/rate-limit'

// ── Durcissement de la cle IP des limiteurs artisanaux ────────────────────────
// Cinq routes portaient leur propre resolveur d'IP qui prenait le PREMIER hop de
// x-forwarded-for — valeur que le client peut forger, donc un bucket neuf a
// chaque requete et un limiteur sans effet. Elles partagent desormais le
// resolveur de lib/rate-limit (DERNIER hop), le meme que le limiteur central.

const SITES = [
  'app/api/partners/register/route.ts',
  'app/api/affiliate/apply/route.ts',
  'app/api/affiliate/join/route.ts',
  'app/api/eat/consumer-provision/route.ts',
  'app/api/eat-next/consumer-provision/route.ts',
]
const src = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const reqWith = (xff?: string, real?: string) =>
  new Request('http://t/x', { method: 'POST', headers: {
    ...(xff ? { 'x-forwarded-for': xff } : {}),
    ...(real ? { 'x-real-ip': real } : {}),
  } })

describe('resolveClientIp — dernier hop, resistant a la forge', () => {
  it('retient le DERNIER element de x-forwarded-for', () => {
    expect(resolveClientIp(reqWith('198.51.100.1, 203.0.113.9'))).toBe('203.0.113.9')
    expect(resolveClientIp(reqWith('203.0.113.9'))).toBe('203.0.113.9')
  })

  it('des premiers hops forges differents donnent la MEME cle', () => {
    const a = resolveClientIp(reqWith('198.51.100.1, 203.0.113.9'))
    const b = resolveClientIp(reqWith('198.51.100.77, 203.0.113.9'))
    expect(a).toBe(b)
  })

  it('trim, elements vides filtres, repli x-real-ip puis bucket partage', () => {
    expect(resolveClientIp(reqWith('a,   203.0.113.9'))).toBe('203.0.113.9')
    expect(resolveClientIp(reqWith('   ', '203.0.113.5'))).toBe('203.0.113.5')
    expect(resolveClientIp(reqWith(undefined, '203.0.113.5'))).toBe('203.0.113.5')
    expect(resolveClientIp(reqWith())).toBe('unknown')
  })
})

describe('les 5 limiteurs artisanaux ne parsent plus x-forwarded-for eux-memes', () => {
  it.each(SITES)('%s importe le resolveur partage et ne redefinit pas clientIp', (p) => {
    const s = src(p)
    expect(s).toContain("resolveClientIp as clientIp } from '@/lib/rate-limit'")
    expect(s).not.toMatch(/function clientIp\s*\(/)
    expect(s).not.toMatch(/x-forwarded-for/)
  })

  it('aucun des 5 ne retient plus le premier hop', () => {
    for (const p of SITES) expect(src(p)).not.toContain("split(',')[0]")
  })
})
