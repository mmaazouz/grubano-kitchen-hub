import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'

// The page returns JSX (<PrestataireRegisterForm/>), which the classic runtime compiles
// to React.createElement — provide React in the global scope so calling Page() works in
// the node env (the static import does NOT execute the JSX; only invoking Page() does).
vi.stubGlobal('React', React)

// ── /business/prestataire/register PAGE flag gate (P1, Agent 74) ──────────────
// /business/* is PUBLIC, so the role must NOT leak when PRESTATAIRE_ENABLED is OFF: the
// SERVER page must 404 (notFound) BEFORE rendering the form — byte-identical to the route
// not existing. (Adversarial-review finding: the client page used to render HTTP 200 and
// expose the whole form/SIREN/service taxonomy when the flag was OFF.)

const { notFoundMock, FORM } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  FORM: () => null, // stub the client form so importing the page never pulls the client
}))                  // component tree (design-system / lucide / next-intl) into node env
vi.mock('next/navigation', () => ({ notFound: notFoundMock }))
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }))
vi.mock('@/app/[locale]/business/prestataire/register/RegisterForm', () => ({ default: FORM }))

import Page from '@/app/[locale]/business/prestataire/register/page'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
afterEach(() => { OFF(); notFoundMock.mockClear() })

describe('register page — flag-gated visibility', () => {
  it('flag OFF (default) → notFound(): the route 404s, form never rendered', () => {
    OFF()
    expect(() => Page({ params: { locale: 'fr' } })).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('flag ON → renders the client form (no 404)', () => {
    ON()
    const el = Page({ params: { locale: 'fr' } }) as { type: unknown }
    expect(notFoundMock).not.toHaveBeenCalled()
    expect(el.type).toBe(FORM)
  })
})
