import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// ── CROSS-ACCOUNT ADDRESS LEAK (production incident) ───────────────────────────
//
// WHAT HAPPENED. Account A saved « Domicile — 2 Rue Test, 84100 Orange ». Account B
// then signed in IN THE SAME BROWSER, saw that address, and the production database
// ended up with the row on BOTH accounts. Two defects in lib/eat-addresses.ts:
//   1. ONE GLOBAL KEY — `const KEY = 'grubano_addresses'` — so the cache held whatever
//      the last signed-in identity had put there and any later identity read it as its
//      own.
//   2. syncFromServer() read « server list empty + localStorage not empty » as "this
//      user built these up as a guest" and POSTed the cached rows to /api/eat/addresses,
//      i.e. into the NEW account. The API is correctly owner-scoped (every query is
//      `where: { userId }`), so it dutifully created A's address FOR B. The leak was
//      entirely client-side, and it WROTE, not just displayed.
//
// WHAT IS PROVEN HERE. The library runs for real against an in-memory localStorage and a
// stubbed fetch — no DOM library is involved, which is why this is a .test.ts in the
// repository's node environment. Every lettered case below is one of the founder's
// requirements (A…L). The UI-wiring and do-not-touch requirements are proven on source,
// because there is no DOM harness in this repository to render a shell in.

// ── minimal browser surface (node env) ─────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>()
  get length(): number { return this.m.size }
  key(i: number): string | null { return Array.from(this.m.keys())[i] ?? null }
  getItem(k: string): string | null { return this.m.has(k) ? (this.m.get(k) as string) : null }
  setItem(k: string, v: string): void { this.m.set(k, String(v)) }
  removeItem(k: string): void { this.m.delete(k) }
  clear(): void { this.m.clear() }
  /** test helper — the raw buckets, to prove what is and is not stored */
  keys(): string[] { return Array.from(this.m.keys()) }
}

const store = new MemStorage()
const events: string[] = []
const win = new EventTarget() as EventTarget & { addEventListener: EventTarget['addEventListener'] }
;(globalThis as { window?: unknown }).window = win
;(globalThis as { localStorage?: unknown }).localStorage = store
win.addEventListener('grubano:addresses', () => { events.push('addresses') })

const fetchMock = vi.fn()
;(globalThis as { fetch?: unknown }).fetch = fetchMock

import {
  readAddresses, addAddress, updateAddress, removeAddress, setDefaultAddress,
  getDefaultAddress, syncFromServer, setAddressOwner, getAddressOwner, clearAddressOwner,
  __resetAddressOwner, formatAddress, currentAddressStamp, sessionAddressStamp,
  ADDRESS_EVENT, type EatAddress,
} from '@/lib/eat-addresses'
import { syncGeoCacheOwner } from '@/lib/use-geolocation'

const LEGACY_KEY = 'grubano_addresses'
const bucketOf = (owner: string) =>
  owner === 'guest' ? 'grubano_addresses.v2.guest' : `grubano_addresses.v2.u.${owner}`

/** The leaked address from the real incident. */
const ADDR_A: EatAddress = {
  id: 'a-prod-1', label: 'Domicile', kind: 'home', street: '2 Rue Test',
  postalCode: '84100', city: 'Orange', country: 'France', isDefault: true,
}
const ADDR_B: EatAddress = {
  id: 'b-own-1', label: 'Travail', kind: 'work', street: '8 Bd Haussmann',
  postalCode: '75009', city: 'Paris', country: 'France', isDefault: true,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A GET /api/eat/addresses response as the route really answers it: the server NAMES the
 *  owner it resolved from the session cookie, and the client refuses any list the server
 *  attributes to someone else. Every fixture below therefore has to say whose rows these
 *  are — a fixture that forgets is refused, which is the point. */
const gotFor = (ownerId: string, list: EatAddress[] = []) => json({ owner: ownerId, addresses: list })

/** Every fetch the library made, as {method, url, body}. */
function calls(): { method: string; url: string; body: string }[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
    body: String((init as RequestInit | undefined)?.body ?? ''),
  }))
}
/** Writes to the address API — the ones that could plant data in an account. */
const writeCalls = () => calls().filter((c) => c.method !== 'GET')

/** Seed a bucket the way the library itself would have written it. */
function seedBucket(owner: string, list: EatAddress[]) {
  store.setItem(bucketOf(owner), JSON.stringify({ owner: owner === 'guest' ? 'guest' : `u:${owner}`, list }))
}

beforeEach(() => {
  store.clear()
  events.length = 0
  fetchMock.mockReset()
  __resetAddressOwner()
})
afterEach(() => { __resetAddressOwner() })

// ── A — an account sees its OWN addresses ──────────────────────────────────────

describe('A — account A with a local cache and server rows sees its own address', () => {
  it('the server list is mirrored into A’s bucket and read back', async () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    expect(readAddresses()).toEqual([ADDR_A]) // served from A's own bucket

    fetchMock.mockResolvedValueOnce(gotFor('A', [ADDR_A]))
    expect(await syncFromServer()).toBe(true)
    expect(readAddresses()).toEqual([ADDR_A])
    expect(getDefaultAddress()).toEqual(ADDR_A)
    expect(writeCalls(), 'a plain sync must never write to the server').toEqual([])
  })

  it('the bucket is keyed by the owner and stamped with it', () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    addAddress({ ...ADDR_A, id: undefined as unknown as string } as Omit<EatAddress, 'id'>)
    expect(store.keys()).toEqual([bucketOf('A')])
    const env = JSON.parse(store.getItem(bucketOf('A')) as string)
    expect(env.owner).toBe('u:A')
    expect(Array.isArray(env.list)).toBe(true)
  })
})

// ── B, C, D — the leak itself ─────────────────────────────────────────────────

describe('B/C/D — signing in as B after A', () => {
  beforeEach(() => {
    // A's session: its address is cached locally, exactly as production had it.
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    expect(readAddresses()).toEqual([ADDR_A])
  })

  it('B sees ZERO addresses the instant the identity changes — before any network call', () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    expect(readAddresses()).toEqual([])          // ← requirement B
    expect(getDefaultAddress()).toBeNull()       // ← requirement J (« Livrer à »)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('B with an EMPTY server stays empty, and NOTHING of A is ever POSTed', async () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    fetchMock.mockResolvedValueOnce(gotFor('B'))
    expect(await syncFromServer()).toBe(true)

    expect(readAddresses()).toEqual([])
    // ← requirement C: the old migration POSTed here. Not one write may be sent.
    expect(writeCalls()).toEqual([])
    const everyBody = calls().map((c) => c.body).join(' ')
    expect(everyBody).not.toContain('2 Rue Test')
    expect(everyBody).not.toContain('Orange')
    expect(calls().every((c) => c.method === 'GET')).toBe(true)
  })

  it('D — A’s cache is never exposed to B, although it is still on the device', () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    // A's bucket is intact (B → logout → A must find its own addresses again)…
    expect(store.getItem(bucketOf('A'))).toContain('2 Rue Test')
    // …and unreachable while B is the owner, through every public read.
    expect(readAddresses()).toEqual([])
    expect(getDefaultAddress()).toBeNull()
    expect(JSON.stringify(readAddresses())).not.toContain('Rue Test')
  })

  it('D — a mutation by B cannot resurrect A’s rows, and writes only B’s bucket', () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    const created = addAddress({
      label: 'Chez moi', kind: 'home', street: '1 Rue B', postalCode: '75001',
      city: 'Paris', country: 'France', isDefault: true,
    })
    expect(readAddresses()).toEqual([created])
    expect(readAddresses()).toHaveLength(1)             // A's row did not come along
    expect(store.getItem(bucketOf('B'))).not.toContain('Rue Test')
    expect(store.getItem(bucketOf('A'))).toContain('Rue Test') // untouched
  })

  it('an identity change EMITS, so « Livrer à » and open lists re-read at once (J)', () => {
    events.length = 0
    expect(setAddressOwner({ kind: 'user', id: 'B' })).toBe(true)
    expect(events).toEqual(['addresses'])
    expect(ADDRESS_EVENT).toBe('grubano:addresses')
    // Re-declaring the SAME identity is not a change and must not churn the UI.
    events.length = 0
    expect(setAddressOwner({ kind: 'user', id: 'B' })).toBe(false)
    expect(events).toEqual([])
  })
})

// ── E, F — each account keeps its own book ────────────────────────────────────

describe('E/F — two accounts, two books', () => {
  it('E — B’s own server rows replace what is visible for B', async () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    setAddressOwner({ kind: 'user', id: 'B' })
    seedBucket('B', [{ ...ADDR_B, street: 'stale local' }])

    fetchMock.mockResolvedValueOnce(gotFor('B', [ADDR_B]))
    expect(await syncFromServer()).toBe(true)
    expect(readAddresses()).toEqual([ADDR_B])        // server is the source of truth
    expect(JSON.stringify(readAddresses())).not.toContain('stale local')
    expect(writeCalls()).toEqual([])
  })

  it('requirement 3 — server EMPTY + this owner’s cache non-empty ⇒ the cache is EMPTIED, never pushed up', async () => {
    // The prohibited behaviour, in the one shape where it is still reachable once buckets
    // are per-owner: the CURRENT owner's own stale cache. The server is the source of
    // truth for a signed-in user, so an empty server means an empty book — it does not
    // mean "adopt whatever is on this device". (This is the case that catches a
    // re-introduced migration by BEHAVIOUR and not only by reading the source.)
    setAddressOwner({ kind: 'user', id: 'B' })
    seedBucket('B', [ADDR_B])
    expect(readAddresses()).toEqual([ADDR_B])

    fetchMock.mockResolvedValueOnce(gotFor('B'))
    expect(await syncFromServer()).toBe(true)
    expect(readAddresses(), 'the server said empty').toEqual([])
    expect(writeCalls(), 'and nothing was POSTed up').toEqual([])
    expect(calls()).toHaveLength(1)
  })

  it('F — B → logout → A: A finds ONLY its own addresses back', async () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    setAddressOwner({ kind: 'user', id: 'B' })
    seedBucket('B', [ADDR_B])
    expect(readAddresses()).toEqual([ADDR_B])

    setAddressOwner({ kind: 'guest' })               // logout
    expect(readAddresses()).toEqual([])              // not B's, not A's
    setAddressOwner({ kind: 'user', id: 'A' })       // A signs back in
    expect(readAddresses()).toEqual([ADDR_A])
    expect(JSON.stringify(readAddresses())).not.toContain('Haussmann')
  })
})

// ── G — the legacy key ───────────────────────────────────────────────────────

describe('G — the legacy `grubano_addresses` key is never adopted', () => {
  it('an authenticated user with an EMPTY server gets nothing from it, and it is destroyed', async () => {
    store.setItem(LEGACY_KEY, JSON.stringify([ADDR_A]))   // whoever wrote it, we cannot know
    setAddressOwner({ kind: 'user', id: 'B' })

    expect(store.getItem(LEGACY_KEY), 'unattributable cache must not survive').toBeNull()
    expect(readAddresses()).toEqual([])

    fetchMock.mockResolvedValueOnce(gotFor('B'))
    await syncFromServer()
    expect(readAddresses()).toEqual([])
    expect(writeCalls()).toEqual([])                       // ← no migration, ever
  })

  it('a GUEST does not inherit it either — its provenance is unprovable', () => {
    store.setItem(LEGACY_KEY, JSON.stringify([ADDR_A]))
    setAddressOwner({ kind: 'guest' })
    expect(store.getItem(LEGACY_KEY)).toBeNull()
    expect(readAddresses()).toEqual([])
  })

  it('a bucket under the RIGHT key but stamped with another owner reads empty', () => {
    store.setItem(bucketOf('B'), JSON.stringify({ owner: 'u:A', list: [ADDR_A] }))
    setAddressOwner({ kind: 'user', id: 'B' })
    expect(readAddresses()).toEqual([])
  })

  it('a bare array (legacy shape) under a v2 key reads empty', () => {
    store.setItem(bucketOf('B'), JSON.stringify([ADDR_A]))
    setAddressOwner({ kind: 'user', id: 'B' })
    expect(readAddresses()).toEqual([])
  })

  it('unparseable JSON reads empty instead of throwing', () => {
    store.setItem(bucketOf('B'), '{ not json')
    setAddressOwner({ kind: 'user', id: 'B' })
    expect(readAddresses()).toEqual([])
  })
})

// ── H — guest mode still works, locally and offline ──────────────────────────

describe('H — a signed-out visitor keeps a working local book', () => {
  it('add / update / default / remove all work with no network at all', () => {
    setAddressOwner({ kind: 'guest' })
    const a = addAddress({
      label: 'Chez moi', kind: 'home', street: '3 Rue Guest', postalCode: '13001',
      city: 'Marseille', country: 'France', isDefault: false,
    })
    expect(a.isDefault).toBe(true)                      // first one becomes the default
    expect(readAddresses()).toHaveLength(1)

    const b = addAddress({
      label: 'Bureau', kind: 'work', street: '9 Rue Pro', postalCode: '13002',
      city: 'Marseille', country: 'France', isDefault: false,
    })
    setDefaultAddress(b.id)
    expect(getDefaultAddress()?.id).toBe(b.id)
    updateAddress(a.id, { note: 'code 1234' })
    expect(readAddresses().find((x) => x.id === a.id)?.note).toBe('code 1234')
    removeAddress(b.id)
    expect(readAddresses().map((x) => x.id)).toEqual([a.id])
    expect(getDefaultAddress()?.id).toBe(a.id)          // a default is always promoted

    // A guest is not server-backed: not a single call may be fired (it would 401).
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.keys()).toEqual([bucketOf('guest')])
  })

  it('a guest sync is refused outright — the guest book is never pushed to an account', async () => {
    setAddressOwner({ kind: 'guest' })
    seedBucket('guest', [ADDR_A])
    expect(await syncFromServer()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('signing in does NOT inject the guest book into the account', async () => {
    setAddressOwner({ kind: 'guest' })
    seedBucket('guest', [ADDR_A])
    setAddressOwner({ kind: 'user', id: 'B' })
    fetchMock.mockResolvedValueOnce(gotFor('B'))
    await syncFromServer()
    expect(readAddresses()).toEqual([])
    expect(writeCalls()).toEqual([])
  })
})

// ── I — a failed load must never fall back to another account's cache ────────

describe('I — load failures for B never reveal A', () => {
  beforeEach(() => {
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    setAddressOwner({ kind: 'user', id: 'B' })
  })

  for (const [label, arm] of [
    ['network error', () => fetchMock.mockRejectedValueOnce(new Error('offline'))],
    ['HTTP 500', () => fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500))],
    ['HTTP 401', () => fetchMock.mockResolvedValueOnce(json({ error: 'unauthorized' }, 401))],
    ['malformed body', () => fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))],
  ] as [string, () => void][]) {
    it(`${label} → B still sees nothing, and A’s cache is not read`, async () => {
      arm()
      await syncFromServer()
      expect(readAddresses(), label).toEqual([])
      expect(getDefaultAddress(), label).toBeNull()
      expect(JSON.stringify(readAddresses()), label).not.toContain('Rue Test')
      expect(writeCalls(), label).toEqual([])
    })
  }

  it('an identity change WHILE the GET is in flight does not write the stale list anywhere', async () => {
    let release: (r: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r }))
    const pending = syncFromServer()                 // started for B
    setAddressOwner({ kind: 'user', id: 'C' })       // identity changes mid-flight
    release(gotFor('B', [ADDR_B]))
    expect(await pending).toBe(false)
    expect(readAddresses(), 'C must not inherit B’s in-flight list').toEqual([])
    expect(store.getItem(bucketOf('C'))).toBeNull()
    // …and the response is dropped ENTIRELY, not merely redirected: B's bucket is not
    // written either. Without this line the case was satisfiable by a library that wrote
    // the stale list into B's own bucket and returned true.
    expect(store.getItem(bucketOf('B'))).toBeNull()
    expect(store.keys()).toEqual([bucketOf('A')])
  })
})

// ── the owner must be SERVER-PROVEN, not client-asserted ─────────────────────
//
// Found by the adversarial review of the first version of this fix. The per-owner key and
// the in-value stamp are both written by the CLIENT, from the client's belief about who it
// is. That belief can be wrong: a tab left open across a sign-in in another tab still
// holds the previous session object while the browser's cookie is already the new
// account's. The GET then returns the OTHER account's rows, and the old code would have
// mirrored them into this bucket and stamped them as this owner's — defeating both locks
// from the inside, i.e. the production leak re-entering through the fixed path.

describe('the server names the owner, and a mismatch is refused', () => {
  it('a list the server attributes to ANOTHER account is discarded, and nothing is written', async () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    // The tab believes it is A; the cookie is already B's, so the server answers with B's
    // rows and says so.
    fetchMock.mockResolvedValueOnce(gotFor('B', [ADDR_B]))
    expect(await syncFromServer()).toBe(false)

    expect(readAddresses(), 'A must not be shown B’s rows').toEqual([])
    expect(store.getItem(bucketOf('A')), 'and they must not be stored as A’s').toBeNull()
    expect(store.getItem(bucketOf('B'))).toBeNull()
  })

  it('a response with NO owner field is refused (the client cannot attribute it)', async () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    fetchMock.mockResolvedValueOnce(json({ addresses: [ADDR_A] })) // legacy shape
    expect(await syncFromServer()).toBe(false)
    expect(store.getItem(bucketOf('A'))).toBeNull()
  })

  it('a mutation is only sent for an identity the SERVER has named', async () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    // No sync yet ⇒ nothing is proven ⇒ the write-through must stay silent.
    addAddress({
      label: 'x', kind: 'other', street: '1 Rue X', postalCode: '75001',
      city: 'Paris', country: 'France', isDefault: true,
    })
    expect(writeCalls(), 'unproven identity ⇒ no server write').toEqual([])
    expect(readAddresses()).toHaveLength(1) // the optimistic local write still happened

    // After the server confirms B, the write-through is allowed.
    fetchMock.mockResolvedValueOnce(gotFor('B'))
    expect(await syncFromServer()).toBe(true)
    fetchMock.mockResolvedValueOnce(json({ address: ADDR_B }, 201))
    fetchMock.mockResolvedValueOnce(gotFor('B', [ADDR_B]))
    addAddress({ ...ADDR_B, id: undefined as unknown as string } as Omit<EatAddress, 'id'>)
    await new Promise((r) => setTimeout(r, 0))
    expect(writeCalls().filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('a refused mismatch REVOKES the proof, so no further mutation is sent', async () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    fetchMock.mockResolvedValueOnce(gotFor('B'))
    await syncFromServer()                       // B is proven…

    fetchMock.mockResolvedValueOnce(gotFor('OTHER', [ADDR_A])) // …then the cookie changed
    expect(await syncFromServer()).toBe(false)

    fetchMock.mockClear()
    addAddress({
      label: 'y', kind: 'other', street: '2 Rue Y', postalCode: '75002',
      city: 'Paris', country: 'France', isDefault: true,
    })
    expect(writeCalls(), 'the proof was revoked ⇒ nothing is pushed').toEqual([])
  })

  it('the route really does echo the owner (and only the session-resolved one)', () => {
    const route = executable(read('app/api/eat/addresses/route.ts'))
    expect(route).toContain('return NextResponse.json({ owner: userId, addresses: rows.map(toEatAddress) })')
    // Inside GET, and resolved from the session before anything is returned.
    const get = route.slice(route.indexOf('export async function GET('), route.indexOf('export async function POST('))
    expect(get.length).toBeGreaterThan(80)
    expect(get).toContain('const userId = await ownerId()')
    expect(get.indexOf('const userId = await ownerId()')).toBeLessThan(get.indexOf('owner: userId'))
    // Never a body value.
    expect(route).not.toMatch(/owner: [a-z]*[Bb]ody/)
    expect(route).not.toMatch(/owner: parsed/)
  })
})

// ── fail-closed before the identity is known ─────────────────────────────────

describe('no declared identity ⇒ nothing is served and nothing is written', () => {
  it('reads are empty and writes are refused while the owner is unknown', () => {
    seedBucket('A', [ADDR_A])
    expect(getAddressOwner()).toBeNull()
    expect(readAddresses()).toEqual([])
    expect(getDefaultAddress()).toBeNull()
    addAddress({
      label: 'x', kind: 'other', street: 'y', postalCode: '1', city: 'z',
      country: 'France', isDefault: true,
    })
    // Nothing landed in any bucket — an unattributed write is how the leak started.
    expect(store.keys()).toEqual([bucketOf('A')])
    expect(store.getItem(bucketOf('A'))).toContain('Rue Test') // and A was not touched
  })

  it('a sync without a declared identity does not even call the API', async () => {
    expect(await syncFromServer()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('it does NOT fall back to the guest bucket when the identity is unknown', () => {
    // Without this case the previous assertions were satisfiable by accident: they seeded
    // only A's bucket, so a `readAddresses` that silently read the GUEST bucket when no
    // owner is declared would still have returned []. Seed the guest bucket itself.
    seedBucket('guest', [ADDR_A])
    expect(getAddressOwner()).toBeNull()
    expect(readAddresses()).toEqual([])
    expect(getDefaultAddress()).toBeNull()
  })

  it('an identity can be UNDECLARED, and then nothing is served', () => {
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    expect(readAddresses()).toEqual([ADDR_A])

    events.length = 0
    clearAddressOwner()
    expect(getAddressOwner()).toBeNull()
    expect(readAddresses()).toEqual([])
    expect(events, 'the screens must be told to re-read').toEqual(['addresses'])
    // And the bucket is still there for when A is declared again.
    expect(store.getItem(bucketOf('A'))).toContain('Rue Test')
  })
})

// ── the write-through still works for a signed-in owner ──────────────────────

describe('server write-through (unchanged behaviour, now owner-bound)', () => {
  it('a mutation after a successful sync POSTs and re-syncs', async () => {
    setAddressOwner({ kind: 'user', id: 'B' })
    fetchMock.mockResolvedValueOnce(gotFor('B'))
    await syncFromServer()

    fetchMock.mockResolvedValueOnce(json({ address: ADDR_B }, 201))
    fetchMock.mockResolvedValueOnce(gotFor('B', [ADDR_B]))
    addAddress({ ...ADDR_B, id: undefined as unknown as string } as Omit<EatAddress, 'id'>)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const posts = writeCalls().filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/eat/addresses')
    expect(posts[0].body).toContain('Haussmann')
    expect(readAddresses()).toEqual([ADDR_B])
  })

  it('formatAddress is unchanged (the order’s deliveryAddress string)', () => {
    expect(formatAddress(ADDR_A)).toBe('2 Rue Test · 84100 Orange · France')
  })
})

// ── J, K, L — the wiring and the untouched surfaces, read as source ──────────

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments FIRST, then blank block comments (the order matters: a
 *  line comment may legitimately contain a path glob, which a block-comment stripper
 *  run first would read as an opening delimiter and blind itself with). */
function executable(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

describe('J — the shell declares the identity, and only from the session', () => {
  const src = read('components/eat/EatShell.tsx')
  const code = executable(src)

  it('POSITIVE CONTROL — the stripper left the code it is about to judge', () => {
    expect(code).toContain('export default function EatShell')
    expect(code).toContain('useSession()')
    expect(src).toContain('// P0-DATA-1')
    expect(code).not.toContain('// P0-DATA-1')
  })

  it('the owner comes from session.user.id — never from an e-mail or a client value', () => {
    expect(code).toMatch(/const addressOwnerId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/)
    expect(code).toMatch(/const me = \{ kind: 'user' as const, id: addressOwnerId \}/)
    expect(code).toMatch(/setAddressOwner\(me\)/)
    expect(code).toMatch(/setAddressOwner\(\{ kind: 'guest' \}\)/)
    // The effect re-runs on every identity change.
    expect(code).toMatch(/\}, \[status, addressOwnerId\]\)/)
  })

  it('loading → declares nothing; authenticated without an id → UNDECLARES', () => {
    const effect = code.slice(code.indexOf('if (status === \'loading\') return'), code.indexOf('}, [status, addressOwnerId])'))
    expect(effect.length, 'the effect slice must be the effect').toBeGreaterThan(40)
    expect(effect.length).toBeLessThan(500)
    expect(effect).toContain("if (status === 'loading') return")
    // An identity we cannot name must not keep the PREVIOUS owner declared: a bare
    // `return` here used to leave A's cache being served to an unnameable session.
    expect(effect).toContain('if (!addressOwnerId) { clearAddressOwner(); return }')
    expect(effect).not.toMatch(/if \(!addressOwnerId\) return\b/)
    // The owner is declared BEFORE the server pull, so the pull can only ever be for a
    // named identity.
    expect(effect.indexOf('setAddressOwner({ kind: \'user\'')).toBeLessThan(effect.indexOf('syncFromServer()'))
  })

  it('the « Livrer à » banner reads through the owner-scoped getter and refreshes on the event', () => {
    // The value is stored WITH the stamp of the identity it was read under (the render-time
    // gate lives in the first-frame block below).
    expect(code).toMatch(/setDefaultAddr\(\{ stamp: currentAddressStamp\(\), addr: getDefaultAddress\(\) \}\)/)
    expect(code).toContain('window.addEventListener(ADDRESS_EVENT, sync)')
  })
})

describe('the library can no longer migrate a cache into an account', () => {
  const src = read('lib/eat-addresses.ts')
  const code = executable(src)

  it('POSITIVE CONTROL — the stripper left the code it is about to judge', () => {
    expect(code).toContain('export async function syncFromServer')
    expect(code).toContain('export function setAddressOwner')
    expect(code).toContain('export function readAddresses')
    expect(src).toContain('// ── CROSS-ACCOUNT LEAK')
    expect(code).not.toContain('// ── CROSS-ACCOUNT LEAK')
  })

  it('the migration branch and the single global key are GONE', () => {
    expect(code).not.toMatch(/serverList\.length === 0 && local\.length > 0/)
    expect(code).not.toMatch(/const KEY = 'grubano_addresses'/)
    // The legacy name survives only as the key being REMOVED, never read.
    expect(code).toMatch(/localStorage\.removeItem\(LEGACY_KEY\)/)
    expect(code).not.toMatch(/getItem\(LEGACY_KEY\)/)
  })

  it('syncFromServer contains no write method at all — it only ever mirrors', () => {
    const start = code.indexOf('export async function syncFromServer')
    const end = code.indexOf('export function addAddress')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = code.slice(start, end)
    expect(body).not.toMatch(/method: 'POST'/)
    expect(body).not.toMatch(/method: 'PATCH'/)
    expect(body).not.toMatch(/method: 'DELETE'/)
    expect(body).toContain('writeFor(at, serverList)')
    // And it refuses to run for anything but a named, signed-in owner.
    expect(body).toMatch(/if \(!owner \|\| owner\.kind !== 'user'\) return false/)
  })

  it('every read goes through the owner check', () => {
    expect(code).toMatch(/export function readAddresses\(\): EatAddress\[\] \{\s*\n\s*if \(!owner\) return \[\]/)
    expect(code).toMatch(/if \(env\.owner !== stampFor\(o\)\) return \[\]/)
  })

  it('NEGATIVE CONTROL — reinstating the migration shape would be caught', () => {
    const regressed = code + `
      if (serverList.length === 0 && local.length > 0) {
        for (const a of local) await fetch(API, { method: 'POST', body: JSON.stringify(payload(a)) })
      }
    `
    expect(regressed).toMatch(/serverList\.length === 0 && local\.length > 0/)
    expect(regressed).toMatch(/method: 'POST'/)
  })
})

describe('the two money screens cannot keep the previous account’s address', () => {
  it('cart — the delivery string is CLEARED when no saved address is selected (it becomes Order.deliveryAddress)', () => {
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
    // The defect: the effect SET the field and never cleared it, so the previous account's
    // formatted address stayed pre-filled and would be POSTed. It now clears — but only
    // what came from the cache, never a hand-typed value (see the first-frame block).
    expect(cart).not.toMatch(/setAddress\(chosen \? formatAddress\(chosen\) : ''\)/)
    expect(cart).toMatch(/if \(chosen\) \{\s*\n\s*setAddress\(formatAddress\(chosen\)\)/)
    expect(cart).toMatch(/if \(fromSavedRef\.current\) \{\s*\n\s*setAddress\(''\)/)
    // The effect re-runs on both the (gated) list and the selection, which is what makes
    // an identity change reach it: the list empties → no chosen → the cache value goes.
    expect(cart).toMatch(/\}, \[selectedAddrId, visibleAddrs\]\)/)
    // And the order carries the GATED value.
    expect(cart).toContain('deliveryAddress = addressForUse')
    // The list itself is still owner-scoped and live.
    expect(cart).toContain('window.addEventListener(ADDRESS_EVENT, sync)')
  })

  it('checkout — the saved list is re-read on ADDRESS_EVENT, not frozen at mount', () => {
    const co = executable(read('app/[locale]/eat/checkout/[orderId]/page.tsx'))
    expect(co).toContain('window.addEventListener(ADDRESS_EVENT, sync)')
    expect(co).toContain("window.addEventListener('storage', sync)")
    expect(co).toContain('window.removeEventListener(ADDRESS_EVENT, sync)')
    // The selection is dropped when the refreshed list no longer holds it.
    expect(co).toMatch(/if \(list\.some\(\(a\) => a\.id === cur\)\) return cur/)
    // The old mount-only read is gone.
    expect(co).not.toMatch(/const list = readAddresses\(\)\s*\n\s*setAddresses\(list\)\s*\n\s*const def/)
  })

  it('GeolocSheet — the picked address is dropped with the list (the map card renders it)', () => {
    const geo = executable(read('components/eat/GeolocSheet.tsx'))
    expect(geo).toMatch(/setPicked\(\(cur\) => \(cur && list\.some\(\(a\) => a\.id === cur\.id\) \? cur : null\)\)/)
    // It really is rendered, which is why a stale value mattered — through the gated
    // value now (the un-gated `picked` must not reach the card).
    expect(geo).toMatch(/const mapTitle = shownPicked \? shownPicked\.street \|\| shownPicked\.label/)
    expect(geo).toContain('window.addEventListener(ADDRESS_EVENT, refresh)')
  })

  it('NEGATIVE CONTROL — both regressions would be caught', () => {
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
      .replace('deliveryAddress = addressForUse', 'deliveryAddress = address')
    expect(cart).toMatch(/deliveryAddress = address$/m)
    const co = executable(read('app/[locale]/eat/checkout/[orderId]/page.tsx'))
      .replace('window.addEventListener(ADDRESS_EVENT, sync)', '/* removed */')
    expect(co).not.toContain('window.addEventListener(ADDRESS_EVENT, sync)')
  })
})

// ── THE FIRST FRAME of an A → B switch inside the SPA ─────────────────────────
//
// The identity is declared in an effect. Effects run AFTER the render that introduced the
// new session, so every consumer that keeps address data in React state re-renders ONCE
// with B's session and A's data still in state. ADDRESS_EVENT cannot prevent it — the
// effect that emits it has not run yet; saying otherwise would be exactly the kind of
// claim this repository has paid for before. The guard is a stamp comparison evaluated
// DURING render: the stamp the data was captured under versus the stamp the session
// implies, the latter changing in the same render as the session.

describe('the first frame of an identity change renders nothing cache-derived', () => {
  it('sessionAddressStamp is fail-closed: null while loading and for an unnameable session', () => {
    expect(sessionAddressStamp('authenticated', 'A')).toBe('u:A')
    expect(sessionAddressStamp('unauthenticated', undefined)).toBe('guest')
    expect(sessionAddressStamp('loading', undefined), 'identity unknown ⇒ no match').toBeNull()
    expect(sessionAddressStamp('loading', 'A'), 'still loading ⇒ no match').toBeNull()
    expect(sessionAddressStamp('authenticated', undefined), 'authenticated but unnameable').toBeNull()
    expect(sessionAddressStamp('authenticated', null)).toBeNull()
  })

  it('the captured stamp and the session stamp disagree exactly during the stale frame', () => {
    // The library is still on A (the effect has not run)…
    setAddressOwner({ kind: 'user', id: 'A' })
    seedBucket('A', [ADDR_A])
    const captured = currentAddressStamp()
    expect(captured).toBe('u:A')
    expect(readAddresses(), 'the data a consumer would be holding').toEqual([ADDR_A])

    // …while the render is already for B. This is the frame.
    const sessionStamp = sessionAddressStamp('authenticated', 'B')
    expect(sessionStamp).toBe('u:B')
    expect(captured === sessionStamp, 'the gate must be CLOSED in this frame').toBe(false)

    // After the effect declares B, the gate opens for B's own (empty) data.
    setAddressOwner({ kind: 'user', id: 'B' })
    expect(currentAddressStamp()).toBe('u:B')
    expect(currentAddressStamp() === sessionStamp).toBe(true)
    expect(readAddresses()).toEqual([])
  })

  it('every consumer that holds address data gates its RENDER on that comparison', () => {
    // The shell's « Livrer à ».
    const shell = executable(read('components/eat/EatShell.tsx'))
    expect(shell).toMatch(/const sessionStamp = sessionAddressStamp\(status, addressOwnerId\)/)
    expect(shell).toMatch(/const shownAddr = defaultAddr\.stamp !== null && defaultAddr\.stamp === sessionStamp \? defaultAddr\.addr : null/)
    expect(shell).toMatch(/\{shownAddr \? shownAddr\.label : t\('deliverToValue'\)\}/)
    expect(shell, 'the raw state must not be rendered').not.toMatch(/\{defaultAddr \? defaultAddr\.label/)
    expect(shell).toMatch(/stamp: currentAddressStamp\(\)/)

    // The cart: the list, the selector and the string that becomes Order.deliveryAddress.
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
    expect(cart).toMatch(/const sessionStamp = sessionAddressStamp\(authStatus,/)
    expect(cart).toMatch(/const stampOk = addrStamp !== null && addrStamp === sessionStamp/)
    // useMemo'd so the reference is stable (it is an effect dependency).
    expect(cart).toMatch(/const visibleAddrs = useMemo\(\(\) => \(stampOk \? savedAddrs : \[\]\), \[stampOk, savedAddrs\]\)/)
    expect(cart).toMatch(/const addressForUse = addressFromSaved && !stampOk \? '' : address/)
    for (const site of ['visibleAddrs.length > 0', 'visibleAddrs.map(', 'value={addressForUse}']) {
      expect(cart, site).toContain(site)
    }
    // …and the ORDER uses the gated value, not the raw state.
    expect(cart).toContain('deliveryAddress = addressForUse')
    expect(cart).not.toMatch(/deliveryAddress = address$/m)
    expect(cart).toMatch(/if \(!addressForUse\.trim\(\)/)
    // A hand-typed address is NOT gated away (it belongs to whoever typed it here).
    expect(cart).toMatch(/if \(fromSavedRef\.current\) \{/)

    // The checkout screen.
    const co = executable(read('app/[locale]/eat/checkout/[orderId]/page.tsx'))
    expect(co).toMatch(/const sessionStamp = sessionAddressStamp\(status,/)
    expect(co).toMatch(/const visibleAddrs = addrStamp !== null && addrStamp === sessionStamp \? addresses : \[\]/)
    expect(co).toMatch(/const selAddr = visibleAddrs\.find/)
    expect(co).toContain('{visibleAddrs.length === 0 ? (')
    expect(co).not.toMatch(/const selAddr = addresses\.find/)

    // GeolocSheet, which renders the picked address on its map card.
    const geo = executable(read('components/eat/GeolocSheet.tsx'))
    expect(geo).toMatch(/sessionStamp \}: \{ open: boolean; onClose: \(\) => void; sessionStamp: string \| null \}/)
    expect(geo).toMatch(/const stampOk = addrStamp !== null && addrStamp === sessionStamp/)
    expect(geo).toMatch(/const shownPicked = stampOk \? picked : null/)
    expect(geo).toMatch(/const mapTitle = shownPicked \?/)
    expect(geo).toMatch(/if \(shownPicked\) setDefaultAddress\(shownPicked\.id\)/)
    expect(geo, 'the raw picked must not reach the card').not.toMatch(/\[picked\.postalCode/)
    // The shell supplies it, so the sheet cannot be rendered without a stamp.
    expect(shell).toMatch(/<GeolocSheet open=\{geoOpen\} onClose=\{\(\) => setGeoOpen\(false\)\} sessionStamp=\{sessionStamp\} \/>/)
  })

  // ── THE ADDRESSES SCREEN ITSELF ───────────────────────────────────────────────
  //
  // The page whose whole purpose is to show the address book. It kept the list in React
  // state, rendered `addresses.map(...)` directly, and used neither the session nor a
  // stamp — so on an A → B switch in another tab it painted A's addresses under B's
  // session for one frame, and its edit form held one of A's address OBJECTS. It had been
  // pinned byte-identical in this file, which proved it unchanged and hid that it was
  // wrong. A/D/E/F are asserted on source because there is no DOM harness here; what they
  // compose — the stamp semantics — is proven behaviourally above.
  describe('the addresses screen is first-frame safe', () => {
    const page = executable(read('app/[locale]/eat/account/addresses/page.tsx'))

    it('POSITIVE CONTROL — the stripper left the code being judged', () => {
      expect(page).toContain('export default function AddressesPage()')
      expect(page).toContain('function AddressForm(')
      expect(read('app/[locale]/eat/account/addresses/page.tsx')).toContain('// ── FIRST-FRAME GUARD')
      expect(page).not.toContain('// ── FIRST-FRAME GUARD')
    })

    it('[A] it reads the session and gates the list on the stamp comparison', () => {
      expect(page).toContain("import { useSession } from 'next-auth/react'")
      expect(page).toMatch(/const \{ data: session, status \} = useSession\(\)/)
      expect(page).toMatch(/setAddrStamp\(currentAddressStamp\(\)\)/)
      expect(page).toMatch(/const sessionStamp = sessionAddressStamp\(status, \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id\)/)
      expect(page).toMatch(/const stampOk = addrStamp !== null && addrStamp === sessionStamp/)
      expect(page).toMatch(/const visibleAddresses = stampOk \? addresses : \[\]/)
      // The stamp is captured in the SAME callback that reads the list, so the two can
      // never describe different moments.
      const refresh = page.slice(page.indexOf('const refresh = useCallback'), page.indexOf('useEffect(() => {'))
      expect(refresh).toContain('setAddresses(readAddresses())')
      expect(refresh).toContain('setAddrStamp(currentAddressStamp())')
    })

    it('[B] the empty/list state is computed from the GATED list', () => {
      expect(page).toMatch(/const state = visibleAddresses\.length === 0 \? 'empty' : 'list'/)
      expect(page).not.toMatch(/const state = addresses\.length === 0/)
    })

    it('[C] no raw addresses.map in the render', () => {
      expect(page).toContain('{visibleAddresses.map((a) => (')
      expect(page).not.toMatch(/\{addresses\.map/)
      // The raw state survives ONLY as its declaration and inside the gate. (Lines with a
      // quote are excluded: the i18n namespace, the stylesheet and the library path all
      // legitimately contain the word — the first version of this assertion counted those
      // and measured nothing.)
      const rawLines = page
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /(^|[^A-Za-z.])addresses\b/.test(l) && !l.includes("'") && !l.includes('"'))
      expect(rawLines).toEqual([
        'const [addresses, setAddresses] = useState<EatAddress[]>([])',
        'const visibleAddresses = stampOk ? addresses : []',
      ])
    })

    it('[D] an edit form captured under another identity is CLOSED, not merely hidden', () => {
      expect(page).toMatch(/const visibleForm = stampOk \? form : null/)
      expect(page).toMatch(/\{visibleForm && <AddressForm state=\{visibleForm\} canMutate=\{canMutate\} onClose=\{\(\) => setForm\(null\)\} \/>\}/)
      expect(page).not.toMatch(/\{form && <AddressForm state=\{form\}/)
      // …and really closed, so a stale edit target cannot return when the stamps agree.
      expect(page).toMatch(/if \(!stampOk && form\) setForm\(null\)/)
    })

    it('[E] edit / delete / set-default are unreachable for a masked address', () => {
      // The row actions live inside the GATED map, so a masked address has no row at all…
      const list = page.slice(page.indexOf('{visibleAddresses.map((a) => ('), page.indexOf('className="page__add"'))
      expect(list.length).toBeGreaterThan(400)
      expect(list).toContain('onClick={() => { if (canMutate) setDefaultAddress(a.id) }}')
      expect(list).toContain("onClick={() => { if (canMutate) setForm({ mode: 'edit', address: a }) }}")
      expect(list).toContain('onClick={() => onDelete(a)}')
      // …and the handlers refuse anyway.
      expect(page).toMatch(/const onDelete = \(a: EatAddress\) => \{\s*\n\s*if \(!canMutate\) return/)
      expect(page).not.toMatch(/onClick=\{\(\) => setDefaultAddress\(a\.id\)\}/)
    })

    it('[F] every add / save entry point is refused during a stamp mismatch', () => {
      // Three « add » buttons (header, list footer, empty state) + the form's Save.
      expect((page.match(/disabled=\{!canMutate\}/g) ?? []).length, 'three adds + save').toBe(4)
      expect((page.match(/if \(canMutate\) setForm\(\{ mode: 'add' \}\)/g) ?? []).length).toBe(3)
      expect(page).not.toMatch(/onClick=\{\(\) => setForm\(\{ mode: 'add' \}\)\}/)
      // The form cannot write either, whatever a caller passes.
      expect(page).toMatch(/const onSave = \(\) => \{\s*\n\s*if \(!canMutate\) return/)
      expect(page).toMatch(/const onDelete = \(\) => \{\s*\n\s*if \(!canMutate\) return/)
      expect(page).toMatch(/const canMutate = stampOk/)
    })

    it('[G/H/I] what the gate composes with: B sees only B, an empty B is truly empty, a guest works', async () => {
      // The page's gate is `addrStamp === sessionStamp`; these are the three outcomes it
      // composes with, proven on the library the page reads from.
      setAddressOwner({ kind: 'user', id: 'A' })
      seedBucket('A', [ADDR_A])
      setAddressOwner({ kind: 'user', id: 'B' })
      seedBucket('B', [ADDR_B])
      // G — stamps agree on B: B's own rows, and only those.
      expect(currentAddressStamp()).toBe(sessionAddressStamp('authenticated', 'B'))
      expect(readAddresses()).toEqual([ADDR_B])
      expect(JSON.stringify(readAddresses())).not.toContain('Rue Test')
      // H — B with nothing: a true empty state, not a fallback to anyone else's book.
      fetchMock.mockResolvedValueOnce(gotFor('B'))
      await syncFromServer()
      expect(readAddresses()).toEqual([])
      // I — guest: 'guest' === 'guest', so the local book keeps working.
      setAddressOwner({ kind: 'guest' })
      expect(currentAddressStamp()).toBe(sessionAddressStamp('unauthenticated', undefined))
      const made = addAddress({
        label: 'Chez moi', kind: 'home', street: '3 Rue Guest', postalCode: '13001',
        city: 'Marseille', country: 'France', isDefault: true,
      })
      expect(readAddresses()).toEqual([made])
    })

    it('[J] NEGATIVE CONTROL — removing the page’s guard is caught', () => {
      const regressed = page
        .replace('const visibleAddresses = stampOk ? addresses : []', 'const visibleAddresses = addresses')
        .replace('{visibleAddresses.map((a) => (', '{addresses.map((a) => (')
      expect(regressed).toMatch(/\{addresses\.map/)
      expect(regressed).not.toMatch(/const visibleAddresses = stampOk \? addresses : \[\]/)
      // …and the form gate likewise.
      const noForm = page.replace('const visibleForm = stampOk ? form : null', 'const visibleForm = form')
      expect(noForm).not.toMatch(/const visibleForm = stampOk \? form : null/)
    })
  })

  it('NEGATIVE CONTROL — removing any one gate is detectable', () => {
    const shell = executable(read('components/eat/EatShell.tsx'))
      .replace('{shownAddr ? shownAddr.label', '{defaultAddr ? defaultAddr.label')
    expect(shell).toMatch(/\{defaultAddr \? defaultAddr\.label/)
    const cart = executable(read('app/[locale]/eat/cart/page.tsx'))
      .replace('deliveryAddress = addressForUse', 'deliveryAddress = address')
    expect(cart).toMatch(/deliveryAddress = address$/m)
  })
})

describe('the cached geolocation label is bound to an identity too', () => {
  it('the geo cache is dropped when the identity it was captured under changes', () => {
    const geo = read('lib/use-geolocation.ts')
    expect(geo).toContain("const OWNER_KEY = 'grubano_geo.owner'")
    expect(geo).toMatch(/export function syncGeoCacheOwner/)
    expect(geo).toMatch(/if \(localStorage\.getItem\(OWNER_KEY\) !== stamp\) \{\s*\n\s*localStorage\.removeItem\(STORAGE_KEY\)/)
    // It really is an address that was at stake, not just coordinates.
    expect(geo).toMatch(/label\?: string \| null/)
    // And the shell binds it on every identity declaration.
    const shell = executable(read('components/eat/EatShell.tsx'))
    expect(shell).toMatch(/syncGeoCacheOwner\(me\)/)
    expect(shell).toMatch(/syncGeoCacheOwner\(\{ kind: 'guest' \}\)/)
    expect(shell).toContain("import { syncGeoCacheOwner } from '@/lib/use-geolocation'")
  })

  it('the stamp survives a reload for the SAME identity (the cache is not wiped every visit)', () => {
    // Behavioural: the function is pure localStorage, so it runs here directly.
    store.clear()
    store.setItem('grubano_geo', JSON.stringify({ lat: 1, lng: 2, capturedAt: Date.now(), label: '2 Rue Test' }))
    syncGeoCacheOwner({ kind: 'user', id: 'A' })          // first declaration for A
    expect(store.getItem('grubano_geo'), 'unattributed cache goes on the first bind').toBeNull()

    store.setItem('grubano_geo', JSON.stringify({ lat: 1, lng: 2, capturedAt: Date.now(), label: 'A home' }))
    syncGeoCacheOwner({ kind: 'user', id: 'A' })          // reload, same identity
    expect(store.getItem('grubano_geo'), 'kept for the same identity').toContain('A home')

    syncGeoCacheOwner({ kind: 'user', id: 'B' })          // account switch
    expect(store.getItem('grubano_geo'), 'dropped for a different identity').toBeNull()
    syncGeoCacheOwner({ kind: 'guest' })                  // sign-out
    expect(store.getItem('grubano_geo')).toBeNull()
  })
})

describe('K — the address API stays session-gated and owner-scoped', () => {
  const route = read('app/api/eat/addresses/route.ts')

  it('all four verbs resolve the owner from the session and 401 without one', () => {
    for (const verb of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const at = route.indexOf(`export async function ${verb}(`)
      expect(at, verb).toBeGreaterThan(-1)
      const body = route.slice(at, at + 420)
      expect(body, verb).toContain('const userId = await ownerId()')
      expect(body, verb).toContain("status: 401")
    }
    expect(route).toContain('const session = await getServerSession(authOptions)')
    expect(route).toMatch(/return \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id \?\? null/)
  })

  it('reads are scoped and the two id-taking verbs prove ownership before writing', () => {
    expect(route).toMatch(/findMany\(\{\s*\n?\s*where: \{ userId \}/)
    const patchAt = route.indexOf('export async function PATCH(')
    const deleteAt = route.indexOf('export async function DELETE(')
    for (const [verb, at] of [['PATCH', patchAt], ['DELETE', deleteAt]] as [string, number][]) {
      const body = route.slice(at, at + 1200)
      expect(body, verb).toMatch(/findFirst\(\{ where: \{ id, userId \}/)
      expect(body, verb).toContain("status: 404")
    }
  })

  it('a WRITE whose sender was acting as another account is refused with 409', () => {
    expect(route).toContain("const claimed = req.headers.get('x-address-owner')")
    // FAIL CLOSED: only an exact match passes. Absent is refused like different — the
    // earlier version accepted an absent header and left a pre-deploy tab able to write.
    expect(route).toMatch(/if \(claimed === userId\) return null/)
    expect(route).not.toMatch(/if \(!claimed/)
    expect(route).toContain("return NextResponse.json({ error: 'owner_mismatch' }, { status: 409 })")
    // Wired into all THREE write verbs, after the session resolves the real owner…
    for (const verb of ['POST', 'PATCH', 'DELETE']) {
      const at = route.indexOf(`export async function ${verb}(`)
      const body = route.slice(at, at + 520)
      expect(body, verb).toContain('const mism = ownerMismatch(req, userId)')
      expect(body.indexOf('const userId = await ownerId()'), verb).toBeLessThan(body.indexOf('ownerMismatch(req, userId)'))
      expect(body.indexOf('ownerMismatch(req, userId)'), verb).toBeLessThan(body.indexOf('safeParse'))
    }
    // …AND on the read path as well. An earlier version gated only the writes, reasoning
    // that "a GET has nothing to plant" — true of the row, false of the rendering: a
    // pre-deploy bundle ignores the `owner` field and would display the cookie-holder's
    // rows in a tab that still believes it is someone else. So the GET is gated too.
    const get = route.slice(route.indexOf('export async function GET('), route.indexOf('export async function POST('))
    expect(get).toContain('const mism = ownerMismatch(req, userId)')
    expect(get).toContain('if (mism) return mism')
    // The header is never used AS the identity — the row is always scoped by the session.
    expect(route).not.toMatch(/userId = .*x-address-owner/)
    expect(route).not.toMatch(/where: \{ userId: claimed/)
    // The client sends it, from the identity it is acting for.
    const lib = read('lib/eat-addresses.ts')
    expect(lib).toMatch(/'x-address-owner': at\.id/)
    expect(lib).not.toMatch(/'x-address-owner': [^a]/) // never a value other than `at.…`
  })

  // ── STALE PRE-DEPLOY CLIENT — the header is MANDATORY (fail closed) ──────────
  //
  // A tab loaded BEFORE the deploy runs the OLD bundle: it knows nothing about
  // `x-address-owner`, may still hold account A's global cache, and now carries account
  // B's cookie. While an absent header was accepted, that tab could still POST A's rows
  // into B — the incident, through the "fixed" route — and on the read path it would
  // ignore the `owner` field and display the cookie-holder's rows in a tab that believes
  // it is A. So absent is refused, exactly like different.
  describe('a client that does not declare its identity can neither read nor write', () => {
    const verbs = ['GET', 'POST', 'PATCH', 'DELETE'] as const

    it('[A–D] every verb refuses a request with NO header', () => {
      for (const verb of verbs) {
        const at = route.indexOf(`export async function ${verb}(`)
        const body = route.slice(at, at + 520)
        // The guard runs before any parsing or DB work in every verb…
        expect(body, verb).toContain('const mism = ownerMismatch(req, userId)')
        expect(body, verb).toContain('if (mism) return mism')
      }
      // …and the guard itself treats "absent" as a refusal: only an exact match passes.
      expect(route).toContain("const claimed = req.headers.get('x-address-owner')")
      expect(route).toMatch(/if \(claimed === userId\) return null/)
      expect(route, 'absent must NOT be accepted').not.toMatch(/if \(!claimed \|\| claimed === userId\)/)
      expect(route).not.toMatch(/if \(!claimed\) return null/)
    })

    it('[A] the GET refusal carries NO addresses', () => {
      // The 409 body is an error code only; the rows are never serialised on that path.
      // On the EXECUTABLE text: the guard's own documentation legitimately names
      // lib/eat-addresses.ts, and a ban that read comments would refuse its own rationale.
      const exec = executable(route)
      const guard = exec.slice(exec.indexOf('function ownerMismatch'), exec.indexOf('const SELECT'))
      expect(guard.length).toBeGreaterThan(80)
      expect(guard.length, 'the slice must be the guard, not the file').toBeLessThan(600)
      expect(guard).toContain("NextResponse.json({ error: 'owner_mismatch' }, { status: 409 })")
      expect(guard).not.toContain('addresses')
      expect(guard).not.toContain('toEatAddress')
      // And the GET's own rows are read only AFTER the guard returned nothing.
      const get = route.slice(route.indexOf('export async function GET('), route.indexOf('export async function POST('))
      expect(get.indexOf('if (mism) return mism')).toBeLessThan(get.indexOf('prisma.address.findMany'))
    })

    it('[B–D] the refusal precedes every write — zero create / update / delete', () => {
      for (const [verb, write] of [
        ['POST', 'tx.address.create'],
        ['PATCH', 'tx.address.update'],
        ['DELETE', 'tx.address.delete'],
      ] as [string, string][]) {
        const at = route.indexOf(`export async function ${verb}(`)
        const next = route.indexOf('export async function', at + 10)
        const body = route.slice(at, next === -1 ? undefined : next)
        expect(body, verb).toContain(write)
        expect(body.indexOf('if (mism) return mism'), verb).toBeLessThan(body.indexOf(write))
        // …and before the ownership probe / parsing too, so nothing is even read.
        expect(body.indexOf('if (mism) return mism'), verb).toBeLessThan(body.indexOf('safeParse'))
      }
    })

    it('[E] header A + session B is refused on all four verbs (same single guard)', () => {
      // One guard, four call sites: a mismatch cannot be refused on some verbs only.
      expect((route.match(/const mism = ownerMismatch\(req, userId\)/g) ?? [])).toHaveLength(4)
      expect((route.match(/if \(mism\) return mism/g) ?? [])).toHaveLength(4)
      // The comparison is against the SESSION-resolved id, never the header.
      expect(route).toMatch(/function ownerMismatch\(req: Request, userId: string\)/)
      expect(route).not.toMatch(/userId = claimed/)
    })

    it('[F] header B + session B passes (the guard returns null and the handler proceeds)', () => {
      expect(route).toMatch(/if \(claimed === userId\) return null/)
      const get = route.slice(route.indexOf('export async function GET('), route.indexOf('export async function POST('))
      expect(get).toContain('return NextResponse.json({ owner: userId, addresses: rows.map(toEatAddress) })')
    })

    it('[G] the only client of this route sends the header on EVERY call, read included', () => {
      const lib = executable(read('lib/eat-addresses.ts'))
      const fetches = Array.from(lib.matchAll(/fetch\(API, \{[\s\S]{0,260}?\}\)/g)).map((m) => m[0])
      expect(fetches.length, 'both the sync GET and the mutation').toBe(2)
      for (const f of fetches) expect(f, f.slice(0, 40)).toContain("'x-address-owner': at.id")
      // A 409 revokes the proof, so no further mutation is attempted either.
      expect(lib).toMatch(/if \(res\.status === 409\) \{[\s\S]{0,120}verifiedOwner = null/)
    })
  })

  it('the ONLY change this lot made to the route is the owner echo — every guard is intact', () => {
    // No digest pin here: this lot does edit this file (one added field, so the client can
    // refuse a list the server attributes to someone else). What must be proven instead is
    // that nothing else moved — so each pre-existing guard is asserted above, and here the
    // mutation handlers are checked to be untouched in substance.
    expect(route).toContain("const { isDefault, ...data } = parsed.data")
    expect(route).toMatch(/tx\.address\.create\(\{ data: \{ \.\.\.data, isDefault: makeDefault, userId \}/)
    expect(route).toMatch(/await tx\.address\.updateMany\(\{ where: \{ userId \}, data: \{ isDefault: false \} \}\)/)
    expect(route).toMatch(/await tx\.address\.delete\(\{ where: \{ id \} \}\)/)
    // The POST/PATCH/DELETE responses are UNCHANGED (no new field, no new status).
    expect(route).toContain("return NextResponse.json({ address: toEatAddress(created) }, { status: 201 })")
    expect(route).toContain('return NextResponse.json({ address: toEatAddress(updated) })')
    expect(route).toContain('return NextResponse.json({ ok: true })')
    // And the file still has exactly one owner echo, on the read path.
    expect((route.match(/owner: userId/g) ?? [])).toHaveLength(1)
  })
})

describe('L — no schema, no money path, and the consumer API is unchanged', () => {
  // Digests taken at the base of this branch (origin/main 63fdd687), on LF-normalised
  // bytes so a CRLF checkout cannot flip them.
  //
  // The two money SCREENS are NOT pinned any more, and that is a deliberate, declared
  // exception: the adversarial review proved each of them could still show — and in the
  // cart's case POST as `Order.deliveryAddress` — the previous account's address, because
  // one held the value in React state with no reset and the other never re-read the book.
  // That is requirement 1 itself ("JAMAIS affichée à un autre compte … ni POSTée vers un
  // autre compte"), so the exception is the requirement, not a widening of scope. Both
  // changes are asserted line-by-line above, with negative controls. No total, fee,
  // discount, payment call or placeOrder argument is touched by either.
  // The addresses SCREEN is no longer pinned here. Pinning it proved it had not changed —
  // and that is precisely how it went unexamined through two rounds while it held the
  // address book in React state with no notion of whose it was. It is now covered by the
  // behavioural and source proofs in the first-frame block instead.
  const PINNED: Record<string, string> = {
    'prisma/schema.prisma': '162155c0b15dc96ee3bd088e5a6c3566553c51b03f2dedd1ab9832d073f2e734',
  }

  for (const [file, digest] of Object.entries(PINNED)) {
    it(`${file} is byte-identical to the branch base`, () => {
      expect(createHash('sha256').update(read(file)).digest('hex'), `${file} was modified by this lot`).toBe(digest)
    })
  }

  it('NEGATIVE CONTROL — the digests really detect an edit', () => {
    const edited = read('prisma/schema.prisma') + '\n// touched\n'
    expect(createHash('sha256').update(edited).digest('hex')).not.toBe(PINNED['prisma/schema.prisma'])
  })

  it('the consumers still import the SAME public API from the library', () => {
    // Requirement 9: GeolocSheet / cart / checkout / the addresses screen keep working
    // against the same exports. Those files are pinned above, so this asserts the
    // library still PROVIDES what they import — a removed export would break the build,
    // but a renamed one with a compatible shim would not be caught by the digests.
    const lib = read('lib/eat-addresses.ts')
    for (const sym of [
      'readAddresses', 'addAddress', 'updateAddress', 'removeAddress', 'setDefaultAddress',
      'getDefaultAddress', 'formatAddress', 'syncFromServer', 'ADDRESS_EVENT',
    ]) {
      expect(lib, sym).toMatch(new RegExp(`export (async )?(function|const) ${sym}\\b`))
    }
    expect(lib).toMatch(/export interface EatAddress/)
    expect(lib).toMatch(/export type AddrKind/)
  })

  it('nothing in this lot touches Stripe, order placement, the DB or auth core', () => {
    for (const f of ['lib/eat-addresses.ts', 'components/eat/EatShell.tsx']) {
      const code = executable(read(f))
      expect(code, f).not.toMatch(/stripe/i)
      expect(code, f).not.toMatch(/placeOrder/)
      expect(code, f).not.toMatch(/prisma/)
      expect(code, f).not.toMatch(/authOptions|getServerSession/)
    }
    // The library talks to exactly ONE endpoint, and it is the address book.
    const lib = executable(read('lib/eat-addresses.ts'))
    const urls = Array.from(lib.matchAll(/fetch\(([A-Za-z_]+|'[^']*')/g)).map((m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    expect(new Set(urls)).toEqual(new Set(['API']))
    expect(lib).toMatch(/const API = '\/api\/eat\/addresses'/)
    // EatShell's own pre-existing fetches (badge counters, wallet) are not this lot's
    // business and are unchanged; what matters is that it gained no new write path.
    const shell = executable(read('components/eat/EatShell.tsx'))
    expect(shell).not.toMatch(/method: *'(POST|PATCH|DELETE|PUT)'/)
  })

  it('the visual-QA robot seeds the OWNER-SCOPED bucket (its screens would be empty otherwise)', () => {
    const qa = read('scripts/design-qa.config.mjs')
    expect(qa, 'the legacy key is no longer read by the app').not.toContain("setItem('grubano_addresses',")
    expect(qa).toContain("setItem('grubano_addresses.v2.guest',JSON.stringify({owner:'guest',list:[")
    expect(qa).toContain("setItem('grubano_addresses.v2.u.qa-user',JSON.stringify({owner:'u:qa-user',list:[")

    // Each seed must sit in a scenario whose own session stub MATCHES the bucket it
    // writes: a user bucket needs a stub carrying `id:'qa-user'` (a stub without an id
    // makes the shell declare NO owner, by design, and the screen would render empty);
    // a guest bucket must NOT be in a signed-in scenario. Judged per `before:` block,
    // so an unrelated stub elsewhere in the file cannot make this pass or fail.
    let seeds = 0
    for (const m of Array.from(qa.matchAll(/setItem\('grubano_addresses\.v2\.(guest|u\.qa-user)'/g))) {
      seeds += 1
      const i = m.index as number
      const blockStart = qa.lastIndexOf('before:', i)
      const after = qa.slice(i)
      const endRel = after.search(/`,\n/)
      expect(blockStart, 'each seed lives in a before: block').toBeGreaterThan(-1)
      expect(endRel, 'each before: block is bounded').toBeGreaterThan(-1)
      const block = qa.slice(blockStart, i + endRel)
      const signedIn = /JSON\.stringify\(\{user:\{id:'qa-user'/.test(block)
      if (m[1] === 'guest') {
        expect(signedIn, `a guest bucket must not be seeded in a signed-in scenario (@${i})`).toBe(false)
      } else {
        expect(signedIn, `a user bucket needs a session stub carrying an id (@${i})`).toBe(true)
      }
    }
    expect(seeds, 'all four address seeds must be accounted for').toBe(4)
  })
})
