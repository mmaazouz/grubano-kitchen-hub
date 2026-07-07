'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import CourierMap from '@/components/CourierMap'
import './admin-tracking.css'

// ── AdminTracking (Géoloc ÉTAPE 4) — admin/support courier-position view (WHITELIST = admin role).
// Looks up an order by id and shows the courier's EXACT position (admin privilege — the endpoint
// coarsens only for the order-owner client). Gated: when LOGISTICS_TRACKING_ENABLED is OFF the
// server passes enabled=false and this shows an honest "disabled" panel (no position surface).

interface Pos {
  available: boolean
  courier?: { lat: number; lng: number }
  pickup?: { lat: number; lng: number } | null
  dropoff?: { lat: number; lng: number } | null
  etaMinutes?: number | null
  status?: string
  updatedAt?: string
}
type State = 'idle' | 'loading' | 'empty' | 'denied' | 'ok' | 'error'

export default function AdminTracking({ enabled }: { enabled: boolean }) {
  const t = useTranslations('adminTracking')
  const [orderId, setOrderId] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)
  const [state, setState] = useState<State>('idle')

  const load = useCallback(async () => {
    const id = orderId.trim()
    if (!id) return
    setState('loading')
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/courier-position`, { cache: 'no-store' })
      if (res.status === 403) { setPos(null); setState('denied'); return }
      if (!res.ok) { setPos(null); setState('empty'); return }
      const data = (await res.json()) as Pos
      if (!data?.available || !data.courier) { setPos(null); setState('empty'); return }
      setPos(data); setState('ok')
    } catch {
      setPos(null); setState('error')
    }
  }, [orderId])

  return (
    <div className="admtrk">
      <h1 className="admtrk__title">{t('title')}</h1>
      <p className="admtrk__sub">{t('subtitle')}</p>

      {!enabled ? (
        <div className="admtrk__disabled">
          <span className="ms">location_off</span>
          <b>{t('disabledTitle')}</b>
          <span>{t('disabledBody')}</span>
        </div>
      ) : (
        <>
          <div className="admtrk__search">
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
              placeholder={t('orderIdPlaceholder')}
              aria-label={t('orderIdPlaceholder')}
            />
            <button className="op-btn-primary" onClick={() => void load()} disabled={!orderId.trim() || state === 'loading'}>
              <span className="ms">search</span>{t('view')}
            </button>
          </div>

          {state === 'ok' && pos?.courier && (
            <div className="admtrk__result">
              <div className="admtrk__map">
                <CourierMap
                  courier={pos.courier}
                  pickup={pos.pickup ?? null}
                  dropoff={pos.dropoff ?? null}
                  etaText={pos.etaMinutes ? t('etaMinutes', { min: pos.etaMinutes }) : null}
                  approxText={null}
                  accent="#4f46e5"
                />
              </div>
              <div className="admtrk__meta">
                <span className="admtrk__exact"><span className="ms">verified_user</span>{t('exactBadge')}</span>
                {pos.status && <span>{t('status')}: <b>{pos.status}</b></span>}
                {pos.updatedAt && <span>{t('updatedAt')}: <b>{new Date(pos.updatedAt).toLocaleTimeString()}</b></span>}
              </div>
            </div>
          )}
          {state === 'empty' && <p className="admtrk__note">{t('noPosition')}</p>}
          {state === 'denied' && <p className="admtrk__note">{t('denied')}</p>}
          {state === 'error' && <p className="admtrk__note">{t('error')}</p>}
        </>
      )}
    </div>
  )
}
