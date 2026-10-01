'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import './franchise-parametres.css'

// ── FR6 · Paramètres franchiseur (CD Vague 3) ────────────────────────────────────
// Rendered inside FranchiseShell. Only the REAL editable surface is a form: the Operator
// account's name/phone/city (whitelist PATCH /api/franchise/profile). The royalty rate +
// legal identity (officialName/SIREN) are REAL but READ-ONLY. Everything the maquette adds
// with no backing — multi-member team, notif toggles, entry-fee/term, "close network" — is
// BUILD-NEW → titulaire-only / omitted / disabled "bientôt" (never an input that saves
// nowhere). Real sign-out. Owner-scoped server-side.

type Profile = {
  name: string; phone: string; city: string; email: string; status: string
  ratePct: number | null; officialName: string | null; siren: string | null
}

const INITIALS = (s: string) =>
  (s.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '–').toUpperCase()
const maskEmail = (e: string) => {
  const [u, d] = e.split('@')
  return d ? `${(u ?? '').slice(0, 1)}***@${d}` : e
}

export default function FranchiseParametresPage() {
  const t = useTranslations('franchise.settings')
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/franchise/profile', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(res => {
        if (!alive) return
        const pr = res?.profile as Profile | undefined
        if (!pr) { setError(true); return }
        setP(pr); setName(pr.name ?? ''); setPhone(pr.phone ?? ''); setCity(pr.city ?? '')
      })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setSaved(false); setSaveErr('')
    try {
      const res = await fetch('/api/franchise/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: phone || undefined, city: city || undefined }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setSaveErr(d?.error || t('errorGeneric')); return }
      setSaved(true)
    } catch { setSaveErr(t('errorGeneric')) }
    finally { setSaving(false) }
  }

  const statusLabel = (s: string) => (s === 'active' ? t('statusActive') : s === 'suspended' ? t('statusSuspended') : t('statusPending'))

  if (!p && !error) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 200, height: 26, marginBottom: 18 }} />
        <span className="op-sk" style={{ width: '100%', height: 180, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12, display: 'block' }} />
      </section>
    )
  }

  if (error || !p) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{t('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  return (
    <section>
      <div className="fr-narrow">
        <div className="op-dash__head" style={{ display: 'block' }}>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>

        {/* Identité — the ONLY editable form (real whitelist PATCH) */}
        <form className="op-card set-card" onSubmit={save}>
          <div className="set-hd">
            <span className="ic"><span className="ms" aria-hidden="true">badge</span></span>
            <div className="set-hd__t"><b>{t('identityTitle')}</b><span>{t('identitySub')}</span></div>
          </div>
          <div className="set-body">
            <div className="field">
              <label className="field__label" htmlFor="fr-name">{t('fieldName')}</label>
              <input id="fr-name" className="inp" type="text" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="row2">
              <div className="field">
                <label className="field__label" htmlFor="fr-phone">{t('fieldPhone')}</label>
                <input id="fr-phone" className="inp" type="text" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="fr-city">{t('fieldCity')}</label>
                <input id="fr-city" className="inp" type="text" value={city} onChange={e => setCity(e.target.value)} />
              </div>
            </div>
          </div>
          {saveErr && <div className="set-err" role="alert">{saveErr}</div>}
          <div className="set-foot">
            {saved && <span className="saved"><span className="ms" aria-hidden="true">check_circle</span>{t('savedTitle')}</span>}
            <button className="op-btn-primary" type="submit" disabled={saving}>
              <span className="ms" aria-hidden="true">save</span>{saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>

        {/* Conditions de franchise — READ-ONLY (real rate; entry-fee/term are BUILD-NEW → omitted) */}
        <div className="op-card set-card">
          <div className="set-hd">
            <span className="ic"><span className="ms" aria-hidden="true">gavel</span></span>
            <div className="set-hd__t"><b>{t('conditionsTitle')}</b><span>{t('conditionsSub')}</span></div>
          </div>
          <div className="set-body">
            <div className="field">
              <div className="field__label">{t('rateLabel')} <span className="ro"><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</span></div>
              <input className="inp" type="text" value={p.ratePct != null ? t('rateValue', { pct: p.ratePct }) : '—'} readOnly />
              <div className="field__hint"><span className="ms" aria-hidden="true">info</span><span>{t('rateHint')}</span></div>
            </div>
          </div>
        </div>

        {/* Informations légales — READ-ONLY (KYB, admin-set). Omitted entirely if none. */}
        {(p.officialName || p.siren) && (
          <div className="op-card set-card">
            <div className="set-hd">
              <span className="ic"><span className="ms" aria-hidden="true">description</span></span>
              <div className="set-hd__t"><b>{t('legalTitle')}</b><span>{t('legalSub')}</span></div>
            </div>
            <div className="set-body">
              {p.officialName && (
                <div className="field">
                  <div className="field__label">{t('legalCompany')} <span className="ro"><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</span></div>
                  <input className="inp" type="text" value={p.officialName} readOnly />
                </div>
              )}
              {p.siren && (
                <div className="field">
                  <div className="field__label">{t('legalSiren')} <span className="ro"><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</span></div>
                  <input className="inp mono" type="text" value={p.siren} readOnly />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Équipe réseau — the REAL titulaire only. Multi-member + invite = BUILD-NEW → "bientôt". */}
        <div className="op-card set-card">
          <div className="set-hd">
            <span className="ic"><span className="ms" aria-hidden="true">groups</span></span>
            <div className="set-hd__t"><b>{t('teamTitle')}</b><span>{t('teamSub')}</span></div>
          </div>
          <div className="set-body">
            <div className="mem">
              <span className="mem__av">{INITIALS(p.name || p.email)}</span>
              <div className="mem__m"><b>{p.name || '—'}</b><span>{maskEmail(p.email)}</span></div>
              <span className="mem__role">{t('roleOwner')}</span>
            </div>
            <div style={{ marginTop: 14 }}>
              <span className="op-soon"><span className="ms" aria-hidden="true">person_add</span>{t('inviteMember')}<span className="tag">{t('soon')}</span></span>
            </div>
          </div>
        </div>

        {/* Compte — locked (login e-mail + status, read-only) */}
        <div className="op-card set-card">
          <div className="set-hd">
            <span className="ic"><span className="ms" aria-hidden="true">manage_accounts</span></span>
            <div className="set-hd__t"><b>{t('accountTitle')}</b><span>{t('accountSub')}</span></div>
          </div>
          <div className="set-body">
            <div className="field">
              <div className="field__label">{t('lockedEmail')} <span className="ro"><span className="ms" aria-hidden="true">lock</span>{t('readOnly')}</span></div>
              <input className="inp" type="text" value={p.email} readOnly />
            </div>
            <div className="field">
              <div className="field__label">{t('lockedStatus')}</div>
              <input className="inp" type="text" value={statusLabel(p.status)} readOnly />
            </div>
          </div>
          <div className="set-foot">
            <button className="op-btn-ghost" type="button" onClick={() => signOut({ callbackUrl: '/franchise' })}>
              <span className="ms" aria-hidden="true">logout</span>{t('signOut')}
            </button>
          </div>
        </div>

        {/* Zone sensible — "close network" is BUILD-NEW → disabled "bientôt" (no fake destructive action) */}
        <div className="op-card set-card danger-card">
          <div className="set-hd">
            <span className="ic"><span className="ms" aria-hidden="true">warning</span></span>
            <div className="set-hd__t"><b>{t('dangerTitle')}</b><span>{t('dangerSub')}</span></div>
          </div>
          <div className="set-body">
            <div className="danger-row">
              <div className="m"><b>{t('closeNetwork')}</b><span>{t('closeNetworkDesc')}</span></div>
              <span className="op-soon"><span className="ms" aria-hidden="true">delete</span>{t('closeNetwork')}<span className="tag">{t('soon')}</span></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
