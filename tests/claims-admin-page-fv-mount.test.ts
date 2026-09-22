// tests/claims-admin-page-fv-mount.test.ts — T-49 round 13, D0 « CARD = AdminFinancialVerification. Always mounted »
// (targeted re-audits of 2466e03, d9fb194 and 75f1601), amended by D′ L1 (spec v2 §3.2).
//
// A source-shape pin cannot see a flag gate on an ANCESTOR of the card, an early exit written another way, a wrapper component
// that renders nothing, or an ancestor hidden by an attribute, a style or a class. This file pins the behaviour: the
// /admin/claims server component is called with the claims SURFACE closed (the kill-switch: no product flag, no lease), then
// open, and the tree it returns is RENDERED (react-dom/server) with marker components. With the surface closed, the card must
// be in the markup and none of the hiding shapes checked below may appear on the page. Hiding shapes outside that list (a
// portal, a class or rule a stylesheet hides) are not checked here.
//
// D′ L1: the arbitration console is mounted UNCONDITIONALLY, `<AdminClaimsArbitration surfaceOpen={claimsOpen} />`, inside the
// same ToastProvider island as the card — GET /api/admin/claims is split server-side (surface closed ⇒ workflow lists empty,
// MONEY list still returned), so the money cards it renders are reachable when the surface is closed. The 05152b6 shape
// `{claimsOpen && <AdminClaimsArbitration />}` (console absent when closed) is now a violation, pinned by the negative
// control. The gate is real: the page reads claimsSurfaceOpen() from lib/claim-flags, which reads process.env.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as React from 'react'
import type { FC, ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

vi.stubGlobal('React', React)

const { redirectMock, resolveAdminMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }),
  resolveAdminMock: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (k: string) => k), setRequestLocale: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: resolveAdminMock }))
vi.mock('@/lib/admin-identity', () => ({ buildAdminIdentity: vi.fn(() => ({ name: 'Admin' })) }))
vi.mock('@/lib/influencer-verification', () => ({ isInfluencerEnabled: vi.fn(() => false) }))
vi.mock('@/lib/prestataire-account', () => ({ isPrestataireEnabled: vi.fn(() => false) }))
vi.mock('@/lib/logistics-account', () => ({ isCourierActivationEnabled: vi.fn(() => false) }))
// The real AdminShell and ToastProvider render their children unconditionally; the markers stand in for them.
vi.mock('@/components/admin/AdminShell', () => ({ default: function AdminShell(p: { children?: ReactNode }) { return p.children ?? null } }))
vi.mock('@/components/design-system', () => ({ ToastProvider: function ToastProvider(p: { children?: ReactNode }) { return p.children ?? null } }))
vi.mock('@/components/claims/AdminClaimsArbitration', async () => {
  const R = await import('react')
  // the marker carries the prop the page passes, so the rendered markup shows which surface value the console received
  return { default: function AdminClaimsArbitration(p: { surfaceOpen?: boolean }) { return R.createElement('i', { 'data-arb': '1', 'data-surface-open': String(p.surfaceOpen) }) } }
})
vi.mock('@/components/claims/AdminFinancialVerification', async () => {
  const R = await import('react')
  return { default: function AdminFinancialVerification() { return R.createElement('i', { 'data-fv': '1' }) } }
})

import AdminClaimsPage from '@/app/[locale]/admin/claims/page'
import AdminFinancialVerificationImport from '@/components/claims/AdminFinancialVerification'
import AdminClaimsArbitrationImport from '@/components/claims/AdminClaimsArbitration'
import { ToastProvider as ToastProviderImport } from '@/components/design-system'
import { claimsSurfaceOpen } from '@/lib/claim-flags'

// The mocked markers, typed loosely: elements are compared by type and the tree is rendered with the markers.
const FinancialVerification = AdminFinancialVerificationImport as unknown as FC
const ClaimsArbitration = AdminClaimsArbitrationImport as unknown as FC<{ surfaceOpen?: boolean }>
const Island = ToastProviderImport as unknown as FC<{ children?: ReactNode }>

type El = ReactElement<{ children?: unknown; surfaceOpen?: boolean }>
const isElement = (node: unknown): node is El => !!node && typeof node === 'object' && 'props' in (node as Record<string, unknown>)

/** Every element of `type` in a returned tree (used to check the card sits inside the ToastProvider island). */
function findAll(node: unknown, type: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, type, out)
    return out
  }
  if (isElement(node)) {
    if (node.type === type) out.push(node)
    findAll(node.props?.children, type, out)
  }
  return out
}

/** Rebuilds a returned tree, replacing each element for which `swap` returns something other than undefined. */
function mapTree(node: unknown, swap: (el: El) => unknown): unknown {
  if (Array.isArray(node)) return node.map((n) => mapTree(n, swap))
  if (!isElement(node)) return node
  const swapped = swap(node)
  if (swapped !== undefined) return swapped
  const kids = node.props?.children
  if (kids === undefined) return node
  const mapped = mapTree(kids, swap)
  return Array.isArray(mapped)
    ? React.cloneElement(node, undefined, ...(mapped as ReactNode[]))
    : React.cloneElement(node, undefined, mapped as ReactNode)
}

const render = (tree: unknown) => renderToStaticMarkup(tree as ReactElement)
const occurrences = (html: string, needle: string) => html.split(needle).length - 1

/**
 * D0 + D′ L1 on the RENDERED markup: the card exactly once; the arbitration console exactly once WHATEVER the surface says,
 * carrying the surface value the page read (surfaceOpen={claimsOpen}); none of these hiding shapes.
 */
function mountViolations(html: string, claimsOpen: boolean): string[] {
  const v: string[] = []
  const fv = occurrences(html, 'data-fv="1"')
  if (fv !== 1) v.push(`financial-verification card rendered ${fv} time(s)`)
  const arb = occurrences(html, 'data-arb="1"')
  if (arb !== 1) v.push(`arbitration console rendered ${arb} time(s) with the surface ${claimsOpen ? 'open' : 'closed'} (D′ L1: mounted unconditionally)`)
  const surfaceProp = occurrences(html, `data-surface-open="${claimsOpen}"`)
  if (arb === 1 && surfaceProp !== 1) v.push(`arbitration console mounted without surfaceOpen=${claimsOpen} (the surface as the page read it)`)
  if (/\shidden(=|\s|>|\/)/.test(html)) v.push('an element carries the hidden attribute')
  if (/\s(aria-hidden="true"|inert(=|\s|>|\/))/.test(html)) v.push('an element is hidden from assistive technology or made inert')
  if (/display\s*:\s*none|visibility\s*:\s*(hidden|collapse)/i.test(html)) v.push('an element is hidden by style')
  if (/opacity\s*:\s*0*\.?0+%?\s*(;|"|!)/i.test(html)) v.push('an element is transparent by style')
  if (/(^|[;"\s])(width|height|max-width|max-height|block-size|inline-size)\s*:\s*0*\.?0+([a-z]+|%)?\s*(;|"|!)/i.test(html)) v.push('an element has a zero size by style')
  if (/(^|[;"\s])(clip|clip-path)\s*:/i.test(html)) v.push('an element is clipped by style')
  if (/(^|[;"\s])(left|top|right|bottom|margin-left|margin-top|text-indent)\s*:\s*(calc\(\s*)?-\s*\d/i.test(html)
    || /transform\s*:[^;"]*(scale\(\s*0*\.?0+\s*[,)]|translate[xy]?\(\s*-)/i.test(html)) v.push('an element is moved off screen or scaled away by style')
  if (/class="[^"]*\b(hidden|invisible|sr-only)\b/.test(html)) v.push('an element is hidden by class')
  if (/<(details|dialog|template)[\s>]/i.test(html)) v.push('an element that hides its content by default is on the page')
  return v
}

/** The kill-switch: no product flag, no lease — the surface reads CLOSED. */
const killSwitch = () => { closeClaimsWindow(); delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED }
type Shape = 'kill-switch' | 'product surface' | 'legacy lease'
/** The page under a real gate state: the surface closed (kill-switch) or opened by the product flag / the legacy lease. */
async function renderPage(shape: Shape): Promise<unknown> {
  killSwitch()
  if (shape === 'product surface') process.env.CLAIMS_SURFACE_ENABLED = 'true'
  if (shape === 'legacy lease') openClaimsWindow()
  expect(claimsSurfaceOpen()).toBe(shape !== 'kill-switch')
  return AdminClaimsPage({ params: { locale: 'fr' } })
}
/** The console element inside the island, with the surface value it received. */
const consoleInIsland = (tree: unknown) => {
  const islands = findAll(tree, Island)
  expect(islands).toHaveLength(1)
  expect(findAll(islands[0].props.children, FinancialVerification)).toHaveLength(1)
  const consoles = findAll(islands[0].props.children, ClaimsArbitration)
  expect(consoles).toHaveLength(1)
  return consoles[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  killSwitch()
  resolveAdminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test', role: 'admin' })
})
afterEach(killSwitch)

describe('D0 + D′ L1 — the financial-verification card AND the arbitration console are rendered whatever the surface says (behaviour; targeted re-audits of 2466e03, d9fb194 and 75f1601)', () => {
  it('surface CLOSED (kill-switch) → no redirect; the card exactly once and the console exactly once with surfaceOpen={false}, both inside the ToastProvider island, nothing hidden — the money cards stay reachable', async () => {
    const tree = await renderPage('kill-switch')
    expect(redirectMock).not.toHaveBeenCalled()
    expect(mountViolations(render(tree), false)).toEqual([])
    expect(consoleInIsland(tree).props.surfaceOpen).toBe(false)
  })

  it('surface OPEN (product flag, then the legacy lease) → both consoles inside the same island, the console with surfaceOpen={true}', async () => {
    for (const shape of ['product surface', 'legacy lease'] as const) {
      const tree = await renderPage(shape)
      expect(redirectMock).not.toHaveBeenCalled()
      expect(mountViolations(render(tree), true), shape).toEqual([])
      expect(consoleInIsland(tree).props.surfaceOpen, shape).toBe(true)
    }
  })

  it("a non-admin is sent away before anything renders — the page's only redirect, and it does not depend on the surface", async () => {
    resolveAdminMock.mockResolvedValue(null)
    await expect(renderPage('kill-switch')).rejects.toThrow('NEXT_REDIRECT /eat')
    await expect(renderPage('product surface')).rejects.toThrow('NEXT_REDIRECT /eat')
    expect(redirectMock.mock.calls.map((c) => c[0])).toEqual(['/eat', '/eat'])
  })

  it('the source: `const claimsOpen = claimsSurfaceOpen()` and `<AdminClaimsArbitration surfaceOpen={claimsOpen} />` — never the 05152b6 gate `{claimsOpen && <AdminClaimsArbitration`, never the lease', () => {
    const src = readFileSync('app/[locale]/admin/claims/page.tsx', 'utf8').replace(/\r\n/g, '\n')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(code).toMatch(/import \{ claimsSurfaceOpen \} from '@\/lib\/claim-flags'/)
    expect(code).toMatch(/const claimsOpen = claimsSurfaceOpen\(\)/)
    expect(code).toMatch(/<AdminClaimsArbitration surfaceOpen=\{claimsOpen\} \/>/)
    expect(code).not.toMatch(/\{claimsOpen && <AdminClaimsArbitration/)
    expect(code).not.toMatch(/\bisClaimsEnabled\b|@\/lib\/claims'/)
  })

  it("NEGATIVE CONTROL — built from the page's REAL surface-closed tree: the 05152b6 gate on the console, a console with the wrong surface value or without it, and every gating or hiding shape checked turn the rendered check red", async () => {
    const tree = await renderPage('kill-switch')
    expect(mountViolations(render(tree), false)).toEqual([])
    const ClaimsOnly: FC<{ open: boolean; children?: ReactNode }> = (p) => (p.open ? React.createElement(React.Fragment, null, p.children) : null)
    const onSection = (props: Record<string, unknown>) => mapTree(tree, (el) => (el.type === 'section' ? React.cloneElement(el, props as never) : undefined))
    const onConsole = (swap: (el: El) => unknown) => mapTree(tree, (el) => (el.type === ClaimsArbitration ? swap(el) : undefined))
    const variants: Array<[string, unknown]> = [
      ['the 05152b6 shape: the console gated by the surface ({claimsOpen && <AdminClaimsArbitration />}, absent when closed)', onConsole(() => null)],
      ['the console gated by a wrapper rendering nothing when the surface is closed', onConsole((el) => React.createElement(ClaimsOnly, { open: false }, el as unknown as ReactNode))],
      ['the console mounted with the WRONG surface value (surfaceOpen={true} while closed)', onConsole((el) => React.cloneElement(el, { surfaceOpen: true } as never))],
      ['the console mounted without the surface value', onConsole((el) => React.cloneElement(el, { surfaceOpen: undefined } as never))],
      ['the console mounted twice', onConsole((el) => React.createElement(React.Fragment, null, el as unknown as ReactNode, React.cloneElement(el)))],
      ['the island replaced by false', mapTree(tree, (el) => (el.type === Island ? false : undefined))],
      ['a wrapper component rendering nothing around the island', mapTree(tree, (el) => (el.type === Island ? React.createElement(ClaimsOnly, { open: false }, el as unknown as ReactNode) : undefined))],
      ['the island inside a details element', mapTree(tree, (el) => (el.type === Island ? React.createElement('details', null, el as unknown as ReactNode) : undefined))],
      ['the section hidden by attribute', onSection({ hidden: true })],
      ['the section hidden from assistive technology', onSection({ 'aria-hidden': true })],
      ['the section made inert', onSection({ inert: '' })],
      ['the section hidden by class', onSection({ className: 'hidden' })],
      ['the section hidden by style', onSection({ style: { display: 'none' } })],
      ['the section at opacity 0', onSection({ style: { opacity: 0 } })],
      ['the section at opacity 0%', onSection({ style: { opacity: '0%' } })],
      ['the section collapsed to zero height, its overflow hidden', onSection({ style: { height: 0, overflow: 'hidden' } })],
      ['the section collapsed to 0rem, its overflow hidden', onSection({ style: { height: '0rem', overflow: 'hidden' } })],
      ['the section clipped away', onSection({ style: { clipPath: 'inset(100%)' } })],
      ['the section collapsed by visibility', onSection({ style: { visibility: 'collapse' } })],
      ['the section moved off screen with calc()', onSection({ style: { position: 'absolute', left: 'calc(-100vw)' } })],
      ['the section scaled to nothing', onSection({ style: { transform: 'scale(0)' } })],
      ['a synthetic null tree (an early exit)', null],
    ]
    for (const [name, variant] of variants) expect(mountViolations(render(variant), false), name).not.toEqual([])
    // the tree-level check too: the console moved OUT of the island (beside it) is caught by consoleInIsland
    const outside = mapTree(tree, (el) => (el.type === Island
      ? React.createElement(React.Fragment, null, React.cloneElement(el, undefined, ...(findAll(el.props.children, FinancialVerification) as unknown as ReactNode[])), React.createElement(ClaimsArbitration, { surfaceOpen: false }))
      : undefined))
    expect(findAll(findAll(outside, Island)[0].props.children, ClaimsArbitration)).toHaveLength(0)
    // and the source pin catches the 05152b6 line
    expect('          {claimsOpen && <AdminClaimsArbitration />}').toMatch(/\{claimsOpen && <AdminClaimsArbitration/)
  })
})
