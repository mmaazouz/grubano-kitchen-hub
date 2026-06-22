import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'

// ── /prestataire/dashboard/profil PAGE flag gate (Agent 104) — no leak when OFF ─
// The profil page is a SERVER component that 404s (notFound) when PRESTATAIRE_ENABLED is OFF,
// BEFORE rendering the client child — same pattern as the services/calendar pages. This backs
// the dashboard "Modifier mon profil" link AND the onboarding-guide profile/company CTAs.
vi.stubGlobal('React', React)

const { notFoundMock, FORM } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  FORM: () => null,
}))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/app/[locale]/prestataire/dashboard/profil/ProfilClient', () => ({ default: FORM }))

import ProfilPage from '@/app/[locale]/prestataire/dashboard/profil/page'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
afterEach(() => { OFF(); notFoundMock.mockClear() })

describe('« Mon profil » prestataire page', () => {
  it('OFF → 404 (notFound), client never rendered', () => {
    OFF()
    expect(() => ProfilPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
  it('ON → renders the client form (no 404)', () => {
    ON()
    const el = ProfilPage({ params: { locale: 'fr' } }) as { type: unknown }
    expect(notFoundMock).not.toHaveBeenCalled()
    expect(el.type).toBe(FORM)
  })
})
