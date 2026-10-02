import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { __resetRateLimit } from '@/lib/rate-limit'

// ── POST /api/account/password — in-account « current → new » password change ───
//
// WHAT THIS LOT REPAIRED. /{locale}/eat/account/password drew a current / new /
// confirm form and a « Mettre à jour » button, but no endpoint accepted a
// current→new change: BOTH buttons posted to /api/auth/forgot-password, so pressing
// « Mettre à jour » mailed a reset link and the screen answered « Lien envoyé ». The
// three inputs had no `value` and no `onChange` at all, and the strength gauge was
// the literal `ok ok mid empty` whatever was typed.
//
// WHAT IS MOCKED AND WHAT IS NOT. next-auth, @/lib/prisma and the transactional
// e-mail are mocked, so this isolates the route's auth / policy / write contract.
// bcryptjs is REAL: cases 10–12 verify an actual cost-12 hash, that the OLD password
// no longer matches it and that the NEW one does — a mocked bcrypt would make those
// three cases assert nothing. @/lib/rate-limit is REAL too (case 2 drives it through
// its own env flag), because the founder confirmed RATE_LIMIT_ENABLED = true in
// production: a limiter that is only exercised when disabled is not exercised.
//
// WHY THE UI CASES (17–19) READ THE SOURCE. vitest.config.ts is `environment: 'node'`
// with `include: ['tests/**/*.test.ts']` — there is no DOM, no jsdom and no
// @testing-library in this repository, so a .tsx render harness would be a new
// dependency, not a test. The regressions these cases exist to stop are textual
// (« Mettre à jour » re-wired to the reset-link call; the fields going back to
// uncontrolled), so the source is the right surface — the same choice as
// tests/eat-account-partner-entry.test.ts.

// Real bcrypt at cost 12 is ~0.3 s per operation on an idle machine and several
// times that while the full suite saturates the CPU — a case doing two of them
// exceeded the 5 s default and timed out in a full run while passing in isolation.
// The work is deliberate (see above), so the budget is raised rather than the
// cryptography faked.
vi.setConfig({ testTimeout: 30_000 })

const { getSession, findUnique, update, tokenDeleteMany, sendMail } = vi.hoisted(() => ({
  getSession:      vi.fn(),
  findUnique:      vi.fn(),
  update:          vi.fn(),
  tokenDeleteMany: vi.fn(),
  sendMail:        vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    operator:          { findUnique, update },
    verificationToken: { deleteMany: tokenDeleteMany },
  },
}))
vi.mock('@/lib/transactional-emails', () => ({ sendPasswordChangedEmail: sendMail }))

import { POST } from '@/app/api/account/password/route'

const OLD = 'OldPass123!'
const NEW = 'BrandNewPass456!'
const OP = { id: 'op1', email: 'client@example.com', name: 'Alex' }

let storedHash = ''
beforeAll(async () => {
  // One real cost-12 hash, reused: it is the expensive part of the suite.
  storedHash = await bcrypt.hash(OLD, 12)
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://x/api/account/password', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    typeof body === 'string' ? body : JSON.stringify(body),
  }))

const good = () => ({ currentPassword: OLD, newPassword: NEW })

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimit()
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_ACCOUNT_PASSWORD_CHANGE_MAX
  getSession.mockResolvedValue({ user: { id: OP.id } })
  findUnique.mockResolvedValue({ ...OP, password: storedHash, status: 'active' })
  update.mockResolvedValue({ id: OP.id })
  tokenDeleteMany.mockResolvedValue({ count: 1 })
  sendMail.mockResolvedValue(undefined)
})
afterEach(() => {
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_ACCOUNT_PASSWORD_CHANGE_MAX
  __resetRateLimit()
})

/** The password written by the single prisma.operator.update call. */
const writtenHash = (): string => update.mock.calls[0][0].data.password as string

describe('POST /api/account/password — auth, policy, refusals', () => {
  it('(1) UNAUTHENTICATED → 401, and nothing is read or written', async () => {
    getSession.mockResolvedValue(null)
    const res = await post(good())
    expect(res.status).toBe(401)
    expect(findUnique).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('(1b) a session WITHOUT an id is not a session → 401', async () => {
    getSession.mockResolvedValue({ user: { email: OP.email } }) // email only, no id
    expect((await post(good())).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('(1c) the account changed is the SESSION id — a body-supplied id is ignored', async () => {
    const res = await post({ ...good(), operatorId: 'victim', id: 'victim', email: 'victim@example.com' })
    expect(res.status).toBe(200)
    // Read AND write are both keyed on the session id, never on the body.
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OP.id } }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OP.id } }))
  })

  it('(2) RATE LIMIT — the 6th attempt in the window is 429 with Retry-After, and writes nothing', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    const ip = { 'x-forwarded-for': '203.0.113.7' }
    // limitDefault 5 / windowDefault 900 s. These five are refused on their SHAPE
    // (7 chars), which the route judges after the limiter — so this also proves the
    // bucket counts an attempt whatever its outcome: a caller cannot farm extra
    // guesses by alternating well-formed and malformed bodies.
    for (let i = 0; i < 5; i++) {
      const r = await post({ currentPassword: 'whatever', newPassword: 'short7!' }, ip)
      expect(r.status).toBe(400)
    }
    const res = await post({ currentPassword: OLD, newPassword: NEW }, ip)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()

    // The bucket is keyed on the operator id too: another account from the same IP
    // is unaffected by this one's exhausted window (400 on shape ≠ 429 on quota).
    getSession.mockResolvedValue({ user: { id: 'op2' } })
    expect((await post({ currentPassword: 'whatever', newPassword: 'short7!' }, ip)).status).toBe(400)
  })

  it('(2c) a CREDENTIAL-GUESSING flood is stopped — and the cap is env-tunable', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_ACCOUNT_PASSWORD_CHANGE_MAX = '2' // keeps the real bcrypt work to 2
    const ip = { 'x-forwarded-for': '198.51.100.4' }
    for (let i = 0; i < 2; i++) {
      const r = await post({ currentPassword: `guess-${i}`, newPassword: NEW }, ip)
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe('invalid_current')
    }
    const res = await post({ currentPassword: 'guess-3', newPassword: NEW }, ip)
    expect(res.status).toBe(429)
    expect(update).not.toHaveBeenCalled()
  })

  it('(2b) the limiter runs AFTER authentication — an unauthenticated flood still gets 401, not 429', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    getSession.mockResolvedValue(null)
    for (let i = 0; i < 8; i++) {
      expect((await post(good(), { 'x-forwarded-for': '203.0.113.9' })).status).toBe(401)
    }
  })

  it('(3) WRONG current password → refused, no write, no e-mail', async () => {
    const res = await post({ currentPassword: 'not-my-password', newPassword: NEW })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_current')
    expect(update).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
    expect(tokenDeleteMany).not.toHaveBeenCalled()
  })

  it('(4) new password SHORTER than 8 → refused BEFORE any DB access', async () => {
    const res = await post({ currentPassword: OLD, newPassword: 'short7!' }) // 7 chars
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('weak_new')
    expect(findUnique).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('(5) new password LONGER than 100 → refused', async () => {
    const res = await post({ currentPassword: OLD, newPassword: 'a'.repeat(101) })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('weak_new')
    expect(update).not.toHaveBeenCalled()
    // 100 exactly is the documented maximum and must still pass.
    expect((await post({ currentPassword: OLD, newPassword: 'b'.repeat(100) })).status).toBe(200)
  })

  it('(5b) an EMPTY current password is refused as such, not as a weak new password', async () => {
    const res = await post({ currentPassword: '', newPassword: NEW })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('current_required')
    // A missing field reports the same code — zod's own "Required" message must not
    // be mistaken for a new-password problem.
    expect((await (await post({ newPassword: NEW })).json()).code).toBe('current_required')
    expect(update).not.toHaveBeenCalled()
  })

  it('(6) new === current → refused (no write, no e-mail about a non-event)', async () => {
    const res = await post({ currentPassword: OLD, newPassword: OLD })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('same_as_current')
    expect(update).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('(7) password === null → DISTINCT, honest refusal (not « wrong password »)', async () => {
    findUnique.mockResolvedValue({ ...OP, password: null, status: 'active' })
    const res = await post(good())
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('no_password')
    expect(body.code).not.toBe('invalid_current')
    expect(update).not.toHaveBeenCalled()
    // The copy must not send the user to a flow that cannot help them:
    // /api/auth/forgot-password only mails a link when operator.password is non-null.
    expect(body.error).not.toMatch(/oubli/i)
  })

  it('(8) status pending / suspended → refused, no write', async () => {
    for (const status of ['pending', 'suspended']) {
      vi.clearAllMocks()
      findUnique.mockResolvedValue({ ...OP, password: storedHash, status })
      update.mockResolvedValue({ id: OP.id })
      const res = await post(good())
      expect(res.status, status).toBe(403)
      expect((await res.json()).code).toBe('account_locked')
      expect(update, status).not.toHaveBeenCalled()
    }
  })

  it('(8b) an account that no longer exists → 401, never a crash', async () => {
    findUnique.mockResolvedValue(null)
    expect((await post(good())).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('POST /api/account/password — the successful change', () => {
  it('(9) correct current + valid new → 200 ok', async () => {
    const res = await post(good())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // Honest about what it did NOT do: JWT sessions cannot be revoked here.
    expect(body.sessionsRevoked).toBe(false)
  })

  it('(10) a real bcrypt hash is written — never the plaintext', async () => {
    await post(good())
    const written = writtenHash()
    expect(written).not.toBe(NEW)
    expect(written).not.toContain(NEW)
    expect(written).toMatch(/^\$2[aby]\$12\$/) // bcrypt, cost 12 (app-wide convention)
  })

  it('(11) the OLD password no longer matches the stored hash', async () => {
    await post(good())
    expect(await bcrypt.compare(OLD, writtenHash())).toBe(false)
  })

  it('(12) the NEW password matches the stored hash', async () => {
    await post(good())
    expect(await bcrypt.compare(NEW, writtenHash())).toBe(true)
  })

  it('(13) exactly ONE update, on the session operator, touching ONLY the password', async () => {
    await post(good())
    expect(update).toHaveBeenCalledTimes(1)
    const arg = update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: OP.id })
    expect(Object.keys(arg.data)).toEqual(['password'])
  })

  it('(14) every pending pwreset token of THIS account is consumed', async () => {
    await post(good())
    expect(tokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: `pwreset:${OP.email}` } })
    // The identifier comes from the DB row, not from the session/JWT.
    expect(tokenDeleteMany.mock.calls[0][0].where.identifier).toContain(OP.email)
  })

  it('(15) the security e-mail is sent exactly once, to the account address', async () => {
    await post(good())
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledWith({ to: OP.email, name: OP.name })
  })

  it('(16) an e-mail FAILURE does not turn a committed change into an error', async () => {
    sendMail.mockRejectedValue(new Error('SMTP unreachable'))
    const res = await post(good())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(await bcrypt.compare(NEW, writtenHash())).toBe(true)
  })

  it('(16b) a token-purge failure likewise does not misreport a committed change', async () => {
    tokenDeleteMany.mockRejectedValue(new Error('deadlock'))
    expect((await post(good())).status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('(16c) SECRETS ARE NEVER LOGGED — not even inside an error message', async () => {
    // A Prisma failure on the update embeds the invocation arguments in its
    // message, and on this route those arguments are `data: { password: <hash> }`.
    // Logging err.message (the house pattern elsewhere) would print the hash.
    const leaky = new Error(`Invalid \`prisma.operator.update()\` invocation: data: { password: "${storedHash}" }`)
    update.mockRejectedValue(leaky)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(good())
    expect(res.status).toBe(500)
    const logged = spy.mock.calls.flat().map(String).join(' ')
    spy.mockRestore()
    for (const secret of [OLD, NEW, storedHash, leaky.message]) {
      expect(logged, 'console.error must not carry secrets').not.toContain(secret)
    }
    // …and the client is told nothing about the internals either.
    expect(JSON.stringify(await res.json())).not.toContain(storedHash)
  })

  it('a malformed stored hash reads as NOT VERIFIED (bcrypt throws → refusal, never success)', async () => {
    findUnique.mockResolvedValue({ ...OP, password: 'not-a-bcrypt-hash', status: 'active' })
    const res = await post(good())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_current')
    expect(update).not.toHaveBeenCalled()
  })

  it('a non-JSON body is refused, not crashed', async () => {
    expect((await post('{ not json')).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})

// ── (17)–(19) the screen, read as source ───────────────────────────────────────

const PAGE = 'app/[locale]/eat/account/password/page.tsx'
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** Drop whole-line // comments FIRST, then blank block comments (newlines kept). The
 *  headers legitimately NAME the forgot-password route to document the split between
 *  the two buttons; a ban that read comments would refuse its own documentation.
 *  ⚠️ THE ORDER IS LOAD-BEARING, and this cost a red run: a line comment mentioning a
 *  path glob ("…/email-change" followed by slash-star) opens a block comment for a
 *  stripper that blanks block comments first, which swallowed everything up to the
 *  next star-slash — the route's whole zod schema — and the assertions over that
 *  region passed over BLANKS. Line comments can contain anything; removing them
 *  before looking for block comments is the only safe sequence. */
function executable(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The text of one `async function <name>` up to the next one. */
function fnBody(code: string, name: string): string {
  const start = code.indexOf(`async function ${name}(`)
  expect(start, `${name} must exist`).toBeGreaterThan(-1)
  const rest = code.slice(start + `async function ${name}(`.length)
  const next = rest.indexOf('async function ')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the password screen', () => {
  const code = executable(read(PAGE))

  it('(17) the three fields are CONTROLLED and the submit button mirrors the server policy', async () => {
    // value + onChange on all three (they had neither: the form was decorative).
    for (const [state, setter] of [['cur', 'setCur'], ['nxt', 'setNxt'], ['cfm', 'setCfm']]) {
      expect(code, state).toMatch(new RegExp(`value=\\{${state}\\}`))
      expect(code, setter).toMatch(new RegExp(`onChange=\\{\\(e\\) => ${setter}\\(e\\.target\\.value\\)\\}`))
    }
    // Every refusal the server can raise is pre-checked, so a request that cannot
    // succeed is never sent — including the differing-confirmation case.
    const canSave = code.slice(code.indexOf('const canSave'), code.indexOf('// Server refusal codes'))
    expect(canSave).toContain('cur.length > 0')
    expect(canSave).toContain('nxt.length >= 8')
    expect(canSave).toContain('nxt.length <= 100')
    expect(canSave).toContain('cfm === nxt')      // ← the differing-confirmation guard
    expect(canSave).toContain('nxt !== cur')
    expect(code).toMatch(/disabled=\{busy \|\| !canSave\}/)
    // The gauge reads the value instead of being hard-coded « ok ok mid empty ».
    expect(code).not.toMatch(/<span className="ok" \/><span className="ok" \/><span className="mid" \/>/)
    expect(code).toMatch(/strength\(nxt\)/)
  })

  it('(18) « Mettre à jour » calls ONLY /api/account/password', async () => {
    const save = fnBody(code, 'changePassword')
    expect(save).toContain("fetch('/api/account/password'")
    expect(save).not.toContain('forgot-password')
    expect(save).not.toContain('reset-password')
    // It sends the two credentials and NO identifier — the server takes the account
    // from the session, and a client-sent id must not even be offered.
    expect(save).toContain('currentPassword: cur')
    expect(save).toContain('newPassword: nxt')
    expect(save).not.toMatch(/body:[^}]*\bemail\b/)
    // The footer button is wired to it, and the whole file calls each route once.
    expect(code).toMatch(/onClick=\{changePassword\}/)
    expect(code.match(/'\/api\/account\/password'/g) ?? []).toHaveLength(1)
    expect(code.match(/'\/api\/auth\/forgot-password'/g) ?? []).toHaveLength(1)
  })

  it('(19) « Mot de passe oublié ? » still posts the SAME forgot-password request', async () => {
    const link = fnBody(code, 'sendResetLink')
    expect(link).toContain("fetch('/api/auth/forgot-password'")
    expect(link).toContain("JSON.stringify({ email, space: 'eat' })")
    expect(link).toContain("setError(t('pwErrGeneric'))") // same copy as before
    expect(link).toContain('setSent(true)')
    // Its row is still wired to it, and its confirmation screen still exists.
    expect(code).toMatch(/onClick=\{sendResetLink\}/)
    expect(code).toContain("t('pwSentTitle')")
    expect(code).toContain("t('pwSentBody')")
  })

  it('(19b) the success screen does not claim other sessions were closed', async () => {
    expect(code).toContain("t('pwChangedTitle')")
    expect(code).toContain("t('pwOtherDevices')") // "other devices may stay signed in"
    const fr = JSON.parse(readFileSync('messages/fr.json', 'utf8')).eat.profileEdit
    expect(fr.pwOtherDevices).toMatch(/rester connect/i)
    expect(fr.pwChangedBody).not.toMatch(/déconnect/i)
    expect(fr.pwChangedTitle).not.toMatch(/lien|e-mail/i) // it is not the emailed-link screen
  })

  it('NEGATIVE CONTROL — re-wiring « Mettre à jour » to the reset link is caught', async () => {
    const regressed = code.replace('onClick={changePassword}', 'onClick={sendResetLink}')
    expect(regressed).not.toMatch(/onClick=\{changePassword\}/)
    // …and so is a changePassword that posts to forgot-password.
    const swapped = code.replace("fetch('/api/account/password'", "fetch('/api/auth/forgot-password'")
    expect(fnBody(executable(swapped), 'changePassword')).toContain('forgot-password')
  })
})

// ── (20) the two reset-by-email routes must be UNTOUCHED ───────────────────────

describe('(20) /api/auth/forgot-password and /api/auth/reset-password are unchanged', () => {
  // Digests taken at the base of this branch (origin/main 11e0104a), computed on the
  // LF-normalised bytes so a CRLF checkout cannot flip them. This lot adds a new
  // endpoint; it must not edit either reset-by-email route. A deliberate future
  // change to one of them has to update the digest here, on purpose and in review.
  const PINNED: Record<string, string> = {
    'app/api/auth/forgot-password/route.ts': '8a56901c43dcdf02acf084f7f4bd5cf3fdb8071d6c2e0d473e1793e9bdce59a0',
    'app/api/auth/reset-password/route.ts':  '212d71275761b75145d4d3cb3c5c99ca0c120ad9cb923bc7f00f25e2eaf21970',
  }

  for (const [file, digest] of Object.entries(PINNED)) {
    it(`${file} is byte-identical to the branch base`, () => {
      const actual = createHash('sha256').update(read(file)).digest('hex')
      expect(actual, `${file} was modified by this lot`).toBe(digest)
    })
  }

  it('NEGATIVE CONTROL — the digest really does detect an edit', () => {
    const edited = read('app/api/auth/reset-password/route.ts') + '\n// touched\n'
    expect(createHash('sha256').update(edited).digest('hex'))
      .not.toBe(PINNED['app/api/auth/reset-password/route.ts'])
  })

  it('their load-bearing behaviour is still the one the new route relies on', () => {
    const forgot = read('app/api/auth/forgot-password/route.ts')
    const reset  = read('app/api/auth/reset-password/route.ts')
    // The new route purges `pwreset:<email>` — the identifier these two own.
    expect(forgot).toContain('`pwreset:${email}`')
    expect(reset).toContain('`pwreset:${email}`')
    // A passwordless account gets NO reset e-mail: the reason the no_password copy
    // must not point the user at « Mot de passe oublié ? ».
    expect(forgot).toContain('if (operator?.password)')
    // Their own limiter buckets stay distinct from the new one.
    expect(forgot).toContain("'auth_forgot_password'")
    expect(reset).toContain("'auth_reset_password'")
    expect(forgot).not.toContain('account_password_change')
    expect(reset).not.toContain('account_password_change')
  })
})

// ── the new route's own invariants, read as source ─────────────────────────────

describe('the new endpoint keeps its order and its secrecy rules', () => {
  const src = read('app/api/account/password/route.ts')
  const code = executable(src)

  it('session → limiter → validation → DB read → verify → write, in that order', () => {
    const at = (needle: string) => {
      const i = code.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    expect(at('getServerSession(authOptions)')).toBeLessThan(at('status: 401'))
    expect(at('status: 401')).toBeLessThan(at('rateLimit(req'))
    expect(at('rateLimit(req')).toBeLessThan(at('bodySchema.safeParse'))
    expect(at('bodySchema.safeParse')).toBeLessThan(at('prisma.operator.findUnique'))
    expect(at('prisma.operator.findUnique')).toBeLessThan(at('bcrypt.compare'))
    expect(at('bcrypt.compare')).toBeLessThan(at('bcrypt.hash'))
    expect(at('bcrypt.hash')).toBeLessThan(at('prisma.operator.update'))
    // The CALL, not the import line — `sendPasswordChangedEmail` also appears at the
    // top of the file, which would make this comparison compare nothing.
    expect(at('prisma.operator.update')).toBeLessThan(at('sendPasswordChangedEmail({'))
  })

  it('POSITIVE CONTROL — the stripper leaves real code and only removes comments', () => {
    // A scanner that matches nothing passes every ban it is given. These two lines
    // prove this `code` still contains the statements the assertions below judge.
    expect(code).toContain('const bodySchema = z.object({')
    expect(code).toContain("currentPassword: z.string().min(1, 'current_required')")
    expect(code).toContain('export async function POST(req: Request)')
    // …and that it really did remove the commentary.
    expect(src).toContain('// NO FEATURE FLAG')
    expect(code).not.toContain('// NO FEATURE FLAG')
  })

  it('the limiter is keyed on the AUTHENTICATED operator id', () => {
    expect(code).toMatch(/rateLimit\(req,\s*'account_password_change'/)
    expect(code).toMatch(/extraKey:\s*operatorId/)
    expect(code).toMatch(/limitDefault:\s*5/)
    expect(code).toMatch(/windowDefault:\s*900/)
  })

  it('the policy is the app-wide one — no divergent third rule', () => {
    expect(code).toMatch(/z\.string\(\)\.min\(8,[^)]*\)\.max\(100/)
    const reg = read('app/api/auth/register/route.ts')
    expect(reg).toMatch(/min\(8[\s\S]{0,40}max\(100\)/)
  })

  it('no secret is ever handed to a logger, and err.message is not logged', () => {
    expect(code).not.toMatch(/console\.(log|error|warn|info)\([^)]*\b(currentPassword|newPassword|hashed|token)\b/)
    expect(code).not.toMatch(/console\.error\([^)]*err\.message/)
    expect(code).not.toMatch(/err instanceof Error \? err\.message/)
    // Only the error's class/code reaches the log.
    expect(code).toMatch(/err instanceof Error \? err\.name/)
  })

  it('it reads the hash and the status from the DB, and the id from the session only', () => {
    expect(code).toMatch(/select:\s*\{[^}]*password:\s*true[^}]*\}/)
    expect(code).toMatch(/select:\s*\{[^}]*status:\s*true[^}]*\}/)
    expect(code).toMatch(/where:\s*\{\s*id:\s*operatorId\s*\}/)
    // No identifier is ever taken from the request body.
    expect(code).not.toMatch(/parsed\.data\.(operatorId|id|email)/)
    expect(code).not.toMatch(/bodySchema[\s\S]{0,400}\bemail:/)
  })

  it('it is NOT behind a feature flag — the gap it closes must not be re-openable', () => {
    expect(code).not.toMatch(/_ENABLED/)
    expect(code).not.toMatch(/status: 404/)
  })
})
