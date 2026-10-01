'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'

type PromoType = 'percent' | 'fixed' | 'second_item' | 'threshold_reward'

// ── <PromotionsManager /> — chantier P1, l'écran resto ─────────────────────────
// Lists the establishment's promotions (status badge, usage count), creates V1
// promos (percent 1-90 | fixed > 0, window, optional minOrderEur / targeted
// items / channels) and soft-toggles them. Consumes /api/restaurant/promotions
// (strict brand ownership server-side). The ENGINE applies them automatically
// at checkout — best one for the customer, never stacked (D5).
//
// 🔒 CD v1 re-skin (Notion 390fd2c9-…-d5056c19ac9a) — PRESENTATION ONLY. Every fetch /
// React state / mutation handler below is byte-identical to the pre-skin manager: only
// the JSX markup + classes moved to the navy --op-* operator shell (Material Symbols, not
// lucide). The « best-of / pas de cumul » preview is an HONEST note about the SERVER engine
// (lib/promotions.pickBestPromotion) — nothing is recomputed here. Tabs (Actives /
// Programmées / Terminées) are a pure client GROUPING of the already-fetched real promotions
// via statusOf(); toggle stays the existing PATCH soft-toggle (jamais de suppression).

type Promotion = {
  id: string; brandId: string; name: string; type: string; discount: number
  conditions: {
    minOrderEur?: number; itemIds?: string[]; channels?: string[]
    thresholdEur?: number; rewardKind?: 'percent' | 'free_item'; rewardPct?: number; freeItemIds?: string[]
  } | null
  startDate: string; endDate: string; active: boolean; usageCount: number
}
type BrandRow    = { id: string; name: string; emoji: string }
type MenuItemRow = { id: string; name: string; brandId: string }

export default function PromotionsManager() {
  const t      = useTranslations('promotions')
  const op     = useTranslations('operator')
  const locale = useLocale()

  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [brands,     setBrands]     = useState<BrandRow[]>([])
  const [menuItems,  setMenuItems]  = useState<MenuItemRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)
  const [toast,      setToast]      = useState('')
  // Promo V2 Slice 2 — chef campaign invitations (recipes this resto adopted).
  const [invites, setInvites] = useState<Array<{
    campaignId: string; dishName: string; creatorName: string
    suggestedDiscountPct: number; message: string; endsAt: string; menuItemId: string
  }>>([])
  const [optInTarget, setOptInTarget] = useState<typeof invites[number] | null>(null)
  const [optInPct,    setOptInPct]    = useState('')
  const [optInSaving, setOptInSaving] = useState(false)
  const [optInError,  setOptInError]  = useState('')

  // Tab grouping (client-side view of the real fetched promotions — no recompute).
  const [tab, setTab] = useState<'active' | 'scheduled' | 'ended'>('active')

  // Create form state
  const [open,      setOpen]      = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [formError, setFormError] = useState('')
  const [brandId,   setBrandId]   = useState('')
  const [name,      setName]      = useState('')
  const [type,      setType]      = useState<PromoType>('percent')
  const [value,     setValue]     = useState('')
  const [start,     setStart]     = useState('')
  const [end,       setEnd]       = useState('')
  const [minOrder,  setMinOrder]  = useState('')
  const [itemIds,   setItemIds]   = useState<string[]>([])
  const [channels,  setChannels]  = useState<string[]>([])
  // Promo V2 — threshold_reward fields.
  const [threshold,   setThreshold]   = useState('')
  const [rewardKind,  setRewardKind]  = useState<'percent' | 'free_item'>('percent')
  const [rewardPct,   setRewardPct]   = useState('')
  const [freeItemIds, setFreeItemIds] = useState<string[]>([])
  // Anti-gaspi — « stock à écouler » card state (separate from the create modal).
  const [agOpen,   setAgOpen]   = useState(false)
  const [agSaving, setAgSaving] = useState(false)
  const [agError,  setAgError]  = useState('')
  const [agItemIds, setAgItemIds] = useState<string[]>([])
  const [agExpiry,  setAgExpiry]  = useState('')
  const [agPct,     setAgPct]     = useState('30') // heuristic default −30% (LLM M7 = content vetting, not a discount suggester — reuse not trivial, noted)

  const eur = useMemo(() => (n: number) => formatEuros(n, locale), [locale])
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const r = await fetch('/api/restaurant/promotions', { cache: 'no-store' })
      if (!r.ok) throw new Error('load')
      const d = await r.json()
      setPromotions(d.promotions ?? [])
      setBrands(d.brands ?? [])
      setMenuItems(d.menuItems ?? [])
      if (!brandId && d.brands?.length) setBrandId(d.brands[0].id)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
    // Campaign invitations — best-effort, never blocks the promo list.
    try {
      const ic = await fetch('/api/restaurant/campaigns', { cache: 'no-store' })
      if (ic.ok) { const dc = await ic.json(); setInvites(Array.isArray(dc.invitations) ? dc.invitations : []) }
    } catch { /* no invitations */ }
  }, [brandId])

  function openOptIn(inv: typeof invites[number]) {
    setOptInTarget(inv); setOptInPct(String(inv.suggestedDiscountPct)); setOptInError('')
  }
  const optInPctNum = parseFloat(optInPct.replace(',', '.'))
  const optInValid = !!optInTarget && Number.isFinite(optInPctNum) && optInPctNum >= 1 && optInPctNum <= 90
  async function confirmOptIn() {
    if (!optInValid || optInSaving || !optInTarget) return
    setOptInSaving(true); setOptInError('')
    try {
      const r = await fetch('/api/restaurant/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: optInTarget.campaignId, discountPct: Math.round(optInPctNum) }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setOptInError(typeof d?.error === 'string' ? d.error : t('errGeneric')); return }
      setOptInTarget(null); setToast(t('campaignJoinedOk'))
      void load()
    } catch { setOptInError(t('errGeneric')) } finally { setOptInSaving(false) }
  }

  useEffect(() => { load() }, [load])

  // status: 'active' (running now) | 'paused' (inactive but window valid) |
  // 'scheduled' (starts later) | 'ended' (expired). Pure read of real dates/active flag.
  function statusOf(p: Promotion): 'active' | 'paused' | 'scheduled' | 'ended' {
    const now = Date.now()
    if (now > new Date(p.endDate).getTime()) return 'ended'
    if (now < new Date(p.startDate).getTime()) return 'scheduled'
    if (!p.active) return 'paused'
    return 'active'
  }
  // Tab bucket: active + paused → « Actives » ; scheduled → « Programmées » ; ended → « Terminées ».
  function bucketOf(p: Promotion): 'active' | 'scheduled' | 'ended' {
    const s = statusOf(p)
    if (s === 'scheduled') return 'scheduled'
    if (s === 'ended') return 'ended'
    return 'active'
  }

  async function toggle(p: Promotion) {
    try {
      const r = await fetch('/api/restaurant/promotions', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: p.id, active: !p.active }),
      })
      if (!r.ok) throw new Error()
      setToast(t('updatedOk'))
      void load()
    } catch {
      setToast(t('errGeneric'))
    }
  }

  function openCreate() {
    setName(''); setType('percent'); setValue(''); setStart(''); setEnd('')
    setMinOrder(''); setItemIds([]); setChannels([]); setFormError('')
    setThreshold(''); setRewardKind('percent'); setRewardPct(''); setFreeItemIds([])
    if (brands.length && !brandId) setBrandId(brands[0].id)
    setOpen(true)
  }

  const valueNum    = parseFloat(value.replace(',', '.'))
  const thresholdNum = parseFloat(threshold.replace(',', '.'))
  const rewardPctNum = parseFloat(rewardPct.replace(',', '.'))
  // percent / second_item → 1..90 ; fixed → > 0 ; threshold_reward → no headline value.
  const valueValid  = type === 'threshold_reward' ? true : Number.isFinite(valueNum) &&
    ((type === 'percent' || type === 'second_item') ? valueNum >= 1 && valueNum <= 90 : valueNum > 0)
  const thresholdValid = type !== 'threshold_reward' || (Number.isFinite(thresholdNum) && thresholdNum > 0)
  const rewardValid = type !== 'threshold_reward' ||
    (rewardKind === 'percent'
      ? Number.isFinite(rewardPctNum) && rewardPctNum >= 1 && rewardPctNum <= 90
      : freeItemIds.length > 0) // free_item: an explicit « offered item » pool is required
  const datesValid  = !!start && !!end && new Date(end) > new Date(start)
  const formValid   = !!brandId && name.trim().length >= 2 && valueValid && thresholdValid && rewardValid && datesValid

  async function create() {
    if (!formValid || saving) return
    setSaving(true)
    setFormError('')
    try {
      const minOrderNum = parseFloat(minOrder.replace(',', '.'))
      const conditions: Record<string, unknown> = {}
      if (Number.isFinite(minOrderNum) && minOrderNum > 0) conditions.minOrderEur = minOrderNum
      if (itemIds.length)  conditions.itemIds  = itemIds
      if (channels.length) conditions.channels = channels
      if (type === 'threshold_reward') {
        conditions.thresholdEur = thresholdNum
        conditions.rewardKind   = rewardKind
        if (rewardKind === 'percent') conditions.rewardPct = rewardPctNum
        else if (freeItemIds.length)  conditions.freeItemIds = freeItemIds
      }

      const r = await fetch('/api/restaurant/promotions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          name:      name.trim(),
          type,
          discount:  type === 'threshold_reward' ? 0 : valueNum,
          startDate: new Date(start).toISOString(),
          endDate:   new Date(end).toISOString(),
          ...(Object.keys(conditions).length ? { conditions } : {}),
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setFormError(typeof d?.error === 'string' ? d.error : t('errGeneric'))
        return
      }
      setOpen(false)
      setToast(t('createdOk'))
      void load()
    } catch {
      setFormError(t('errGeneric'))
    } finally {
      setSaving(false)
    }
  }

  // ── Anti-gaspi : « stock à écouler » → flash percent promo en 1 clic ──────────
  // Réutilise le POST existant (type percent + itemIds + fenêtre = maintenant →
  // péremption). Suggestion HEURISTIQUE (−30% par défaut, réglable). 1 clic.
  const agPctNum = parseFloat(agPct.replace(',', '.'))
  const agValid = !!brandId && agItemIds.length > 0 && !!agExpiry &&
    new Date(agExpiry) > new Date() && Number.isFinite(agPctNum) && agPctNum >= 1 && agPctNum <= 90
  async function launchAntiGaspi() {
    if (!agValid || agSaving) return
    setAgSaving(true)
    setAgError('')
    try {
      const r = await fetch('/api/restaurant/promotions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          name:      t('agName'),
          type:      'percent',
          discount:  Math.round(agPctNum),
          startDate: new Date().toISOString(),
          endDate:   new Date(agExpiry).toISOString(),
          conditions: { itemIds: agItemIds },
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) { setAgError(typeof d?.error === 'string' ? d.error : t('errGeneric')); return }
      setAgOpen(false); setAgItemIds([]); setAgExpiry(''); setAgPct('30')
      setToast(t('agLaunchedOk'))
      void load()
    } catch {
      setAgError(t('errGeneric'))
    } finally {
      setAgSaving(false)
    }
  }

  const brandItems = menuItems.filter(m => m.brandId === brandId)
  const brandName  = (id: string) => brands.find(b => b.id === id)?.name ?? ''

  // Derived groupings + display helpers (pure reads — no money recompute).
  const counts = useMemo(() => {
    const c = { active: 0, scheduled: 0, ended: 0 }
    for (const p of promotions) c[bucketOf(p)]++
    return c
  }, [promotions])
  const visible = promotions.filter(p => bucketOf(p) === tab)
  const activeNowCount = promotions.filter(p => statusOf(p) === 'active').length

  // CD promo-type badge (auto / offer) derived from the real `type`. NOTE: the list
  // endpoint intentionally does NOT return `code` (column-tolerant select) → we never
  // render a « Code promo » badge/row we couldn't honestly fill.
  function typeBadge(p: Promotion): { cls: string; label: string } {
    if (p.type === 'second_item' || p.type === 'threshold_reward') return { cls: 'offer', label: op('promotions.typeOffer') }
    return { cls: 'auto', label: op('promotions.typeAuto') }
  }
  function statusBadge(p: Promotion): { cls: string; label: string } {
    const s = statusOf(p)
    if (s === 'active')    return { cls: 'active',    label: t('badgeActive') }
    if (s === 'paused')    return { cls: 'paused',    label: t('badgeInactive') }
    if (s === 'scheduled') return { cls: 'scheduled', label: t('badgeUpcoming') }
    return { cls: 'ended', label: t('badgeExpired') }
  }
  function valueText(p: Promotion): string {
    return p.type === 'percent'          ? t('valuePercent', { value: p.discount })
      : p.type === 'fixed'               ? t('valueFixed', { value: eur(p.discount) })
      : p.type === 'second_item'         ? t('valueSecondItem', { value: p.discount })
      : p.type === 'threshold_reward'    ? t('valueThreshold', { amount: eur(p.conditions?.thresholdEur ?? 0) })
      : t('valuePercent', { value: p.discount })
  }

  return (
    <section className="op-promotions">
      {loading ? (
        // ── skeleton ──
        <>
          <div className="op-dash__head">
            <div>
              <span className="op-sk" style={{ width: 150, height: 24, display: 'block' }} />
              <span className="op-sk" style={{ width: 210, height: 14, display: 'block', marginTop: 8, borderRadius: 4 }} />
            </div>
            <span className="op-sk" style={{ width: 170, height: 40, borderRadius: 8 }} />
          </div>
          <span className="op-sk" style={{ width: 280, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
          <div className="promo-grid">
            {[0, 1, 2, 3].map(i => (
              <span key={i} className="op-sk" style={{ width: '100%', height: 200, borderRadius: 12 }} />
            ))}
          </div>
        </>
      ) : loadError ? (
        // ── error ──
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms">cloud_off</span>
            <h2>{t('errLoad')}</h2>
            <p>{op('dash.errorBody')}</p>
            <button type="button" className="op-btn-primary" onClick={() => void load()}>
              <span className="ms">refresh</span>{op('dash.retry')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── head ── */}
          <div className="op-dash__head">
            <div>
              <h1 className="op-dash__title">{t('title')}</h1>
              <p className="op-dash__sub">{op('promotions.activeCount', { count: activeNowCount })}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="op-btn-add ghost"
                onClick={() => { setAgError(''); setAgItemIds([]); setAgExpiry(''); setAgPct('30'); if (brands.length && !brandId) setBrandId(brands[0].id); setAgOpen(true) }}
              >
                <span className="ms">schedule</span>{t('agBtn')}
              </button>
              <button type="button" className="op-btn-add" onClick={openCreate}>
                <span className="ms">add</span>{t('btnNew')}
              </button>
            </div>
          </div>

          {/* ── honest « pas de cumul » note (server-side engine) ── */}
          <div className="op-promo-note">
            <span className="ms">info</span>
            <p>{op('promotions.bestOfNote')}</p>
          </div>
          <p className="op-hint" style={{ marginTop: -8, marginBottom: 18 }}>{t('docFinance')}</p>

          {toast && (
            <p className="op-promo-toast"><span className="ms">check_circle</span>{toast}</p>
          )}

          {/* ── campaign invitations (adopted chef recipes) ── */}
          {invites.length > 0 && (
            <div className="op-camp">
              <div className="op-camp__title"><span className="ms">restaurant_menu</span>{t('campaignInvitesTitle', { count: invites.length })}</div>
              {invites.map(inv => (
                <div key={inv.campaignId} className="op-camp__card">
                  <div className="op-camp__row">
                    <span className="ms">local_offer</span>
                    <span className="op-camp__head">{t('campaignInviteHead', { creator: inv.creatorName, dish: inv.dishName })}</span>
                    <span className="op-camp__pct mono">−{inv.suggestedDiscountPct}%</span>
                  </div>
                  {inv.message && <p className="op-camp__msg">« {inv.message} »</p>}
                  <div className="op-camp__foot">
                    <span className="op-camp__note">{t('campaignInviteFinance')}</span>
                    <button type="button" className="op-camp__cta" onClick={() => openOptIn(inv)}>{t('campaignJoinCta')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {promotions.length === 0 ? (
            // ── empty (aucune promo) ──
            <div className="op-card">
              <div className="op-emptyline">
                <span className="ms">sell</span>
                <b>{op('promotions.emptyTitle')}</b>
                <span>{t('empty')}</span>
                <button type="button" className="op-btn-primary" onClick={openCreate}>
                  <span className="ms">add</span>{op('promotions.emptyCta')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── tabs (Actives / Programmées / Terminées) ── */}
              <div className="promo-tabs" role="tablist">
                {([
                  ['active',    op('promotions.tabActive'),    counts.active],
                  ['scheduled', op('promotions.tabScheduled'), counts.scheduled],
                  ['ended',     op('promotions.tabEnded'),     counts.ended],
                ] as const).map(([k, label, n]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    className={tab === k ? 'is-active' : undefined}
                    onClick={() => setTab(k)}
                  >
                    {label} <span className="tab-count mono">{n}</span>
                  </button>
                ))}
              </div>

              {/* ── grid ── */}
              {visible.length === 0 ? (
                <div className="op-card">
                  <div className="op-emptyline">
                    <span className="ms">sell</span>
                    <b>{op('promotions.tabEmpty')}</b>
                  </div>
                </div>
              ) : (
                <div className="promo-grid">
                  {visible.map(p => {
                    const tb = typeBadge(p)
                    const sb = statusBadge(p)
                    const st = statusOf(p)
                    const isText = p.type === 'threshold_reward'
                    return (
                      <div key={p.id} className={`promo-card${st === 'ended' ? ' is-ended' : ''}`}>
                        <div className="promo-card__top">
                          <span className={`promo-type ${tb.cls}`}>{tb.label}</span>
                          <span className={`promo-status ${sb.cls}`}><i className="dot" />{sb.label}</span>
                        </div>
                        <h3 className="promo-name">{p.name}</h3>
                        <div className={`promo-value${isText ? ' text' : ''}`}>{valueText(p)}</div>
                        {p.conditions?.minOrderEur ? (
                          <div className="promo-cond">{t('minOrderPill', { amount: eur(p.conditions.minOrderEur) })}</div>
                        ) : p.type === 'second_item' ? (
                          <div className="promo-cond">{t('typeSecondItem')}</div>
                        ) : null}
                        <div className="promo-period">
                          <span className="ms">event</span>{t('windowLabel', { start: dateFmt(p.startDate), end: dateFmt(p.endDate) })}
                        </div>
                        <div className="promo-scope">
                          <span className="ms">storefront</span>{brandName(p.brandId)}
                          {p.conditions?.itemIds?.length ? ` · ${t('itemsPill', { count: p.conditions.itemIds.length })}` : ''}
                          {p.conditions?.channels?.map(c => ` · ${c === 'pickup' ? t('channelPickup') : t('channelDelivery')}`).join('')}
                        </div>
                        <div className="promo-usage"><span className="mono">{t('usage', { count: p.usageCount })}</span></div>
                        <div className="promo-card__actions">
                          {st === 'ended' ? (
                            <span className="op-hint">{t('badgeExpired')}</span>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn-sm"
                              onClick={() => toggle(p)}
                              title={p.active ? t('btnDeactivate') : t('btnReactivate')}
                            >
                              <span className="ms">{p.active ? 'pause_circle' : 'play_circle'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Create modal ── */}
      <div className={`op-modal-backdrop${open ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget && !saving) setOpen(false) }}>
        <div className="op-modal" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('formTitle')}</h3>
            <button type="button" className="op-modal__close" onClick={() => !saving && setOpen(false)}><span className="ms">close</span></button>
          </div>
          <div className="op-modal__body">
            {brands.length > 1 && (
              <div className="op-field">
                <span className="lbl">{t('fieldBrand')}</span>
                <select className="op-select" value={brandId} onChange={e => { setBrandId(e.target.value); setItemIds([]) }}>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}
                </select>
              </div>
            )}

            <div className="op-field">
              <label htmlFor="promoName">{t('fieldName')}</label>
              <input id="promoName" className="op-input" type="text" placeholder={t('fieldNamePh')} value={name} onChange={e => setName(e.target.value)} />
            </div>

            <div className="op-field">
              <span className="lbl">{t('fieldType')}</span>
              <div className="op-seg cols4">
                {([
                  ['percent', t('typePercent')],
                  ['fixed', t('typeFixed')],
                  ['second_item', t('typeSecondItem')],
                  ['threshold_reward', t('typeThreshold')],
                ] as const).map(([k, label]) => (
                  <label key={k} className={`op-seg__opt${type === k ? ' is-active' : ''}`}>
                    <input type="radio" name="promoType" checked={type === k} onChange={() => setType(k)} /> {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Headline value — hidden for threshold_reward (its value lives below). */}
            {type !== 'threshold_reward' && (
              <div className="op-field">
                <label htmlFor="promoValue">{type === 'fixed' ? t('fieldValueFixed') : type === 'second_item' ? t('fieldValueSecondItem') : t('fieldValuePercent')}</label>
                <input id="promoValue" className={`op-input mono${value && !valueValid ? ' err' : ''}`} inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />
                {value && !valueValid && <span className="op-field-err">{t('errGeneric')}</span>}
              </div>
            )}

            {/* threshold_reward: seuil + récompense (remise % ou article offert). */}
            {type === 'threshold_reward' && (
              <div className="op-field" style={{ gap: 12 }}>
                <div className="op-field">
                  <label htmlFor="promoThreshold">{t('fieldThreshold')}</label>
                  <input id="promoThreshold" className={`op-input mono${threshold && !thresholdValid ? ' err' : ''}`} inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} />
                  {threshold && !thresholdValid && <span className="op-field-err">{t('errGeneric')}</span>}
                </div>
                <div className="op-chip-inline">
                  <label className="op-checkrow"><input type="radio" name="rewardKind" checked={rewardKind === 'percent'} onChange={() => setRewardKind('percent')} /> {t('rewardPercent')}</label>
                  <label className="op-checkrow"><input type="radio" name="rewardKind" checked={rewardKind === 'free_item'} onChange={() => setRewardKind('free_item')} /> {t('rewardFreeItem')}</label>
                </div>
                {rewardKind === 'percent' ? (
                  <div className="op-field">
                    <label htmlFor="promoRewardPct">{t('fieldRewardPct')}</label>
                    <input id="promoRewardPct" className={`op-input mono${rewardPct && !rewardValid ? ' err' : ''}`} inputMode="decimal" value={rewardPct} onChange={e => setRewardPct(e.target.value)} />
                    {rewardPct && !rewardValid && <span className="op-field-err">{t('errGeneric')}</span>}
                  </div>
                ) : (
                  <div className="op-field">
                    <span className="lbl">{t('fieldFreeItems')}</span>
                    <span className="op-hint">{t('fieldFreeItemsHint')}</span>
                    <div className="op-checklist">
                      {brandItems.map(m => (
                        <label key={m.id} className="op-checkrow">
                          <input type="checkbox" checked={freeItemIds.includes(m.id)}
                            onChange={e => setFreeItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
                          {m.name}
                        </label>
                      ))}
                      {brandItems.length === 0 && <span className="op-hint">—</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="op-field-row">
              <div className="op-field">
                <label htmlFor="promoStart">{t('fieldStart')}</label>
                <input id="promoStart" className="op-input" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
              </div>
              <div className="op-field">
                <label htmlFor="promoEnd">{t('fieldEnd')}</label>
                <input id="promoEnd" className="op-input" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
              </div>
            </div>

            <div className="op-field">
              <label htmlFor="promoMinOrder">{t('fieldMinOrder')}</label>
              <input id="promoMinOrder" className="op-input mono" inputMode="decimal" value={minOrder} onChange={e => setMinOrder(e.target.value)} />
            </div>

            <div className="op-field">
              <span className="lbl">{t('fieldItems')}</span>
              <span className="op-hint">{t('fieldItemsHint')}</span>
              <div className="op-checklist">
                {brandItems.map(m => (
                  <label key={m.id} className="op-checkrow">
                    <input type="checkbox" checked={itemIds.includes(m.id)}
                      onChange={e => setItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
                    {m.name}
                  </label>
                ))}
                {brandItems.length === 0 && <span className="op-hint">—</span>}
              </div>
            </div>

            <div className="op-field">
              <span className="lbl">{t('fieldChannels')}</span>
              <div className="op-chip-inline">
                {(['delivery', 'pickup'] as const).map(c => (
                  <label key={c} className="op-checkrow">
                    <input type="checkbox" checked={channels.includes(c)}
                      onChange={e => setChannels(prev => e.target.checked ? [...prev, c] : prev.filter(x => x !== c))} />
                    {c === 'pickup' ? t('channelPickup') : t('channelDelivery')}
                  </label>
                ))}
              </div>
            </div>

            {/* honest « pas de cumul » reminder inside the modal (server engine) */}
            <div className="op-callout">
              <span className="ms">info</span>
              <p>{op('promotions.bestOfNote')}</p>
            </div>

            {formError && (
              <div className="op-callout err"><span className="ms">error</span><p>{formError}</p></div>
            )}
          </div>
          <div className="op-modal__foot">
            <button type="button" className="op-btn-ghost" onClick={() => setOpen(false)} disabled={saving}>{t('btnCancel')}</button>
            <button type="button" className="op-btn-primary" onClick={create} disabled={saving || !formValid}>
              <span className={`ms${saving ? ' spin' : ''}`}>{saving ? 'progress_activity' : 'check'}</span>{t('btnCreate')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Anti-gaspi modal — « stock à écouler » → flash percent en 1 clic ── */}
      <div className={`op-modal-backdrop${agOpen ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget && !agSaving) setAgOpen(false) }}>
        <div className="op-modal narrow" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('agTitle')}</h3>
            <button type="button" className="op-modal__close" onClick={() => !agSaving && setAgOpen(false)}><span className="ms">close</span></button>
          </div>
          <div className="op-modal__body">
            <div className="op-callout"><span className="ms">recycling</span><p>{t('agIntro')}</p></div>
            {brands.length > 1 && (
              <div className="op-field">
                <span className="lbl">{t('fieldBrand')}</span>
                <select className="op-select" value={brandId} onChange={e => { setBrandId(e.target.value); setAgItemIds([]) }}>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}
                </select>
              </div>
            )}
            <div className="op-field">
              <span className="lbl">{t('agItems')}</span>
              <div className="op-checklist">
                {brandItems.map(m => (
                  <label key={m.id} className="op-checkrow">
                    <input type="checkbox" checked={agItemIds.includes(m.id)}
                      onChange={e => setAgItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
                    {m.name}
                  </label>
                ))}
                {brandItems.length === 0 && <span className="op-hint">—</span>}
              </div>
            </div>
            <div className="op-field">
              <label htmlFor="agExpiry">{t('agExpiry')}</label>
              <input id="agExpiry" className="op-input" type="datetime-local" value={agExpiry} onChange={e => setAgExpiry(e.target.value)} />
            </div>
            <div className="op-field">
              <label htmlFor="agPct">{t('agPctLabel')}</label>
              <input id="agPct" className="op-input mono" inputMode="decimal" value={agPct} onChange={e => setAgPct(e.target.value)} />
              <span className="op-hint">{t('agSuggestHint', { pct: Number.isFinite(agPctNum) ? Math.round(agPctNum) : 30 })}</span>
            </div>
            {agError && (
              <div className="op-callout err"><span className="ms">error</span><p>{agError}</p></div>
            )}
          </div>
          <div className="op-modal__foot">
            <button type="button" className="op-btn-ghost" onClick={() => setAgOpen(false)} disabled={agSaving}>{t('btnCancel')}</button>
            <button type="button" className="op-btn-primary" onClick={launchAntiGaspi} disabled={agSaving || !agValid}>
              <span className={`ms${agSaving ? ' spin' : ''}`}>{agSaving ? 'progress_activity' : 'bolt'}</span>{t('agLaunch')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Campaign opt-in modal (Promo V2 Slice 2) ── */}
      <div className={`op-modal-backdrop${optInTarget ? ' open' : ''}`} onClick={e => { if (e.target === e.currentTarget && !optInSaving) setOptInTarget(null) }}>
        <div className="op-modal narrow" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('campaignOptInTitle')}</h3>
            <button type="button" className="op-modal__close" onClick={() => !optInSaving && setOptInTarget(null)}><span className="ms">close</span></button>
          </div>
          {optInTarget && (
            <>
              <div className="op-modal__body">
                <div className="op-callout">
                  <span className="ms">restaurant_menu</span>
                  <p>{t('campaignOptInIntro', { creator: optInTarget.creatorName, dish: optInTarget.dishName, pct: optInTarget.suggestedDiscountPct })}</p>
                </div>
                <div className="op-field">
                  <label htmlFor="optInPct">{t('campaignYourPct')}</label>
                  <input id="optInPct" className={`op-input mono${optInPct && !optInValid ? ' err' : ''}`} inputMode="decimal" value={optInPct} onChange={e => setOptInPct(e.target.value)} />
                  {optInPct && !optInValid && <span className="op-field-err">{t('errGeneric')}</span>}
                </div>
                <span className="op-hint">{t('campaignOptInFinanceNote')}</span>
                {optInError && (
                  <div className="op-callout err"><span className="ms">error</span><p>{optInError}</p></div>
                )}
              </div>
              <div className="op-modal__foot">
                <button type="button" className="op-btn-ghost" onClick={() => setOptInTarget(null)} disabled={optInSaving}>{t('btnCancel')}</button>
                <button type="button" className="op-btn-primary" onClick={confirmOptIn} disabled={optInSaving || !optInValid}>
                  <span className={`ms${optInSaving ? ' spin' : ''}`}>{optInSaving ? 'progress_activity' : 'check'}</span>{t('campaignConfirmJoin')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
