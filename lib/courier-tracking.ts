// Courier position CAPTURE controller — Géoloc ÉTAPE 3 (RGPD-sensible). Framework-agnostic +
// PURE (no React, no navigator, no fetch) so it is fully unit-testable in the node env: the
// browser side-effects are INJECTED (geolocation / postPosition / now). The React hook
// lib/use-courier-tracking wires this to navigator.geolocation.watchPosition + a POST.
//
// PRIVACY-BY-DESIGN — the controller captures a position ONLY while ALL hold (else it stops):
//   • opt-in given (the courier consented)            • the feature flag is ON (server-gated too)
//   • an in-course mission (accepted | picked_up)      • throttled: emit only if ≥15s AND ≥50m
// It AUTO-STOPS (clearWatch) the instant the mission ends (delivered/cancelled → leaves the
// active set), opt-in is revoked, or the flag goes off — the watch NEVER runs off-course. It
// never starts at mount: sync() is called with the current inputs and only starts a watch when
// they all hold, so the device permission prompt appears at the right moment (course + opt-in).

/** Throttle: a retained fix must be ≥ this many ms AND ≥ TRACK_MIN_DISTANCE_M from the last sent
 *  one. The first fix of a course (no previous) always emits. */
export const TRACK_MIN_INTERVAL_MS = 15_000
export const TRACK_MIN_DISTANCE_M = 50

export interface LatLng { lat: number; lng: number }
export interface Emission { at: number; lat: number; lng: number }

/** Haversine distance in METRES. Inlined (not imported from lib/geocode) to keep this a pure,
 *  dependency-free module safe to bundle client-side. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000 // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Only these two lifecycle states are "in course" — a position is captured ONLY then. */
export function isActiveMissionStatus(status: string): boolean {
  return status === 'accepted' || status === 'picked_up'
}

/** Throttle predicate: emit the first fix; afterwards emit only if BOTH ≥ minMs since the last
 *  sent fix AND ≥ minMeters away from it (both conditions, per the frozen spec). */
export function shouldEmit(
  prev: Emission | null,
  next: Emission,
  minMs: number = TRACK_MIN_INTERVAL_MS,
  minMeters: number = TRACK_MIN_DISTANCE_M,
): boolean {
  if (!prev) return true
  return next.at - prev.at >= minMs && distanceMeters(prev, next) >= minMeters
}

export type TrackerPermission = 'idle' | 'granted' | 'denied' | 'unavailable'
export interface TrackerState { tracking: boolean; missionId: string | null; permission: TrackerPermission }

// Minimal structural shapes so navigator.geolocation (via a thin adapter in the hook) fits.
export interface GeoPositionLike { coords: { latitude: number; longitude: number; accuracy?: number } }
export interface GeoErrorLike { code: number; PERMISSION_DENIED: number }
export interface GeoWatcher {
  watchPosition(success: (pos: GeoPositionLike) => void, error: (err: GeoErrorLike) => void): number
  clearWatch(id: number): void
}

export interface TrackerDeps {
  /** null when navigator.geolocation is unavailable → the controller degrades (permission 'unavailable'). */
  geolocation: GeoWatcher | null
  /** Fire-and-forget POST of a retained point. The server re-gates flag+consent+active mission. */
  postPosition: (body: { missionId: string; lat: number; lng: number; accuracy?: number }) => void
  now: () => number
  onState?: (s: TrackerState) => void
  minIntervalMs?: number
  minDistanceM?: number
}

export interface TrackerInput {
  optIn: boolean
  flagEnabled: boolean
  mission: { id: string; status: string } | null
}

export interface CourierTracker {
  /** Reconcile the watch with the current inputs — start/stop as the conditions change. */
  sync(input: TrackerInput): void
  /** Force-stop the watch (used on unmount). */
  stop(): void
  readonly isTracking: boolean
  readonly state: TrackerState
}

/** Create a courier position-capture controller. All browser side-effects are injected, so the
 *  whole start/throttle/auto-stop/permission logic is unit-testable in node. */
export function createCourierTracker(deps: TrackerDeps): CourierTracker {
  let watchId: number | null = null
  let activeMissionId: string | null = null
  let last: Emission | null = null
  let permission: TrackerPermission = 'idle'

  const emitState = () =>
    deps.onState?.({ tracking: watchId !== null, missionId: activeMissionId, permission })

  const clear = () => {
    if (watchId !== null && deps.geolocation) deps.geolocation.clearWatch(watchId)
    watchId = null
    activeMissionId = null
    last = null
  }

  const stop = () => {
    if (watchId === null && activeMissionId === null) return
    clear()
    emitState()
  }

  const start = (missionId: string) => {
    if (!deps.geolocation) {
      permission = 'unavailable'
      emitState()
      return
    }
    activeMissionId = missionId
    last = null
    watchId = deps.geolocation.watchPosition(
      (pos) => {
        permission = 'granted'
        const next: Emission = { at: deps.now(), lat: pos.coords.latitude, lng: pos.coords.longitude }
        if (shouldEmit(last, next, deps.minIntervalMs, deps.minDistanceM)) {
          last = next
          try {
            deps.postPosition({ missionId, lat: next.lat, lng: next.lng, accuracy: pos.coords.accuracy })
          } catch {
            /* best-effort — the server is the real gate; a failed POST just drops one point */
          }
        }
        emitState()
      },
      (err) => {
        // Graceful degradation — a denied permission (or no signal) never crashes. Stop the watch;
        // 'denied' blocks auto-restart within this instance (no permission-prompt loop).
        permission = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'
        clear()
        emitState()
      },
    )
    emitState()
  }

  const sync = (input: TrackerInput) => {
    const wanted =
      input.optIn && input.flagEnabled && !!input.mission && isActiveMissionStatus(input.mission.status)

    if (!wanted) {
      stop()
      return
    }
    const missionId = input.mission!.id
    // Already watching this exact mission → nothing to do.
    if (watchId !== null && activeMissionId === missionId) return
    // Switching missions → stop the old watch first.
    if (watchId !== null) clear()
    // A prior denial blocks silent re-prompting until the tracker is recreated (hook remount).
    if (permission === 'denied') {
      emitState()
      return
    }
    start(missionId)
  }

  return {
    sync,
    stop,
    get isTracking() { return watchId !== null },
    get state(): TrackerState { return { tracking: watchId !== null, missionId: activeMissionId, permission } },
  }
}
