'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowLeft, Plus, Minus, ShoppingCart, X, Check, Loader2, CheckCircle2, MapPin } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'

// ── /marketplace/suppliers/[id] — supplier catalogue + per-supplier cart (Slice 2)
// One order = one supplier. The cart is client-side (component state). On submit,
// POST /api/marketplace/orders snapshots prices server-side. Operator-gated.

interface CatalogItem {
  id: string
  name: string
  description: string | null
  category: string
  priceCents: number
  unit: string
  packSize: string | null
  allergens: string[]
}
interface DiscoverSupplier {
  id: string
  companyName: string
  city: string | null
  minimumOrderCents: number
  leadTimeDays: number
  catalogItems: CatalogItem[]
}

export default function SupplierStorefrontPage({ params }: { params: { id: string } }) {
  const t  = useTranslations('marketplace')
  const ts = useTranslations('supplier')
  const locale = useLocale()

  const [supplier, setSupplier] = useState<DiscoverSupplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [cart, setCart] = useState<Record<string, number>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState('')
  const [placed, setPlaced] = useState<{ totalCents: number } | null>(null)

  useEffect(() => {
    fetch('/api/marketplace/suppliers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const found = (d.suppliers as DiscoverSupplier[]).find((s) => s.id === params.id)
        if (found) setSupplier(found)
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [params.id])

  const items = supplier?.catalogItems ?? []
  const setQty = (id: string, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, q) }))

  const lines = useMemo(
    () => items.filter((it) => (cart[it.id] ?? 0) > 0).map((it) => ({ it, qty: cart[it.id] })),
    [items, cart],
  )
  const totalCents = lines.reduce((s, l) => s + l.it.priceCents * l.qty, 0)
  const lineCount  = lines.reduce((s, l) => s + l.qty, 0)
  const minOrderCents = supplier?.minimumOrderCents ?? 0
  const belowMin = minOrderCents > 0 && totalCents < minOrderCents

  const byCategory = useMemo(() => {
    const map = new Map<string, CatalogItem[]>()
    for (const it of items) {
      const arr = map.get(it.category) ?? []
      arr.push(it); map.set(it.category, arr)
    }
    return Array.from(map.entries())
  }, [items])

  async function placeOrder() {
    if (placing || !lines.length || belowMin) return
    setPlacing(true); setPlaceError('')
    try {
      const res = await fetch('/api/marketplace/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierProfileId: params.id,
          lines: lines.map((l) => ({ catalogItemId: l.it.id, quantity: l.qty })),
          notes: notes.trim() || null,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setPlaceError(d?.error || t('errOrder')); return }
      setPlaced({ totalCents: d?.order?.totalCents ?? totalCents })
      setCart({}); setConfirmOpen(false)
    } catch {
      setPlaceError(t('errOrder'))
    } finally {
      setPlacing(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-grubano-primary" /></div>
  if (notFound || !supplier) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-grubano-ink-muted">{t('supplierNotFound')}</p>
        <Link href="/marketplace/suppliers" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
          <ArrowLeft size={14} /> {t('backToList')}
        </Link>
      </div>
    )
  }

  // ── Confirmation screen after a successful order ──
  if (placed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-grubano-pill bg-grubano-success-tint">
          <CheckCircle2 size={32} className="text-grubano-success" />
        </span>
        <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('orderPlacedTitle')}</h1>
        <p className="mt-1 text-grubano-ink-muted">{t('orderPlacedBody', { supplier: supplier.companyName })}</p>
        <p className="mt-3 text-lg font-bold text-grubano-ink">{t('cartTotal')}: {formatMoney(placed.totalCents, locale)}</p>
        <Link href="/marketplace/suppliers" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
          <ArrowLeft size={14} /> {t('backToSuppliers')}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-28 md:px-6">
      <Link href="/marketplace/suppliers" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
        <ArrowLeft size={15} /> {t('backToList')}
      </Link>
      <div className="mb-1 flex items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{supplier.companyName}</h1>
      </div>
      <p className="mb-5 flex flex-wrap items-center gap-x-3 text-sm text-grubano-ink-muted">
        {supplier.city && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {supplier.city}</span>}
        <span>{ts('leadTimeValue', { days: supplier.leadTimeDays })}</span>
        {minOrderCents > 0 && <span>{t('minOrder', { amount: formatMoney(minOrderCents, locale) })}</span>}
      </p>

      {items.length === 0 ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-ink-muted">{t('catalogEmpty')}</p></Card>
      ) : (
        <div className="space-y-5">
          {byCategory.map(([cat, catItems]) => (
            <div key={cat}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-grubano-ink-faint">{cat}</h2>
              <ul className="space-y-2">
                {catItems.map((it) => {
                  const qty = cart[it.id] ?? 0
                  return (
                    <li key={it.id}>
                      <Card elevation="sm" padding="md">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-grubano-ink truncate">{it.name}</p>
                            <p className="text-xs text-grubano-ink-muted">
                              {formatMoney(it.priceCents, locale)} / {ts(`u${it.unit.charAt(0).toUpperCase()}${it.unit.slice(1)}` as 'uKg')}
                              {it.packSize ? ` · ${it.packSize}` : ''}
                            </p>
                          </div>
                          {qty === 0 ? (
                            <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setQty(it.id, 1)}>
                              {t('addToCart')}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button onClick={() => setQty(it.id, qty - 1)} aria-label="-" className="grid h-8 w-8 place-items-center rounded-grubano-md border border-grubano-border text-grubano-ink"><Minus size={14} /></button>
                              <span className="w-6 text-center text-sm font-bold tabular-nums">{qty}</span>
                              <button onClick={() => setQty(it.id, qty + 1)} aria-label="+" className="grid h-8 w-8 place-items-center rounded-grubano-md border border-grubano-border text-grubano-ink"><Plus size={14} /></button>
                            </div>
                          )}
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Sticky cart bar */}
      {lineCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-grubano-border bg-grubano-surface/95 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-bold text-grubano-ink">{formatMoney(totalCents, locale)}</p>
              <p className="text-[11px] text-grubano-ink-muted">
                {t('cartCount', { count: lineCount })}{belowMin ? ` · ${t('minOrderWarning', { amount: formatMoney(minOrderCents, locale) })}` : ''}
              </p>
            </div>
            <Button variant="primary" size="md" leftIcon={<ShoppingCart size={16} />} disabled={belowMin} onClick={() => setConfirmOpen(true)}>
              {t('placeOrder')}
            </Button>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !placing && setConfirmOpen(false)}>
          <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-grubano-ink">{t('cartTitle')}</h2>
              <button onClick={() => !placing && setConfirmOpen(false)} aria-label={t('close')}><X size={18} className="text-grubano-ink-muted" /></button>
            </div>
            {placeError && <p className="mb-3 rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{placeError}</p>}
            <ul className="mb-3 max-h-56 space-y-1.5 overflow-auto">
              {lines.map((l) => (
                <li key={l.it.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-grubano-ink"><span className="font-semibold">{l.qty}×</span> {l.it.name}</span>
                  <span className="shrink-0 tabular-nums text-grubano-ink-muted">{formatMoney(l.it.priceCents * l.qty, locale)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-3 flex justify-between border-t border-grubano-border pt-2 text-base font-bold text-grubano-ink">
              <span>{t('cartTotal')}</span><span>{formatMoney(totalCents, locale)}</span>
            </div>
            <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('notesLabel')}</label>
            <textarea
              rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')}
              className="mb-3 w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
            />
            <Button variant="primary" size="md" fullWidth loading={placing} leftIcon={placing ? undefined : <Check size={16} />} onClick={placeOrder}>
              {placing ? t('placing') : t('confirmOrder')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
