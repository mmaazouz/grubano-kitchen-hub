'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatMoney } from '@/lib/format-money'
import type { MissionDTO, OwnMissionDTO } from '@/lib/mission-serialize'

// ── MesMissions — the courier's missions surface (LO2). ───────────────────────
// 3 tabs: Offres (GET /api/logistics/missions — MASKED drop-off, S1) · En cours
// (GET /api/logistics/missions/mine, accepted/picked_up — FULL address revealed post-claim) ·
// Terminées (delivered/cancelled). Actions call the REAL owner-scoped atomic routes
// (accept/decline/pickup/deliver/cancel, shipped c379ae7). Prices are the INERT proposed
// amount (formatMoney, muted, "proposé" — never a gain). The "Disponible" toggle is INERT
// (no online field in the schema, audit §8). Refs = the REAL Mission.id (no fabricated
// "MIS-2026-*"). No fabricated offers/contacts. Owner-scoped, NO money computed.

type Tab = 'offers' | 'current' | 'done'

const TYPE_ICON: Record<string, string> = {
  repas: 'restaurant', produits_fournisseurs: 'inventory_2', b2b: 'local_shipping', froid: 'ac_unit',
}

async function getJson(url: string): Promise<{ ok?: boolean; [k: string]: unknown } | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null // 404 (flag OFF) / 401 / 403 → treat as empty
    return (await res.json().catch(() => null)) as { ok?: boolean } | null
  } catch { return null }
}

export default function MesMissions() {
  const t = useTranslations('business.logistics.missionsUi')
  const tl = useTranslations('business.logistics') // reuse mission-type labels (missionRepas…)
  const locale = useLocale()
  const fmt = (cents: number) => formatMoney(cents, locale)

  const [tab, setTab] = useState<Tab>('offers')
  const [offers, setOffers] = useState<MissionDTO[]>([])
  const [current, setCurrent] = useState<OwnMissionDTO[]>([])
  const [done, setDone] = useState<OwnMissionDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([
      getJson('/api/logistics/missions'),
      getJson('/api/logistics/missions/mine'),
    ])
    setOffers(o?.ok ? ((o.missions as MissionDTO[]) ?? []) : [])
    setCurrent(m?.ok ? ((m.current as OwnMissionDTO[]) ?? []) : [])
    setDone(m?.ok ? ((m.done as OwnMissionDTO[]) ?? []) : [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  // POST an action to a mission route, then refetch (a lost race / invalid step just refreshes).
  const act = async (id: string, action: 'accept' | 'decline' | 'pickup' | 'deliver' | 'cancel') => {
    if (busyId) return
    setBusyId(id)
    try { await fetch(`/api/logistics/missions/${id}/${action}`, { method: 'POST' }) }
    catch { /* best-effort — refetch reflects the real state */ }
    finally { await load(); setBusyId(null) }
  }

  const typeLabel = (type: string) => {
    const key = ({ repas: 'missionRepas', produits_fournisseurs: 'missionProduits', b2b: 'missionB2b', froid: 'missionFroid' } as Record<string, string>)[type]
    return key ? tl(key as 'missionRepas') : type
  }
  // Honest title: the merchant address' first segment (real), else the mission-type label.
  const title = (m: { pickupAddress: string; type: string }) => (m.pickupAddress.split(',')[0] || '').trim() || typeLabel(m.type)
  const price = (cents: number) => (cents > 0 ? `≈ ${fmt(cents)}` : null)

  if (loading) {
    return (
      <section>
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: 300, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 190, borderRadius: 12, marginBottom: 14, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 190, borderRadius: 12, display: 'block' }} />
      </section>
    )
  }

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
        {/* INERT availability control — no online field exists yet (audit §8). */}
        <span className="avail-inert" title={t('availSoon')} aria-disabled>
          <span className="ms">bolt</span>{t('availLabel')}
          <span className="avail-inert__tog"><i /></span>
          <span className="avail-inert__tag">{t('availSoon')}</span>
        </span>
      </div>

      <div className="tabs">
        <button className={tab === 'offers' ? 'is-active' : undefined} onClick={() => setTab('offers')}>
          <span className="ms" style={{ fontSize: 16 }}>inbox</span>{t('tabOffers')}{offers.length > 0 && <span className="cnt">{offers.length}</span>}
        </button>
        <button className={tab === 'current' ? 'is-active' : undefined} onClick={() => setTab('current')}>
          <span className="ms" style={{ fontSize: 16 }}>navigation</span>{t('tabCurrent')}{current.length > 0 && <span className="cnt">{current.length}</span>}
        </button>
        <button className={tab === 'done' ? 'is-active' : undefined} onClick={() => setTab('done')}>
          <span className="ms" style={{ fontSize: 16 }}>history</span>{t('tabDone')}
        </button>
      </div>

      {/* ============ OFFRES ============ */}
      {tab === 'offers' && (
        <div>
          <div className="hon"><span className="ms">info</span><span>{t('honOffers')}</span></div>
          {offers.length === 0 ? (
            <div className="op-card"><div className="op-empty"><span className="ms">assignment_late</span><b>{t('emptyOffersTitle')}</b><span>{t('emptyOffersBody')}</span></div></div>
          ) : offers.map((m) => (
            <div key={m.id} className="op-card offer">
              <div className="offer__hd">
                <span className="offer__ic"><span className="ms">{TYPE_ICON[m.type] ?? 'local_shipping'}</span></span>
                <div className="offer__m">
                  <h3>{title(m)}</h3>
                  <div className="offer__meta">
                    <span><span className="ms">category</span>{typeLabel(m.type)}</span>
                    {m.zone && <span><span className="ms">place</span>{m.zone}</span>}
                  </div>
                </div>
                {price(m.priceCents) && <div className="offer__price"><b>{price(m.priceCents)}</b><span>{t('proposed')}</span></div>}
              </div>
              <div className="route">
                <div className="rt"><span className="rt__d pick"><span className="ms">store</span></span><div className="rt__m"><b>{t('pickup')}</b><span>{m.pickupAddress}</span></div></div>
                <div className="rt"><span className="rt__d drop"><span className="ms">flag</span></span><div className="rt__m"><b>{t('dropoff')}</b><span className="masked"><span className="ms">lock</span>{m.dropoffAddress ? t('maskedZone', { zone: m.dropoffAddress }) : t('maskedGeneric')}</span></div></div>
              </div>
              <div className="offer__acts">
                <button className="op-btn-ghost" disabled={busyId === m.id} onClick={() => act(m.id, 'decline')}><span className="ms">close</span>{t('decline')}</button>
                <button className="op-btn-primary" disabled={busyId === m.id} onClick={() => act(m.id, 'accept')}><span className="ms">check</span>{t('accept')}</button>
              </div>
              <div className="mask-note"><span className="ms">visibility_off</span>{t('maskNote')}</div>
            </div>
          ))}
        </div>
      )}

      {/* ============ EN COURS ============ */}
      {tab === 'current' && (
        <div>
          <div className="hon"><span className="ms">info</span><span>{t('honCurrent')}</span></div>
          {current.length === 0 ? (
            <div className="op-card"><div className="op-empty"><span className="ms">navigation</span><b>{t('emptyCurrentTitle')}</b><span>{t('emptyCurrentBody')}</span></div></div>
          ) : current.map((m) => {
            const currentIdx = m.status === 'accepted' ? 1 : 3 // picked_up → 3
            const steps = [
              { icon: 'check', label: t('cycAccepted') },
              { icon: 'store', label: t('cycEnRoute') },
              { icon: 'inventory_2', label: t('cycPickedUp') },
              { icon: 'directions_bike', label: t('cycEnDelivery') },
              { icon: 'flag', label: t('cycDelivered') },
            ]
            return (
              <div key={m.id}>
                <div className="op-card cur-top">
                  <span className="cur-top__ic"><span className="ms">navigation</span></span>
                  <div className="cur-top__m"><b>{title(m)}</b><span>{price(m.priceCents) ? `${price(m.priceCents)} ${t('proposedInline')}` : typeLabel(m.type)}</span></div>
                  <span className="cur-top__badge">#{m.id}</span>
                </div>
                <div className="op-card" style={{ overflow: 'hidden' }}>
                  <div className="cyc">
                    {steps.map((s, i) => {
                      const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'future'
                      return (
                        <div key={i} className={`cyc-step ${state}`}>
                          <span className="d"><span className="ms">{state === 'done' ? 'check' : s.icon}</span></span>
                          <div className="m"><b>{s.label}</b></div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="cur-addr">
                    <div className="lbl2">{t('pickupPoint')}</div>
                    <span>{m.pickupAddress}</span>
                  </div>
                  <div className="cur-addr no-top">
                    <div className="lbl2">{t('clientAddressRevealed')}</div>
                    <span>{m.dropoffAddress}</span>
                  </div>
                  <div className="cur-acts">
                    <button className="op-btn-danger" disabled={busyId === m.id} onClick={() => act(m.id, 'cancel')}><span className="ms">block</span>{t('cancel')}</button>
                    {m.status === 'accepted' ? (
                      <button className="op-btn-primary" disabled={busyId === m.id} onClick={() => act(m.id, 'pickup')}><span className="ms">inventory_2</span>{t('pickedUp')}</button>
                    ) : (
                      <button className="op-btn-success" disabled={busyId === m.id} onClick={() => act(m.id, 'deliver')}><span className="ms">check_circle</span>{t('markDelivered')}</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ============ TERMINÉES ============ */}
      {tab === 'done' && (
        <div>
          <div className="hon"><span className="ms">info</span><span>{t('honDone')}</span></div>
          {done.length === 0 ? (
            <div className="op-card"><div className="op-empty"><span className="ms">history</span><b>{t('emptyDoneTitle')}</b><span>{t('emptyDoneBody')}</span></div></div>
          ) : (
            <div className="op-card" style={{ padding: '6px 18px' }}>
              {done.map((m) => {
                const cancelled = m.status === 'cancelled'
                const when = cancelled ? m.cancelledAt : m.deliveredAt
                const stamp = when ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(when)) : ''
                return (
                  <div key={m.id} className="dn-row">
                    <span className={`dn-ic ${cancelled ? 'cancel' : 'ok'}`}><span className="ms">{cancelled ? 'block' : 'check'}</span></span>
                    <div className="dn-m"><b>{title(m)}</b><span>{stamp ? `${stamp} · ` : ''}#{m.id}</span></div>
                    <span className={`dn-status ${cancelled ? 'cancel' : 'ok'}`}>{cancelled ? t('statusCancelled') : t('statusDelivered')}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
