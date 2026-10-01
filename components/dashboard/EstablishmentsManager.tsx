'use client'

import { useState, useTransition } from 'react'
import { useRouter, Link } from '@/navigation'
import { useTranslations } from 'next-intl'
import {
  ESTABLISHMENT_COOKIE,
  ESTABLISHMENT_COOKIE_MAX_AGE,
} from '@/lib/establishment'
import { isPlausibleAddress } from '@/lib/geocode'
import '../../app/[locale]/dashboard/establishments/establishments.css'

// Canonical cuisine values shared with the onboarding flow. Labels come from the
// existing `business.onboarding` namespace so we don't duplicate translations.
const CUISINE_TYPES = [
  { value: 'italien',   labelKey: 'cuisineItalien',   emoji: '🍕' },
  { value: 'asiatique', labelKey: 'cuisineAsiatique', emoji: '🍜' },
  { value: 'burger',    labelKey: 'cuisineBurger',    emoji: '🍔' },
  { value: 'healthy',   labelKey: 'cuisineHealthy',   emoji: '🥗' },
  { value: 'sushi',     labelKey: 'cuisineSushi',     emoji: '🍣' },
  { value: 'desserts',  labelKey: 'cuisineDesserts',  emoji: '🍰' },
  { value: 'wraps',     labelKey: 'cuisineWraps',     emoji: '🥙' },
  { value: 'pasta',     labelKey: 'cuisinePasta',     emoji: '🍝' },
  { value: 'autre',     labelKey: 'cuisineAutre',     emoji: '🍴' },
] as const

// Cuisine keywords typed into the city field by mistake (e.g. "burger") are
// rejected client-side — the server enforces the same. Built from the cuisine
// values above so the two never drift.
const CUISINE_VALUES = new Set<string>(CUISINE_TYPES.map((c) => c.value))

// CD list-row logo gradient pairs (verbatim from establishments.html). Cycled by a
// stable hash of the establishment id so each card keeps a consistent colour —
// pure presentation, no data meaning.
const ROW_GRADS = [
  '#FF8A3D,#F2570E',
  '#D5372A,#A8281D',
  '#E8A63D,#B9740A',
  '#3E5A7D,#1B3A5E',
  '#6E56CF,#4B3894',
  '#1E9E57,#136B3B',
] as const
function gradFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ROW_GRADS[h % ROW_GRADS.length]
}
function initials(name: string): string {
  return (
    name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() ||
    '?'
  )
}

/** Loose http(s) URL check — mirrors the server zod `.url()` intent without
 *  blocking on an empty field (empty values are sent as undefined). */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface EstablishmentRow {
  id:       string
  name:     string
  city:     string
  address:  string
  isActive: boolean
}

export default function EstablishmentsManager(props: {
  establishments: EstablishmentRow[]
  currentId:      string
}) {
  const t  = useTranslations('establishment')
  const tc = useTranslations('business.onboarding') // cuisine labels
  const to = useTranslations('operator')             // shared op- labels (soon, status…)
  const router = useRouter()

  const { establishments, currentId } = props

  // Loading state is bound to the navigation transition (not a manual flag that
  // can leak): startTransition stays pending until router.push completes, then
  // resets automatically — and navigating away unmounts this component anyway,
  // so the spinner can never get stuck.
  const [pendingId, setPendingId]  = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Create-modal state.
  const [open, setOpen]       = useState(false)
  const [name, setName]       = useState('')
  const [city, setCity]       = useState('')
  const [address, setAddress] = useState('')
  const [cuisineType, setCuisineType] = useState('italien')
  const [description, setDescription] = useState('')
  const [logo, setLogo]       = useState('')
  const [cover, setCover]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Lightweight inline toast (replaces the DS ToastProvider — the CD shell owns
  // its own visual language). Auto-dismisses; purely cosmetic feedback.
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn'; msg: string } | null>(null)
  function showToast(kind: 'ok' | 'warn', msg: string) {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 4000)
  }

  // Select this establishment (durable cookie) and open ITS dashboard. Navigating
  // is clearer for a non-tech operator than a silent in-place switch — and it
  // sidesteps any stuck-spinner state because the page unmounts on navigation.
  function openDashboardFor(id: string) {
    document.cookie =
      `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ESTABLISHMENT_COOKIE_MAX_AGE}; samesite=lax`
    setPendingId(id)
    startTransition(() => router.push('/dashboard'))
  }

  function resetForm() {
    setName(''); setCity(''); setAddress('')
    setCuisineType('italien'); setDescription('')
    setLogo(''); setCover(''); setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim())    { setError(t('errName')); return }
    if (!city.trim())    { setError(t('errCity')); return }
    if (!address.trim()) { setError(t('errAddress')); return }

    // Reject an obviously-invalid city (too short, or a cuisine keyword typed by
    // mistake). The server enforces the same; here we fail fast without a round
    // trip. The "does this city exist?" question is answered by the BAN geocode
    // server-side and surfaced as a soft warning below.
    const cityNorm = city.trim().toLowerCase()
    if (cityNorm.length < 2 || CUISINE_VALUES.has(cityNorm)) {
      setError(t('errCityInvalid'))
      return
    }

    // Reject an implausible address ("gogo") before the round trip; the server
    // enforces the same. A plausible-but-unfindable address is allowed through
    // and warned about (via geocodeStatus) after creation.
    if (!isPlausibleAddress(address)) {
      setError(t('errAddressInvalid'))
      return
    }

    const logoUrl  = logo.trim()
    const coverUrl = cover.trim()
    if ((logoUrl && !isHttpUrl(logoUrl)) || (coverUrl && !isHttpUrl(coverUrl))) {
      setError(t('errInvalidUrl'))
      return
    }

    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/restaurants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          additional:  true,                         // ← opt out of the duplicate guard
          name:        name.trim(),
          city:        city.trim(),
          address:     address.trim(),
          cuisine:     [cuisineType],
          description: description.trim() || undefined,
          logo:        logoUrl  || undefined,
          coverPhoto:  coverUrl || undefined,
        }),
      })
      if (res.status === 401) { window.location.href = '/auth/magic'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.restaurant?.id) {
        setError((data && (data.error as string)) || t('errCreateFailed'))
        return
      }
      // Make the new establishment the active one, then refresh the server view.
      document.cookie =
        `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(data.restaurant.id)}; path=/; max-age=${ESTABLISHMENT_COOKIE_MAX_AGE}; samesite=lax`
      setOpen(false)
      resetForm()
      // Created either way. Warn ONLY when BAN positively didn't find the address
      // (likely a typo); stay silent + show success when BAN was unavailable, so
      // a third-party outage never produces a false "check your address" alarm.
      if (data.geocodeStatus === 'not_found') showToast('warn', t('cityNotVerified'))
      else                                    showToast('ok', t('createdNote'))
      router.refresh()
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // isActive is the admin-gated PUBLICATION state (visible on /eat), NOT an
  // open/closed-for-orders state — same truth the OperatorShell badge tells (B2).
  const publishedCount = establishments.filter((e) => e.isActive).length

  return (
    <section className="op-est-list">
      {/* head */}
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('label')}s</h1>
          <p className="op-dash__sub">{t('manageSubtitle', { count: establishments.length })}</p>
        </div>
        <button type="button" className="op-btn-add" onClick={() => { resetForm(); setOpen(true) }}>
          <span className="ms" aria-hidden="true">add</span>{t('add')}
        </button>
      </div>

      {/* stat strip — real counts only */}
      <div className="op-card stat-strip">
        <div className="stat">
          <span className="lbl">{t('label')}s</span>
          <b>{establishments.length}</b>
        </div>
        {/* Publication truth (B2 follow-up): this counts PUBLISHED establishments
            (admin-gated isActive), not "open now" — the old « Ouverts maintenant »
            label was the same lie the shell badge dropped. Reuses the shell's
            operator status key so no new translation is needed. */}
        <div className="stat">
          <span className="lbl">{to('status.published')}</span>
          <b>{publishedCount}</b>
        </div>
      </div>

      {establishments.length === 0 ? (
        /* empty — no establishment yet */
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">storefront</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyDesc')}</span>
            <button type="button" className="op-btn-primary" onClick={() => { resetForm(); setOpen(true) }}>
              <span className="ms" aria-hidden="true">add</span>{t('add')}
            </button>
          </div>
        </div>
      ) : (
        /* loaded — clickable rows */
        <div className="op-card">
          {establishments.map((e) => {
            const current = e.id === currentId
            const dashboardLabel = t('openDashboard')
            const location = [e.city, e.address].filter(Boolean).join(' · ')
            return (
              <div key={e.id} className="est-list-row">
                {/* the whole row opens this establishment's HUB (brands & menus).
                    A stretched overlay link covers the row and sits BENEATH the
                    "Gérer" button, so the operational action stays distinct. */}
                <Link
                  href={`/dashboard/establishments/${e.id}`}
                  aria-label={t('openHubAria', { name: e.name })}
                  className="est-list-row__link"
                />
                <span
                  className="est-list-row__logo"
                  style={{ background: `linear-gradient(135deg,${gradFor(e.id)})` }}
                  aria-hidden="true"
                >
                  {initials(e.name)}
                </span>
                <div className="est-list-row__m">
                  <b>{e.name}</b>
                  <span>{location}</span>
                </div>
                <div className="est-list-row__badges">
                  {current && (
                    <span className="est-brand-badge">
                      <span className="ms" aria-hidden="true">check_circle</span>
                      {t('selectedChip')}
                    </span>
                  )}
                  {/* isActive = admin-gated PUBLICATION, not opening hours: label it
                      like the OperatorShell badge (B2) — « Publié / Non publié »,
                      never « Ouvert / Fermé ». Chip classes kept (cosmetic only). */}
                  <span className={`estab-openclosed ${e.isActive ? 'open' : 'closed'}`}>
                    <i className="dot" />
                    {e.isActive ? to('status.published') : to('status.unpublished')}
                  </span>
                </div>
                {/* "Gérer" — opens the hub too (settings icon, distinct click). */}
                <Link
                  href={`/dashboard/establishments/${e.id}`}
                  className="est-manage-btn"
                >
                  <span className="ms" aria-hidden="true">settings</span>{t('manageBtn')}
                </Link>
                {/* Compact "open dashboard" action — sets the active establishment
                    then navigates to /dashboard. Raised above the row link. */}
                <button
                  type="button"
                  onClick={() => openDashboardFor(e.id)}
                  disabled={pending && pendingId === e.id}
                  aria-label={dashboardLabel}
                  title={dashboardLabel}
                  className="est-manage-btn"
                >
                  {pending && pendingId === e.id ? (
                    <span className="op-spin" aria-hidden="true" />
                  ) : (
                    <span className="ms" aria-hidden="true">open_in_new</span>
                  )}
                  {dashboardLabel}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add-establishment modal ─────────────────────────────────────── */}
      {open && (
        <div className="op-modal__scrim" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="op-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="op-modal__head">
              <h2>{t('addTitle')}</h2>
              <button type="button" className="op-modal__x" onClick={() => setOpen(false)} aria-label={t('cancel')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <form onSubmit={submit} style={{ display: 'contents' }}>
              <div className="op-modal__body">
                {error && (
                  <div className="op-note op-note--danger">
                    <span className="ms" aria-hidden="true">error</span>
                    <span>{error}</span>
                  </div>
                )}

                <div className="op-field">
                  <label htmlFor="est-name">{t('fName')}</label>
                  <input
                    id="est-name"
                    className="op-input"
                    type="text"
                    value={name}
                    maxLength={120}
                    onChange={(ev) => setName(ev.target.value)}
                    placeholder={t('fNamePlaceholder')}
                  />
                </div>

                <div className="op-field-row">
                  <div className="op-field">
                    <label htmlFor="est-city">{t('fCity')}</label>
                    <input
                      id="est-city"
                      className="op-input"
                      type="text"
                      value={city}
                      maxLength={100}
                      onChange={(ev) => setCity(ev.target.value)}
                      placeholder={t('fCityPlaceholder')}
                    />
                  </div>
                  <div className="op-field">
                    <label htmlFor="est-addr">{t('fAddress')}</label>
                    <input
                      id="est-addr"
                      className="op-input"
                      type="text"
                      value={address}
                      maxLength={300}
                      onChange={(ev) => setAddress(ev.target.value)}
                      placeholder={t('fAddressPlaceholder')}
                    />
                  </div>
                </div>

                <div className="op-field">
                  <label>{t('fCuisine')}</label>
                  <div className="op-chip-grid">
                    {CUISINE_TYPES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setCuisineType(c.value)}
                        className={`op-chip${cuisineType === c.value ? ' on' : ''}`}
                      >
                        <span className="emo" aria-hidden="true">{c.emoji}</span>
                        <span>{tc(c.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="op-field">
                  <label htmlFor="est-desc">{t('fDescription')}</label>
                  <textarea
                    id="est-desc"
                    className="op-textarea"
                    value={description}
                    maxLength={2000}
                    onChange={(ev) => setDescription(ev.target.value)}
                    placeholder={t('fDescriptionPlaceholder')}
                    rows={3}
                  />
                </div>

                <div className="op-field">
                  <label htmlFor="est-logo">{t('fLogo')}</label>
                  <input
                    id="est-logo"
                    className="op-input"
                    type="url"
                    value={logo}
                    onChange={(ev) => setLogo(ev.target.value)}
                    placeholder={t('fLogoPlaceholder')}
                  />
                </div>
                <div className="op-field">
                  <label htmlFor="est-cover">{t('fCover')}</label>
                  <input
                    id="est-cover"
                    className="op-input"
                    type="url"
                    value={cover}
                    onChange={(ev) => setCover(ev.target.value)}
                    placeholder={t('fCoverPlaceholder')}
                  />
                  <span className="op-field__hint">{t('imageHint')}</span>
                </div>

                <div className="op-note op-note--info">
                  <span className="ms" aria-hidden="true">apartment</span>
                  <span>{t('createdHint')}</span>
                </div>
              </div>
              <div className="op-modal__foot">
                <button type="button" className="op-btn-ghost" onClick={() => setOpen(false)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="op-btn-primary" disabled={saving}>
                  {saving
                    ? <><span className="op-spin" aria-hidden="true" />{t('create')}</>
                    : t('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* inline toast */}
      {toast && (
        <div className={`op-note ${toast.kind === 'warn' ? 'op-note--warn' : 'op-note--info'}`} style={{ marginTop: 16 }} role="status">
          <span className="ms" aria-hidden="true">{toast.kind === 'warn' ? 'warning' : 'check_circle'}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </section>
  )
}
