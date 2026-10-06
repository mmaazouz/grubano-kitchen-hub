'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { useGeolocation } from '@/lib/use-geolocation'
import {
  readAddresses,
  currentAddressStamp,
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

/**
 * `sessionStamp` is the FIRST-FRAME GUARD, passed down rather than re-derived here: the
 * owner is declared in an effect in EatShell, and effects run after the render that
 * introduced a new session, so this sheet would keep showing the previous account's saved
 * list — and the `picked` address it RENDERS on the map card — for one committed frame on
 * an A → B switch. Comparing it with the stamp the list was read under closes that frame.
 */
export default function GeolocSheet(
  { open, onClose, sessionStamp }: { open: boolean; onClose: () => void; sessionStamp: string | null },
) {
  const t = useTranslations('eat.geoloc')
  // Reuse the existing « Par défaut » label from the addresses namespace (already in all
  // 5 locales) rather than introducing a duplicate key.
  const ta = useTranslations('eat.addresses')
  const router = useRouter()
  // The sheet already receives the live identity for the saved-address guard; the geo
  // state is scoped to the same one, so « position active » and its address line reflect
  // whoever is signed in NOW — not whoever granted the permission.
  const { coords, status, request, clear } = useGeolocation(sessionStamp)

  const [step, setStep] = useState<Step>('perm')
  const [query, setQuery] = useState('')
  const [addresses, setAddresses] = useState<EatAddress[]>([])
  // The address chosen on the SEARCH step (a real saved address) → confirmed on MAP.
  const [picked, setPicked] = useState<EatAddress | null>(null)
  /** The identity the saved list and `picked` were read under (first-frame guard). */
  const [addrStamp, setAddrStamp] = useState<string | null>(null)
  // Set when the user toggles geo ON from this overlay, so a successful grant advances.
  /**
   * WHAT THE NEXT SUCCESSFUL FIX IS FOR. Three different gestures in this sheet start an
   * acquisition and they do NOT want the same thing afterwards, so one boolean cannot carry
   * it: `none` — the permission switch, which only reflects state and must never navigate
   * or close; `advance` — the step-1 primary button, whose job is to move the user on to
   * the address step; `close` — « Utiliser ma position actuelle », which IS an explicit
   * choice of destination, so a valid fix completes the selection and the sheet is done.
   * Read once and CONSUMED, so a later render — a reverse-geocode landing, a parent
   * re-render — cannot close the sheet a second time.
   */
  const intent = useRef<'none' | 'advance' | 'close'>('none')

  const geoOn = status === 'granted' && !!coords

  // Refresh saved addresses while open (live via ADDRESS_EVENT).
  //
  // ⚠️ `picked` is dropped with them when it is no longer in the list. It is not just a
  // selection: the map step RENDERS its street / postcode / city (mapTitle / mapSub
  // below). The saved list is owner-scoped now, but a `picked` held in React state is
  // not — so after an identity change in this tab the sheet went on displaying the
  // PREVIOUS ACCOUNT's address on the map card, and « Confirmer » would have tried to
  // set it as the new account's default.
  useEffect(() => {
    if (!open) return
    const refresh = () => {
      const list = readAddresses()
      setAddresses(list)
      setAddrStamp(currentAddressStamp())
      setPicked((cur) => (cur && list.some((a) => a.id === cur.id) ? cur : null))
    }
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
    intent.current = 'none'
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // A VALID FIX, and only a valid fix, acts on the intent. `geoOn` is
  // `status === 'granted' && !!coords`, so a timeout, a refusal or an unavailable position
  // never reaches here and the sheet stays open on its error — which is the point.
  //
  // The RAW GPS success is enough: this does not wait for /api/geo/reverse. The postal
  // label is an enrichment of a destination already chosen, and making the sheet linger
  // until a third party answers would be a worse experience than the one being fixed.
  useEffect(() => {
    if (!geoOn) return
    const want = intent.current
    if (want === 'none') return
    intent.current = 'none'          // consumed exactly once
    if (want === 'close') onClose()
    else setStep('search')
  }, [geoOn, onClose])

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
      intent.current = 'none' // the switch only reflects state: never navigate, never close
      request()
    }
  }, [geoOn, clear, request])

  // THE BUG. This button sits inside `.step-search` (geoloc.css keeps every step in the
  // DOM and shows one via data-step), so when the position was already on its only action
  // was `setStep('search')` — the step the button is already on. A pure no-op: no
  // acquisition, no feedback, the sheet unchanged. And when the position was off it fired
  // a request whose `requesting` state nothing rendered, so that branch looked identical.
  //
  // The button says « use my current position », so it acquires one, every time — including
  // when a position is already held, because the held one can be a cached fix from a
  // previous session and « actuelle » is a promise about NOW. No step change: we are
  // already here, and the status line below reports the outcome in place.
  const useMyPosition = useCallback(() => {
    intent.current = 'close'
    request()
  }, [request])

  const pickSaved = useCallback((a: EatAddress) => {
    setPicked(a)
    setStep('map')
  }, [])

  // FIRST-FRAME GUARD (see the prop doc above): nothing cache-derived is rendered while
  // the stamp the data was read under is not the one this render's session implies.
  const stampOk = addrStamp !== null && addrStamp === sessionStamp
  const visibleAddrs = stampOk ? addresses : []
  const shownPicked = stampOk ? picked : null

  // « Confirmer » commits the picked address as the default — through the GATED value, so
  // it can never promote an address belonging to the previous identity.
  const confirmAddress = useCallback(() => {
    if (shownPicked) setDefaultAddress(shownPicked.id)
    onClose()
  }, [shownPicked, onClose])

  // The map step's address card mirrors the picked saved address (real) when present.
  const mapTitle = shownPicked ? shownPicked.street || shownPicked.label : t('mapPlaceholderTitle')
  const mapSub = shownPicked
    ? `${[shownPicked.postalCode, shownPicked.city].filter(Boolean).join(' ')} · ${t('mapAdjustHint')}`
    : t('mapPlaceholderSub')

  if (!open) return null

  const headBack = step === 'map' ? () => setStep('search') : step === 'search' ? () => setStep('perm') : null
  // The geo-status sub-line: a precise "activée" hint when on, a manual-entry hint when off.
  // WAVE 2 — quand le reverse-geocode (lib/geocode reverseGeocode via /api/geo/reverse) a
  // résolu la position, la sous-ligne affiche l'adresse RÉELLE ; sinon on garde le message
  // neutre « position détectée » (on n'invente jamais une adresse).

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
                <span className="ms lead ms-flip" aria-hidden="true">arrow_back</span>
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
                    {/* WAVE 2 — adresse LISIBLE via reverse-geocode (BAN/IGN) quand
                        disponible ; sinon le libellé neutre honnête d'origine. */}
                    <span className="geo-on-txt">{coords?.label || t('statusOnSub')}</span>
                    <span className="geo-off-txt">{t('statusOffSub')}</span>
                  </span>
                </div>
                {/* `unavailable` and `timeout` are TRANSIENT, so they no longer disable
                    this switch: folding a timeout into a permanent-sounding state and then
                    locking the control is how one slow fix became « nothing works ». Only
                    `unsupported` — no geolocation API at all — can honestly disable, plus
                    `requesting` while an attempt is in flight. */}
                <button
                  type="button"
                  className={`geo-switch${geoOn ? ' on' : ''}`}
                  role="switch"
                  aria-checked={geoOn}
                  aria-label={geoOn ? t('disableLocation') : t('enableLocation')}
                  disabled={status === 'requesting' || status === 'unsupported'}
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
              <button
                type="button"
                className="geo-loc-btn"
                onClick={useMyPosition}
                disabled={status === 'requesting' || status === 'unsupported'}
                aria-busy={status === 'requesting'}
              >
                <span className="ms" aria-hidden="true">
                  {status === 'requesting' ? 'progress_activity' : 'my_location'}
                </span>
                {status === 'requesting' ? t('locating') : t('useMyPosition')}
              </button>

              {/* THE FEEDBACK THAT DID NOT EXIST. Nothing rendered for `requesting`, and
                  nothing at all for a refusal, a timeout or an unavailable position — the
                  sheet simply sat there. role=status / role=alert so a screen reader is
                  told too. Manual entry stays available in every one of these states: the
                  address field above is on this same step and is never disabled. */}
              {status === 'requesting' && (
                <p className="geo-loc-msg" role="status">{t('locatingHint')}</p>
              )}
              {/* A VISIBLE SUCCESS. Without this the acquisition finished in silence on
                  this step: the button label went back to « Utiliser ma position actuelle »
                  and nothing else changed, which reads exactly like the dead button this
                  fix is about. The resolved postal address when the reverse-geocode has
                  landed, the neutral « position détectée » otherwise — never an invented
                  address. No step change: the user is on the address step and may still
                  want a saved one. */}
              {geoOn && (
                <p className="geo-loc-msg geo-loc-msg--ok" role="status">
                  <span className="ms" aria-hidden="true">check_circle</span>
                  <span>{coords?.label || t('statusOnSub')}</span>
                </p>
              )}
              {(status === 'denied' || status === 'timeout' || status === 'unavailable' || status === 'unsupported') && (
                <p className="geo-loc-msg geo-loc-msg--err" role="alert">
                  <span>
                    {status === 'denied'
                      ? t('errDenied')
                      : status === 'timeout'
                        ? t('errTimeout')
                        : status === 'unsupported'
                          ? t('errUnsupported')
                          : t('errUnavailable')}
                  </span>
                  {/* A refusal and a missing API cannot be fixed by trying again, so no
                      retry is offered there — offering one would be a lie. */}
                  {(status === 'timeout' || status === 'unavailable') && (
                    <button type="button" className="geo-retry" onClick={request}>
                      {t('retry')}
                    </button>
                  )}
                </p>
              )}

              {/* Typeahead suggestions — CD « à venir » visual placeholder (no geocoding
                  provider wired): shown only when the user types, inert, never a real
                  result. Honours the CD grouped design (header + soon badge + row) without
                  fabricating data. */}
              {query.trim() && (
                <div className="geo-ac" aria-hidden="true">
                  <div className="geo-ac-group">
                    <span className="soon">
                      <span className="ms">schedule</span>
                      {t('acSoon')}
                    </span>
                  </div>
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
              {visibleAddrs.length === 0 ? (
                <div className="geo-recents-empty">
                  <span className="ms" aria-hidden="true">location_off</span>
                  <p>{t('recentsEmpty')}</p>
                </div>
              ) : (
                visibleAddrs.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`geo-saved${a.isDefault ? ' is-default' : ''}`}
                    onClick={() => pickSaved(a)}
                  >
                    <span className="ico"><span className="ms" aria-hidden="true">{KIND_ICON[a.kind]}</span></span>
                    <div className="main">
                      <span className="title">
                        <b>{a.label}</b>
                        {a.isDefault && (
                          <span className="badge-default">
                            <span className="ms" aria-hidden="true">check</span>
                            {ta('defaultBadge')}
                          </span>
                        )}
                      </span>
                      <span className="line">{formatAddress(a)}</span>
                      {a.note && (
                        <span className="note">
                          <span className="ms" aria-hidden="true">info</span>
                          {a.note}
                        </span>
                      )}
                    </div>
                    <span className="ms go ms-flip" aria-hidden="true">chevron_right</span>
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
                disabled={status === 'requesting' || status === 'unsupported'}
                aria-busy={status === 'requesting'}
                onClick={() => {
                  // From step 1 the step change IS the feedback, so « Continuer » still
                  // advances when a position is held; only the acquisition path needs the
                  // in-place reporting the search step now has.
                  if (geoOn) {
                    setStep('search')
                  } else {
                    intent.current = 'advance'
                    request()
                  }
                }}
              >
                <span className="ms" style={{ fontSize: 19 }} aria-hidden="true">
                  {status === 'requesting' ? 'progress_activity' : 'my_location'}
                </span>
                {status === 'requesting' ? t('locating') : geoOn ? t('continue') : t('enableLocation')}
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
