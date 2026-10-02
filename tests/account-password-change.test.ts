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

// TWO SETS OF WRITE SPIES, on purpose. `txUpdate` / `txTokenDeleteMany` are reached
// only through the transaction client; `update` / `tokenDeleteMany` sit on the
// top-level client and must stay at ZERO calls for the whole file. Moving either
// write out of the transaction therefore fails a test instead of passing silently —
// a single shared spy could not tell the two placements apart.
// `committed` is the fake store's commit log: the transaction fake flushes the
// statements it recorded ONLY if the callback resolves, so a rollback is observable
// here. Real atomicity is Prisma's and MySQL's job; what this file proves is that
// both writes are INSIDE one transaction and that a failure yields 500 with no
// e-mail and nothing reported as changed.
const {
  getSession, findUnique, update, tokenDeleteMany, sendMail,
  txUpdate, txTokenDeleteMany, transaction, committed,
} = vi.hoisted(() => ({
  getSession:        vi.fn(),
  findUnique:        vi.fn(),
  update:            vi.fn(),
  tokenDeleteMany:   vi.fn(),
  sendMail:          vi.fn(),
  txUpdate:          vi.fn(),
  txTokenDeleteMany: vi.fn(),
  transaction:       vi.fn(),
  committed:         [] as string[],
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    operator:          { findUnique, update },
    verificationToken: { deleteMany: tokenDeleteMany },
    $transaction:      transaction,
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

  // The transaction fake: ALL-OR-NOTHING. Statements are recorded as they run and
  // flushed to `committed` only once the callback has resolved, so a throw anywhere
  // inside leaves `committed` empty (rollback) and propagates to the route's catch.
  committed.length = 0
  txUpdate.mockResolvedValue({ id: OP.id })
  txTokenDeleteMany.mockResolvedValue({ count: 1 })
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
    // The fake asserts its OWN contract: it models only the interactive form with
    // no options, so a future `$transaction(fn, { timeout: 1 })` — or a switch to
    // the array form — cannot slip past 49 green tests on a fake that ignored it.
    expect(typeof fn, 'the interactive (callback) form is what this fake models').toBe('function')
    expect(opts, 'this route passes no transaction options; update the fake if it ever does').toBeUndefined()
    const pending: string[] = []
    const tx = {
      operator: {
        update: (...a: unknown[]) => { pending.push('operator.update'); return txUpdate(...a) },
      },
      verificationToken: {
        deleteMany: (...a: unknown[]) => { pending.push('token.deleteMany'); return txTokenDeleteMany(...a) },
      },
    }
    const result = await fn(tx)   // a rejection here never reaches the flush below
    committed.push(...pending)    // COMMIT
    return result
  })
})
afterEach(() => {
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_ACCOUNT_PASSWORD_CHANGE_MAX
  __resetRateLimit()
})

/** The password written by the single operator.update INSIDE the transaction. */
const writtenHash = (): string => txUpdate.mock.calls[0][0].data.password as string

/** Nothing was written, anywhere: no transaction opened, no statement inside one,
 *  and no write on the top-level client either. Replaces the former
 *  `expectNoWrite()`, which became vacuous the moment the
 *  write moved into the transaction — a refusal test that cannot fail is not a test. */
function expectNoWrite(label = ''): void {
  expect(transaction, label).not.toHaveBeenCalled()
  expect(txUpdate, label).not.toHaveBeenCalled()
  expect(txTokenDeleteMany, label).not.toHaveBeenCalled()
  expect(update, label).not.toHaveBeenCalled()
  expect(tokenDeleteMany, label).not.toHaveBeenCalled()
  expect(committed, label).toEqual([])
}

describe('POST /api/account/password — auth, policy, refusals', () => {
  it('(1) UNAUTHENTICATED → 401, and nothing is read or written', async () => {
    getSession.mockResolvedValue(null)
    const res = await post(good())
    expect(res.status).toBe(401)
    expect(findUnique).not.toHaveBeenCalled()
    expectNoWrite()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('(1b) a session WITHOUT an id is not a session → 401', async () => {
    getSession.mockResolvedValue({ user: { email: OP.email } }) // email only, no id
    expect((await post(good())).status).toBe(401)
    expectNoWrite()
  })

  it('(1c) the account changed is the SESSION id — a body-supplied id is ignored', async () => {
    const res = await post({ ...good(), operatorId: 'victim', id: 'victim', email: 'victim@example.com' })
    expect(res.status).toBe(200)
    // Read AND write are both keyed on the session id, never on the body.
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OP.id } }))
    expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OP.id } }))
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
    expectNoWrite()

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
    expectNoWrite()
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
    expectNoWrite()
    expect(sendMail).not.toHaveBeenCalled()
    expect(tokenDeleteMany).not.toHaveBeenCalled()
  })

  it('(4) new password SHORTER than 8 → refused BEFORE any DB access', async () => {
    const res = await post({ currentPassword: OLD, newPassword: 'short7!' }) // 7 chars
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('weak_new')
    expect(findUnique).not.toHaveBeenCalled()
    expectNoWrite()
  })

  it('(5) new password LONGER than 100 → refused', async () => {
    const res = await post({ currentPassword: OLD, newPassword: 'a'.repeat(101) })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('weak_new')
    expectNoWrite()
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
    expectNoWrite()
  })

  it('(6) new === current → refused (no write, no e-mail about a non-event)', async () => {
    const res = await post({ currentPassword: OLD, newPassword: OLD })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('same_as_current')
    expectNoWrite()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('(7) password === null → DISTINCT, honest refusal (not « wrong password »)', async () => {
    findUnique.mockResolvedValue({ ...OP, password: null, status: 'active' })
    const res = await post(good())
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('no_password')
    expect(body.code).not.toBe('invalid_current')
    expectNoWrite()
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
      expectNoWrite(status)
    }
  })

  it('(8b) an account that no longer exists → 401, never a crash', async () => {
    findUnique.mockResolvedValue(null)
    expect((await post(good())).status).toBe(401)
    expectNoWrite()
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
    expect(txUpdate).toHaveBeenCalledTimes(1)
    const arg = txUpdate.mock.calls[0][0]
    expect(arg.where).toEqual({ id: OP.id })
    expect(Object.keys(arg.data)).toEqual(['password'])
    // …and it went through the transaction client, never around it.
    expect(update).not.toHaveBeenCalled()
  })

  it('(14) every pending pwreset token of THIS account is consumed', async () => {
    await post(good())
    expect(txTokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: `pwreset:${OP.email}` } })
    // The identifier comes from the DB row, not from the session/JWT.
    expect(txTokenDeleteMany.mock.calls[0][0].where.identifier).toContain(OP.email)
    expect(tokenDeleteMany).not.toHaveBeenCalled()
  })

  it('(15) the security e-mail is sent exactly once, to the account address', async () => {
    await post(good())
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledWith({ to: OP.email, name: OP.name })
  })

  it('(16) [case 6] an e-mail FAILURE after a COMMITTED transaction stays 200', async () => {
    sendMail.mockRejectedValue(new Error('SMTP unreachable'))
    const res = await post(good())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    // The transaction committed before the e-mail was attempted…
    expect(committed).toEqual(['operator.update', 'token.deleteMany'])
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(await bcrypt.compare(NEW, writtenHash())).toBe(true)
    // …and the e-mail really was attempted and really did fail.
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('(16c) [case 7] SECRETS ARE NEVER LOGGED — not even inside an error message', async () => {
    // A Prisma failure on the update embeds the invocation arguments in its
    // message, and on this route those arguments are `data: { password: <hash> }`.
    // Logging err.message (the house pattern elsewhere) would print the hash.
    const leaky = new Error(`Invalid \`prisma.operator.update()\` invocation: data: { password: "${storedHash}" }`)
    txUpdate.mockRejectedValue(leaky)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(good())
    expect(res.status).toBe(500)
    const logged = spy.mock.calls.flat().map(String).join(' ')
    spy.mockRestore()
    for (const secret of [OLD, NEW, storedHash, leaky.message]) {
      expect(logged, 'console.error must not carry secrets').not.toContain(secret)
    }
    // …the client is told nothing about the internals either…
    expect(JSON.stringify(await res.json())).not.toContain(storedHash)
    // …and the failed transaction committed NOTHING and sent NO e-mail.
    expect(committed).toEqual([])
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('a malformed stored hash reads as NOT VERIFIED (bcrypt throws → refusal, never success)', async () => {
    findUnique.mockResolvedValue({ ...OP, password: 'not-a-bcrypt-hash', status: 'active' })
    const res = await post(good())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_current')
    expectNoWrite()
  })

  it('a non-JSON body is refused, not crashed', async () => {
    expect((await post('{ not json')).status).toBe(400)
    expectNoWrite()
  })
})

// ── ATOMICITY of the password write and the pwreset purge ──────────────────────
//
// WHY THIS BLOCK EXISTS. The first version of this route wrote the new hash, then
// purged the pending `pwreset:<email>` tokens BEST-EFFORT (`.catch(() => {})`), then
// answered 200. The purge is a SECURITY property, not housekeeping: a reset link
// e-mailed before the change would have outlived it, and whoever held that e-mail
// could then overwrite the password the owner had just chosen — a 200 would have
// announced a change that was only half made. The two writes are now one
// transaction. The test that used to assert the old behaviour
// («  a token-purge failure likewise does not misreport a committed change ») was
// conceptually wrong and is deleted, not weakened.

describe('the password write and the pwreset purge are ATOMIC', () => {
  it('[case 1] both writes happen inside ONE transaction, and none outside it', async () => {
    const res = await post(good())
    expect(res.status).toBe(200)
    // Exactly one transaction, opened with the interactive (callback) form.
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(typeof transaction.mock.calls[0][0]).toBe('function')
    // Both statements ran on the TRANSACTION client…
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(txTokenDeleteMany).toHaveBeenCalledTimes(1)
    // …and neither ran on the top-level client, which is what "inside" means here.
    expect(update).not.toHaveBeenCalled()
    expect(tokenDeleteMany).not.toHaveBeenCalled()
    // Order inside the transaction: the hash first, then the purge.
    expect(committed).toEqual(['operator.update', 'token.deleteMany'])
  })

  it('the purge identifier is NORMALISED like the minting routes — a mixed-case stored e-mail still purges', async () => {
    // Nothing lowercases Operator.email at registration, while BOTH routes that
    // mint a pwreset token key it on `email.trim().toLowerCase()`. Purging the raw
    // column would match zero rows, NOT throw, and still commit and answer 200 — a
    // silent purge failure, i.e. the exact hole this transaction exists to close,
    // reachable without any error at all. The round-1 fixture was already lowercase,
    // so no test could see it.
    findUnique.mockResolvedValue({
      ...OP, email: '  Alex@Example.COM ', password: storedHash, status: 'active',
    })
    const res = await post(good())
    expect(res.status).toBe(200)
    expect(txTokenDeleteMany).toHaveBeenCalledWith({ where: { identifier: 'pwreset:alex@example.com' } })
    const sent = txTokenDeleteMany.mock.calls[0][0].where.identifier as string
    expect(sent).toBe(sent.toLowerCase())
    expect(sent).not.toContain('Alex')
    expect(sent).not.toMatch(/\s/)
    // Exactly what /api/auth/forgot-password would have stored for that address.
    const forgot = readFileSync('app/api/auth/forgot-password/route.ts', 'utf8')
    expect(forgot).toContain("const email = parsed.data.email.trim().toLowerCase()")
    expect(forgot).toContain('const identifier = `pwreset:${email}`')
  })

  it('[case 2] purge OK → 200, and the commit contains both statements', async () => {
    txTokenDeleteMany.mockResolvedValue({ count: 3 }) // three stale links destroyed
    const res = await post(good())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(committed).toEqual(['operator.update', 'token.deleteMany'])
    expect(await bcrypt.compare(NEW, writtenHash())).toBe(true)
  })

  it('[cases 3 + 5] purge FAILS → 500, never 200, and NOTHING is committed', async () => {
    txTokenDeleteMany.mockRejectedValue(new Error('deadlock'))
    const res = await post(good())
    expect(res.status).toBe(500)
    expect(res.status).not.toBe(200)
    const body = await res.json()
    expect(body.ok).toBeUndefined()      // no success shape on a failed change
    expect(body.error).toBeTruthy()
    // The update was ATTEMPTED inside the transaction and then rolled back: the
    // fake store flushes only on a resolved callback, so an empty commit log is
    // the rollback. (The rollback itself is Prisma's and MySQL's guarantee; what
    // is proven here is that the route puts the write where that guarantee applies
    // and reports the failure instead of a 200.)
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(committed).toEqual([])
  })

  it('[case 4] a FAILED transaction sends NO security e-mail, whichever statement failed', async () => {
    // ⚠️ The third arm used to be `transaction.mockRejectedValue(...)`, which REPLACES
    // the fake: the callback never ran, so it proved only that a transaction which
    // never opened sends no e-mail. It now fails at the FLUSH point, after both
    // statements have run — the real « both statements succeeded, the COMMIT then
    // failed » case, which is the one the founder's requirement 4 cares about.
    for (const [label, arm] of [
      ['purge fails', () => txTokenDeleteMany.mockRejectedValue(new Error('deadlock'))],
      ['update fails', () => txUpdate.mockRejectedValue(new Error('lock wait timeout'))],
      ['commit fails', () => transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          operator:          { update: (...a: unknown[]) => txUpdate(...a) },
          verificationToken: { deleteMany: (...a: unknown[]) => txTokenDeleteMany(...a) },
        }
        await fn(tx)                                  // both statements land…
        throw new Error('commit failed: connection reset') // …and the COMMIT fails
      })],
    ] as [string, () => void][]) {
      vi.clearAllMocks()
      committed.length = 0
      getSession.mockResolvedValue({ user: { id: OP.id } })
      findUnique.mockResolvedValue({ ...OP, password: storedHash, status: 'active' })
      txUpdate.mockResolvedValue({ id: OP.id })
      txTokenDeleteMany.mockResolvedValue({ count: 1 })
      transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const pending: string[] = []
        const tx = {
          operator:          { update: (...a: unknown[]) => { pending.push('operator.update'); return txUpdate(...a) } },
          verificationToken: { deleteMany: (...a: unknown[]) => { pending.push('token.deleteMany'); return txTokenDeleteMany(...a) } },
        }
        const r = await fn(tx)
        committed.push(...pending)
        return r
      })
      sendMail.mockResolvedValue(undefined)
      arm()

      const res = await post(good())
      expect(res.status, label).toBe(500)
      expect(sendMail, label).not.toHaveBeenCalled()
      expect(committed, label).toEqual([])
      // POSITIVE CONTROL for the third arm: it must really have reached the commit,
      // i.e. both statements ran and were then thrown away — otherwise the arm
      // would be proving something easier than it claims.
      if (label === 'commit fails') {
        expect(txUpdate, label).toHaveBeenCalledTimes(1)
        expect(txTokenDeleteMany, label).toHaveBeenCalledTimes(1)
      }
    }
  })

  it('a COMMITTED change is never reported as a failure, whatever the sender does', async () => {
    // `.catch()` alone only survives a REJECTED promise. These three shapes are the
    // ones that would otherwise reach the handler's catch and answer 500 on a
    // change that DID happen — the misreport of this lot, in the opposite direction.
    const shapes: [string, () => void][] = [
      ['rejects',            () => sendMail.mockRejectedValue(new Error('SMTP unreachable'))],
      ['throws synchronously', () => sendMail.mockImplementation(() => { throw new Error('transport missing') })],
      ['returns a non-thenable', () => sendMail.mockImplementation(() => undefined as unknown as Promise<void>)],
    ]
    for (const [label, arm] of shapes) {
      vi.clearAllMocks()
      committed.length = 0
      getSession.mockResolvedValue({ user: { id: OP.id } })
      findUnique.mockResolvedValue({ ...OP, password: storedHash, status: 'active' })
      txUpdate.mockResolvedValue({ id: OP.id })
      txTokenDeleteMany.mockResolvedValue({ count: 1 })
      transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          operator:          { update: (...a: unknown[]) => txUpdate(...a) },
          verificationToken: { deleteMany: (...a: unknown[]) => txTokenDeleteMany(...a) },
        }
        const r = await fn(tx)
        committed.push('operator.update', 'token.deleteMany')
        return r
      })
      arm()

      const res = await post(good())
      expect(res.status, label).toBe(200)
      expect((await res.json()).ok, label).toBe(true)
      expect(txUpdate, label).toHaveBeenCalledTimes(1)
      expect(sendMail, label).toHaveBeenCalledTimes(1)
    }
  })

  it('a sender that NEVER settles does not hold the response (the transport sets no socket timeout)', async () => {
    // A relay that accepts the socket and stalls is a routine shared-hosting
    // symptom, and lib/transactional-emails.ts declares no connection/greeting/
    // socket timeout. Awaiting it after the commit would block until the request is
    // cut and the user would be told their committed change failed.
    //
    // NO WALL-CLOCK RACE HERE, deliberately. The first version raced the handler
    // against a 2 s timer; under a saturated full-suite run the real cost-12 hash
    // alone exceeded that, so the case failed for the wrong reason AND abandoned a
    // still-running handler whose mock calls then landed in the NEXT test's
    // assertions. The timing-independent form is simply to await: if the route ever
    // awaited this never-settling promise, this `await` could not resolve and the
    // case would die on its timeout. Resolving at all IS the property.
    sendMail.mockImplementation(() => new Promise<void>(() => { /* never settles */ }))
    const res = await post(good())
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1) // it was started, just not awaited
    expect(committed).toEqual(['operator.update', 'token.deleteMany'])
  })

  it('the e-mail is OUTSIDE the transaction — it is attempted only after the commit', async () => {
    const order: string[] = []
    txTokenDeleteMany.mockImplementation(async () => { order.push('purge'); return { count: 1 } })
    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push('tx:begin')
      const tx = {
        operator:          { update: (...a: unknown[]) => txUpdate(...a) },
        verificationToken: { deleteMany: (...a: unknown[]) => txTokenDeleteMany(...a) },
      }
      const r = await fn(tx)
      order.push('tx:commit')
      committed.push('operator.update', 'token.deleteMany')
      return r
    })
    sendMail.mockImplementation(async () => { order.push('email') })

    expect((await post(good())).status).toBe(200)
    expect(order).toEqual(['tx:begin', 'purge', 'tx:commit', 'email'])
    // An e-mail cannot be rolled back, so it must never be inside the transaction.
    expect(order.indexOf('email')).toBeGreaterThan(order.indexOf('tx:commit'))
  })

  it('the bcrypt hash is computed BEFORE the transaction opens (a cost-12 hash must not hold it)', async () => {
    const src = readFileSync('app/api/account/password/route.ts', 'utf8').replace(/\r\n/g, '\n')
    const code = src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    expect(code.indexOf('bcrypt.hash')).toBeGreaterThan(-1)
    expect(code.indexOf('prisma.$transaction')).toBeGreaterThan(-1)
    expect(code.indexOf('bcrypt.hash')).toBeLessThan(code.indexOf('prisma.$transaction'))
  })

  it('SOURCE — the two statements are textually inside the $transaction callback, and the best-effort purge is gone', async () => {
    const src = readFileSync('app/api/account/password/route.ts', 'utf8').replace(/\r\n/g, '\n')
    const code = src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

    const open = code.indexOf('await prisma.$transaction(async (tx) => {')
    expect(open, 'the interactive transaction must be there').toBeGreaterThan(-1)
    const close = code.indexOf('\n    })', open)
    expect(close).toBeGreaterThan(open)
    const block = code.slice(open, close)
    expect(block.length, 'the extracted block must be the callback, not the file').toBeLessThan(400)
    expect(block).toContain('tx.operator.update({ where: { id: operator.id }, data: { password: hashed } })')
    expect(block).toContain('tx.verificationToken.deleteMany({ where: { identifier: resetIdentifier } })')

    // Nothing writes around the transaction…
    expect(code).not.toContain('prisma.operator.update')
    expect(code).not.toContain('prisma.verificationToken')
    // …and NOTHING inside it swallows a failure. The earlier version of this test
    // banned only the `.catch` SHAPE, so a `try { purge } catch {}` moved inside the
    // callback would have passed every source assertion here.
    expect(block).not.toMatch(/\.catch/)
    expect(block).not.toMatch(/try\s*\{/)
    expect(code).not.toMatch(/deleteMany\([\s\S]{0,120}\)\s*\n?\s*\.catch/)

    // The security e-mail is the ONLY swallowed call left, and it is after the
    // transaction. `emailAt` is anchored first: indexOf returns -1 when the call is
    // absent, and `> -1` is true for almost any index — the trap this file has
    // already paid for once.
    const emailAt = code.indexOf('sendPasswordChangedEmail({')
    expect(emailAt, 'the security notice must still be sent').toBeGreaterThan(-1)
    expect(emailAt).toBeGreaterThan(open)
    const swallows = code.match(/\.catch\(\(\) => \{\}\)/g) ?? []
    expect(swallows).toHaveLength(1)
    expect(code.indexOf('.catch(() => {})')).toBeGreaterThan(emailAt)
    // It is fire-and-forget: an un-timeout-ed SMTP socket must not be awaited after
    // the commit (a stall would report a committed change as a failure).
    expect(code).toMatch(/void sendPasswordChangedEmail\(/)
    expect(code).not.toMatch(/await sendPasswordChangedEmail\(/)
  })

  it('NEGATIVE CONTROL — a purge moved back out of the transaction is caught', async () => {
    const regressed = `
      await prisma.$transaction(async (tx) => {
        await tx.operator.update({ where: { id: operator.id }, data: { password: hashed } })
      })
      await prisma.verificationToken
        .deleteMany({ where: { identifier: \`pwreset:\${operator.email}\` } })
        .catch(() => {})
    `
    // The two bans this file relies on both fire on that shape.
    expect(regressed).toContain('prisma.verificationToken')
    expect(regressed).toMatch(/deleteMany\([\s\S]{0,120}\)\s*\n?\s*\.catch/)
    // And the runtime assertion would fail too: the purge would not be in the tx.
    const block = regressed.slice(regressed.indexOf('$transaction'), regressed.indexOf('\n      })'))
    expect(block).not.toContain('tx.verificationToken.deleteMany')
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
    //
    // ⚠️ The marker used to be `'// Server refusal codes'`, a WHOLE-LINE comment —
    // which `executable()` blanks, so indexOf returned -1, `slice(start, -1)` ran to
    // the end of the file and the five assertions below were scoped to the entire
    // page instead of to this one expression. They would have survived moving
    // `cfm === nxt` out of `canSave` entirely. Slice to a marker that SURVIVES the
    // stripper, prove the marker was found, and bound the slice so a future
    // mis-anchoring is loud instead of silent.
    const canSaveAt = code.indexOf('const canSave')
    const endAt = code.indexOf('function messageFor(')
    expect(canSaveAt, 'canSave must exist').toBeGreaterThan(-1)
    expect(endAt, 'the slice marker must survive comment-stripping').toBeGreaterThan(canSaveAt)
    const canSave = code.slice(canSaveAt, endAt)
    expect(canSave.length, 'the slice must be the expression, not the rest of the file').toBeLessThan(300)
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
    expect(at('bcrypt.hash')).toBeLessThan(at('prisma.$transaction'))
    expect(at('prisma.$transaction')).toBeLessThan(at('tx.operator.update'))
    expect(at('tx.operator.update')).toBeLessThan(at('tx.verificationToken.deleteMany'))
    // The CALL, not the import line — `sendPasswordChangedEmail` also appears at the
    // top of the file, which would make this comparison compare nothing.
    expect(at('tx.verificationToken.deleteMany')).toBeLessThan(at('sendPasswordChangedEmail({'))
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
