'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatMoney } from '@/lib/format-money'
import { readSupplyCart, writeSupplyCart, clearSupplyCart, type SupplyCart } from '@/lib/supply-cart'

// ── Supplier cart — order validation (flux acheteur, Lot E) ──────────────────────
// CLIENT half of /marketplace/suppliers/[id]/panier. The server passed the real
// supplier + available items (authoritative priceCents); this component reads the
// browser cart (lib/supply-cart, quantities only) and joins them for a DISPLAY-ONLY
// preview. « Passer la commande » posts ONLY {catalogItemId, quantity} (+ notes,
// desiredDate) to the EXISTING POST /api/marketplace/orders — the server recomputes
// the total in CENTS and re-enforces the minimum, so a forged quantity/price is
// impossible to inject. « Payer en ligne » is a locked, inert button (the /pay flow
// is untouched). No commission line is shown to the buyer.

interface CartItem {
  id: string
  name: string
  priceCents: number
  unit: string
  packSize: string | null
}
interface DayChip { iso: string; weekday: string; dm: string }

export default function CartClient({
  supplierId,
  companyName,
  city,
  minimumOrderCents,
  leadTimeDays,
  items,
}: {
  supplierId: string
  companyName: string
  city: string | null
  minimumOrderCents: number
  leadTimeDays: number
  items: CartItem[]
}) {
  const t  = useTranslations('marketplaceCart')
  const ts = useTranslations('supplier')
  const locale = useLocale()
  const router = useRouter()

  const [mounted, setMounted] = useState(false)
  const [cart, setCart] = useState<SupplyCart>({})
  const [notes, setNotes] = useState('')
  const [desiredDate, setDesiredDate] = useState<string | null>(null)
  const [days, setDays] = useState<DayChip[]>([])
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState('')
  const [placed, setPlaced] = useState<{ totalCents: number } | null>(null)

  const byId = useMemo(() => {
    const m = new Map<string, CartItem>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  // Mount: hydrate the cart from storage + build the real delivery-day chips.
  useEffect(() => {
    setCart(readSupplyCart(supplierId))
    // Earliest deliverable day = today + the supplier's REAL lead time; then a short
    // run of consecutive calendar days. No day is disabled — we don't model supplier
    // closures, so inventing an unavailable weekday would be dishonest.
    const base = new Date()
    base.setHours(12, 0, 0, 0)
    base.setDate(base.getDate() + Math.max(0, leadTimeDays))
    const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    const out: DayChip[] = []
    for (let i = 0; i < 5; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      out.push({ iso: d.toISOString(), weekday: wd.format(d), dm: `${dd}/${mm}` })
    }
    setDays(out)
    setDesiredDate(out[0]?.iso ?? null)
    setMounted(true)
  }, [supplierId, leadTimeDays, locale])

  // Keep storage in sync so edits here survive a refresh (until the order is placed).
  useEffect(() => { if (mounted) writeSupplyCart(supplierId, cart) }, [mounted, supplierId, cart])

  const setQty = (id: string, q: number) =>
    setCart((c) => {
      const next = { ...c }
      if (q > 0) next[id] = q
      else delete next[id]
      return next
    })

  const unitLabel = (unit: string) => {
    const k = `u${unit.charAt(0).toUpperCase()}${unit.slice(1)}`
    const label = ts(k as 'uKg')
    return label === k ? unit : label
  }

  // Cart lines — only items still available (server sent available-only) and in the cart.
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ it: byId.get(id), qty }))
        .filter((l): l is { it: CartItem; qty: number } => !!l.it && l.qty > 0),
    [cart, byId],
  )
  const totalCents = lines.reduce((s, l) => s + l.it.priceCents * l.qty, 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const hasMin = minimumOrderCents > 0
  const belowMin = hasMin && totalCents < minimumOrderCents
  const shortfallCents = Math.max(minimumOrderCents - totalCents, 0)
  const canSubmit = !placing && lines.length > 0 && !belowMin

  async function placeOrder() {
    if (!canSubmit) return
    setPlacing(true); setPlaceError('')
    try {
      const res = await fetch('/api/marketplace/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierProfileId: supplierId,
          lines: lines.map((l) => ({ catalogItemId: l.it.id, quantity: l.qty })),
          notes: notes.trim() || null,
          desiredDate: desiredDate || null,
        }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) { setPlaceError(d?.error || t('errOrder')); return }
      clearSupplyCart(supplierId)
      setPlaced({ totalCents: d?.order?.totalCents ?? totalCents })
    } catch {
      setPlaceError(t('errOrder'))
    } finally {
      setPlacing(false)
    }
  }

  const logoInitials =
    companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'F'

  // ── Order sent — confirmation ────────────────────────────────────────────────
  if (placed) {
    return (
      <section className="mkt-cart">
        <div className="op-card op-center" style={{ minHeight: 420 }}>
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true" style={{ color: 'var(--op-success)' }}>check_circle</span>
            <b>{t('successTitle')}</b>
            <span>{t('successBody', { supplier: companyName })}</span>
            <div className="cart-success__total mono">{formatMoney(placed.totalCents, locale)}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link href="/marketplace/orders" className="op-btn-primary">
                <span className="ms" aria-hidden="true">receipt_long</span>{t('viewOrders')}
              </Link>
              <Link href="/marketplace/suppliers" className="op-btn-ghost">
                <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToMarketplace')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ── Loading (client hydration) — matches the CD skeleton ─────────────────────
  if (!mounted) {
    return (
      <section className="mkt-cart" aria-busy="true">
        <span className="op-sk" style={{ width: 120, height: 16, marginBottom: 14, display: 'block' }} />
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <div className="cart-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <span className="op-sk" style={{ width: '100%', height: 76, borderRadius: 12, display: 'block' }} />
            <span className="op-sk" style={{ width: '100%', height: 240, borderRadius: 12, display: 'block' }} />
          </div>
          <span className="op-sk" style={{ width: '100%', height: 300, borderRadius: 12, display: 'block' }} />
        </div>
      </section>
    )
  }

  // ── Empty cart ───────────────────────────────────────────────────────────────
  if (lines.length === 0) {
    return (
      <section className="mkt-cart">
        <Link href={`/marketplace/suppliers/${supplierId}`} className="op-back">
          <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToCatalog', { supplier: companyName })}
        </Link>
        <h1 className="op-dash__title">{t('title')}</h1>
        <div className="op-card" style={{ marginTop: 16 }}>
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">shopping_cart</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyBody')}</span>
            <Link href="/marketplace/suppliers" className="op-btn-primary">
              <span className="ms" aria-hidden="true">storefront</span>{t('emptyCta')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mkt-cart">
      <Link href={`/marketplace/suppliers/${supplierId}`} className="op-back">
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToCatalog', { supplier: companyName })}
      </Link>
      <h1 className="op-dash__title" style={{ marginBottom: 4 }}>{t('title')}</h1>
      <p className="op-dash__sub" style={{ marginBottom: 18 }}>{t('subtitle')}</p>

      <div className="cart-grid">
        {/* Main column */}
        <div className="cart-col-main">
          {/* Supplier recap */}
          <div className="op-card sup-recap">
            <span className="sup-recap__logo">{logoInitials}</span>
            <div className="sup-recap__m">
              <b>{companyName}</b>
              <div className="row">
                {city && <span><span className="ms" aria-hidden="true">place</span>{city}</span>}
                <span><span className="ms" aria-hidden="true">local_shipping</span>{ts('leadTimeValue', { days: leadTimeDays })}</span>
              </div>
            </div>
            {!belowMin ? (
              <span className="sup-min-ok"><span className="ms" aria-hidden="true">check_circle</span>{t('minReached')}</span>
            ) : (
              <span className="sup-min-warn"><span className="ms" aria-hidden="true">info</span>{t('belowMin')}</span>
            )}
          </div>

          {/* Lines */}
          <div className="op-card cart-lines">
            <div className="cart-lines__head">{t('articles')} <span className="cnt mono">{lines.length}</span></div>
            {lines.map((l) => (
              <div key={l.it.id} className="cl-row">
                <span className="cl-thumb"><span className="ms" aria-hidden="true">nutrition</span></span>
                <div className="cl-m">
                  <b>{l.it.name}</b>
                  {l.it.packSize && <div className="pack">{l.it.packSize}</div>}
                  <div className="unit mono">{t('perUnit', { price: formatMoney(l.it.priceCents, locale), unit: unitLabel(l.it.unit) })}</div>
                </div>
                <div className="stepper">
                  <button type="button" aria-label={t('decLabel')} onClick={() => setQty(l.it.id, l.qty - 1)}><span className="ms" aria-hidden="true">remove</span></button>
                  <span className="q mono">{l.qty}</span>
                  <button type="button" aria-label={t('incLabel')} onClick={() => setQty(l.it.id, l.qty + 1)}><span className="ms" aria-hidden="true">add</span></button>
                </div>
                <div className="cl-sub mono">{formatMoney(l.it.priceCents * l.qty, locale)}</div>
                <button type="button" className="cl-del" aria-label={t('removeLine')} title={t('removeLine')} onClick={() => setQty(l.it.id, 0)}>
                  <span className="ms" aria-hidden="true">delete</span>
                </button>
              </div>
            ))}
          </div>

          {/* Delivery day */}
          <div className="op-card blk">
            <h3 className="blk__title"><span className="ms" aria-hidden="true">event</span>{t('deliveryTitle')}</h3>
            <div className="day-chips">
              {days.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  className={`day-chip${desiredDate === d.iso ? ' is-active' : ''}`}
                  onClick={() => setDesiredDate(d.iso)}
                >
                  <b>{d.weekday}</b><span className="mono">{d.dm}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Note to supplier — persisted via SupplyOrder.notes */}
          <div className="op-card blk">
            <h3 className="blk__title">
              <span className="ms" aria-hidden="true">edit_note</span>{t('noteTitle')}
              <span className="blk__opt">{t('noteOptional')}</span>
            </h3>
            <textarea
              className="cart-note"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notePlaceholder')}
            />
          </div>
        </div>

        {/* Summary column */}
        <div className="cart-col-side">
          <div className="op-card sum-card">
            <h3>{t('summaryTitle')}</h3>
            {placeError && (
              <div className="cart-err"><span className="ms" aria-hidden="true">error</span><span>{placeError}</span></div>
            )}
            <div className="sum-row"><span>{t('subtotal')} · {t('itemsCount', { count })}</span><span className="v mono">{formatMoney(totalCents, locale)}</span></div>
            {belowMin && (
              <div className="sum-row sum-row--warn">
                <span>{t('shortfall')}</span>
                <span className="v mono">{formatMoney(shortfallCents, locale)}</span>
              </div>
            )}
            <div className="sum-sep" />
            <div className="sum-total"><b>{t('total')}</b><span className="v mono">{formatMoney(totalCents, locale)}</span></div>

            <div className="sum-actions">
              <button type="button" className="op-btn-primary" disabled={!canSubmit} onClick={placeOrder}>
                {placing
                  ? <><span className="ms spin" aria-hidden="true">progress_activity</span>{t('placing')}</>
                  : <><span className="ms" aria-hidden="true">send</span>{t('placeOrder')}</>}
              </button>
              <button type="button" className="pay-locked" disabled>
                <span className="ms" aria-hidden="true">lock</span>{t('payOnline')}
              </button>
              <div className="pay-note"><span className="ms" aria-hidden="true">schedule</span>{t('payNote')}</div>
            </div>

            <div className="sum-sep" />
            <div className="settle-note"><span className="ms" aria-hidden="true">info</span><span>{t('settleNote')}</span></div>
          </div>
        </div>
      </div>
    </section>
  )
}
