'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { BadgePercent, Plus, Loader2, AlertCircle, Clock3, Sparkles } from 'lucide-react'
import { Modal, Button, Input } from '@/components/design-system'

type PromoType = 'percent' | 'fixed' | 'second_item' | 'threshold_reward'

// ── <PromotionsManager /> — chantier P1, l'écran resto ─────────────────────────
// Lists the establishment's promotions (status badge, usage count), creates V1
// promos (percent 1-90 | fixed > 0, window, optional minOrderEur / targeted
// items / channels) and soft-toggles them. Consumes /api/restaurant/promotions
// (strict brand ownership server-side). The ENGINE applies them automatically
// at checkout — best one for the customer, never stacked (D5).

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
  const locale = useLocale()

  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [brands,     setBrands]     = useState<BrandRow[]>([])
  const [menuItems,  setMenuItems]  = useState<MenuItemRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError,  setLoadError]  = useState(false)
  const [toast,      setToast]      = useState('')

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

  const eur = useMemo(() => (n: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(n), [locale])
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
  }, [brandId])

  useEffect(() => { load() }, [load])

  function statusOf(p: Promotion): { key: string; tone: string } {
    const now = Date.now()
    if (!p.active) return { key: 'badgeInactive', tone: 'bg-muted text-muted-foreground' }
    if (now < new Date(p.startDate).getTime()) return { key: 'badgeUpcoming', tone: 'bg-warning/10 text-warning' }
    if (now > new Date(p.endDate).getTime())   return { key: 'badgeExpired',  tone: 'bg-muted text-muted-foreground' }
    return { key: 'badgeActive', tone: 'bg-success/10 text-success' }
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

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-display font-bold tracking-tight">
          <BadgePercent size={20} className="text-primary" /> {t('title')}
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setAgError(''); setAgItemIds([]); setAgExpiry(''); setAgPct('30'); if (brands.length && !brandId) setBrandId(brands[0].id); setAgOpen(true) }} leftIcon={<Clock3 size={14} />}>{t('agBtn')}</Button>
          <Button size="sm" onClick={openCreate} leftIcon={<Plus size={14} />}>{t('btnNew')}</Button>
        </div>
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{t('subtitle')}</p>
      <p className="mb-5 rounded-xl bg-accent px-3 py-2 text-[12px] text-muted-foreground">{t('docFinance')}</p>

      {toast && (
        <p className="mb-3 rounded-xl bg-navy px-3 py-2 text-[12px] font-semibold text-navy-foreground">{toast}</p>
      )}

      {loading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-navy/10" />
      ) : loadError ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-[13px] text-muted-foreground">
          <AlertCircle size={14} /> {t('errLoad')}
        </p>
      ) : promotions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {promotions.map(p => {
            const st = statusOf(p)
            return (
              <div key={p.id} className="rounded-2xl border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold">{p.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.tone}`}>{t(st.key)}</span>
                  <span className="ms-auto text-[15px] font-bold tabular-nums text-primary">
                    {p.type === 'percent'      ? t('valuePercent', { value: p.discount })
                     : p.type === 'fixed'       ? t('valueFixed', { value: eur(p.discount) })
                     : p.type === 'second_item' ? t('valueSecondItem', { value: p.discount })
                     : p.type === 'threshold_reward'
                       ? t('valueThreshold', { amount: eur(p.conditions?.thresholdEur ?? 0) })
                       : t('valuePercent', { value: p.discount })}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{t('windowLabel', { start: dateFmt(p.startDate), end: dateFmt(p.endDate) })}</span>
                  {p.conditions?.minOrderEur ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5">{t('minOrderPill', { amount: eur(p.conditions.minOrderEur) })}</span>
                  ) : null}
                  {p.conditions?.itemIds?.length ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5">{t('itemsPill', { count: p.conditions.itemIds.length })}</span>
                  ) : null}
                  {p.conditions?.channels?.map(c => (
                    <span key={c} className="rounded-full bg-muted px-1.5 py-0.5">
                      {c === 'pickup' ? t('channelPickup') : t('channelDelivery')}
                    </span>
                  ))}
                  <span>· {t('usage', { count: p.usageCount })}</span>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    className="ms-auto rounded-lg border border-border px-2 py-1 text-[10px] font-bold"
                  >
                    {p.active ? t('btnDeactivate') : t('btnReactivate')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Create modal ── */}
      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title={t('formTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>{t('btnCancel')}</Button>
            <Button onClick={create} disabled={saving || !formValid}>
              {saving ? <Loader2 size={13} className="me-1 animate-spin" /> : null}
              {t('btnCreate')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {brands.length > 1 && (
            <label className="block text-[13px]">
              <span className="mb-1 block font-semibold">{t('fieldBrand')}</span>
              <select
                value={brandId}
                onChange={e => { setBrandId(e.target.value); setItemIds([]) }}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px]"
              >
                {brands.map(b => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}
              </select>
            </label>
          )}

          <Input label={t('fieldName')} placeholder={t('fieldNamePh')} value={name} onChange={e => setName(e.target.value)} />

          <div className="grid grid-cols-2 gap-2">
            {([
              ['percent', t('typePercent')],
              ['fixed', t('typeFixed')],
              ['second_item', t('typeSecondItem')],
              ['threshold_reward', t('typeThreshold')],
            ] as const).map(([k, label]) => (
              <label key={k} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${type === k ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <input type="radio" checked={type === k} onChange={() => setType(k)} /> {label}
              </label>
            ))}
          </div>

          {/* Headline value — hidden for threshold_reward (its value lives below). */}
          {type !== 'threshold_reward' && (
            <Input
              label={type === 'fixed' ? t('fieldValueFixed') : type === 'second_item' ? t('fieldValueSecondItem') : t('fieldValuePercent')}
              inputMode="decimal"
              value={value}
              onChange={e => setValue(e.target.value)}
              error={value && !valueValid ? t('errGeneric') : undefined}
            />
          )}

          {/* Promo V2 — threshold_reward: seuil + récompense (remise % ou article offert). */}
          {type === 'threshold_reward' && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <Input label={t('fieldThreshold')} inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)}
                error={threshold && !thresholdValid ? t('errGeneric') : undefined} />
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={rewardKind === 'percent'} onChange={() => setRewardKind('percent')} /> {t('rewardPercent')}
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={rewardKind === 'free_item'} onChange={() => setRewardKind('free_item')} /> {t('rewardFreeItem')}
                </label>
              </div>
              {rewardKind === 'percent' ? (
                <Input label={t('fieldRewardPct')} inputMode="decimal" value={rewardPct} onChange={e => setRewardPct(e.target.value)}
                  error={rewardPct && !rewardValid ? t('errGeneric') : undefined} />
              ) : (
                <div>
                  <p className="mb-1 text-[13px] font-semibold">{t('fieldFreeItems')}</p>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">{t('fieldFreeItemsHint')}</p>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {brandItems.map(m => (
                      <label key={m.id} className="flex items-center gap-2 text-[12px]">
                        <input type="checkbox" checked={freeItemIds.includes(m.id)}
                          onChange={e => setFreeItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
                        {m.name}
                      </label>
                    ))}
                    {brandItems.length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Input label={t('fieldStart')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            <Input label={t('fieldEnd')}   type="datetime-local" value={end}   onChange={e => setEnd(e.target.value)} />
          </div>

          <Input label={t('fieldMinOrder')} inputMode="decimal" value={minOrder} onChange={e => setMinOrder(e.target.value)} />

          <div>
            <p className="mb-1 text-[13px] font-semibold">{t('fieldItems')}</p>
            <p className="mb-1.5 text-[11px] text-muted-foreground">{t('fieldItemsHint')}</p>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {brandItems.map(m => (
                <label key={m.id} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={itemIds.includes(m.id)}
                    onChange={e => setItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))}
                  />
                  {m.name}
                </label>
              ))}
              {brandItems.length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
            </div>
          </div>

          <div>
            <p className="mb-1 text-[13px] font-semibold">{t('fieldChannels')}</p>
            <div className="flex gap-3">
              {(['delivery', 'pickup'] as const).map(c => (
                <label key={c} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={e => setChannels(prev => e.target.checked ? [...prev, c] : prev.filter(x => x !== c))}
                  />
                  {c === 'pickup' ? t('channelPickup') : t('channelDelivery')}
                </label>
              ))}
            </div>
          </div>

          {formError && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" /> {formError}
            </p>
          )}
        </div>
      </Modal>

      {/* ── Anti-gaspi modal — « stock à écouler » → flash percent en 1 clic ── */}
      <Modal
        open={agOpen}
        onClose={() => !agSaving && setAgOpen(false)}
        title={t('agTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAgOpen(false)} disabled={agSaving}>{t('btnCancel')}</Button>
            <Button onClick={launchAntiGaspi} disabled={agSaving || !agValid} leftIcon={agSaving ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={14} />}>
              {t('agLaunch')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="rounded-xl bg-accent px-3 py-2 text-[12px] text-muted-foreground">{t('agIntro')}</p>
          {brands.length > 1 && (
            <label className="block text-[13px]">
              <span className="mb-1 block font-semibold">{t('fieldBrand')}</span>
              <select value={brandId} onChange={e => { setBrandId(e.target.value); setAgItemIds([]) }}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px]">
                {brands.map(b => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}
              </select>
            </label>
          )}
          <div>
            <p className="mb-1 text-[13px] font-semibold">{t('agItems')}</p>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {brandItems.map(m => (
                <label key={m.id} className="flex items-center gap-2 text-[12px]">
                  <input type="checkbox" checked={agItemIds.includes(m.id)}
                    onChange={e => setAgItemIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
                  {m.name}
                </label>
              ))}
              {brandItems.length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
            </div>
          </div>
          <Input label={t('agExpiry')} type="datetime-local" value={agExpiry} onChange={e => setAgExpiry(e.target.value)} />
          {/* Suggestion pré-remplie (heuristique −30%), réglable. */}
          <Input label={t('agPctLabel')} inputMode="decimal" value={agPct} onChange={e => setAgPct(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{t('agSuggestHint', { pct: Number.isFinite(agPctNum) ? Math.round(agPctNum) : 30 })}</p>
          {agError && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" /> {agError}
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
