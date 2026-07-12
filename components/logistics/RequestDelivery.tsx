'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'

// ── RequestDelivery — a business operator requests a delivery → an OFFERED mission, and
// tracks its status (brick 3, Agent 124). Hosted on the gated /deliveries page — this form
// renders ONLY when LOGISTICS_MISSIONS_ENABLED is ON. The mission is OFFERED to eligible
// couriers (never "assigned"); priceCents is an OPTIONAL inert proposed amount (data only —
// NO money is charged/computed). Owner-scoped: the API only ever returns this operator's
// own missions.
//
// 🔒 Re-skinned to the --op- operator design system (CD v1 LOT 5) — PRESENTATION ONLY.
// Every fetch, state hook, handler and payload below is BYTE-IDENTICAL to the pre-re-skin
// version: GET/POST /api/logistics/missions/request unchanged, priceCents stays inert.

interface MissionDTO {
  id: string; type: string; pickupAddress: string; dropoffAddress: string
  zone: string | null; priceCents: number; status: string; createdAt: string
}

const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const TYPE_LABEL: Record<string, string> = {
  repas: 'typeRepas', produits_fournisseurs: 'typeProduits', b2b: 'typeB2b', froid: 'typeFroid',
}
// --op- badge tone per mission status (replaces the design-system BadgeTone).
const STATUS_TONE: Record<string, string> = {
  offered: 'warning', accepted: 'success', picked_up: 'success', delivered: 'success',
  declined: 'neutral', expired: 'neutral', cancelled: 'danger',
}

export default function RequestDelivery() {
  const t = useTranslations('business.logistics.request')
  const locale = useLocale()
  const [missions, setMissions] = useState<MissionDTO[] | null>(null)
  const [type, setType] = useState<string>('repas')
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const [zone, setZone] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/missions/request', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setMissions(res.ok && data?.ok ? (data.missions as MissionDTO[]) : [])
    } catch {
      setMissions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError(null); setCreated(false)
    try {
      const priceCents = price.trim() ? Math.round(parseFloat(price.replace(',', '.')) * 100) : undefined
      const res = await fetch('/api/logistics/missions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, pickupAddress: pickup.trim(), dropoffAddress: dropoff.trim(),
          zone: zone.trim() || undefined,
          ...(priceCents !== undefined && Number.isFinite(priceCents) ? { priceCents } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setError(data?.error || t('errorGeneric')); return }
      setCreated(true)
      setPickup(''); setDropoff(''); setZone(''); setPrice('')
      setMissions((prev) => [data.mission as MissionDTO, ...(prev ?? [])])
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const price$ = (cents: number) => formatMoney(cents, locale) // inert proposed amount, locale-aware
  const statusLabel = (s: string) => t(`status_${s}` as 'status_offered')
  const typeLabel = (m: string) => (m in TYPE_LABEL ? t(TYPE_LABEL[m]) : m)

  return (
    <div className="op-del-wrap">
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('pageTitle')}</h1>
          <p className="op-dash__sub">{t('pageSubtitle')}</p>
        </div>
      </div>

      <div className="op-card" style={{ padding: 20, marginBottom: 18 }}>
        <p className="op-del-form__head"><span className="ms">local_shipping</span>{t('formTitle')}</p>
        <p className="op-del-form__sub">{t('formSubtitle')}</p>

        {created && (
          <div className="op-notice ok" style={{ marginBottom: 12 }}>
            <span className="ms">check_circle</span>
            <span><strong>{t('createdTitle')}</strong> {t('createdBody')}</span>
          </div>
        )}
        {error && (
          <div className="op-notice err" style={{ marginBottom: 12 }}>
            <span className="ms">error</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="op-del-form">
          <div className="op-field">
            <label>{t('fieldType')}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="op-select">
              {MISSION_TYPES.map((mt) => <option key={mt} value={mt}>{typeLabel(mt)}</option>)}
            </select>
          </div>
          <div className="op-field">
            <label>{t('fieldPickup')}</label>
            <input value={pickup} onChange={(e) => setPickup(e.target.value)} required minLength={3} maxLength={200} className="op-input" />
          </div>
          <div className="op-field">
            <label>{t('fieldDropoff')}</label>
            <input value={dropoff} onChange={(e) => setDropoff(e.target.value)} required minLength={3} maxLength={200} className="op-input" />
          </div>
          <div className="op-grid2">
            <div className="op-field">
              <label>{t('fieldZone')}</label>
              <input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={80} className="op-input" />
            </div>
            <div className="op-field">
              <label>{t('fieldPrice')}</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="op-input mono" placeholder="0,00" />
              <span className="hint">{t('fieldPriceHint')}</span>
            </div>
          </div>
          <div>
            <button type="submit" className="op-btn-primary" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </button>
          </div>
        </form>
      </div>

      <div className="op-card" style={{ padding: 20 }}>
        <p className="op-del-form__head" style={{ fontSize: 14, marginBottom: 12 }}>{t('myMissionsTitle')}</p>
        {missions === null ? (
          <div className="op-emptyline"><span className="ms">hourglass_top</span><span>{t('loading')}</span></div>
        ) : missions.length === 0 ? (
          <div className="op-emptyline">
            <span className="ms">local_shipping</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyBody')}</span>
          </div>
        ) : (
          <div className="delivery-list">
            {missions.map((m) => (
              <div key={m.id} className="op-mission-li">
                <div className="op-mission-li__top">
                  <span className="op-badge neutral">{typeLabel(m.type)}</span>
                  <span className={`op-badge ${STATUS_TONE[m.status] ?? 'neutral'}`}>{statusLabel(m.status)}</span>
                </div>
                <div className="op-mission-li__route">
                  <span className="ms">location_on</span>
                  <span className="a">{m.pickupAddress}</span>
                  <span className="ms">arrow_forward</span>
                  <span className="a">{m.dropoffAddress}</span>
                </div>
                {m.priceCents > 0 && <p className="op-mission-li__price">{price$(m.priceCents)}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
