import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/auth/magic-link — the EMAIL is reliably clickable (bug fix) ──────
// The reported bug: the email arrives but the link can't be clicked. The fix makes
// the link actionable three ways and on a correct absolute base. These tests pin:
//   1. a clickable <a href> BUTTON to the absolute link,
//   2. a VISIBLE, copyable, word-break raw-URL fallback (button-less clients),
//   3. a plain-text alternative part carrying the bare URL,
//   4. the base comes from NEXTAUTH_URL (canonical), not the request host,
//   5. anti-enumeration: no email for unknown/inactive accounts, always generic OK.

const { db, sendMail } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), update: vi.fn() } },
  sendMail: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('@/i18n', () => ({ locales: ['fr', 'en', 'es', 'ar', 'it'], defaultLocale: 'fr' }))
vi.mock('@/lib/magic-link', () => ({
  createMagicLinkToken: () => ({ token: 'op1.deadbeef', hash: 'h', expiry: new Date(Date.now() + 900_000) }),
}))

import { POST } from '@/app/api/auth/magic-link/route'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('https://app.grubano.com/api/auth/magic-link', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) as never)

const ENV = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  db.operator.update.mockResolvedValue({})
  process.env.SMTP_PASS = 'x'                       // SMTP configured → the mail is sent
  process.env.NEXTAUTH_URL = 'https://app.grubano.com'
  delete process.env.APP_URL
  delete process.env.ALLOWED_MAGIC_HOSTS            // default allow-list applies
})
afterEach(() => { process.env = { ...ENV } })

describe('magic-link email is reliably clickable', () => {
  it('active account → sends a button, a VISIBLE raw-URL fallback, and a text part on the canonical base', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'Resto', status: 'active' })
    const res = await post({ email: 'resto@x.fr', locale: 'fr' })
    expect((await res.json()).ok).toBe(true)               // generic OK
    expect(sendMail).toHaveBeenCalledTimes(1)

    const mail = sendMail.mock.calls[0][0]
    const link = 'https://app.grubano.com/fr/auth/magic?token=op1.deadbeef'
    // 1. clickable button to the absolute link
    expect(mail.html).toContain(`<a href="${link}"`)
    // 2. the FULL url is also printed as visible, copyable text (button-less clients)
    expect(mail.html).toContain(`>${link}</a>`)
    expect(mail.html).toContain('word-break:break-all')
    // 3. a plain-text alternative carrying the bare URL on its own line
    expect(typeof mail.text).toBe('string')
    expect(mail.text.split('\n')).toContain(link)
    // 4. absolute https on the canonical base (NOT the request host)
    expect(link.startsWith('https://app.grubano.com/')).toBe(true)
    // the button label hugs the tags AND no anchor has a newline in its text body —
    // a label on its own line is exactly the blob that made the original link
    // non-clickable, so guard the anchor BODY, not just the opening tag.
    expect(mail.html).toContain('>Me connecter</a>')
    expect(mail.html).not.toMatch(/<a\b[^>]*>[^<]*\n[^<]*<\/a>/)
  })

  it('respects the requested locale in the link path', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'R', status: 'active' })
    await post({ email: 'r@x.fr', locale: 'en' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://app.grubano.com/en/auth/magic?token=op1.deadbeef')
  })

  it('uses an allow-listed apex host (grubano.com) even with no NEXTAUTH_URL/APP_URL', async () => {
    delete process.env.NEXTAUTH_URL
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'R', status: 'active' })
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'grubano.com', 'x-forwarded-proto': 'https' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://grubano.com/fr/auth/magic?token=op1.deadbeef')
  })
})

describe('multi-domain base — allow-listed request host wins, forged host ignored', () => {
  // NEXTAUTH_URL = app.grubano.com (canonical) is set in the outer beforeEach.
  beforeEach(() => { db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'R', status: 'active' }) })

  it('supplier on business.grubano.com → link to business (NOT app), beating the canonical base', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'business.grubano.com' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://business.grubano.com/fr/auth/magic?token=op1.deadbeef')
  })

  it('app.grubano.com → app', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'app.grubano.com' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://app.grubano.com/fr/auth/magic')
  })

  it('allow-listed host with a :port → port stripped, https forced', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'grubano.com:443', 'x-forwarded-proto': 'http' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://grubano.com/fr/auth/magic')
  })

  it('forged host (evil.com) is IGNORED → canonical base, never the attacker domain', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'evil.com' })
    const html = sendMail.mock.calls[0][0].html
    expect(html).toContain('https://app.grubano.com/fr/auth/magic') // canonical NEXTAUTH_URL
    expect(html).not.toContain('evil.com')
  })

  it('internal host (127.0.0.1:3000) is IGNORED → canonical base', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': '127.0.0.1:3000' })
    const html = sendMail.mock.calls[0][0].html
    expect(html).toContain('https://app.grubano.com/fr/auth/magic')
    expect(html).not.toContain('127.0.0.1')
  })

  it('respects an ALLOWED_MAGIC_HOSTS env override', async () => {
    process.env.ALLOWED_MAGIC_HOSTS = 'partner.grubano.com'
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'partner.grubano.com' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://partner.grubano.com/fr/auth/magic')
  })

  // Lock the EXACT-match guarantee: a suffix/substring of an allow-listed host must
  // NOT match (guards against a future regression to endsWith/includes/startsWith).
  it.each([
    'app.grubano.com.evil.com', // allow-listed host as a left-substring
    'evilapp.grubano.com',      // allow-listed apex as a right-substring
    'notgrubano.com',
    'attacker@app.grubano.com', // userinfo trick
  ])('suffix/substring/userinfo host %s is IGNORED → canonical base', async (h) => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': h })
    const html = sendMail.mock.calls[0][0].html
    expect(html).toContain('https://app.grubano.com/fr/auth/magic') // canonical, not the forged host
    expect(html).not.toContain('evil.com')
  })

  it('comma-list with an allow-listed host FIRST → used; a trailing forged host is discarded', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'business.grubano.com, evil.com' })
    const html = sendMail.mock.calls[0][0].html
    expect(html).toContain('https://business.grubano.com/fr/auth/magic')
    expect(html).not.toContain('evil.com')
  })

  it('comma-list with a forged host FIRST → ignored → canonical base', async () => {
    await post({ email: 'r@x.fr', locale: 'fr' }, { 'x-forwarded-host': 'evil.com, app.grubano.com' })
    expect(sendMail.mock.calls[0][0].html).toContain('https://app.grubano.com/fr/auth/magic')
  })

  it('anti-enumeration: unknown account → no email, still generic OK', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const res = await post({ email: 'ghost@x.fr' })
    expect((await res.json()).ok).toBe(true)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('anti-enumeration: inactive (pending) account → no email, still generic OK', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'R', status: 'pending' })
    const res = await post({ email: 'pending@x.fr' })
    expect((await res.json()).ok).toBe(true)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('no SMTP secret → no send attempt, still generic OK (never 500s)', async () => {
    delete process.env.SMTP_PASS
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'R', status: 'active' })
    const res = await post({ email: 'r@x.fr' })
    expect((await res.json()).ok).toBe(true)
    expect(sendMail).not.toHaveBeenCalled()
  })
})
