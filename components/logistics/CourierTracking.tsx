'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useCourierTracking } from '@/lib/use-courier-tracking'
import type { OwnMissionDTO } from '@/lib/mission-serialize'

// ── CourierTracking (Géoloc ÉTAPE 3) — the courier position-sharing opt-in + live status card. ─
// GATED: it loads GET /api/logistics/tracking-consent; when the LOGISTICS_TRACKING_ENABLED flag
// is OFF (default) the endpoint returns { enabled:false } and this renders NOTHING (byte-identical)
// AND the capture hook stays inert (optIn/flagEnabled false → never starts watchPosition).
// When ON: an explicit, revocable opt-in (PATCH consent), honest copy (position shared ONLY during
// a course, deleted after), and — while a mission is in course — a live "suivi actif" indicator,
// the PWA reminder (keep the app open), and graceful degradation if the device permission is
// refused. NO map, NO position is ever displayed (that is Étape 4).

export default function CourierTracking({ activeMission }: { activeMission: OwnMissionDTO | null }) {
  const t = useTranslations('business.logistics.tracking')
  const [enabled, setEnabled] = useState(false) // mirrors LOGISTICS_TRACKING_ENABLED
  const [consent, setConsent] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/logistics/tracking-consent', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { enabled?: boolean; consent?: boolean } | null) => {
        if (!alive) return
        setEnabled(!!j?.enabled)
        setConsent(!!j?.consent)
        setLoaded(true)
      })
    return () => { alive = false }
  }, [])

  const setTracking = useCallback(async (next: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/logistics/tracking-consent', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: next }),
      })
      if (res.ok) setConsent(next)
    } catch {
      /* best-effort — a reload reflects the real state */
    } finally {
      setBusy(false)
    }
  }, [busy])

  // The mission handed to the capture hook — only an in-course one (accepted/picked_up). When the
  // course ends it leaves the server's `current` set → activeMission becomes null → the hook
  // auto-stops the watch (never runs off-course).
  const inCourse =
    activeMission && (activeMission.status === 'accepted' || activeMission.status === 'picked_up')
      ? { id: activeMission.id, status: activeMission.status }
      : null

  // Hook is called unconditionally (rules of hooks). It stays inert unless flag + opt-in + course.
  const { tracking, permission } = useCourierTracking({
    optIn: consent && enabled,
    flagEnabled: enabled,
    mission: inCourse,
  })

  // Gated: flag OFF (or not yet loaded) → render NOTHING → byte-identical to before.
  if (!loaded || !enabled) return null

  return (
    <div className="track">
      <div className="track__hd">
        <span className="track__ic"><span className="ms">my_location</span></span>
        <div className="track__m">
          <b>{t('title')}</b>
          <span>{t('desc')}</span>
        </div>
        <span className="track__badge"><span className="ms">shield</span>{t('badge')}</span>
      </div>

      {!consent ? (
        <button type="button" className="op-btn-primary track__cta" disabled={busy} onClick={() => setTracking(true)}>
          <span className="ms">location_on</span>{t('enable')}
        </button>
      ) : (
        <>
          {inCourse ? (
            permission === 'denied' ? (
              <div className="track__state is-warn">
                <span className="ms">location_off</span><span>{t('permDenied')}</span>
              </div>
            ) : permission === 'unavailable' ? (
              <div className="track__state is-warn">
                <span className="ms">gps_off</span><span>{t('unavailable')}</span>
              </div>
            ) : (
              <div className={`track__state${tracking ? ' is-live' : ''}`}>
                <span className="track__dot" />
                <div>
                  <b>{t('activeTitle')}</b>
                  <span>{t('activeBody')}</span>
                  <span className="track__pwa"><span className="ms">info</span>{t('pwaReminder')}</span>
                </div>
              </div>
            )
          ) : (
            <div className="track__state">
              <span className="ms">schedule</span><span>{t('idleNoMission')}</span>
            </div>
          )}
          <button type="button" className="op-btn-ghost track__revoke" disabled={busy} onClick={() => setTracking(false)}>
            <span className="ms">block</span>{t('revoke')}
          </button>
        </>
      )}
    </div>
  )
}
