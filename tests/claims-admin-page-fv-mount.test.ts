// tests/claims-admin-page-fv-mount.test.ts — T-49 round 13, D0 « CARD = AdminFinancialVerification. Always mounted »
// (targeted re-audits of 2466e03, d9fb194 and 75f1601).
//
// A source-shape pin cannot see a flag gate on an ANCESTOR of the card, an early exit written another way, a wrapper component
// that renders nothing, or an ancestor hidden by an attribute, a style or a class. This file pins the behaviour: the
// /admin/claims server component is called with the claims flag off, then on, and the tree it returns is RENDERED
// (react-dom/server) with marker components. With the flag off, the card must be in the markup and none of the hiding shapes
// checked below may appear on the page. Hiding shapes outside that list (a portal, a class or rule a stylesheet hides) are
// not checked here.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as React from 'react'
import type { FC, ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.stubGlobal('React', React)

const { claimsFlag, redirectMock, resolveAdminMock } = vi.hoisted(() => ({
  claimsFlag: vi.fn(),
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
vi.mock('@/lib/claims', () => ({ isClaimsEnabled: claimsFlag }))
// The real AdminShell and ToastProvider render their children unconditionally; the markers stand in for them.
vi.mock('@/components/admin/AdminShell', () => ({ default: function AdminShell(p: { children?: ReactNode }) { return p.children ?? null } }))
vi.mock('@/components/design-system', () => ({ ToastProvider: function ToastProvider(p: { children?: ReactNode }) { return p.children ?? null } }))
vi.mock('@/components/claims/AdminClaimsArbitration', async () => {
  const R = await import('react')
  return { default: function AdminClaimsArbitration() { return R.createElement('i', { 'data-arb': '1' }) } }
})
vi.mock('@/components/claims/AdminFinancialVerification', async () => {
  const R = await import('react')
  return { default: function AdminFinancialVerification() { return R.createElement('i', { 'data-fv': '1' }) } }
})

import AdminClaimsPage from '@/app/[locale]/admin/claims/page'
import AdminFinancialVerificationImport from '@/components/claims/AdminFinancialVerification'
import AdminClaimsArbitrationImport from '@/components/claims/AdminClaimsArbitration'
import { ToastProvider as ToastProviderImport } from '@/components/design-system'

// The mocked markers, typed loosely: elements are compared by type and the tree is rendered with the markers.
const FinancialVerification = AdminFinancialVerificationImport as unknown as FC
const ClaimsArbitration = AdminClaimsArbitrationImport as unknown as FC
const Island = ToastProviderImport as unknown as FC<{ children?: ReactNode }>

type El = ReactElement<{ children?: unknown }>
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

/** D0 on the RENDERED markup: the card exactly once, the arbitration console only when claims are open, none of these hiding shapes. */
function mountViolations(html: string, claimsOpen: boolean): string[] {
  const v: string[] = []
  const fv = occurrences(html, 'data-fv="1"')
  if (fv !== 1) v.push(`financial-verification card rendered ${fv} time(s)`)
  const arb = occurrences(html, 'data-arb="1"')
  if (claimsOpen ? arb !== 1 : arb !== 0) v.push(`arbitration console rendered ${arb} time(s) with claims ${claimsOpen ? 'open' : 'closed'}`)
  if (/\shidden(=|\s|>|\/)/.test(html)) v.push('an element carries the hidden attribute')
  if (/\s(aria-hidden="true"|inert(=|\s|>|\/))/.test(html)) v.push('an element is hidden from assistive technology or made inert')
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(html)) v.push('an element is hidden by style')
  if (/opacity\s*:\s*0(\.0+)?(;|"|\s)|(width|height)\s*:\s*0(px)?(;|"|\s)|clip\s*:|left\s*:\s*-\d/i.test(html)) v.push('an element is visually collapsed by style')
  if (/class="[^"]*\b(hidden|invisible|sr-only)\b/.test(html)) v.push('an element is hidden by class')
  if (/<(details|dialog|template)[\s>]/i.test(html)) v.push('an element that hides its content by default is on the page')
  return v
}

async function renderPage(flag: boolean): Promise<unknown> {
  claimsFlag.mockReturnValue(flag)
  return AdminClaimsPage({ params: { locale: 'fr' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveAdminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test', role: 'admin' })
})

describe('D0 — the financial-verification card is rendered whatever the claims flag says (behaviour; targeted re-audits of 2466e03, d9fb194 and 75f1601)', () => {
  it('claims CLOSED → no redirect; the rendered page shows the card exactly once, inside the ToastProvider island, nothing hidden, no arbitration console', async () => {
    const tree = await renderPage(false)
    expect(redirectMock).not.toHaveBeenCalled()
    expect(mountViolations(render(tree), false)).toEqual([])
    const islands = findAll(tree, Island)
    expect(islands).toHaveLength(1)
    expect(findAll(islands[0].props.children, FinancialVerification)).toHaveLength(1)
  })

  it('claims OPEN → the rendered page shows both consoles, inside the same ToastProvider island', async () => {
    const tree = await renderPage(true)
    expect(redirectMock).not.toHaveBeenCalled()
    expect(mountViolations(render(tree), true)).toEqual([])
    const islands = findAll(tree, Island)
    expect(islands).toHaveLength(1)
    expect(findAll(islands[0].props.children, FinancialVerification)).toHaveLength(1)
    expect(findAll(islands[0].props.children, ClaimsArbitration)).toHaveLength(1)
  })

  it("a non-admin is sent away before anything renders — the page's only redirect, and it does not depend on the claims flag", async () => {
    resolveAdminMock.mockResolvedValue(null)
    await expect(renderPage(false)).rejects.toThrow('NEXT_REDIRECT /eat')
    await expect(renderPage(true)).rejects.toThrow('NEXT_REDIRECT /eat')
    expect(redirectMock.mock.calls.map((c) => c[0])).toEqual(['/eat', '/eat'])
  })

  it("NEGATIVE CONTROL — built from the page's REAL flag-off tree: every gating or hiding shape checked turns the rendered check red", async () => {
    const tree = await renderPage(false)
    expect(mountViolations(render(tree), false)).toEqual([])
    const ClaimsOnly: FC<{ open: boolean; children?: ReactNode }> = (p) => (p.open ? React.createElement(React.Fragment, null, p.children) : null)
    const onSection = (props: Record<string, unknown>) => mapTree(tree, (el) => (el.type === 'section' ? React.cloneElement(el, props as never) : undefined))
    const variants: Array<[string, unknown]> = [
      ['the island replaced by false', mapTree(tree, (el) => (el.type === Island ? false : undefined))],
      ['a wrapper component rendering nothing around the island', mapTree(tree, (el) => (el.type === Island ? React.createElement(ClaimsOnly, { open: false }, el as unknown as ReactNode) : undefined))],
      ['the island inside a details element', mapTree(tree, (el) => (el.type === Island ? React.createElement('details', null, el as unknown as ReactNode) : undefined))],
      ['the section hidden by attribute', onSection({ hidden: true })],
      ['the section hidden from assistive technology', onSection({ 'aria-hidden': true })],
      ['the section made inert', onSection({ inert: '' })],
      ['the section hidden by class', onSection({ className: 'hidden' })],
      ['the section hidden by style', onSection({ style: { display: 'none' } })],
      ['the section at opacity 0', onSection({ style: { opacity: 0 } })],
      ['the section collapsed to zero height', onSection({ style: { height: 0 } })],
      ['a synthetic null tree (an early exit)', null],
    ]
    for (const [name, variant] of variants) expect(mountViolations(render(variant), false), name).not.toEqual([])
  })
})
