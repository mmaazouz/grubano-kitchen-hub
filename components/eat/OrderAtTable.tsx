'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Loader2, AlertCircle, Plus, Minus, X, Check, UtensilsCrossed } from 'lucide-react'

// ── <OrderAtTable /> — client order-at-table (étape 3 bloc B, Agent 13) ──────
//
// The connected guest whose linked reservation is 'arrived' browses the
// restaurant's menu, picks dishes + quantities + an optional note and
// allergies, and POSTs Agent 2's order endpoint:
//   POST /api/t/[tableId]/order
//   body { items: [{ menuItemId, quantity(1-99), notes?, allergies? }] (1..50) }
//   → 201 { ticket, added }
// Errors are mapped per the étape-1 contract: 401 (sign in), 403
// walkin_no_order / not_your_session, 409 not_arrived. The guest can order
// SEVERAL times; there is NO line-removal affordance client-side (T3.Q2 —
// only the operator can cancel a line).
//
// Menu source: the PUBLIC consumer endpoint /api/restaurants/[id] (the same
// the /eat/r page uses), flattened across categories. Prices shown come from
// it; the SERVER re-reads MenuItem prices at insert (never trusts the body).

interface MenuLine {
  id:    string
  name:  string
  price: number
}

interface Props {
  tableId:      string
  restaurantId: string
  /** Refresh hook — the parent re-pulls the ticket so the new lines appear
   *  (polling would catch them anyway; this just makes it instant). */
  onOrdered?: () => void
  onClose:    () => void
}

export default function OrderAtTable({ tableId, restaurantId, onOrdered, onClose }: Props) {
  const t = useTranslations('premium.order')
  const locale = useLocale()

  const [menu,      setMenu]      = useState<MenuLine[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [qty,       setQty]       = useState<Record<string, number>>({})
  const [notes,     setNotes]     = useState('')
  const [allergies, setAllergies] = useState('')
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState('')
  const [done,      setDone]      = useState(false)

  // ── Menu fetch (public consumer endpoint, flattened) ─────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetch(`/api/restaurants/${restaurantId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('load_failed')
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        // /api/restaurants/[id] returns the menu grouped by category:
        // { restaurant, menu: [{ category, items: [{ id, name, price, ... }] }] }
        const flat: MenuLine[] = []
        const groups = Array.isArray(body?.menu) ? body.menu : []
        for (const g of groups) {
          const items = Array.isArray(g?.items) ? g.items : []
          for (const it of items) {
            if (it?.id && it?.name && typeof it?.price === 'number') {
              flat.push({ id: it.id, name: it.name, price: it.price })
            }
          }
        }
        setMenu(flat)
      })
      .catch(() => { if (!cancelled) setLoadError(t('errGeneric')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [restaurantId, t])

  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
    [locale],
  )

  const cart = useMemo(
    () => menu.filter((m) => (qty[m.id] ?? 0) > 0).map((m) => ({ ...m, quantity: qty[m.id] })),
    [menu, qty],
  )
  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.price * l.quantity, 0),
    [cart],
  )

  function bump(id: string, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, Math.min(99, (prev[id] ?? 0) + delta))
      return { ...prev, [id]: next }
    })
  }

  async function submit() {
    if (sending) return
    if (cart.length === 0) { setError(t('cartEmpty')); return }
    setSending(true)
    setError('')
    try {
      const r = await fetch(`/api/t/${tableId}/order`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.slice(0, 50).map((l) => ({
            menuItemId: l.id,
            quantity:   l.quantity,
            ...(notes.trim()     ? { notes: notes.trim().slice(0, 280) }         : {}),
            ...(allergies.trim() ? { allergies: allergies.trim().slice(0, 280) } : {}),
          })),
        }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) {
        const code = body?.code as string | undefined
        if (r.status === 401)                 setError(t('errAuth'))
        else if (code === 'walkin_no_order')  setError(t('errWalkin'))
        else if (code === 'not_your_session') setError(t('errNotYours'))
        else if (code === 'not_arrived' || code === 'no_open_ticket') setError(t('errNotArrived'))
        else setError((body?.error as string) || t('errGeneric'))
        return
      }
      setDone(true)
      onOrdered?.()
    } catch {
      setError(t('errGeneric'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-background sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="flex items-center gap-2 text-base font-bold">
            <UtensilsCrossed size={16} className="text-primary" /> {t('title')}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="grid h-9 w-9 place-items-center rounded-xl bg-muted"
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="p-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success text-white">
              <Check size={20} />
            </span>
            <p className="mt-3 text-sm font-bold text-foreground">{t('added')}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
            >
              {t('close')}
            </button>
          </div>
        ) : (
          <>
            {/* Scrollable menu list */}
            <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> {t('menuLoading')}
                </div>
              ) : loadError ? (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>{loadError}</span>
                </p>
              ) : menu.length === 0 ? (
                <p className="rounded-xl border border-border bg-card px-3 py-8 text-center text-[12px] text-muted-foreground">
                  {t('menuEmpty')}
                </p>
              ) : (
                menu.map((m) => {
                  const q = qty[m.id] ?? 0
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
                        q > 0 ? 'border-primary bg-primary/5' : 'border-border bg-card'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
                        <p className="text-[11px] text-muted-foreground">{fmt.format(m.price)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => bump(m.id, -1)}
                          disabled={q === 0}
                          aria-label="-"
                          className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground disabled:opacity-30"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{q}</span>
                        <button
                          type="button"
                          onClick={() => bump(m.id, 1)}
                          aria-label="+"
                          className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer: notes + allergies + total + submit */}
            <div className="space-y-2 border-t border-border p-4">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('notesPh')}
                maxLength={280}
                aria-label={t('notesLabel')}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[12px] focus:border-primary focus:outline-none"
              />
              <input
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder={t('allergiesPh')}
                maxLength={280}
                aria-label={t('allergiesLabel')}
                className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[12px] focus:border-primary focus:outline-none"
              />

              {error && (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}

              <div className="flex items-center justify-between text-[12px] font-bold">
                <span className="text-muted-foreground">{t('total')}</span>
                <span className="text-primary">{fmt.format(cartTotal)}</span>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={sending || cart.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : null}
                {sending ? t('submitting') : t('submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
