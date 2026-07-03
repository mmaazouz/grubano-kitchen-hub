'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import SupplierConnectCard from '@/components/supplier/SupplierConnectCard'
import './supplier-reglages.css'

// ── ReglagesClient — CD v1 Lot 6 (Réglages). RE-SKIN of the REAL supplier profile. ──
// Only the fields that PERSIST via PATCH /api/supplier/profile are editable; the
// identity block is read-only. SupplierConnectCard (gated payout onboarding) lives in
// the Versements section — its permanent home. Real logout via signOut. CD elements
// with NO backing column (logo, description, delivery-days, order-cutoff, VAT number,
// DAC7, team, notif prefs, in-place password change, account closure) are honest
// "bientôt" / omitted — never fabricated, no new field, no new route.

const CATEGORIES = ['fresh', 'meat', 'fish', 'dairy', 'drinks', 'grocery', 'packaging'] as const

type LoadedProfile = {
  companyName: string; contactName: string; phone: string; city: string
  categories: string[]; deliveryZones: string[]; minimumOrderEur: number
  leadTimeDays: number; paymentTerms: string
  siren: string | null; officialName: string | null
  verificationStatus: string | null; status: string
}

export default function ReglagesClient({ connectEnabled, payoutStatus }: { connectEnabled: boolean; payoutStatus: string }) {
  const t  = useTranslations('supplierSettings')
  const ts = useTranslations('supplier')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [zones, setZones] = useState('')
  const [minOrder, setMinOrder] = useState('')
  const [leadTime, setLeadTime] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [locked, setLocked] = useState<Pick<LoadedProfile, 'siren' | 'officialName' | 'verificationStatus' | 'status'> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/supplier/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const p = d?.profile as LoadedProfile | undefined
        if (!p) { setLoadError(true); return }
        setCompanyName(p.companyName ?? ''); setContactName(p.contactName ?? '')
        setPhone(p.phone ?? ''); setCity(p.city ?? '')
        setCategories(Array.isArray(p.categories) ? p.categories : [])
        setZones((p.deliveryZones ?? []).join(', '))
        setMinOrder(String(p.minimumOrderEur ?? 0)); setLeadTime(String(p.leadTimeDays ?? 1))
        setPaymentTerms(p.paymentTerms ?? '')
        setLocked({ siren: p.siren, officialName: p.officialName, verificationStatus: p.verificationStatus, status: p.status })
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const catLabel = (c: string) => ts(`cat${c.charAt(0).toUpperCase()}${c.slice(1)}` as 'catFresh')
  const toggleCategory = (c: string) => setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  const verifLabel = (v: string | null) => v === 'verified' ? ts('verifVerified') : v === 'review' ? ts('verifReview') : v === 'rejected' ? ts('verifRejected') : ts('verifNone')
  const statusLabel = (s: string) => s === 'active' ? ts('statusActive') : s === 'suspended' ? ts('statusSuspended') : s === 'rejected' ? ts('statusRejected') : ts('statusPending')

  async function save() {
    if (saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      const res = await fetch('/api/supplier/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName, contactName,
          phone: phone || undefined, city: city || undefined,
          categories,
          deliveryZones: zones.split(',').map((z) => z.trim()).filter(Boolean),
          minimumOrderEur: Number(minOrder) || 0,
          leadTimeDays: Number(leadTime) || 0,
          paymentTerms: paymentTerms || undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || ts('errorGeneric')); return }
      setSaved(true); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { setError(ts('errorGeneric')) }
    finally { setSaving(false) }
  }

  if (loading) {
    return <section className="sup-set"><div className="op-card"><div className="op-emptyline"><span className="ms">settings</span><b>{t('loading')}</b></div></div></section>
  }
  if (loadError) {
    return <section className="sup-set"><div className="op-card"><div className="op-emptyline"><span className="ms">cloud_off</span><b>{t('loadError')}</b></div></div></section>
  }

  return (
    <section className="sup-set">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{companyName}</p>
      </div>

      {saved && <div className="save-banner"><span className="ms">check_circle</span><b>{t('saved')}</b></div>}

      {/* 1. Profil public (real editable) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">storefront</span></span>
          <div className="m"><h2>{t('publicTitle')}</h2><p>{t('publicSub')}</p></div>
        </div>
        <div className="set-card__body">
          {error && <div className="form-err">{error}</div>}
          <div className="op-field"><label>{t('fName')}</label><input className="op-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
          <div className="op-field-row">
            <div className="op-field"><label>{t('fContact')}</label><input className="op-input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="op-field"><label>{t('fPhone')}</label><input className="op-input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div className="op-field"><label>{t('fCity')}</label><input className="op-input" value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div className="op-field">
            <label>{t('fCategories')}</label>
            <div className="chip-row">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className={`chip${categories.includes(c) ? ' is-active' : ''}`} onClick={() => toggleCategory(c)}>{catLabel(c)}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="set-card__foot"><button className="op-btn-primary" onClick={save} disabled={saving}><span className="ms">check</span>{saving ? ts('saving') : ts('save')}</button></div>
      </div>

      {/* 2. Livraison & commandes (real editable) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">local_shipping</span></span>
          <div className="m"><h2>{t('deliveryTitle')}</h2><p>{t('deliverySub')}</p></div>
        </div>
        <div className="set-card__body">
          <div className="op-field"><label>{t('fZones')}</label><input className="op-input" value={zones} onChange={(e) => setZones(e.target.value)} placeholder="Lyon, Villeurbanne, 69003" /></div>
          <div className="op-field-row">
            <div className="op-field"><label>{t('fLeadTime')}</label><input className="op-input" type="number" inputMode="numeric" min={0} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} /></div>
            <div className="op-field"><label>{t('fMinOrder')}</label><input className="op-input mono" type="number" inputMode="numeric" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} /></div>
          </div>
          <div className="op-field"><label>{t('fPaymentTerms')}</label><textarea className="op-textarea" maxLength={500} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} /></div>
        </div>
        <div className="set-card__foot"><button className="op-btn-primary" onClick={save} disabled={saving}><span className="ms">check</span>{saving ? ts('saving') : ts('save')}</button></div>
      </div>

      {/* 3. Informations légales (real, read-only) */}
      {locked && (
        <div className="op-card set-card">
          <div className="set-card__head"><span className="ic"><span className="ms">gavel</span></span>
            <div className="m"><h2>{t('legalTitle')}</h2><p>{t('legalSub')}</p></div>
          </div>
          <div className="set-card__body" style={{ gap: 0 }}>
            <div className="legal-row"><div className="m"><b>{t('legalOfficialName')}</b><div className="legal-val txt">{locked.officialName || ts('verifNone')}</div></div></div>
            <div className="legal-row"><div className="m"><b>{t('legalSiren')}</b><div className="legal-val">{locked.siren || ts('verifNone')}</div></div></div>
            <div className="legal-row"><div className="m"><b>{t('legalVerification')}</b><div className="legal-val txt">{verifLabel(locked.verificationStatus)}</div></div>
              <span className={`legal-badge${locked.verificationStatus === 'verified' ? ' ok' : locked.verificationStatus === 'rejected' ? ' warn' : ''}`}>{verifLabel(locked.verificationStatus)}</span></div>
            <div className="legal-row"><div className="m"><b>{t('legalStatus')}</b><div className="legal-val txt">{statusLabel(locked.status)}</div></div>
              <span className={`legal-badge${locked.status === 'active' ? ' ok' : locked.status === 'suspended' || locked.status === 'rejected' ? ' warn' : ''}`}>{statusLabel(locked.status)}</span></div>
          </div>
        </div>
      )}

      {/* 4. Versements — SupplierConnectCard's permanent home (real, gated) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">account_balance</span></span>
          <div className="m"><h2>{t('payoutTitle')}</h2><p>{t('payoutSub')}</p></div>
        </div>
        <div className="set-card__body">
          <SupplierConnectCard enabled={connectEnabled} initialStatus={payoutStatus} />
        </div>
      </div>

      {/* 5. Équipe — honest "bientôt" (no team model) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">groups</span></span>
          <div className="m"><h2>{t('teamTitle')}</h2><p>{t('teamSub')}</p></div>
        </div>
        <div className="bientot"><span className="ms">group_add</span><div className="m"><b>{t('teamSoonTitle')}</b><span>{t('teamSoonBody')}</span></div><span className="pill">{t('soon')}</span></div>
      </div>

      {/* 6. Notifications — honest "bientôt" (no supplier notif prefs) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">notifications</span></span>
          <div className="m"><h2>{t('notifTitle')}</h2><p>{t('notifSub')}</p></div>
        </div>
        <div className="bientot"><span className="ms">tune</span><div className="m"><b>{t('notifSoonTitle')}</b><span>{t('notifSoonBody')}</span></div><span className="pill">{t('soon')}</span></div>
      </div>

      {/* 7. Sécurité — real logout; password reset via the login flow (no authed change endpoint) */}
      <div className="op-card set-card">
        <div className="set-card__head"><span className="ic"><span className="ms">lock</span></span>
          <div className="m"><h2>{t('secTitle')}</h2><p>{t('secSub')}</p></div>
        </div>
        <div className="set-card__body">
          <p className="sec-note">{t('secPasswordNote')}</p>
          <div className="sec-actions"><button className="op-btn-ghost" onClick={() => signOut({ callbackUrl: '/eat/auth' })}><span className="ms">logout</span>{t('logout')}</button></div>
        </div>
      </div>

      {/* 8. Zone dangereuse — honest "bientôt" (no account-closure endpoint) */}
      <div className="op-card set-card danger-card">
        <div className="set-card__head"><span className="ic"><span className="ms">warning</span></span>
          <div className="m"><h2>{t('dangerTitle')}</h2><p>{t('dangerSub')}</p></div>
        </div>
        <div className="set-card__body">
          <p className="danger-text">{t('dangerBody')}</p>
          <div><button className="op-btn-danger" disabled><span className="ms">delete_forever</span>{t('dangerClose')} — {t('soon')}</button></div>
        </div>
      </div>
    </section>
  )
}
