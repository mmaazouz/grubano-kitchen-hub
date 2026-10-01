'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { signOut } from 'next-auth/react'
import { usePathname, useRouter } from '@/navigation'
import type { Locale } from '@/i18n'

// ── LogisticsProfileForm — the courier's EDITABLE profile (LO3). ──────────────
// ⭐ Unlike the affiliate settings (AF6, all read-only), the courier profile IS editable via the
// REAL owner-scoped whitelist PATCH /api/logistics/profile (contactName/contactPhone/
// missionTypes/vehicleTypes/zones). Identity keys (email/SIREN/officialName/verificationStatus/
// status/partnerType) are DISPLAY-ONLY — the PATCH strips them (audit §5) — but partnerType is
// still sent unchanged (the schema requires it). Distance-max / time-slots are OMITTED (no schema
// column — no field without backing). Payout + close-account are INERT ("bientôt"). Language is a
// real i18n switch; sign-out is real. NO money. Owner-scoped. RE-SKIN 0 migration.

type Phase = 'wait' | 'active' | 'pending' | 'rejected' | 'suspended'
interface Initial {
  partnerType: string; contactName: string; contactPhone: string
  missionTypes: string[]; vehicleTypes: string[]; zones: string[]
  siren: string | null; officialName: string | null; verificationStatus: string | null; status: string
}

const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const
const MISSION_LABEL: Record<string, string> = { repas: 'missionRepas', produits_fournisseurs: 'missionProduits', b2b: 'missionB2b', froid: 'missionFroid' }
const VEHICLE_LABEL: Record<string, string> = { velo: 'vehicleVelo', scooter: 'vehicleScooter', voiture: 'vehicleVoiture', camionnette: 'vehicleCamionnette', frigorifique: 'vehicleFrigorifique' }
const MISSION_ICON: Record<string, string> = { repas: 'restaurant', produits_fournisseurs: 'local_grocery_store', b2b: 'local_shipping', froid: 'ac_unit' }
const VEHICLE_ICON: Record<string, string> = { velo: 'pedal_bike', scooter: 'two_wheeler', voiture: 'directions_car', camionnette: 'local_shipping', frigorifique: 'ac_unit' }
const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English', es: 'Español', it: 'Italiano', ar: 'العربية' }
const LOCALE_ORDER: readonly Locale[] = ['fr', 'en', 'es', 'it', 'ar']
const BADGE_ICON: Record<Phase, string> = { wait: 'hourglass_top', active: 'check_circle', pending: 'fact_check', rejected: 'cancel', suspended: 'block' }

function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return ((p.length >= 2 ? (p[0][0] ?? '') + (p[1][0] ?? '') : name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2)) || 'L').toUpperCase()
}

export default function LogisticsProfileForm({
  email, createdAtISO, phase, initial,
}: { email: string; createdAtISO: string; phase: Phase; initial: Initial }) {
  const t = useTranslations('business.logistics.profilUi')
  const tl = useTranslations('business.logistics')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const nameParts = initial.contactName.trim().split(/\s+/)
  const [firstName, setFirstName] = useState(nameParts[0] ?? '')
  const [lastName, setLastName] = useState(nameParts.slice(1).join(' '))
  const [phone, setPhone] = useState(initial.contactPhone)
  const [missionTypes, setMissionTypes] = useState<string[]>(initial.missionTypes)
  const [vehicleTypes, setVehicleTypes] = useState<string[]>(initial.vehicleTypes)
  const [zones, setZones] = useState<string[]>(initial.zones)
  const [zoneInput, setZoneInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const displayName = `${firstName} ${lastName}`.trim() || initial.contactName
  const since = (() => { try { return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(createdAtISO)) } catch { return '' } })()
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  function changeLocale(next: Locale) {
    if (next === locale) return
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`
    router.replace(pathname, { locale: next })
  }

  function addZone() {
    const z = zoneInput.trim()
    if (!z || zones.includes(z)) { setZoneInput(''); return }
    setZones((prev) => [...prev, z]); setZoneInput('')
  }

  // Every card's "Enregistrer" persists the FULL operational state (the whitelist PATCH is
  // all-or-nothing). Identity/email are never sent. partnerType is sent unchanged (schema-required).
  async function save() {
    if (saving) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/logistics/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerType: initial.partnerType,
          contactName: `${firstName} ${lastName}`.trim(),
          contactPhone: phone || undefined,
          missionTypes,
          vehicleTypes,
          zones,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setMsg({ ok: false, text: data?.error || t('errorGeneric') }); return }
      setMsg({ ok: true, text: t('saved') })
    } catch { setMsg({ ok: false, text: t('errorGeneric') }) } finally { setSaving(false) }
  }

  const verifBadge = () => {
    const v = initial.verificationStatus
    if (v === 'verified') return <span className="kyb-badge ok"><span className="ms">check</span>{t('verifVerified')}</span>
    if (v === 'review') return <span className="kyb-badge pending"><span className="ms">schedule</span>{t('verifPending')}</span>
    if (v === 'rejected') return <span className="kyb-badge none"><span className="ms">block</span>{t('verifRejected')}</span>
    return <span className="kyb-badge none">{t('verifNone')}</span>
  }
  const accountStatusLabel = () => ({ wait: t('statusWaitlist'), active: t('statusActive'), pending: t('statusPending'), rejected: t('statusRejected'), suspended: t('statusSuspended') } as Record<Phase, string>)[phase]

  const foot = (
    <div className="set-foot">
      {msg && <span className={msg.ok ? 'saved' : 'err'}>{msg.ok && <span className="ms">check</span>}{msg.text}</span>}
      <button type="button" className="op-btn-primary" disabled={saving} onClick={save}>
        <span className="ms">save</span>{saving ? t('saving') : t('save')}
      </button>
    </div>
  )

  return (
    <section>
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{t('subtitle')}</p>
      </div>

      <div className="op-card pf-hero">
        <span className="pf-hero__av">{initialsOf(displayName)}</span>
        <div className="pf-hero__m"><h1>{displayName}</h1><p>{t('heroRole')}{since ? ` · ${t('heroSince', { date: since })}` : ''}</p></div>
        <span className={`pf-hero__badge ${phase}`}><span className="ms">{BADGE_ICON[phase]}</span>{accountStatusLabel()}</span>
      </div>

      {/* CONTACT (editable) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">contact_page</span></span>
          <div className="set-hd__t"><b>{t('contactTitle')}</b><span>{t('contactSub')}</span></div>
          <span className="set-hd__edit editable"><span className="ms">edit</span>{t('editable')}</span>
        </div>
        <div className="set-body">
          <div className="row2">
            <div className="field"><div className="field__label">{t('firstName')}</div><input className="inp" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div className="field"><div className="field__label">{t('lastName')}</div><input className="inp" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          </div>
          <div className="row2">
            <div className="field"><div className="field__label">{t('phone')}</div><input className="inp mono" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="field">
              <div className="field__label">{t('email')}</div>
              <input className="inp mono" type="email" value={email} readOnly />
              <div className="field__hint">{t('emailHint')}</div>
            </div>
          </div>
        </div>
        {foot}
      </div>

      {/* MISSION PREFERENCES (editable) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">tune</span></span>
          <div className="set-hd__t"><b>{t('prefTitle')}</b><span>{t('prefSub')}</span></div>
          <span className="set-hd__edit editable"><span className="ms">edit</span>{t('editable')}</span>
        </div>
        <div className="set-body">
          <div className="field no-bd">
            <div className="field__label">{t('missionTypesLabel')}</div>
            <div className="chips">
              {MISSION_TYPES.map((m) => (
                <span key={m} className={`chip${missionTypes.includes(m) ? ' on' : ''}`} onClick={() => toggle(missionTypes, setMissionTypes, m)}>
                  <span className="ms">{MISSION_ICON[m]}</span>{tl(MISSION_LABEL[m] as 'missionRepas')}
                </span>
              ))}
            </div>
            <div className="field__hint">{t('prefSoonHint')}</div>
          </div>
        </div>
        {foot}
      </div>

      {/* VEHICLES (editable) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">two_wheeler</span></span>
          <div className="set-hd__t"><b>{t('vehTitle')}</b><span>{t('vehSub')}</span></div>
          <span className="set-hd__edit editable"><span className="ms">edit</span>{t('editable')}</span>
        </div>
        <div className="set-body">
          <div className="field no-bd">
            <div className="field__label">{t('vehLabel')}</div>
            <div className="chips">
              {VEHICLE_TYPES.map((v) => (
                <span key={v} className={`chip${vehicleTypes.includes(v) ? ' on' : ''}`} onClick={() => toggle(vehicleTypes, setVehicleTypes, v)}>
                  <span className="ms">{VEHICLE_ICON[v]}</span>{tl(VEHICLE_LABEL[v] as 'vehicleVelo')}
                </span>
              ))}
            </div>
          </div>
        </div>
        {foot}
      </div>

      {/* ZONES (editable) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">map</span></span>
          <div className="set-hd__t"><b>{t('zonesTitle')}</b><span>{t('zonesSub')}</span></div>
          <span className="set-hd__edit editable"><span className="ms">edit</span>{t('editable')}</span>
        </div>
        <div className="set-body">
          <div className="field no-bd">
            <div className="field__label">{t('zonesLabel')}</div>
            <div className="chips">
              {zones.map((z) => (
                <span key={z} className="chip on">
                  <span className="ms">place</span>{z}
                  <button type="button" className="chip-del" aria-label={z} onClick={() => setZones((prev) => prev.filter((x) => x !== z))}><span className="ms">close</span></button>
                </span>
              ))}
              <span className="zone-add">
                <input value={zoneInput} onChange={(e) => setZoneInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addZone() } }} placeholder={t('zonePlaceholder')} maxLength={80} />
                <span className="chip add" onClick={addZone}><span className="ms">add</span>{t('zoneAdd')}</span>
              </span>
            </div>
          </div>
        </div>
        {foot}
      </div>

      {/* LOCKED: KYB / status (read-only) */}
      <div className="op-card set-card locked-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">verified_user</span></span>
          <div className="set-hd__t"><b>{t('kybTitle')}</b><span>{t('kybSub')}</span></div>
          <span className="set-hd__edit locked"><span className="ms">lock</span>{t('locked')}</span>
        </div>
        <div className="set-body">
          <div className="info-row"><span className="k">{t('legalStatus')}</span><span className="v mono">{tl(initial.partnerType === 'company' ? 'partnerTypeCompany' : 'partnerTypeIndependent')}</span></div>
          <div className="info-row"><span className="k">{t('sirenLabel')}</span><span className="v mono">{initial.siren || t('verifNone')}</span></div>
          {initial.officialName && <div className="info-row"><span className="k">{t('officialNameLabel')}</span><span className="v">{initial.officialName}</span></div>}
          <div className="info-row"><span className="k">{t('verifLabel')}</span><span className="v">{verifBadge()}</span></div>
          <div className="info-row"><span className="k">{t('accountStatusLabel')}</span><span className="v mono">{accountStatusLabel()}</span></div>
          <div className="lock-note"><span className="ms">info</span><span>{t('lockNote')}</span></div>
        </div>
      </div>

      {/* PAYOUT (inert — bientôt) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">account_balance</span></span>
          <div className="set-hd__t"><b>{t('payoutTitle')}</b><span>{t('payoutSub')}</span></div>
          <span className="set-hd__edit locked"><span className="ms">schedule</span>{t('soon')}</span>
        </div>
        <div className="set-body">
          <div className="payout-status">
            <span className="ms">payments</span>
            <div className="m"><b>{t('payoutTitle')} <span className="tag">{t('payoutBadge')}</span></b><span>{t('payoutBody')}</span></div>
          </div>
        </div>
      </div>

      {/* ACCOUNT (language + logout real; password inert) */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">manage_accounts</span></span>
          <div className="set-hd__t"><b>{t('accountTitle')}</b><span>{t('accountSub')}</span></div>
          <span className="set-hd__edit editable"><span className="ms">edit</span>{t('editable')}</span>
        </div>
        <div className="set-body">
          <div className="field no-bd">
            <div className="field__label">{t('languageLabel')}</div>
            <select className="inp" value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
              {LOCALE_ORDER.map((l) => <option key={l} value={l}>{LOCALE_LABELS[l]}</option>)}
            </select>
          </div>
          <div className="acct-acts">
            <button type="button" className="op-btn-ghost" disabled title={t('soon')}><span className="ms">lock</span>{t('changePassword')}</button>
            <button type="button" className="op-btn-ghost" onClick={() => signOut({ callbackUrl: '/' })}><span className="ms flip-rtl">logout</span>{t('signOut')}</button>
          </div>
        </div>
      </div>

      {/* DANGER ZONE (close account inert — no capability yet) */}
      <div className="op-card set-card danger-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">warning</span></span>
          <div className="set-hd__t"><b>{t('dangerTitle')}</b><span>{t('dangerSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="danger-row">
            <div className="m"><b>{t('closeTitle')}</b><span>{t('closeBody')}</span></div>
            <button type="button" className="op-btn-ghost" disabled title={t('soon')}><span className="ms">delete</span>{t('closeCta')}</button>
          </div>
        </div>
      </div>
    </section>
  )
}
