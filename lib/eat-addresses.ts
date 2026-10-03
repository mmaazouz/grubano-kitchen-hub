'use client'

// Consumer delivery addresses (P0-DATA-1) — a localStorage cache in front of a server
// backend (/api/eat/addresses, model Address). The PUBLIC READ + MUTATION API stays
// SYNCHRONOUS and localStorage-backed exactly as before, so every consumer (the
// addresses screen, GeolocSheet, the EatShell « Livrer à », the cart/checkout delivery
// field) is UNCHANGED and the money path is byte-identical.
//
// ── CROSS-ACCOUNT LEAK, AND WHY THIS FILE LOOKS THE WAY IT DOES ─────────────────────
// A production incident: account A saved « 2 Rue Test, 84100 Orange ». Account B then
// signed in IN THE SAME BROWSER and not only SAW that address — it was WRITTEN into B's
// own server address book. Two defects together:
//   1. ONE GLOBAL KEY (`grubano_addresses`) held whatever the last signed-in account had
//      cached, so any later identity read it as its own.
//   2. syncFromServer() treated « server empty + localStorage not empty » as "this user
//      built these up as a guest, migrate them up" and POSTed them to the new account.
// The cache can never tell WHOSE addresses it holds unless it records that, so:
//   • every bucket is keyed BY OWNER (`grubano_addresses.v2.u.<userId>` / `….guest`) AND
//     stamped with that owner inside the stored value — a key/stamp mismatch reads EMPTY;
//   • the owner must be DECLARED (setAddressOwner) before anything is read or written.
//     Identity unknown ⇒ reads return [] and writes are refused. FAIL CLOSED: showing
//     nothing for one render is always better than showing someone else's address;
//   • for a signed-in user the SERVER IS THE SOURCE OF TRUTH: a sync MIRRORS it. There is
//     NO upward migration of a local cache into an account, ever — not for the legacy
//     key, not for a guest bucket. A cache whose owner cannot be PROVEN is never adopted;
//   • the legacy `grubano_addresses` key is unattributable by construction (it is the very
//     blob that leaked), so it is not read — it is deleted the first time an owner is
//     declared. A guest's pre-existing local list is lost once; that is the deliberate
//     trade, security over convenience.
// Mutations still write THROUGH to the server best-effort when server-backed; a guest
// (401) or an offline device silently stays localStorage-only. The optimistic local write
// keeps the UI instant; a re-sync reconciles ids (the server uses cuid, the optimistic
// local row a temp id).

export type AddrKind = 'home' | 'work' | 'other'

export interface EatAddress {
  id: string
  /** Free label shown to the user (e.g. « Domicile »). */
  label: string
  /** Drives the icon + the default chip in the form. */
  kind: AddrKind
  /** Street & number. */
  street: string
  /** Floor / apt / intercom (optional). */
  complement?: string
  postalCode: string
  city: string
  country: string
  /** Driver instructions (optional). */
  note?: string
  isDefault: boolean
}

/** Who the cache currently belongs to. A signed-in operator id, or an anonymous visitor. */
export type AddressOwner = { kind: 'user'; id: string } | { kind: 'guest' }

/** UNATTRIBUTABLE legacy bucket — never read, deleted on the first owner declaration. */
const LEGACY_KEY = 'grubano_addresses'
const PREFIX = 'grubano_addresses.v2.'
export const ADDRESS_EVENT = 'grubano:addresses'
const API = '/api/eat/addresses'

/** One bucket per identity. The guest bucket is shared by every anonymous visit on this
 *  browser; a user bucket is reachable only while that exact user is the declared owner. */
function keyFor(o: AddressOwner): string {
  return o.kind === 'user' ? `${PREFIX}u.${o.id}` : `${PREFIX}guest`
}
/** The owner stamp stored INSIDE the value — a second lock, so a bucket that was copied,
 *  hand-edited or landed under the wrong key cannot be read as the current owner's. */
function stampFor(o: AddressOwner): string {
  return o.kind === 'user' ? `u:${o.id}` : 'guest'
}
function sameOwner(a: AddressOwner | null, b: AddressOwner | null): boolean {
  if (!a || !b) return false
  return stampFor(a) === stampFor(b)
}

/** null = the identity has NOT been declared yet ⇒ nothing is read and nothing is written. */
let owner: AddressOwner | null = null
/**
 * The owner stamp the SERVER last confirmed, from the `owner` field of a GET response —
 * not a boolean "we are logged in somehow". It gates the write-through: a mutation is only
 * ever sent for an identity the server itself has named. This matters because the declared
 * owner is a CLIENT belief: a tab left open across a sign-in in another tab still holds the
 * old session object while the browser's cookie is already the new account's. Nothing on
 * the client can prove who it is; only the server can say so.
 */
let verifiedOwner: string | null = null

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ADDRESS_EVENT))
}

/**
 * Declare whose addresses the cache may serve. Called from the session-aware shell on
 * mount and on EVERY identity change (sign-in, sign-out, account switch).
 *
 * On a change it resets the server-backed flag and EMITS, so every subscriber (the
 * « Livrer à » banner, the addresses screen, GeolocSheet, the cart selector) re-reads
 * immediately and the previous owner's view is gone before the new owner's data arrives.
 * It MIGRATES NOTHING: switching identity never copies one bucket into another.
 * Returns true when the owner actually changed.
 */
export function setAddressOwner(next: AddressOwner): boolean {
  // NEVER on the server. `owner` is module state, and a Next server process shares one
  // module instance across every concurrent request: declaring an identity there would
  // make one visitor's owner visible to another's render. Callers are useEffect-only
  // today, so this is unreachable — which is exactly why it is cheap to make impossible.
  if (typeof window === 'undefined') return false
  const changed = !sameOwner(owner, next)
  const first = owner === null
  owner = next
  if (typeof window !== 'undefined' && (first || changed)) {
    // The legacy single-key bucket cannot be attributed to anyone, and it is the blob
    // that leaked across accounts. It is destroyed rather than adopted.
    try { localStorage.removeItem(LEGACY_KEY) } catch { /* ignore */ }
  }
  if (changed) {
    verifiedOwner = null // nothing is proven about the new identity yet
    emit()
  }
  return changed
}

/** The declared owner, or null while the identity is still unknown. Read-only. */
export function getAddressOwner(): AddressOwner | null {
  return owner
}

/**
 * Forget the identity: reads go back to empty and writes are refused until a new owner is
 * declared. For the case where the session says "authenticated" but carries no usable id —
 * an identity we cannot name is one we must not keep serving the PREVIOUS owner's data for.
 * Without this there was no way to undeclare, so an early return silently kept the last
 * owner declared: a comment claiming "declare nothing" that the code did not implement.
 */
export function clearAddressOwner(): void {
  if (typeof window === 'undefined') return
  const had = owner !== null
  owner = null
  verifiedOwner = null
  if (had) emit()
}

type Envelope = { owner: string; list: EatAddress[] }

function readFor(o: AddressOwner): EatAddress[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(keyFor(o))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    // v2 envelope ONLY. A bare array is either the legacy blob or a hand-written value:
    // unattributable, so it reads as empty instead of as the current owner's.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const env = parsed as Partial<Envelope>
    if (env.owner !== stampFor(o)) return []
    return Array.isArray(env.list) ? (env.list as EatAddress[]) : []
  } catch {
    return []
  }
}

export function readAddresses(): EatAddress[] {
  if (!owner) return [] // identity not declared yet → fail closed
  return readFor(owner)
}

/** Local cache write for ONE named owner (localStorage + live event). */
function writeFor(o: AddressOwner, list: EatAddress[]) {
  if (typeof window === 'undefined') return
  try {
    const env: Envelope = { owner: stampFor(o), list }
    localStorage.setItem(keyFor(o), JSON.stringify(env))
    emit()
  } catch {
    /* ignore quota errors */
  }
}

// Local cache write (localStorage + live event). The single source the sync reads use.
// Refused while no owner is declared: an unattributed write is how the leak started.
function write(list: EatAddress[]) {
  if (!owner) return
  writeFor(owner, list)
}

function newId(): string {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// The address payload the server accepts (everything except the id).
function payload(a: EatAddress | Omit<EatAddress, 'id'>) {
  const { label, kind, street, complement, postalCode, city, country, note, isDefault } =
    a as EatAddress
  return { label, kind, street, complement, postalCode, city, country, note, isDefault }
}

// Fire a best-effort server mutation, then reconcile the cache from the server (the
// source of truth: it assigns the real cuid ids + enforces the single-default rule).
// Never throws — a guest (401) or offline device just keeps the local cache.
// Only ever fires for a DECLARED, signed-in owner, so a mutation can never be sent on
// behalf of an identity the client has not established.
function pushServer(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  if (!owner || owner.kind !== 'user' || typeof window === 'undefined') return
  // The SERVER must have named this exact identity at least once. A boolean "a sync
  // succeeded" was not enough: it stayed true across a cookie change and let a mutation be
  // sent on behalf of an identity the client only believed it had.
  if (verifiedOwner !== stampFor(owner)) return
  const at = owner
  // ⭐ THE MUTATION STATES WHO IT BELIEVES IT IS. The server still decides the account
  // from the cookie — this header never grants anything — but it lets the server REFUSE
  // (409) a write whose sender was acting as somebody else. That is the write direction of
  // the incident: in the window between the cookie changing and this tab noticing, a
  // mutation would otherwise create A's address inside account B, exactly as production
  // did. A read-side check cannot catch that, because by then the row exists.
  fetch(API, {
    method,
    headers: { 'content-type': 'application/json', 'x-address-owner': at.id },
    body: JSON.stringify(body),
  })
    .then((r) => {
      // The identity may have changed while the request was in flight; a late reconcile
      // must not run for an owner who is no longer the current one.
      if (r.ok && sameOwner(at, owner)) return syncFromServer()
    })
    .catch(() => {
      /* offline / transient — the optimistic local write stands; next sync reconciles */
    })
}

/**
 * Pull the server address book into THIS owner's cache (signed-in users only). Returns
 * true when server-backed. A guest (401) or any error leaves the cache untouched — which,
 * because buckets are per-owner, means a failed load for B can never fall back to A's data.
 *
 * The server is the SOURCE OF TRUTH: the local bucket is overwritten with what it returns,
 * including with an EMPTY list. The « server empty + local non-empty ⇒ POST the local ones
 * up » migration that caused the cross-account leak is GONE and must not come back.
 */
export async function syncFromServer(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!owner || owner.kind !== 'user') return false
  const at = owner // the identity this sync is FOR
  let res: Response
  try {
    res = await fetch(API, { headers: { accept: 'application/json' } })
  } catch {
    return false
  }
  if (res.status === 401) {
    verifiedOwner = null
    return false
  }
  if (!res.ok) return false
  const data = (await res.json().catch(() => null)) as
    { owner?: unknown; addresses?: EatAddress[] } | null
  const serverList = data?.addresses ?? []
  // Identity changed while the GET was in flight → drop this response on the floor. The
  // write below is addressed to `at` anyway, so B's bucket could not be poisoned either
  // way; this also stops a stale list being re-emitted to the new owner's screens.
  if (!sameOwner(at, owner)) return false
  // ⭐ THE SERVER MUST AGREE ABOUT WHOSE ROWS THESE ARE. The declared owner is a client
  // belief; the cookie the browser attached is the real identity. When they diverge — a
  // tab still holding the previous session object after a sign-in elsewhere — this
  // response contains the OTHER account's addresses, and writing it would store them in
  // this bucket STAMPED as this owner's, which no amount of client-side keying can undo.
  // A response the server attributes to someone else is refused, and nothing is written.
  if (data?.owner !== at.id) {
    verifiedOwner = null
    return false
  }
  verifiedOwner = stampFor(at)
  writeFor(at, serverList) // mirror server → local cache (no migration, ever)
  return true
}

/** Add a new address. The first one (or one flagged default) becomes the default. */
export function addAddress(addr: Omit<EatAddress, 'id'>): EatAddress {
  const list = readAddresses()
  const created: EatAddress = { ...addr, id: newId() }
  let next = [...list, created]
  if (created.isDefault || list.length === 0) {
    created.isDefault = true
    next = next.map((a) => ({ ...a, isDefault: a.id === created.id }))
  }
  write(next)
  pushServer('POST', payload(created))
  return created
}

export function updateAddress(id: string, patch: Partial<Omit<EatAddress, 'id'>>): void {
  const list = readAddresses()
  let next = list.map((a) => (a.id === id ? { ...a, ...patch } : a))
  if (patch.isDefault) next = next.map((a) => ({ ...a, isDefault: a.id === id }))
  // never leave the list without a default while it has entries
  if (next.length && !next.some((a) => a.isDefault)) next[0] = { ...next[0], isDefault: true }
  write(next)
  pushServer('PATCH', { id, ...patch })
}

export function removeAddress(id: string): void {
  const list = readAddresses()
  const removed = list.find((a) => a.id === id)
  let next = list.filter((a) => a.id !== id)
  if (removed?.isDefault && next.length && !next.some((a) => a.isDefault)) {
    next = next.map((a, i) => ({ ...a, isDefault: i === 0 }))
  }
  write(next)
  pushServer('DELETE', { id })
}

export function setDefaultAddress(id: string): void {
  write(readAddresses().map((a) => ({ ...a, isDefault: a.id === id })))
  pushServer('PATCH', { id, isDefault: true })
}

export function getDefaultAddress(): EatAddress | null {
  const list = readAddresses()
  return list.find((a) => a.isDefault) ?? list[0] ?? null
}

/** One-line postal string fed to the order's deliveryAddress (the existing text field). */
export function formatAddress(a: EatAddress): string {
  const head = [a.street, a.complement].filter(Boolean).join(', ')
  return [head, `${a.postalCode} ${a.city}`.trim(), a.country].filter(Boolean).join(' · ')
}

/** Test-only: forget the declared identity and the server-confirmed one. */
export function __resetAddressOwner(): void {
  owner = null
  verifiedOwner = null
}
