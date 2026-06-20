import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'

// ── /prestataire/calendar PAGE flag gate (P4, Agent 77) — no leak when OFF (d) ─
// The calendar page is a SERVER component that 404s (notFound) when PRESTATAIRE_ENABLED is
// OFF, BEFORE rendering the client child — the P1/P2/P3 leak lesson.
vi.stubGlobal('React', React)

const { notFoundMock, CAL } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  CAL: () => null,
}))
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/app/[locale]/prestataire/calendar/CalendarClient', () => ({ default: CAL }))

import CalendarPage from '@/app/[locale]/prestataire/calendar/page'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
afterEach(() => { OFF(); notFoundMock.mockClear() })

describe('« Mon calendrier » page', () => {
  it('OFF → 404 (notFound), client never rendered', () => {
    OFF()
    expect(() => CalendarPage({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
  it('ON → renders the client (no 404)', () => {
    ON()
    const el = CalendarPage({ params: { locale: 'fr' } }) as { type: unknown }
    expect(notFoundMock).not.toHaveBeenCalled()
    expect(el.type).toBe(CAL)
  })
})
