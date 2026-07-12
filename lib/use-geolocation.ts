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

function readCached(): GeoCoords | null {
  if (typeof window === 'undefined') return null
  try {
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

function persist(coords: GeoCoords | null) {
  if (typeof window === 'undefined') return
  try {
    if (coords) localStorage.setItem(STORAGE_KEY, JSON.stringify(coords))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore (private browsing, quota, etc.) */
  }
}

export function useGeolocation(): UseGeolocation {
  const [coords, setCoords] = useState<GeoCoords | null>(null)
  const [status, setStatus] = useState<GeoStatus>('idle')

  // Rehydrate cached coordinates on mount (client-only).
  useEffect(() => {
    const cached = readCached()
    if (cached) {
      setCoords(cached)
      setStatus('granted')
    }
  }, [])

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      return
    }
    setStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: GeoCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          capturedAt: Date.now(),
        }
        setCoords(next)
        setStatus('granted')
        persist(next)
      },
      (err) => {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3.
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
      },
      {
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 5, // 5 min cache from the browser layer
        timeout: 10_000,
      },
    )
  }, [])

  const clear = useCallback(() => {
    setCoords(null)
    setStatus('idle')
    persist(null)
  }, [])

  return { coords, status, request, clear }
}
