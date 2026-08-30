'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { isPlausibleAddress } from '@/lib/geocode'
import { isNumericOnly, normalizeFrenchPostalCode } from '@/lib/address-validation'

// ── <AddressSection /> — post-onboarding address edit (B3, beta-truth train) ──
//
// The human rehearsal proved an operator who mistyped the address at onboarding
// (real case: city="30210" / postalCode="Fournès") had NO way to fix it — the
// establishment page had no address section. This section closes that trap.
//
// Consumes the EXISTING owner-scoped PATCH /api/restaurants/[id] (same route as
// the site/logo prefill imports — authorization untouched). The server:
//   • enforces strict-France validation (address plausible, CP = 5 digits,
//     city non-numeric) with reason codes mapped to i18n messages here;
//   • re-geocodes via the IGN/BAN mechanism and persists the new coords
//     ATOMICALLY with the address — a geocode miss stores lat/lng = null (never
//     obsolete coords) and comes back as geocodeStatus ≠ 'ok', surfaced here
//     with the existing onboarding geoWarnNotFound wording.
//
// Presentation mirrors the sibling embedded sections (settings-block card,
// op-field/op-input, Material Symbols, op-note feedback). No new UI library.

export default function AddressSection({
  restaurantId,
  initialAddress,
  initialCity,
  onSaved,
}: {
  restaurantId:   string
  initialAddress: string
  initialCity:    string
  onSaved?:       (next: { address: string; city: string }) => void
}) {
  const t   = useTranslations('dashboard.hub.addr')
  const tOb = useTranslations('business.onboarding')

  const [address,    setAddress]    = useState(initialAddress)
  const [postalCode, setPostalCode] = useState('')
  const [city,       setCity]       = useState(initialCity)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [saved,      setSaved]      = useState(false)
  const [geoWarn,    setGeoWarn]    = useState(false)

  // Any edit clears the previous outcome so the feedback always reflects the
  // CURRENT form content, never a stale save.
  function touch() {
    setSaved(false)
    setGeoWarn(false)
    setError('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const cleanAddress = address.trim()
    const cleanPostal  = postalCode.trim()
    const cleanCity    = city.trim()

    // Client-side mirror of the server's strict-France rules — the server
    // re-checks everything (source of truth); this only gives instant feedback.
    if (!cleanAddress || !cleanPostal || !cleanCity) {
      setError(t('errRequired'))
      return
    }
    if (!isPlausibleAddress(cleanAddress)) {
      setError(tOb('errAddressInvalid'))
      return
    }
    // Shared Unicode-aware rules (lib/address-validation) — the SAME functions
    // the server runs, so this mirror can never drift from the API's verdict
    // (fullwidth "３０２１０" or Arabic-Indic digits included).
    if (normalizeFrenchPostalCode(cleanPostal) === null) {
      setError(t('errPostalCode'))
      return
    }
    if (isNumericOnly(cleanCity)) {
      setError(t('errCity'))
      return
    }

    setError('')
    setSaved(false)
    setGeoWarn(false)
    setSaving(true)
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address:    cleanAddress,
          city:       cleanCity,
          postalCode: cleanPostal,
        }),
      })
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        const reason = d?.reason as string | undefined
        setError(
          reason === 'invalid_address'       ? tOb('errAddressInvalid')
          : reason === 'invalid_postal_code' ? t('errPostalCode')
          : reason === 'invalid_city'        ? t('errCity')
          : (d?.error as string) || t('errSaveFailed'),
        )
        return
      }
      setSaved(true)
      // Honest geocode feedback: anything but 'ok' means the establishment is
      // saved WITHOUT map coords (out of the proximity sort until fixed) —
      // EXCEPT when the server kept the existing coords (coordsKept: unchanged
      // address + third-party geocoder outage): warning there would be the lie.
      if (d?.geocodeStatus !== 'ok' && d?.coordsKept !== true) setGeoWarn(true)
      onSaved?.({ address: cleanAddress, city: cleanCity })
    } catch {
      setError(tOb('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="op-card settings-block">
      <div className="settings-block__head"><h2>{t('title')}</h2></div>
      <form onSubmit={save} className="settings-block__body">
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--op-muted)' }}>
          {t('desc')}
        </p>

        <div className="op-field">
          <label htmlFor="estab-addr-street">{tOb('addressLabel')}</label>
          <input
            id="estab-addr-street"
            className="op-input"
            type="text"
            value={address}
            maxLength={300}
            placeholder={tOb('addressPlaceholder')}
            onChange={(e) => { setAddress(e.target.value); touch() }}
            autoComplete="street-address"
          />
        </div>

        <div className="op-field-row">
          <div className="op-field">
            <label htmlFor="estab-addr-postal">{tOb('postalCodeLabel')}</label>
            <input
              id="estab-addr-postal"
              className="op-input"
              type="text"
              inputMode="numeric"
              value={postalCode}
              maxLength={5}
              placeholder={tOb('postalCodePlaceholder')}
              onChange={(e) => { setPostalCode(e.target.value); touch() }}
              autoComplete="postal-code"
            />
          </div>
          <div className="op-field">
            <label htmlFor="estab-addr-city">{tOb('cityLabel')}</label>
            <input
              id="estab-addr-city"
              className="op-input"
              type="text"
              value={city}
              maxLength={100}
              placeholder={tOb('cityPlaceholder')}
              onChange={(e) => { setCity(e.target.value); touch() }}
              autoComplete="address-level2"
            />
          </div>
        </div>

        {error && (
          <div className="op-note op-note--danger" role="alert">
            <span className="ms" aria-hidden="true">error</span>
            <span>{error}</span>
          </div>
        )}

        {saved && !geoWarn && (
          <div className="op-note op-note--info" role="status">
            <span className="ms" aria-hidden="true">check_circle</span>
            <span>{t('saved')}</span>
          </div>
        )}

        {saved && geoWarn && (
          <div className="op-note op-note--warn" role="alert">
            <span className="ms" aria-hidden="true">warning</span>
            <span>{tOb('geoWarnNotFound')}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="op-btn-primary" disabled={saving}>
            {saving
              ? <><span className="op-spin" aria-hidden="true" />{t('save')}</>
              : <><span className="ms" aria-hidden="true">save</span>{t('save')}</>}
          </button>
        </div>
      </form>
    </div>
  )
}
