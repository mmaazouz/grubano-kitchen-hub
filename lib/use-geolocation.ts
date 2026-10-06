'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * useGeolocation — opt-in browser geolocation, persisted in localStorage.
 *
 * - Does NOT auto-request permission on mount (we surface a friendly button
 *   first; calling getCurrentPosition() unprompted produces poor grant rates).
 * - Rehydrates cached coordinates so we don't re-ask every visit.
 * - Exposes a simple state machine: idle → requesting → granted | denied | unavailable.
 */

export interface GeoCoords {
  lat: number
  lng: number
  /** Wall-clock at the time the fix was captured (ms since epoch). */
  capturedAt: number
  /** WAVE 2 — localisation lisible via /api/geo/reverse (BAN/IGN). null = reverse
   *  indisponible : l'UI reste sur un état « position active » honnête. */
  label?: string | null
  city?: string | null
  postcode?: string | null
}

export type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'

export interface UseGeolocation {
  coords: GeoCoords | null
  status: GeoStatus
  /** Trigger a permission request + position fix. */
  request: () => void
  /** Clear cached coords (e.g. user wants to disable). */
  clear: () => void
}

const STORAGE_KEY = 'grubano_geo'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7 // 1 week

/** Remembers WHICH identity the cached fix was captured under. */
const OWNER_KEY = 'grubano_geo.owner'

/**
 * The identity a fix belongs to: `u:<userId>` for an account, `guest` for a visitor, and
 * null when the identity is unresolved or unusable. Same convention as the cart, the
 * favourites and the receipt, so there is ONE notion of identity in this app.
 *
 * Unlike those, `guest` is a VALID owner here: a visitor may legitimately locate themselves,
 * and components/chef/ChefPublicPage.tsx does exactly that with no session at all.
 */
export type GeoOwner = string

/** Emitted after a successful commit, so sibling instances in the same tab can re-read. */
export const GEO_EVENT = 'grubano:geo'

/**
 * The owner this browser currently belongs to, declared by the hook from the identity its
 * caller passes in. Asynchronous work validates against THIS, not against the owner captured
 * in its own closure — comparing a closure with itself is a tautology, and the two callbacks
 * below (the browser's position callback and the reverse-geocode response) can both arrive
 * after the session has changed.
 */
let liveGeoOwner: GeoOwner | null = null

export function setGeoOwner(owner: GeoOwner | null): void {
  // Never on the server: module state is shared by every concurrent request there.
  if (typeof window === 'undefined') return
  liveGeoOwner = owner
}
export function getGeoOwner(): GeoOwner | null {
  return liveGeoOwner
}
/** Test-only: forget the declared identity between cases. */
export function __resetGeoOwner(): void {
  liveGeoOwner = null
}

/** The stamped shape held in React state. */
export interface GeoState {
  owner: GeoOwner | null
  coords: GeoCoords | null
  status: GeoStatus
}

/**
 * THE GATE, exported so the tests execute the real decision rather than a copy of it.
 * A fix is visible only to the identity it was read or captured under.
 */
export function geoVisible(liveOwner: GeoOwner | null, state: { owner: GeoOwner | null }): boolean {
  return liveOwner !== null && state.owner === liveOwner
}

/**
 * Bind the cached fix to an identity, dropping it when the identity is not the one it was
 * captured under. Called from the EatShell identity effect (mount + every sign-in /
 * sign-out / account switch).
 *
 * WHY THIS IS A PRIVACY FIX. The cached value is not only coordinates: /api/geo/reverse
 * fills `label` / `city` / `postcode`, i.e. the REVERSE-GEOCODED POSTAL ADDRESS of where
 * the signed-in user was. It lived under ONE global key with nothing recording whose it
 * was, so the next account to sign in on this browser was shown the previous account's
 * address line as its own « position active » — the same exposure as the saved-address
 * cache, in a different key.
 *
 * WHY A STAMP AND NOT « CLEAR ON EVERY DECLARATION ». Module state is empty on every page
 * load, so a fresh load cannot tell « first declaration » from « the identity changed »;
 * clearing on both would re-ask for permission on every visit, which is exactly what the
 * cache exists to avoid. The stamp lives next to the cache, so it survives reloads: same
 * identity → the cache is kept, different identity → it goes. Nothing the user authored is
 * lost either way (re-granting is one tap).
 */
export function syncGeoCacheOwner(owner: { kind: 'user'; id: string } | { kind: 'guest' }): void {
  if (typeof window === 'undefined') return
  const stamp = owner.kind === 'user' ? `u:${owner.id}` : 'guest'
  try {
    if (localStorage.getItem(OWNER_KEY) !== stamp) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(OWNER_KEY, stamp)
    }
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * The cached fix, but only when the stamp beside it names THIS owner. An unstamped or
 * foreign `grubano_geo` is never adopted — it is the blob that leaked, and it may hold the
 * postal address of someone who is not the person signing in now.
 */
function readCachedFor(owner: GeoOwner): GeoCoords | null {
  if (typeof window === 'undefined' || !owner) return null
  try {
    if (localStorage.getItem(OWNER_KEY) !== owner) return null
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeoCoords
    if (
      typeof parsed?.lat !== 'number' ||
      typeof parsed?.lng !== 'number' ||
      typeof parsed?.capturedAt !== 'number'
    ) {
      return null
    }
    if (Date.now() - parsed.capturedAt > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Persist a fix FOR A NAMED OWNER, and only while that owner is still the declared one.
 * A position captured under A must never be written into the cache B now owns — which is
 * exactly what a late browser callback would otherwise do.
 */
function persistFor(owner: GeoOwner, coords: GeoCoords | null): boolean {
  if (typeof window === 'undefined' || !owner) return false
  if (liveGeoOwner === null || owner !== liveGeoOwner) return false
  try {
    if (coords) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(coords))
      localStorage.setItem(OWNER_KEY, owner)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    window.dispatchEvent(new CustomEvent(GEO_EVENT, { detail: { owner } }))
    return true
  } catch {
    /* ignore (private browsing, quota, etc.) */
    return false
  }
}

/** Is this GEO_EVENT this owner's? FAIL CLOSED: an event naming no owner is foreign. */
export function geoEventIsMine(e: Event, owner: GeoOwner | null): boolean {
  if (!owner) return false
  const detail = (e as CustomEvent).detail as { owner?: unknown } | undefined
  return !!detail && detail.owner === owner
}

/**
 * @param liveOwner the identity this render belongs to — `u:<id>`, `guest`, or null while it
 *   is unresolved. REQUIRED, so no caller can forget it. The hook does NOT read useSession
 *   itself: ChefPublicPage renders without a SessionProvider, and a hook that demanded one
 *   would break that public page.
 */
export function useGeolocation(liveOwner: GeoOwner | null): UseGeolocation {
  /** RAW — read only through the gate below: the fix AND the identity it belongs to. */
  const [state, setState] = useState<GeoState>({ owner: null, coords: null, status: 'idle' })

  // ── EVALUATED DURING RENDER ────────────────────────────────────────────────────
  // The position is a physical fact about a person, so it is shown only to the identity it
  // was read or captured under. This has to be a render-time derivation: the owner is
  // declared in an effect, and effects run AFTER the frame that already painted the previous
  // account's address line.
  const mine = geoVisible(liveOwner, state)
  const coords = mine ? state.coords : null
  const status: GeoStatus = mine ? state.status : 'idle'

  // Declare the owner and rehydrate FOR IT. Re-runs on an identity change, so a cache that
  // is not this owner's is never adopted and the in-memory fix is dropped with it.
  useEffect(() => {
    setGeoOwner(liveOwner)
    if (liveOwner === null) {
      setState({ owner: null, coords: null, status: 'idle' })
      return
    }
    const cached = readCachedFor(liveOwner)
    setState({ owner: liveOwner, coords: cached, status: cached ? 'granted' : 'idle' })
    // Sibling instances in the same tab (the page and the geoloc sheet) stay in step — but
    // only on their OWN owner's events. This is a convenience, never the guard: the gate
    // above is what closes the frame.
    const onGeo = (e: Event) => {
      if (!geoEventIsMine(e, liveOwner)) return
      const fresh = readCachedFor(liveOwner)
      setState({ owner: liveOwner, coords: fresh, status: fresh ? 'granted' : 'idle' })
    }
    window.addEventListener(GEO_EVENT, onGeo)
    return () => window.removeEventListener(GEO_EVENT, onGeo)
  }, [liveOwner])

  const request = useCallback(() => {
    if (liveOwner === null) return // no identity ⇒ never ask the browser for a position
    // Captured BEFORE the permission prompt. Everything below is attributed to THIS owner.
    const requestOwner = liveOwner
    /** Commit only while the captured owner is still the live one. */
    const commit = (next: Partial<GeoState>) =>
      setState((prev) => (liveGeoOwner === requestOwner
        ? { owner: requestOwner, coords: next.coords ?? null, status: next.status ?? prev.status }
        : prev))
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      commit({ status: 'unavailable' })
      return
    }
    commit({ status: 'requesting' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // THE PROMPT CAN SIT OPEN FOR MINUTES. By the time the user taps « allow », the
        // session may be someone else's — so the position captured for A is dropped rather
        // than attributed to whoever is signed in now.
        if (liveGeoOwner !== requestOwner) return
        const next: GeoCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          capturedAt: Date.now(),
        }
        commit({ coords: next, status: 'granted' })
        persistFor(requestOwner, next)
        // WAVE 2 — reverse-geocode best-effort (proxy serveur → IGN) : enrichit la
        // position d'une adresse LISIBLE. Échec du tiers = silencieux (les coords
        // restent pleinement utilisables pour le tri).
        fetch(`/api/geo/reverse?lat=${next.lat}&lng=${next.lng}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { status?: string; label?: string; city?: string | null; postcode?: string | null } | null) => {
            // The reverse answer carries the POSTAL ADDRESS. It is the most sensitive thing
            // this hook ever holds, and it arrives last — so it is checked again here.
            if (liveGeoOwner !== requestOwner) return
            if (!d || d.status !== 'ok' || !d.label) return
            const enriched: GeoCoords = { ...next, label: d.label, city: d.city ?? null, postcode: d.postcode ?? null }
            commit({ coords: enriched, status: 'granted' })
            persistFor(requestOwner, enriched)
          })
          .catch(() => { /* best-effort */ })
      },
      (err) => {
        if (liveGeoOwner !== requestOwner) return
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3.
        commit({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' })
      },
      {
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 5, // 5 min cache from the browser layer
        timeout: 10_000,
      },
    )
  }, [liveOwner])

  const clear = useCallback(() => {
    if (liveOwner === null) return
    const owner = liveOwner
    // A « disable » tapped under A must not wipe the fix B has since granted: persistFor
    // refuses unless this owner is still the live one, and the state write is guarded too.
    if (liveGeoOwner !== owner) return
    setState((prev) => (prev.owner === owner ? { owner, coords: null, status: 'idle' } : prev))
    persistFor(owner, null)
  }, [liveOwner])

  return { coords, status, request, clear }
}
