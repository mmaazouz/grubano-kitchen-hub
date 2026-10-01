import { describe, it, expect, vi } from 'vitest'
import {
  createCourierTracker,
  shouldEmit,
  distanceMeters,
  isActiveMissionStatus,
  TRACK_MIN_INTERVAL_MS,
  TRACK_MIN_DISTANCE_M,
  type GeoWatcher,
  type TrackerState,
} from '@/lib/courier-tracking'

// ── Géoloc ÉTAPE 3 — courier capture CONTROLLER (pure, node-tested via injected fakes) ─────────
// The browser side-effects (geolocation.watchPosition/clearWatch, postPosition, now) are injected,
// so the whole start/throttle/auto-stop/permission logic is unit-testable without jsdom.

// A fake geolocation that captures the success/error callbacks so a test can drive them.
function makeGeo() {
  const g = {
    successCb: null as null | ((p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void),
    errorCb: null as null | ((e: { code: number; PERMISSION_DENIED: number }) => void),
    cleared: [] as number[],
    _id: 0,
    watchPosition: vi.fn((s: any, e: any) => { g.successCb = s; g.errorCb = e; return ++g._id }),
    clearWatch: vi.fn((id: number) => { g.cleared.push(id) }),
    fix: (lat: number, lng: number, accuracy = 5) => g.successCb?.({ coords: { latitude: lat, longitude: lng, accuracy } }),
    fail: (code: number) => g.errorCb?.({ code, PERMISSION_DENIED: 1 }),
  }
  return g
}

function setup(geo = makeGeo()) {
  let clock = 1_000_000
  const post = vi.fn()
  const states: TrackerState[] = []
  const tracker = createCourierTracker({
    geolocation: geo as unknown as GeoWatcher,
    postPosition: post,
    now: () => clock,
    onState: (s) => states.push(s),
  })
  return { tracker, geo, post, states, setClock: (t: number) => { clock = t }, advance: (ms: number) => { clock += ms } }
}

const ACTIVE = { id: 'm1', status: 'accepted' as const }

describe('pure predicates', () => {
  it('isActiveMissionStatus — only accepted/picked_up', () => {
    expect(isActiveMissionStatus('accepted')).toBe(true)
    expect(isActiveMissionStatus('picked_up')).toBe(true)
    for (const s of ['offered', 'delivered', 'cancelled', 'declined', 'expired']) {
      expect(isActiveMissionStatus(s)).toBe(false)
    }
  })
  it('distanceMeters — ~111m for 0.001° latitude', () => {
    const d = distanceMeters({ lat: 48.85, lng: 2.35 }, { lat: 48.851, lng: 2.35 })
    expect(d).toBeGreaterThan(105); expect(d).toBeLessThan(116)
  })
  it('shouldEmit — first always; then needs BOTH ≥15s AND ≥50m', () => {
    expect(shouldEmit(null, { at: 0, lat: 48.85, lng: 2.35 })).toBe(true)
    // far but too soon → false
    expect(shouldEmit({ at: 0, lat: 48.85, lng: 2.35 }, { at: 14_999, lat: 48.90, lng: 2.35 })).toBe(false)
    // long enough but too close (~10m) → false
    expect(shouldEmit({ at: 0, lat: 48.85, lng: 2.35 }, { at: 15_000, lat: 48.85009, lng: 2.35 })).toBe(false)
    // both satisfied → true
    expect(shouldEmit({ at: 0, lat: 48.85, lng: 2.35 }, { at: 15_000, lat: 48.8515, lng: 2.35 })).toBe(true)
  })
  it('the frozen thresholds are 15s and 50m', () => {
    expect(TRACK_MIN_INTERVAL_MS).toBe(15_000)
    expect(TRACK_MIN_DISTANCE_M).toBe(50)
  })
})

describe('start conditions — watchPosition ONLY when opt-in + flag + in-course mission', () => {
  it('does NOT start when any condition is missing', () => {
    for (const input of [
      { optIn: false, flagEnabled: true, mission: ACTIVE },
      { optIn: true, flagEnabled: false, mission: ACTIVE },
      { optIn: true, flagEnabled: true, mission: null },
      { optIn: true, flagEnabled: true, mission: { id: 'm1', status: 'offered' } },
      { optIn: true, flagEnabled: true, mission: { id: 'm1', status: 'delivered' } },
    ]) {
      const { tracker, geo } = setup()
      tracker.sync(input)
      expect(geo.watchPosition, JSON.stringify(input)).not.toHaveBeenCalled()
      expect(tracker.isTracking).toBe(false)
    }
  })
  it('starts exactly once when all conditions hold (accepted or picked_up)', () => {
    for (const status of ['accepted', 'picked_up']) {
      const { tracker, geo } = setup()
      tracker.sync({ optIn: true, flagEnabled: true, mission: { id: 'm1', status } })
      expect(geo.watchPosition).toHaveBeenCalledOnce()
      expect(tracker.isTracking).toBe(true)
    }
  })
  it('re-sync with the SAME active mission does not restart the watch', () => {
    const { tracker, geo } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    expect(geo.watchPosition).toHaveBeenCalledOnce()
  })
})

describe('throttle — emit only if ≥15s AND ≥50m since the last SENT fix', () => {
  it('first fix emits; then respects both thresholds (measured from the last sent point)', () => {
    const { tracker, geo, post, setClock } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })

    setClock(1_000_000); geo.fix(48.85, 2.35, 8)            // first → emit
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toEqual({ missionId: 'm1', lat: 48.85, lng: 2.35, accuracy: 8 })

    setClock(1_010_000); geo.fix(48.86, 2.35)               // +10s, ~1.1km → too soon
    expect(post).toHaveBeenCalledTimes(1)

    setClock(1_020_000); geo.fix(48.85009, 2.35)            // +20s, ~10m from last sent → too close
    expect(post).toHaveBeenCalledTimes(1)

    setClock(1_030_000); geo.fix(48.8515, 2.35)             // +30s, ~167m → BOTH ok → emit
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1][0]).toMatchObject({ missionId: 'm1', lat: 48.8515 })
  })
})

describe('auto-stop — the watch never runs off-course', () => {
  it('clears the watch when the mission goes delivered/cancelled', () => {
    for (const status of ['delivered', 'cancelled']) {
      const { tracker, geo } = setup()
      tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
      expect(tracker.isTracking).toBe(true)
      tracker.sync({ optIn: true, flagEnabled: true, mission: { id: 'm1', status } })
      expect(geo.clearWatch, status).toHaveBeenCalledWith(1)
      expect(tracker.isTracking).toBe(false)
    }
  })
  it('clears the watch when the mission disappears (null), opt-in is revoked, or the flag goes off', () => {
    for (const input of [
      { optIn: true, flagEnabled: true, mission: null },
      { optIn: false, flagEnabled: true, mission: ACTIVE },
      { optIn: true, flagEnabled: false, mission: ACTIVE },
    ]) {
      const { tracker, geo } = setup()
      tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
      tracker.sync(input)
      expect(geo.clearWatch, JSON.stringify(input)).toHaveBeenCalledWith(1)
      expect(tracker.isTracking).toBe(false)
    }
  })
  it('switching to a different active mission stops the old watch and starts a new one', () => {
    const { tracker, geo } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: { id: 'm1', status: 'accepted' } })
    tracker.sync({ optIn: true, flagEnabled: true, mission: { id: 'm2', status: 'accepted' } })
    expect(geo.clearWatch).toHaveBeenCalledWith(1)
    expect(geo.watchPosition).toHaveBeenCalledTimes(2)
  })
  it('stop() clears the watch (used on unmount)', () => {
    const { tracker, geo } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    tracker.stop()
    expect(geo.clearWatch).toHaveBeenCalledWith(1)
    expect(tracker.isTracking).toBe(false)
  })
})

describe('graceful degradation — never crashes', () => {
  it('permission denied → clears the watch, reports denied, and does NOT re-prompt on re-sync', () => {
    const { tracker, geo } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    geo.fail(1) // PERMISSION_DENIED
    expect(geo.clearWatch).toHaveBeenCalledWith(1)
    expect(tracker.state.permission).toBe('denied')
    expect(tracker.isTracking).toBe(false)
    // A later sync with the SAME active mission must NOT re-open a watch (no prompt loop).
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    expect(geo.watchPosition).toHaveBeenCalledOnce()
  })
  it('a POST failure never throws (best-effort)', () => {
    const { tracker, geo, post } = setup()
    post.mockImplementation(() => { throw new Error('network') })
    tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })
    expect(() => geo.fix(48.85, 2.35)).not.toThrow()
  })
  it('no navigator.geolocation → no crash, reports unavailable, never posts', () => {
    const post = vi.fn()
    const tracker = createCourierTracker({ geolocation: null, postPosition: post, now: () => 1 })
    expect(() => tracker.sync({ optIn: true, flagEnabled: true, mission: ACTIVE })).not.toThrow()
    expect(tracker.state.permission).toBe('unavailable')
    expect(tracker.isTracking).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('POST payload — carries the correct missionId + coords', () => {
  it('posts {missionId, lat, lng, accuracy} for the active mission', () => {
    const { tracker, geo, post } = setup()
    tracker.sync({ optIn: true, flagEnabled: true, mission: { id: 'mission-XYZ', status: 'picked_up' } })
    geo.fix(43.2965, 5.3698, 12)
    expect(post).toHaveBeenCalledWith({ missionId: 'mission-XYZ', lat: 43.2965, lng: 5.3698, accuracy: 12 })
  })
})
