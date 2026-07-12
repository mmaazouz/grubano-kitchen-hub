'use client'

// Consumer delivery addresses (P0-DATA-1) — a localStorage cache in front of a server
// backend (/api/eat/addresses, model Address). The PUBLIC READ + MUTATION API stays
// SYNCHRONOUS and localStorage-backed exactly as before, so every consumer (the
// addresses screen, GeolocSheet, the EatShell « Livrer à », the cart/checkout delivery
// field) is UNCHANGED and the money path is byte-identical. On top of that:
//   • syncFromServer() (called on mount for a logged-in user, from EatShell) pulls the
//     server rows into the localStorage cache — so addresses now persist server-side and
//     follow the user across devices. First sync after login with local-only addresses
//     and an empty server MIGRATES the local ones up (no data loss).
//   • Mutations write THROUGH to the server best-effort when server-backed; a guest
//     (401) or an offline device silently stays localStorage-only — the pre-existing
//     behaviour. The optimistic local write keeps the UI instant; a re-sync reconciles
//     ids (the server uses cuid, the optimistic local row a temp id).

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

const KEY = 'grubano_addresses'
export const ADDRESS_EVENT = 'grubano:addresses'
const API = '/api/eat/addresses'

// Set true once a server sync succeeds (the user is authenticated). Gates the
// best-effort write-through so a guest never fires (and silently 401s) server calls.
let serverBacked = false

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ADDRESS_EVENT))
}

export function readAddresses(): EatAddress[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as EatAddress[]) : []
  } catch {
    return []
  }
}

// Local cache write (localStorage + live event). The single source the sync reads use.
function write(list: EatAddress[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    emit()
  } catch {
    /* ignore quota errors */
  }
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
function pushServer(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
  if (!serverBacked || typeof window === 'undefined') return
  fetch(API, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => {
      if (r.ok) return syncFromServer()
    })
    .catch(() => {
      /* offline / transient — the optimistic local write stands; next sync reconciles */
    })
}

/**
 * Pull the server address book into the local cache (logged-in users). Returns true when
 * server-backed. A guest (401) or any error leaves the localStorage store untouched.
 * First sync with local-only addresses + an empty server migrates them up (no loss).
 */
export async function syncFromServer(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  let res: Response
  try {
    res = await fetch(API, { headers: { accept: 'application/json' } })
  } catch {
    return false
  }
  if (res.status === 401) {
    serverBacked = false
    return false
  }
  if (!res.ok) return false
  const data = (await res.json().catch(() => null)) as { addresses?: EatAddress[] } | null
  const serverList = data?.addresses ?? []
  const local = readAddresses()

  // One-time migration: a user who built up addresses as a guest now logs in to an empty
  // server → push the local ones up instead of wiping them.
  if (serverList.length === 0 && local.length > 0) {
    serverBacked = true
    for (const a of local) {
      try {
        await fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload(a)),
        })
      } catch {
        /* best-effort */
      }
    }
    try {
      const r2 = await fetch(API, { headers: { accept: 'application/json' } })
      const d2 = (await r2.json().catch(() => null)) as { addresses?: EatAddress[] } | null
      write(d2?.addresses ?? local)
    } catch {
      /* keep local */
    }
    return true
  }

  serverBacked = true
  write(serverList) // mirror server → local cache
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
