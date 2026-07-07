import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Go-live hardening — POST /api/csp-report (report-only CSP violation collector) ────────────
// Logs a compact line + returns 204. Must never error, even on a malformed body.

import { POST } from '@/app/api/csp-report/route'

const post = (body: unknown) => POST(new NextRequest('http://x/api/csp-report', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))

describe('POST /api/csp-report', () => {
  it('always returns 204 for a well-formed report-uri report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ 'csp-report': { 'document-uri': 'https://x/p', 'violated-directive': 'img-src', 'blocked-uri': 'https://evil/x.png' } })
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('returns 204 and never throws on a malformed / empty body', async () => {
    expect((await post('not json{')).status).toBe(204)
    expect((await post({})).status).toBe(204)
    expect((await post({ some: 'other shape' })).status).toBe(204)
  })
})
