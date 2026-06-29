'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { useGeolocation } from '@/lib/use-geolocation'
import {
  readAddresses,
  setDefaultAddress,
  formatAddress,
  ADDRESS_EVENT,
  type EatAddress,
  type AddrKind,
} from '@/lib/eat-addresses'
import './geoloc.css'

// ── <GeolocSheet /> — « Géoloc + choix d'adresse » overlay (« Livrer à »). VERBATIM
// reproduction of the FROZEN CD ref (Notion 38efd2c9-…-21ebc0, eat/geolocation.html):
// modal (desktop ≥720px) / bottom-sheet (mobile <720px), 3 steps perm/search/map.
// Opened from the EatShell « Livrer à » button. Renders nothing when closed.
//
// REAL DATA:
//  · Step PERMISSION : real navigator.geolocation via lib/use-geolocation. The on/off
//    toggle = the live grant state (request()/clear()), never hard-coded.
//  · Step SEARCH     : « Récents » = the user's REAL saved addresses (lib/eat-addresses);
//    selecting one sets it default (feeds « Livrer à ») + closes. The typeahead suggestion
//    rows are the CD « à venir » visual placeholder (NO geocoding provider in the app) —
//    inert, shown only to honour the CD design; they never fabricate a real result.
//    « Utiliser ma position actuelle » = real geolocation.
//  · Step MAP        : the CD map + draggable-pin is an inert visual placeholder (no carto
//    lib wired). « Confirmer l'adresse » commits the picked saved address as default.
//
// The overlay is rendered under a `.gb` root so the foundation tokens/Material font apply
// (the EatShell `.gb` does not wrap fixed-position portaled overlays reliably, so we set
// it locally). The CD generic class names are renamed to `.geo-*` (see geoloc.css).

type Step = 'perm' | 'search' | 'map'

const KIND_ICON: Record<AddrKind, string> = { home: 'home', work: 'work', other: 'location_on' }

// Highlight the typed query inside a label (case-insensitive), wrapping the match in
// <mark>, mirroring the CD typeahead. Purely visual (no geocoding).
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export default function GeolocSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('eat.geoloc')
  const router = useRouter()
  const { coords, status, request, clear } = useGeolocation()

  const [step, setStep] = useState<Step>('perm')
  const [query, setQuery] = useState('')
  const [addresses, setAddresses] = useState<EatAddress[]>([])
  // The address chosen on the SEARCH step (a real saved address) → confirmed on MAP.
  const [picked, setPicked] = useState<EatAddress | null>(null)
  // Set when the user toggles geo ON from this overlay, so a successful grant advances.
  const awaitingGrant = useRef(false)

  const geoOn = status === 'granted' && !!coords

  // Refresh saved addresses while open (live via ADDRESS_EVENT).
  useEffect(() => {
    if (!open) return
    const refresh = () => setAddresses(readAddresses())
    refresh()
    window.addEventListener(ADDRESS_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(ADDRESS_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [open])

  // Reset to the first step each time the overlay opens; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    setStep('perm')
    setQuery('')
    setPicked(null)
    awaitingGrant.current = false
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // When a grant lands after the user asked for it from here, advance to search.
  useEffect(() => {
    if (geoOn && awaitingGrant.current) {
      awaitingGrant.current = false
      setStep('search')
    }
  }, [geoOn])

  // Esc closes the overlay.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const toggleGeo = useCallback(() => {
    if (geoOn) {
      clear()
    } else {
      awaitingGrant.current = false // toggle reflects state; don't auto-advance from here
      request()
    }
  }, [geoOn, clear, request])

  const useMyPosition = useCallback(() => {
    if (geoOn) {
      setStep('search')
    } else {
      awaitingGrant.current = true
      request()
    }
  }, [geoOn, request])

  const pickSaved = useCallback((a: EatAddress) => {
    setPicked(a)
    setStep('map')
  }, [])

  const confirmAddress = useCallback(() => {
    if (picked) setDefaultAddress(picked.id)
    onClose()
  }, [picked, onClose])

  // The map step's address card mirrors the picked saved address (real) when present.
  const mapTitle = picked ? picked.street || picked.label : t('mapPlaceholderTitle')
  const mapSub = picked
    ? `${[picked.postalCode, picked.city].filter(Boolean).join(' ')} · ${t('mapAdjustHint')}`
    : t('mapPlaceholderSub')

  if (!open) return null

  const headBack = step === 'map' ? () => setStep('search') : step === 'search' ? () => setStep('perm') : null
  // The geo-status sub-line: a precise "activée" hint when on, a manual-entry hint when off.
  // We don't fabricate a city/precision from coords (no reverse-geocode), so the on-state
  // sub-line is a neutral "position détectée" message.

  return (
    <div
      className="gb gb-geoloc"
      data-step={step}
      data-geo={geoOn ? 'on' : 'off'}
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <div className="geo-backdrop" onClick={onClose}>
        <section className="geo-sheet" onClick={(e) => e.stopPropagation()}>
          {/* HEAD — changes with the step */}
          <div className="geo-sheet__head">
            {headBack ? (
              <button type="button" className="iconbtn" onClick={headBack} aria-label={t('back')}>
                <span className="ms lead" aria-hidden="true">arrow_back</span>
              </button>
            ) : null}
            <h2>
              <span className="head-perm">{t('headPerm')}</span>
              <span className="head-search">{t('headSearch')}</span>
              <span className="head-map">{t('headMap')}</span>
            </h2>
            <button type="button" className="iconbtn" onClick={onClose} aria-label={t('close')}>
              <span className="ms close" aria-hidden="true">close</span>
            </button>
          </div>

          <div className="geo-sheet__body">
            {/* ============ STEP 1 — PERMISSION ============ */}
            <div className="step-perm">
              <div className="geo-perm">
                <div className="geo-perm__ico"><span className="ms" aria-hidden="true">my_location</span></div>
                <h3>{t('permTitle')}</h3>
                <p>{t('permBody')}</p>
              </div>
              {/* on / off state (toggle) */}
              <div className="geo-status">
                <span className="ico">
                  <span className="ms geo-on-txt" aria-hidden="true">location_on</span>
                  <span className="ms geo-off-txt" aria-hidden="true">location_off</span>
                </span>
                <div className="main">
                  <b>
                    <span className="geo-on-txt">{t('statusOn')}</span>
                    <span className="geo-off-txt">{t('statusOff')}</span>
                  </b>
                  <span>
                    <span className="geo-on-txt">{t('statusOnSub')}</span>
                    <span className="geo-off-txt">{t('statusOffSub')}</span>
                  </span>
                </div>
                <button
                  type="button"
                  className={`geo-switch${geoOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={geoOn}
                  aria-label={geoOn ? t('disableLocation') : t('enableLocation')}
                  disabled={status === 'unavailable' || status === 'requesting'}
                  onClick={toggleGeo}
                >
                  <i />
                </button>
              </div>
            </div>

            {/* ============ STEP 2 — SEARCH + AUTOCOMPLETE ============ */}
            <div className="step-search">
              <div className="geo-search">
                <span className="ms" aria-hidden="true">search</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                />
                {query && (
                  <button
                    type="button"
                    className="iconbtn"
                    onClick={() => setQuery('')}
                    aria-label={t('clear')}
                  >
                    <span className="ms clear" aria-hidden="true">close</span>
                  </button>
                )}
              </div>
              <button type="button" className="geo-loc-btn" onClick={useMyPosition}>
                <span className="ms" aria-hidden="true">my_location</span>
                {t('useMyPosition')}
              </button>

              {/* Typeahead suggestions — CD « à venir » visual placeholder (no geocoding
                  provider wired): shown only when the user types, inert, never a real
                  result. Honours the CD design without fabricating data. */}
              {query.trim() && (
                <div className="geo-ac" aria-hidden="true">
                  <div className="geo-ac-group">{t('acSoon')}</div>
                  <div className="geo-ac-item">
                    <span className="lead"><span className="ms">location_on</span></span>
                    <div className="txt">
                      <b><Highlight text={query.trim()} query={query.trim()} /></b>
                      <span>{t('acSoonHint')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Récents — the user's REAL saved addresses (lib/eat-addresses). */}
              <div className="geo-section-label">{t('recents')}</div>
              {addresses.length === 0 ? (
                <p className="geo-empty-recents">{t('recentsEmpty')}</p>
              ) : (
                addresses.map((a) => (
                  <button key={a.id} type="button" className="geo-saved" onClick={() => pickSaved(a)}>
                    <span className="ico"><span className="ms" aria-hidden="true">{KIND_ICON[a.kind]}</span></span>
                    <div className="main">
                      <b>{a.label}</b>
                      <span>{formatAddress(a)}</span>
                    </div>
                    <span className="ms go" aria-hidden="true">chevron_right</span>
                  </button>
                ))
              )}
            </div>

            {/* ============ STEP 3 — MAP + CONFIRMATION ============ */}
            <div className="step-map">
              {/* Inert visual placeholder — no carto lib wired (« à venir »). */}
              <div className="geo-map" aria-hidden="true">
                <div className="pin"><span className="head" /><span className="shadow" /></div>
                <div className="recenter"><span className="ms">my_location</span></div>
              </div>
              <div className="geo-addr-confirm">
                <span className="ms" aria-hidden="true">location_on</span>
                <div>
                  <b>{mapTitle}</b>
                  <span>{mapSub}</span>
                </div>
                <button
                  type="button"
                  className="edit"
                  onClick={() => { onClose(); router.push('/eat/account/addresses') }}
                >
                  {t('edit')}
                </button>
              </div>
            </div>
          </div>

          {/* FOOT — changes with the step */}
          <div className="geo-sheet__foot">
            {/* step 1 */}
            <div className="step-perm">
              <button
                type="button"
                className="geo-btn geo-btn--primary"
                disabled={status === 'unavailable'}
                onClick={() => {
                  if (geoOn) {
                    setStep('search')
                  } else {
                    awaitingGrant.current = true
                    request()
                  }
                }}
              >
                <span className="ms" style={{ fontSize: 19 }} aria-hidden="true">my_location</span>
                {geoOn ? t('continue') : t('enableLocation')}
              </button>
              <button
                type="button"
                className="geo-btn geo-btn--ghost"
                style={{ marginTop: 6 }}
                onClick={() => setStep('search')}
              >
                {t('laterEnterAddress')}
              </button>
            </div>
            {/* step 3 */}
            <div className="step-map">
              <button type="button" className="geo-btn geo-btn--primary" onClick={confirmAddress}>
                {t('confirmAddress')}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
