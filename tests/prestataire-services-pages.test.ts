import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'

// ── P2 server pages flag-gated (P2, Agent 75) — no leak when OFF ─────────────
// The 3 new pages (services management + discovery list + detail fiche) are SERVER pages
// that 404 (notFound) when PRESTATAIRE_ENABLED is OFF, BEFORE rendering their client child
// — byte-identical to non-existent (the P1 leak lesson). JSX compiles to React.createElement
// → provide React in scope; stub the client children so no client tree loads in node.
vi.stubGlobal('React', React)

const { notFoundMock, SERVICES, DISCOVER, DETAIL } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  SERVICES: () => null,
  DISCOVER: () => null,
  DETAIL: () => null,
}))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/app/[locale]/prestataire/services/ServicesClient', () => ({ default: SERVICES }))
vi.mock('@/app/[locale]/marketplace/prestataires/PrestatairesDiscoverClient', () => ({ default: DISCOVER }))
vi.mock('@/app/[locale]/marketplace/prestataires/[id]/PrestataireDetailClient', () => ({ default: DETAIL }))

import ServicesPage from '@/app/[locale]/prestataire/services/page'
import DiscoverPage from '@/app/[locale]/marketplace/prestataires/page'
import DetailPage from '@/app/[locale]/marketplace/prestataires/[id]/page'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
afterEach(() => { OFF(); notFoundMock.mockClear() })

describe('« Mes services » management page', () => {
  it('OFF → 404 (notFound), form never rendered', () => {
    OFF()
    expect(() => ServicesPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
  it('ON → renders the client (no 404)', () => {
    ON()
    const el = ServicesPage({ params: { locale: 'fr' } }) as { type: unknown }
    expect(notFoundMock).not.toHaveBeenCalled()
    expect(el.type).toBe(SERVICES)
  })
})

describe('discovery list page', () => {
  it('OFF → 404; ON → renders the client', () => {
    OFF()
    expect(() => DiscoverPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    ON()
    expect((DiscoverPage({ params: { locale: 'fr' } }) as { type: unknown }).type).toBe(DISCOVER)
  })
})

describe('discovery detail page', () => {
  it('OFF → 404; ON → renders the client with the id prop', () => {
    OFF()
    expect(() => DetailPage({ params: { locale: 'fr', id: 'x' } })).toThrow('NEXT_NOT_FOUND')
    ON()
    const el = DetailPage({ params: { locale: 'fr', id: 'abc' } }) as { type: unknown; props: { id: string } }
    expect(el.type).toBe(DETAIL)
    expect(el.props.id).toBe('abc')
  })
})
