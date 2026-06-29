'use client'

// Consumer delivery addresses — client-side store (localStorage), the same pattern
// the cart (sessionStorage) + favourites (localStorage) already use. There is no
// Address backend model yet (and no db push allowed), so the user's REAL saved
// addresses live here, persisted on the device, and feed the checkout delivery field
// + the shell "Livrer à". A future Address model can replace this store transparently.

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
  return created
}

export function updateAddress(id: string, patch: Partial<Omit<EatAddress, 'id'>>): void {
  const list = readAddresses()
  let next = list.map((a) => (a.id === id ? { ...a, ...patch } : a))
  if (patch.isDefault) next = next.map((a) => ({ ...a, isDefault: a.id === id }))
  // never leave the list without a default while it has entries
  if (next.length && !next.some((a) => a.isDefault)) next[0] = { ...next[0], isDefault: true }
  write(next)
}

export function removeAddress(id: string): void {
  const list = readAddresses()
  const removed = list.find((a) => a.id === id)
  let next = list.filter((a) => a.id !== id)
  if (removed?.isDefault && next.length && !next.some((a) => a.isDefault)) {
    next = next.map((a, i) => ({ ...a, isDefault: i === 0 }))
  }
  write(next)
}

export function setDefaultAddress(id: string): void {
  write(readAddresses().map((a) => ({ ...a, isDefault: a.id === id })))
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
