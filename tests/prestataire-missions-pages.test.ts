import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'

// ── P3 mission pages flag-gated (P3, Agent 76) — no leak when OFF (d) ─────────
// The 2 new server pages (prestataire missions + resto missions) 404 (notFound) when
// PRESTATAIRE_ENABLED is OFF, BEFORE rendering their client child — the P1 leak lesson.
vi.stubGlobal('React', React)

const { notFoundMock, PRESTA, RESTO } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  PRESTA: () => null,
  RESTO: () => null,
}))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/app/[locale]/prestataire/missions/MissionsClient', () => ({ default: PRESTA }))
vi.mock('@/app/[locale]/marketplace/prestataire-missions/RestoMissionsClient', () => ({ default: RESTO }))

import PrestaMissionsPage from '@/app/[locale]/prestataire/missions/page'
import RestoMissionsPage from '@/app/[locale]/marketplace/prestataire-missions/page'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
afterEach(() => { OFF(); notFoundMock.mockClear() })

describe('prestataire « Demandes & missions » page', () => {
  it('OFF → 404 (notFound); ON → renders the client', () => {
    OFF()
    expect(() => PrestaMissionsPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    ON()
    expect((PrestaMissionsPage({ params: { locale: 'fr' } }) as { type: unknown }).type).toBe(PRESTA)
  })
})

describe('resto « Mes demandes » page', () => {
  it('OFF → 404 (notFound); ON → renders the client', () => {
    OFF()
    expect(() => RestoMissionsPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    ON()
    expect((RestoMissionsPage({ params: { locale: 'fr' } }) as { type: unknown }).type).toBe(RESTO)
  })
})
