'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createCourierTracker,
  type CourierTracker,
  type GeoWatcher,
  type TrackerState,
} from '@/lib/courier-tracking'

// ── useCourierTracking — Géoloc ÉTAPE 3 — thin React wiring over the PURE createCourierTracker.
// It injects the real browser side-effects (navigator.geolocation.watchPosition/clearWatch, a
// POST /api/logistics/position, Date.now) and reconciles the watch whenever the inputs change.
// ALL the start/throttle/auto-stop/permission logic lives in lib/courier-tracking (node-tested);
// this hook only bridges it to the browser. It NEVER starts at mount: the controller starts a
// watch only when optIn + flagEnabled + an in-course mission all hold, so the device permission
// prompt appears at the right moment. On unmount it stops the watch.

export interface UseCourierTracking {
  tracking: boolean
  permission: TrackerState['permission']
}

export interface CourierTrackingInput {
  optIn: boolean
  flagEnabled: boolean
  mission: { id: string; status: string } | null
}

export function useCourierTracking(input: CourierTrackingInput): UseCourierTracking {
  const [state, setState] = useState<TrackerState>({ tracking: false, missionId: null, permission: 'idle' })
  const trackerRef = useRef<CourierTracker | null>(null)

  // Lazily create the tracker once, client-side only (SSR keeps it null → inert).
  if (trackerRef.current === null && typeof window !== 'undefined') {
    const nav = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
    // Adapter: bridge navigator.geolocation to the controller's minimal GeoWatcher shape.
    const geolocation: GeoWatcher | null = nav
      ? {
          watchPosition: (success, error) =>
            nav.watchPosition(
              (pos) => success(pos),
              (err) => error(err),
              { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
            ),
          clearWatch: (id) => nav.clearWatch(id),
        }
      : null

    trackerRef.current = createCourierTracker({
      geolocation,
      now: () => Date.now(),
      onState: setState,
      postPosition: (body) => {
        // Fire-and-forget; the server re-gates flag + consent + in-course mission. keepalive so a
        // last point can still flush if the page is navigating away.
        void fetch('/api/logistics/position', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(() => {})
      },
    })
  }

  // Reconcile on any input change (opt-in toggled, flag, mission id/status).
  useEffect(() => {
    trackerRef.current?.sync(input)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.optIn, input.flagEnabled, input.mission?.id, input.mission?.status])

  // Stop the watch on unmount (never leave geolocation running).
  useEffect(() => () => trackerRef.current?.stop(), [])

  return { tracking: state.tracking, permission: state.permission }
}
