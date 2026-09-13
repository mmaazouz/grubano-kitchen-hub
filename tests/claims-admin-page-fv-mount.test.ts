// tests/claims-admin-page-fv-mount.test.ts — T-49 round 13, D0 « CARD = AdminFinancialVerification. Always mounted »
// (targeted re-audit of 2466e03, P1 and its P2 sibling).
//
// A source-shape pin cannot see a flag gate on an ANCESTOR of the card, nor an early exit written another way. This file pins
// the behaviour: the /admin/claims server component is called with the claims flag off, then on, and the element tree it
// returns is walked. With the flag off, the only console surface for money cases must still be mounted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as React from 'react'
import type { FC, ReactElement, ReactNode } from 'react'

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
vi.mock('@/components/admin/AdminShell', () => ({ default: function AdminShell(p: { children?: ReactNode }) { return p.children ?? null } }))
vi.mock('@/components/claims/AdminClaimsArbitration', () => ({ default: function AdminClaimsArbitration() { return null } }))
vi.mock('@/components/claims/AdminFinancialVerification', () => ({ default: function AdminFinancialVerification() { return null } }))
vi.mock('@/components/design-system', () => ({ ToastProvider: function ToastProvider(p: { children?: ReactNode }) { return p.children ?? null } }))

import AdminClaimsPage from '@/app/[locale]/admin/claims/page'
import AdminFinancialVerificationImport from '@/components/claims/AdminFinancialVerification'
import AdminClaimsArbitrationImport from '@/components/claims/AdminClaimsArbitration'
import { ToastProvider as ToastProviderImport } from '@/components/design-system'

// The mocked markers, typed loosely: the tree is compared by element type, and no component body ever runs.
const FinancialVerification = AdminFinancialVerificationImport as unknown as FC
const ClaimsArbitration = AdminClaimsArbitrationImport as unknown as FC
const Island = ToastProviderImport as unknown as FC<{ children?: ReactNode }>

/** Every element of `type` in a tree the page RETURNED (its JSX is inline, so walking props.children reaches every element). */
function findAll(node: unknown, type: unknown, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, type, out)
    return out
  }
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const el = node as ReactElement<{ children?: unknown }>
    if (el.type === type) out.push(el)
    findAll(el.props?.children, type, out)
  }
  return out
}
const childrenOf = (el: ReactElement) => (el.props as { children?: unknown }).children

async function renderPage(flag: boolean): Promise<unknown> {
  claimsFlag.mockReturnValue(flag)
  return AdminClaimsPage({ params: { locale: 'fr' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveAdminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test', role: 'admin' })
})

describe('D0 — the financial-verification card is mounted whatever the claims flag says (behaviour; targeted re-audit of 2466e03, P1)', () => {
  it('claims CLOSED → no redirect; exactly one AdminFinancialVerification, inside the ToastProvider island; no AdminClaimsArbitration', async () => {
    const tree = await renderPage(false)
    expect(redirectMock).not.toHaveBeenCalled()
    expect(findAll(tree, FinancialVerification)).toHaveLength(1)
    expect(findAll(tree, ClaimsArbitration)).toHaveLength(0)
    const islands = findAll(tree, Island)
    expect(islands).toHaveLength(1)
    expect(findAll(childrenOf(islands[0]), FinancialVerification)).toHaveLength(1)
  })

  it('claims OPEN → both consoles, inside the same ToastProvider island', async () => {
    const tree = await renderPage(true)
    expect(redirectMock).not.toHaveBeenCalled()
    const islands = findAll(tree, Island)
    expect(islands).toHaveLength(1)
    expect(findAll(childrenOf(islands[0]), FinancialVerification)).toHaveLength(1)
    expect(findAll(childrenOf(islands[0]), ClaimsArbitration)).toHaveLength(1)
  })

  it('a non-admin is sent away before anything renders — the page\'s only redirect, and it does not depend on the claims flag', async () => {
    resolveAdminMock.mockResolvedValue(null)
    await expect(renderPage(false)).rejects.toThrow('NEXT_REDIRECT /eat')
    await expect(renderPage(true)).rejects.toThrow('NEXT_REDIRECT /eat')
    expect(redirectMock.mock.calls.map((c) => c[0])).toEqual(['/eat', '/eat'])
  })

  it('NEGATIVE CONTROL — the walker reports a gated island, a gated section and an early exit as a missing card', () => {
    const card = React.createElement(FinancialVerification)
    const gatedIsland = React.createElement('section', null, false, React.createElement('p', null, 'x'))
    const gatedSection = React.createElement('div', null, false && React.createElement('section', null, React.createElement(Island, null, card)))
    const cases: Array<[string, unknown]> = [['gated island', gatedIsland], ['gated section', gatedSection], ['early exit', null]]
    for (const [name, tree] of cases) expect(findAll(tree, FinancialVerification), name).toHaveLength(0)
    expect(findAll(React.createElement('section', null, React.createElement(Island, null, card)), FinancialVerification)).toHaveLength(1)
  })
})
