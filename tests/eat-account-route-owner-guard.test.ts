import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── PATCH /api/eat/account — the owner guard that closes the TOCTOU ───────────
//
// WHY THIS EXISTS ON THE SERVER. The client decides WHAT to send; the browser decides WHOSE
// COOKIE goes with it, at send time. A debounced save prepared under account A can therefore
// leave after the cookie has become B's but before the client's own belief has caught up —
// the client cannot close that gap, because it never sees the cookie that will actually be
// attached. The server is the only party that sees both at once: the identity it
// AUTHENTICATED, and the identity the client says it PREPARED the mutation for. So it is the
// only one that can refuse, and it refuses with a stable `owner_changed` 409.
//
// NOT A NEW NOTION OF OWNER: `expectedUserId` is the raw Operator id, the same value the
// session carries. The client keeps using sessionCartStamp for its own rendering.
//
// The real handler runs; only Prisma and the session are mocked. Every refusal case asserts
// that `prisma.operator.update` was NOT called — a refusal that still wrote would be worse
// than no refusal at all, because it would look safe.

const { db, getServerSession } = vi.hoisted(() => ({
  db: { operator: { update: vi.fn(), findUnique: vi.fn() } },
  getServerSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET, PATCH } from '@/app/api/eat/account/route'

const A = 'user-A'
const B = 'user-B'

/** The preferences A had on screen when the debounce was armed. */
const PREFS_A = {
  channels: { push: false, email: false, sms: true },
  rows: { status: false, courier: false, reviews: true, offers: false, newResto: true, rewards: false },
  quiet: false,
}

const signedInAs = (id: string | null) =>
  getServerSession.mockResolvedValue(id ? { user: { id } } : null)

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/eat/account', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  db.operator.update.mockReset()
  db.operator.findUnique.mockReset()
  getServerSession.mockReset()
  db.operator.update.mockResolvedValue({ name: 'n', phone: null, notifPrefs: PREFS_A })
})

describe('the server refuses a mutation prepared for another identity', () => {
  it('session A + expectedUserId A → the update is authorised, and scoped to A', async () => {
    signedInAs(A)
    const res = await patch({ expectedUserId: A, notifPrefs: PREFS_A })
    expect(res.status).toBe(200)
    expect(db.operator.update).toHaveBeenCalledTimes(1)
    const arg = db.operator.update.mock.calls[0][0] as { where: unknown; data: { notifPrefs?: unknown } }
    expect(arg.where, 'the row is chosen by the SESSION, never by the body').toEqual({ id: A })
    expect(arg.data.notifPrefs).toEqual(PREFS_A)
  })

  it('session B + a payload prepared with expectedUserId A → 409, and ZERO write', async () => {
    // This IS the race: the debounce was armed under A, the cookie became B's before the
    // request left, so the server authenticates B while the body says it was prepared for A.
    signedInAs(B)
    const res = await patch({ expectedUserId: A, notifPrefs: PREFS_A })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'owner_changed' })
    expect(db.operator.update, 'nothing of A reached B\'s row').not.toHaveBeenCalled()
  })

  it('…and B\'s account is untouched whatever A\'s payload contained', async () => {
    signedInAs(B)
    for (const prefs of [PREFS_A, { ...PREFS_A, quiet: true }, { ...PREFS_A, channels: { push: true, email: true, sms: true } }]) {
      db.operator.update.mockClear()
      const res = await patch({ expectedUserId: A, notifPrefs: prefs })
      expect(res.status).toBe(409)
      expect(db.operator.update).not.toHaveBeenCalled()
    }
  })

  it('ANY mutation WITHOUT expectedUserId → refused, and ZERO write', async () => {
    // A client that cannot say who it is writing for has no business writing. 400 rather
    // than 409: this is a malformed caller, not an identity that moved. The requirement
    // used to be scoped to notifPrefs — both callers now carry the id, so the exemption on
    // name/phone is lifted and every mutation is held to the same rule.
    signedInAs(A)
    for (const body of [
      { notifPrefs: PREFS_A },
      { name: 'Mohammed' },
      { phone: '0600000000' },
      { name: 'Mohammed', phone: '0600000000' },
      { name: 'Mohammed', notifPrefs: PREFS_A },
    ]) {
      db.operator.update.mockClear()
      const res = await patch(body)
      expect(res.status, `body=${JSON.stringify(body)}`).toBe(400)
      expect(await res.json()).toEqual({ error: 'expected_user_id_required' })
      expect(db.operator.update, `body=${JSON.stringify(body)}`).not.toHaveBeenCalled()
    }
  })

  it('an empty or non-string expectedUserId is not a pass either', async () => {
    signedInAs(A)
    for (const bad of ['', null, 0, false, {}, []]) {
      db.operator.update.mockClear()
      const res = await patch({ expectedUserId: bad, notifPrefs: PREFS_A })
      expect([400, 409], `expectedUserId=${JSON.stringify(bad)}`).toContain(res.status)
      expect(db.operator.update, `expectedUserId=${JSON.stringify(bad)}`).not.toHaveBeenCalled()
    }
  })

  it('the WHERE clause is the session\'s id even when the body tries to name another row', async () => {
    // « aucune mutation d'un autre compte même si le body est autrement parfaitement valide »
    signedInAs(B)
    const res = await patch({ expectedUserId: B, notifPrefs: PREFS_A, id: A, userId: A, where: { id: A } })
    expect(res.status).toBe(200)
    const arg = db.operator.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(arg.where).toEqual({ id: B })
    // zod strips what it does not declare, so none of the smuggled keys reach Prisma
    expect(Object.keys(arg.data).sort()).toEqual(['notifPrefs'])
  })

  it('an unauthenticated caller writes nothing, whatever it claims to expect', async () => {
    signedInAs(null)
    const res = await patch({ expectedUserId: A, notifPrefs: PREFS_A })
    expect(res.status).toBe(401)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('name/phone WITH expectedUserId A under session A → 200, scoped to A', async () => {
    // The exemption that used to let the edit screen skip the field is gone: it now carries
    // the id, so the server can hold name/phone to the same rule as notifPrefs.
    signedInAs(A)
    const res = await patch({ expectedUserId: A, name: 'Mohammed', phone: '0600000000' })
    expect(res.status).toBe(200)
    expect(db.operator.update).toHaveBeenCalledTimes(1)
    const arg = db.operator.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(arg.where).toEqual({ id: A })
    expect(Object.keys(arg.data).sort()).toEqual(['name', 'phone'])
  })

  it('name/phone prepared under A, sent under B → 409 and ZERO write', async () => {
    // THE RACE THE EDIT SCREEN'S SAVE OPENED. The user typed under A, the cookie became B's
    // before the click's await resolved, the server authenticates B — and refuses, because
    // the body says the mutation was prepared for A.
    signedInAs(B)
    const res = await patch({ expectedUserId: A, name: 'Alice typed this', phone: '0611111111' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'owner_changed' })
    expect(db.operator.update, 'A\'s text did NOT reach B\'s row').not.toHaveBeenCalled()
  })

  it('a mixed body is held to the owner rule — name does not smuggle through either', async () => {
    signedInAs(B)
    const res = await patch({ name: 'Mohammed', notifPrefs: PREFS_A, expectedUserId: A })
    expect(res.status).toBe(409)
    expect(db.operator.update, 'the name did not get written either').not.toHaveBeenCalled()
  })

  it('the refusal happens BEFORE the write is assembled — order, not just outcome', async () => {
    const src = (await import('node:fs')).readFileSync('app/api/eat/account/route.ts', 'utf8').replace(/\r\n/g, '\n')
    const iSession = src.indexOf('const userId = await ownerId()', src.indexOf('export async function PATCH'))
    const iParse = src.indexOf('ProfilePatch.safeParse', iSession)
    const iCheck = src.indexOf('parsed.data.expectedUserId !== userId', iParse)
    const iData = src.indexOf('const data:', iCheck)
    const iWrite = src.indexOf('prisma.operator.update', iData)
    for (const [name, i] of [['session', iSession], ['parse', iParse], ['check', iCheck], ['data', iData], ['write', iWrite]] as const) {
      expect(i, `${name} was found`).toBeGreaterThan(-1)
    }
    // session -> parse -> owner check -> build -> write, in that order and no other
    expect(iSession).toBeLessThan(iParse)
    expect(iParse).toBeLessThan(iCheck)
    expect(iCheck).toBeLessThan(iData)
    expect(iData).toBeLessThan(iWrite)
    // and `expectedUserId` is DECLARED in the schema: zod strips undeclared keys, so an
    // undeclared field would arrive as undefined and the comparison would compare nothing
    expect(src).toMatch(/expectedUserId: z\.string\(\)\.min\(1\)\.optional\(\)/)
  })
})

// ── GET: the response names the identity it was produced FOR ──────────────────
//
// The write side was closed first, and that left the read side proving nothing. Owner-scoping
// `findUnique` makes the response CORRECT for whoever was authenticated and says NOTHING
// about who that was — so a client whose belief lags behind the cookie cannot tell one
// account's correct response from another's. `ownerId` is what lets it tell.
//
// These cases run the REAL handler. The id is the SESSION's; nothing in the request can
// influence it.

describe('GET returns the owner it authenticated', () => {
  const OP = { name: 'Mohammed', phone: '0600000000', notifPrefs: PREFS_A }

  beforeEach(() => {
    db.operator.findUnique.mockResolvedValue(OP)
  })

  it('5 — an authenticated GET always carries ownerId, taken from the session', async () => {
    for (const id of [A, B, 'operator-xyz-123']) {
      signedInAs(id)
      db.operator.findUnique.mockClear()
      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ownerId, `session=${id}`).toBe(id)
      // …and the row it read is the same identity's, chosen by the session
      const arg = db.operator.findUnique.mock.calls[0][0] as { where: unknown }
      expect(arg.where).toEqual({ id })
    }
  })

  it('5 bis — the body\'s keys are exactly what the two screens need, and ownerId is one', async () => {
    signedInAs(A)
    const body = await (await GET()).json()
    expect(Object.keys(body).sort()).toEqual(['name', 'notifPrefs', 'ownerId', 'phone'])
    expect(body.notifPrefs).toEqual(PREFS_A)
  })

  it('5 ter — an unauthenticated GET names no owner and reads no row', async () => {
    signedInAs(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(db.operator.findUnique, 'nothing was read').not.toHaveBeenCalled()
  })

  it('5 quater — a missing row is still not an owner-named response', async () => {
    signedInAs(A)
    db.operator.findUnique.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(404)
    expect(await res.json()).not.toHaveProperty('ownerId')
  })

  it('6 — /eat/account/edit now reads ownerId and sends expectedUserId', async () => {
    // The sibling profile screen reads `name`, `phone` AND `ownerId` off this GET. The ownerId
    // read is the GET half of the TOCTOU — it was the missing half before this lot — and the
    // PATCH half is sending `expectedUserId`, which `the server now REQUIRES on every write.
    signedInAs(A)
    const d = await (await GET()).json()
    expect(typeof d.name).toBe('string')
    expect(d.name).toBe(OP.name)
    expect(typeof d.phone).toBe('string')
    expect(d.phone).toBe(OP.phone)
    expect(typeof d.ownerId, 'the GET names the identity it authenticated').toBe('string')
    expect(d.ownerId).toBe(A)

    const edit = (await import('node:fs'))
      .readFileSync('app/[locale]/eat/account/edit/page.tsx', 'utf8').replace(/\r\n/g, '\n')
    // The screen now reads `ownerId` and refuses an adoption that doesn't match
    expect(edit).toMatch(/typeof d\?\.ownerId !== 'string' \|\| d\.ownerId !== requestUserId/)
    expect(edit).toMatch(/const nextName = typeof d\.name === 'string' \? d\.name : ''/)
    expect(edit).toMatch(/const nextPhone = typeof d\.phone === 'string' \? d\.phone : ''/)
    // and the PATCH names the identity it was prepared for
    expect(edit, 'the save carries expectedUserId').toMatch(
      /body: JSON\.stringify\(\{ expectedUserId: saveUserId, name: trimmed, phone: phone\.trim\(\) \}\)/,
    )
    // …and it keys on 409 to stay silent on a stale mutation
    expect(edit).toMatch(/if \(res\.status === 409\) return/)
  })

  it('6 bis — and that PATCH succeeds WITH expectedUserId, scoped to the session', async () => {
    signedInAs(A)
    const res = await patch({ expectedUserId: A, name: 'Mohammed', phone: '0600000000' })
    expect(res.status).toBe(200)
    expect(db.operator.update).toHaveBeenCalledTimes(1)
    const arg = db.operator.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(arg.where).toEqual({ id: A })
    expect(Object.keys(arg.data).sort()).toEqual(['name', 'phone'])
  })
})
