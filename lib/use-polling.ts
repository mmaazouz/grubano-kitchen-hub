'use client'

import { useEffect, useRef } from 'react'

// ── usePolling — shared light polling hook (étape 3, bloc A) ─────────────────
//
// Fires `callback` every `intervalMs` while the tab is VISIBLE, pauses when
// the tab is hidden (visibilitychange), and fires immediately on return so
// the screen catches up without waiting a full interval. No websocket, no
// dependency — the entire premium-table realtime layer rides on this.
//
// Contract:
//   - `callback` may be async; overlapping runs are prevented (a tick is
//     skipped while the previous one is still in flight).
//   - `enabled: false` stops everything (used to pause polling while a
//     payment sheet is open, for instance).
//   - The callback ref is kept fresh — no stale closures, no need for the
//     caller to memoise.

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs = 3000,
  enabled = true,
) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  const busyRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    let timer: ReturnType<typeof setInterval> | null = null

    async function tick() {
      if (busyRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      busyRef.current = true
      try {
        await cbRef.current()
      } catch {
        /* polling is best-effort — a failed tick is silently retried next time */
      } finally {
        busyRef.current = false
      }
    }

    function start() {
      if (timer) return
      timer = setInterval(tick, intervalMs)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        // Catch up immediately, then resume the cadence.
        void tick()
        start()
      } else {
        stop()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [intervalMs, enabled])
}
