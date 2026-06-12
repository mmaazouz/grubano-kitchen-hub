'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { BadgePercent, Plus, Loader2, AlertCircle } from 'lucide-react'
import { Modal, Button, Input } from '@/components/design-system'

// ── <PromotionsManager /> — chantier P1, l'écran resto ─────────────────────────
// Lists the establishment's promotions (status badge, usage count), creates V1
// promos (percent 1-90 | fixed > 0, window, optional minOrderEur / targeted
// items / channels) and soft-toggles them. Consumes /api/restaurant/promotions
// (strict brand ownership server-side). The ENGINE applies them automatically
// at checkout — best one for the customer, never stacked (D5).

type Promotion = {
  id: string; brandId: string; name: string; type: string; discount: number
  conditions: { minOrderEur?: number; itemIds?: string[]; channels?: string[] } | null
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
  const [type,      setType]      = useState<'percent' | 'fixed'>('percent')
  const [value,     setValue]     = useState('')
  const [start,     setStart]     = useState('')
  const [end,       setEnd]       = useState('')
  const [minOrder,  setMinOrder]  = useState('')
  const [itemIds,   setItemIds]   = useState<string[]>([])
  const [channels,  setChannels]  = useState<string[]>([])

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
    if (brands.length && !brandId) setBrandId(brands[0].id)
    setOpen(true)
  }

  const valueNum    = parseFloat(value.replace(',', '.'))
  const valueValid  = Number.isFinite(valueNum) &&
    (type === 'percent' ? valueNum >= 1 && valueNum <= 90 : valueNum > 0)
  const datesValid  = !!start && !!end && new Date(end) > new Date(start)
  const formValid   = !!brandId && name.trim().length >= 2 && valueValid && datesValid

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

      const r = await fetch('/api/restaurant/promotions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId,
          name:      name.trim(),
          type,
          discount:  valueNum,
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

  const brandItems = menuItems.filter(m => m.brandId === brandId)

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-display font-bold tracking-tight">
          <BadgePercent size={20} className="text-primary" /> {t('title')}
        </h1>
        <Button size="sm" onClick={openCreate} leftIcon={<Plus size={14} />}>{t('btnNew')}</Button>
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
                    {p.type === 'percent'
                      ? t('valuePercent', { value: p.discount })
                      : t('valueFixed', { value: eur(p.discount) })}
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

          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" checked={type === 'percent'} onChange={() => setType('percent')} /> {t('typePercent')}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" checked={type === 'fixed'} onChange={() => setType('fixed')} /> {t('typeFixed')}
            </label>
          </div>

          <Input
            label={type === 'percent' ? t('fieldValuePercent') : t('fieldValueFixed')}
            inputMode="decimal"
            value={value}
            onChange={e => setValue(e.target.value)}
            error={value && !valueValid ? t('errGeneric') : undefined}
          />

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
    </div>
  )
}
