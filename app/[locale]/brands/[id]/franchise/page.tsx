'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import './franchise.css'

// ── /brands/[id]/franchise — brand OWNER edits their franchise terms (B4, Agent 46) ─
// Edits Brand.{openToFranchise, royaltyPct, setupFee, franchiseZones, franchiseStatus}
// via GET/PATCH /api/brands/[id] (owner-scoped server-side — a non-owner gets 403/404).
// royaltyPct is stored as a FRACTION (0.06); the form works in PERCENT (6) and converts.
// Empty rate = null → the 6% default applies (same rate the accrual + dashboard resolve).
//
// 🔒 PRESENTATION-ONLY re-skin to the CD « Détail marque / franchise » (navy shell,
// --op-* tokens, Material Symbols). The GET load, the PATCH save, the field names in
// the body, and the PERCENT→FRACTION conversion (pct/100) are ALL byte-identical.

type FranchiseBrand = {
  id: string
  name?: string
  emoji?: string | null
  cuisineType?: string | null
  status?: string | null
  openToFranchise: boolean
  royaltyPct: number | null
  setupFee: number | null
  franchiseZones: string[]
  franchiseStatus: string
}

export default function BrandFranchisePage({ params }: { params: { id: string } }) {
  const t = useTranslations('brands.franchise')
  const locale = useLocale()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // header (display-only, loaded from the same GET)
  const [brandName, setBrandName] = useState('')
  const [brandEmoji, setBrandEmoji] = useState<string | null>(null)
  const [brandCuisine, setBrandCuisine] = useState<string | null>(null)
  const [brandStatus, setBrandStatus] = useState<string | null>(null)

  const [openToFranchise, setOpenToFranchise] = useState(false)
  const [royaltyInput, setRoyaltyInput] = useState('') // PERCENT string ('' = default 6%)
  const [setupFeeInput, setSetupFeeInput] = useState('')
  const [zonesInput, setZonesInput] = useState('')      // one zone per line
  const [franchiseStatus, setFranchiseStatus] = useState('none')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/brands/${params.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return
        const b = res?.brand as FranchiseBrand | undefined
        if (!b) { setLoadError(true); return }
        setBrandName(b.name || '')
        setBrandEmoji(b.emoji ?? null)
        setBrandCuisine(b.cuisineType ?? null)
        setBrandStatus(b.status ?? null)
        setOpenToFranchise(!!b.openToFranchise)
        setRoyaltyInput(b.royaltyPct == null ? '' : String(Math.round(b.royaltyPct * 1000) / 10)) // fraction → %
        setSetupFeeInput(b.setupFee == null ? '' : String(b.setupFee))
        setZonesInput(Array.isArray(b.franchiseZones) ? b.franchiseZones.join('\n') : '')
        setFranchiseStatus(b.franchiseStatus || 'none')
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [openToFranchise, royaltyInput, setupFeeInput, zonesInput, franchiseStatus])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false)

    // PERCENT → FRACTION; empty = null (default 6%). Validate 0–50%.
    let royaltyPct: number | null = null
    const rt = royaltyInput.trim()
    if (rt !== '') {
      const pct = Number(rt.replace(',', '.'))
      if (!Number.isFinite(pct) || pct < 0 || pct > 50) { setError(t('royaltyError')); return }
      royaltyPct = Math.round((pct / 100) * 1e6) / 1e6 // fraction, cent-of-a-percent precision
    }
    const sf = setupFeeInput.trim()
    const setupFee = sf === '' ? null : Number(sf.replace(',', '.'))
    if (setupFee != null && (!Number.isFinite(setupFee) || setupFee < 0)) { setError(t('errorGeneric')); return }
    const franchiseZones = zonesInput
      .split(/[\n,]/).map((z) => z.trim()).filter(Boolean).slice(0, 50)

    setSaving(true)
    try {
      const res = await fetch(`/api/brands/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openToFranchise, royaltyPct, setupFee, franchiseZones, franchiseStatus }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || t('errorGeneric')); return }
      setSaved(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  // header monogram: brand emoji if set, else initials from the name.
  const mono =
    brandEmoji?.trim()
      ? brandEmoji.trim()
      : (brandName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—')

  const isActive = brandStatus === 'active'

  // honest read-back of the SAVED zones (parsed the same way the save handler does).
  const savedZones = zonesInput.split(/[\n,]/).map((z) => z.trim()).filter(Boolean)

  return (
    <section className="fr-panel">
      <Link href="/brands" className="back-link">
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('brandsBack')}
      </Link>

      {loading ? (
        /* ── skeleton ── */
        <>
          <span className="op-sk" style={{ width: '100%', height: 104, borderRadius: 12, marginBottom: 18, display: 'block' }} />
          <span className="op-sk" style={{ width: '100%', height: 88, borderRadius: 12, marginBottom: 18, display: 'block' }} />
          <div className="op-card" style={{ marginBottom: 18 }}>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span className="op-sk" style={{ width: '100%', height: 56 }} />
              <span className="op-sk" style={{ width: '100%', height: 56 }} />
            </div>
          </div>
        </>
      ) : loadError ? (
        /* ── error ── */
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">cloud_off</span>
            <h2>{t('loadErrorTitle')}</h2>
            <p>{t('loadError')}</p>
            <Link href="/brands" className="op-btn-primary" style={{ textDecoration: 'none' }}>
              <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('brandsBack')}
            </Link>
          </div>
        </div>
      ) : (
        /* ── loaded ── */
        <>
          {/* brand header */}
          <div className="op-card fr-head">
            <span className="fr-mono">{mono}</span>
            <div className="fr-head__m">
              <div className="name-row">
                <h1>{brandName || t('title')}</h1>
                <span className={`brand-status ${isActive ? 'active' : 'draft'}`}>
                  <i className="dot" />{isActive ? t('statusActive') : t('statusDraft')}
                </span>
              </div>
              <span>{brandCuisine || t('cuisineUnset')}</span>
            </div>
          </div>

          {/* stat strip — franchise state at a glance */}
          <div className="op-card stat-strip">
            <div className="stat">
              <span className="lbl">{t('statOpenLabel')}</span>
              <b className="mono">{openToFranchise ? t('statOpenYes') : t('statOpenNo')}</b>
            </div>
            <div className="stat">
              <span className="lbl">{t('statZonesLabel')}</span>
              <b className="mono">{savedZones.length}</b>
            </div>
          </div>

          {/* single active tab — this route edits franchise conditions */}
          <div className="fr-tabs" role="tablist">
            <button type="button" className="is-active" role="tab" aria-selected="true">{t('tabFranchise')}</button>
          </div>

          {saved && (
            <div className="fr-banner success" role="status">
              <span className="ms" aria-hidden="true">check_circle</span>
              <div><b>{t('savedTitle')}</b><span>{t('savedBody')}</span></div>
            </div>
          )}

          <form onSubmit={save}>
            {error && (
              <p className="fr-inline-error" role="alert">{error}</p>
            )}

            {/* ── open to franchise ── */}
            <div className="op-card settings-block">
              <div className="settings-block__head"><h2>{t('sectionAvailability')}</h2></div>
              <div className="fr-toggle">
                <div className="m">
                  <b>{t('openLabel')}</b>
                  <span>{t('openHint')}</span>
                </div>
                <label className="op-switch">
                  <input type="checkbox" checked={openToFranchise} onChange={(e) => setOpenToFranchise(e.target.checked)} />
                  <span className="track" />
                </label>
              </div>
            </div>

            {/* ── conditions ── */}
            <div className="op-card settings-block">
              <div className="settings-block__head"><h2>{t('sectionTerms')}</h2></div>
              <div className="settings-block__body">
                <div className="op-field-row">
                  <div className="op-field">
                    <label htmlFor="fr-royalty">{t('royaltyLabel')}</label>
                    <input id="fr-royalty" className="op-input mono" type="number" inputMode="decimal"
                      min={0} max={50} step="0.1" value={royaltyInput}
                      onChange={(e) => setRoyaltyInput(e.target.value)} placeholder="6" />
                    <span className="hint">{t('royaltyHint')}</span>
                  </div>
                  <div className="op-field">
                    <label htmlFor="fr-setup">{t('setupFeeLabel')}</label>
                    <input id="fr-setup" className="op-input mono" type="number" inputMode="decimal"
                      min={0} step="1" value={setupFeeInput}
                      onChange={(e) => setSetupFeeInput(e.target.value)} placeholder="0" />
                    <span className="hint">{t('setupFeeHint')}</span>
                  </div>
                </div>

                <div className="op-field">
                  <label htmlFor="fr-status">{t('statusLabel')}</label>
                  <select id="fr-status" className="op-select" value={franchiseStatus} onChange={(e) => setFranchiseStatus(e.target.value)}>
                    <option value="none">{t('statusNone')}</option>
                    <option value="open">{t('statusOpen')}</option>
                    <option value="full">{t('statusFull')}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* ── zones ── */}
            <div className="op-card settings-block">
              <div className="settings-block__head"><h2>{t('sectionZones')}</h2></div>
              <div className="settings-block__body">
                <div className="op-field">
                  <label htmlFor="fr-zones">{t('zonesLabel')}</label>
                  <textarea id="fr-zones" className="op-textarea" rows={4} value={zonesInput}
                    onChange={(e) => setZonesInput(e.target.value)} placeholder={t('zonesPlaceholder')} />
                  <span className="hint">{t('zonesHint')}</span>
                </div>
              </div>
              {/* honest read-back of the CURRENT saved zones */}
              {savedZones.length > 0 ? (
                <div className="fr-zones">
                  {savedZones.map((z, i) => (
                    <span key={`${z}-${i}`} className="fr-zone-chip"><span className="ms" aria-hidden="true">place</span>{z}</span>
                  ))}
                </div>
              ) : (
                <div className="fr-zones-empty">{t('zonesEmpty')}</div>
              )}
            </div>

            {/* ── read-back preview (honest current values, mono figures) ── */}
            <div className="op-card settings-block">
              <div className="settings-block__head">
                <h2>{t('sectionReview')}</h2>
                <span className="sub">{t('reviewSub')}</span>
              </div>
              <div className="fr-review">
                <span className="k">{t('royaltyLabel')}</span>
                <span className="v mono">
                  {royaltyInput.trim() === '' ? t('royaltyDefault') : `${royaltyInput.trim().replace(',', '.')} %`}
                </span>
              </div>
              <div className="fr-review">
                <span className="k">{t('setupFeeLabel')}</span>
                <span className={`v mono${setupFeeInput.trim() === '' ? ' muted' : ''}`}>
                  {setupFeeInput.trim() === ''
                    ? t('setupFeeNone')
                    : (Number.isFinite(Number(setupFeeInput.replace(',', '.')))
                        ? formatEuros(Number(setupFeeInput.replace(',', '.')), locale)
                        : '—')}
                </span>
              </div>
              <div className="fr-review">
                <span className="k">{t('statusLabel')}</span>
                <span className="v">
                  {franchiseStatus === 'open' ? t('statusOpen') : franchiseStatus === 'full' ? t('statusFull') : t('statusNone')}
                </span>
              </div>
            </div>

            <div className="fr-savebar">
              <button type="submit" className="op-btn-primary" disabled={saving}>
                {saving ? <span className="ms" aria-hidden="true">progress_activity</span> : <span className="ms" aria-hidden="true">save</span>}
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}
