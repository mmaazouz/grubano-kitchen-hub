'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'

// ── CourierJustificatifs — the courier's compliance declaration (Agent 125 · LO1 re-skin) ──
// Rendered INSIDE the LO1 dashboard "Mes justificatifs" card (so it renders the declaration form
// ONLY — no outer card/title). A STRUCTURED DECLARATION (insurance + RC Pro; SIRET was collected at
// signup) — no file upload. Submitting marks the declaration 'submitted'; it does NOT activate the
// account — an admin verifies + activates, and ONLY when the activation flag is ON (waitlist
// guardrail). NO money. Owner-scoped via the session. Styled with --op- .decl-* classes.

interface State {
  status: string; accountStatus: string
  insuranceInsurer: string; insurancePolicyNumber: string; insuranceExpiry: string
  rcProInsurer: string; rcProPolicyNumber: string
}

export default function CourierJustificatifs() {
  const t = useTranslations('business.logistics.justificatifs')
  const [s, setS] = useState<State | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/justificatifs', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (data?.ok) setS(data.justificatifs as State)
      else setS(null)
    } catch { setS(null) }
  }, [])
  useEffect(() => { void load() }, [load])

  const set = (k: keyof State) => (e: { target: { value: string } }) =>
    setS((prev) => (prev ? { ...prev, [k]: e.target.value } : prev))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!s) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/logistics/justificatifs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insuranceInsurer: s.insuranceInsurer, insurancePolicyNumber: s.insurancePolicyNumber,
          insuranceExpiry: s.insuranceExpiry, rcProInsurer: s.rcProInsurer, rcProPolicyNumber: s.rcProPolicyNumber,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setError(data?.error || t('errorGeneric')); return }
      setSaved(true); setS((prev) => (prev ? { ...prev, status: 'submitted' } : prev))
    } catch { setError(t('errorGeneric')) } finally { setSaving(false) }
  }

  if (!s) return null

  const verified = s.status === 'verified'

  return (
    <>
      {saved && <div className="decl__msg ok">{t('savedTitle')} — {t('savedBody')}</div>}
      {error && <div className="decl__msg err">{error}</div>}

      <form onSubmit={submit}>
        <fieldset className="decl__fs" disabled={verified}>
          <div className="decl__lg">{t('insuranceLegend')}</div>
          <div className="decl__grid">
            <div className="decl__f">
              <label>{t('insurerLabel')}</label>
              <input value={s.insuranceInsurer} onChange={set('insuranceInsurer')} required minLength={2} maxLength={120} />
            </div>
            <div className="decl__f">
              <label>{t('policyLabel')}</label>
              <input value={s.insurancePolicyNumber} onChange={set('insurancePolicyNumber')} required minLength={2} maxLength={80} />
            </div>
          </div>
          <div className="decl__f" style={{ marginTop: 12 }}>
            <label>{t('expiryLabel')}</label>
            <input type="date" value={s.insuranceExpiry} onChange={set('insuranceExpiry')} required />
          </div>
        </fieldset>

        <fieldset className="decl__fs" disabled={verified}>
          <div className="decl__lg">{t('rcProLegend')}</div>
          <div className="decl__grid">
            <div className="decl__f">
              <label>{t('rcProInsurerLabel')}</label>
              <input value={s.rcProInsurer} onChange={set('rcProInsurer')} required minLength={2} maxLength={120} />
            </div>
            <div className="decl__f">
              <label>{t('rcProNumberLabel')}</label>
              <input value={s.rcProPolicyNumber} onChange={set('rcProPolicyNumber')} required minLength={2} maxLength={80} />
            </div>
          </div>
        </fieldset>

        <p className="decl__note">{t('note')}</p>

        {!verified && (
          <button type="submit" className="op-btn-primary" disabled={saving}>
            <span className="ms">{saving ? 'progress_activity' : 'shield'}</span>
            {saving ? t('submitting') : t('submit')}
          </button>
        )}
      </form>
    </>
  )
}
