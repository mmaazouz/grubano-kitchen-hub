'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import {
  Truck, Check, Clock, ShoppingBasket, FileDown, Star, ChevronRight,
  Minus, Plus, Share2, X, Sparkles, AlertCircle, RefreshCw, Package,
} from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

// ── Types ─────────────────────────────────────────────────────────────────────

type SupplierProduct = {
  id:        string
  name:      string
  unit:      string
  price:     number
  stock:     'in' | 'low' | 'out'
}

type Supplier = {
  id:         string
  name:       string
  specialty:  string | null
  zone:       string | null
  leadTime:   string
  minOrder:   number
  rating:     number
  apiEnabled: boolean
  phone:      string | null
  email:      string | null
  products:   SupplierProduct[]
}

type CartItem = { product: SupplierProduct; supplierId: string; qty: number }

// ── Main page ─────────────────────────────────────────────────────────────────

type Mode = 'choice' | 'list' | 'order' | 'self'

export default function SuppliersPage() {
  const [mode,      setMode]      = useState<Mode>('choice')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading,   setLoading]   = useState(false)
  const [selected,  setSelected]  = useState<Supplier | null>(null)

  useEffect(() => {
    if (mode === 'list' || mode === 'order') {
      setLoading(true)
      fetch('/api/suppliers')
        .then(r => r.json())
        .then(d => setSuppliers(d.suppliers ?? []))
        .finally(() => setLoading(false))
    }
  }, [mode])

  if (mode === 'order' && !selected) {
    return (
      <SupplierList
        suppliers={suppliers}
        loading={loading}
        onBack={() => setMode('choice')}
        onSelect={s => setSelected(s)}
      />
    )
  }

  if (mode === 'order' && selected) {
    return (
      <PartnerOrderForm
        supplier={selected}
        onBack={() => setSelected(null)}
      />
    )
  }

  if (mode === 'list') {
    return (
      <CatalogView
        suppliers={suppliers}
        loading={loading}
        onBack={() => setMode('choice')}
      />
    )
  }

  if (mode === 'self') {
    return <SelfShoppingList onBack={() => setMode('choice')} />
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commander</h1>
      <p className="mb-5 text-sm text-muted-foreground">Comment souhaitez-vous restocker ?</p>

      <button onClick={() => setMode('list')}
        className="mb-3 w-full overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-accent to-card p-4 text-left transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground"><Sparkles size={20} /></div>
          <div className="flex-1">
            <p className="text-base font-bold">Catalogue intelligent</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Comparez prix &amp; dispo entre fournisseurs</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </div>
      </button>

      <button onClick={() => setMode('order')}
        className="mb-3 w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-left transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-navy text-navy-foreground"><Truck size={20} /></div>
          <div className="flex-1">
            <p className="text-base font-bold">Un seul fournisseur</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Choisissez parmi vos partenaires vérifiés</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </div>
      </button>

      <button onClick={() => setMode('self')}
        className="w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-left transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-foreground"><ShoppingBasket size={20} /></div>
          <div className="flex-1">
            <p className="text-base font-bold">Je m&apos;en occupe</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Liste de courses imprimable / WhatsApp</p>
          </div>
          <ChevronRight size={16} className="text-muted-foreground" />
        </div>
      </button>
    </div>
  )
}

// ── Supplier list (choose one) ────────────────────────────────────────────────

function SupplierList({
  suppliers, loading, onBack, onSelect,
}: {
  suppliers: Supplier[]
  loading:   boolean
  onBack:    () => void
  onSelect:  (s: Supplier) => void
}) {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Fournisseurs</h1>
      <p className="mb-4 text-sm text-muted-foreground">Sélectionnez un partenaire</p>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Changer de méthode
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw size={16} className="animate-spin" /> Chargement…
        </div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
          <Package size={28} className="mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Aucun fournisseur configuré</p>
        </div>
      ) : (
        <div className="space-y-2">
          {suppliers.map(s => (
            <button key={s.id} onClick={() => onSelect(s)}
              className="w-full rounded-2xl border border-border bg-card p-3.5 text-left transition active:scale-[0.99]">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent font-bold text-primary text-lg">
                  {s.name[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold">{s.name}</p>
                    {s.apiEnabled && (
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">API</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {[s.specialty, s.zone].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {s.leadTime}</span>
                    {s.minOrder > 0 && <span>Min €{s.minOrder}</span>}
                    <span className="inline-flex items-center gap-1"><Star size={10} className="text-warning" /> {s.rating.toFixed(1)}</span>
                    <span>{s.products.length} produits</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Catalog view (compare across suppliers) ───────────────────────────────────

function CatalogView({
  suppliers, loading, onBack,
}: {
  suppliers: Supplier[]
  loading:   boolean
  onBack:    () => void
}) {
  const [cart, setCart]   = useState<CartItem[]>([])
  const [sent, setSent]   = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Group products by name across suppliers
  const productMap: Record<string, Array<{ supplier: Supplier; product: SupplierProduct }>> = {}
  for (const s of suppliers) {
    for (const p of s.products) {
      if (!productMap[p.name]) productMap[p.name] = []
      productMap[p.name].push({ supplier: s, product: p })
    }
  }

  const productNames = Object.keys(productMap).sort()

  function getSelection(name: string) {
    return cart.find(c => c.product.name === name)
  }

  function selectOffer(supplier: Supplier, product: SupplierProduct) {
    setCart(prev => {
      const filtered = prev.filter(c => c.product.name !== product.name)
      return [...filtered, { product, supplierId: supplier.id, qty: 1 }]
    })
  }

  function updateQty(name: string, delta: number) {
    setCart(prev => prev.map(c =>
      c.product.name === name
        ? { ...c, qty: Math.max(0, c.qty + delta) }
        : c,
    ).filter(c => c.qty > 0))
  }

  const total         = cart.reduce((s, c) => s + c.product.price * c.qty, 0)
  const supplierCount = new Set(cart.map(c => c.supplierId)).size

  async function sendOrders() {
    setSending(true); setError('')
    try {
      const bySupplier: Record<string, CartItem[]> = {}
      for (const c of cart) {
        if (!bySupplier[c.supplierId]) bySupplier[c.supplierId] = []
        bySupplier[c.supplierId].push(c)
      }
      for (const [supplierId, items] of Object.entries(bySupplier)) {
        const subTotal = items.reduce((s, c) => s + c.product.price * c.qty, 0)
        await fetch('/api/suppliers/orders', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            supplierId,
            items: items.map(c => ({ name: c.product.name, quantity: c.qty, unit: c.product.unit, price: c.product.price })),
            total: subTotal,
          }),
        })
      }
      setSent(true)
    } catch {
      setError('Erreur lors de l\'envoi. Réessayez.')
    }
    setSending(false)
  }

  if (sent) {
    return (
      <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
        <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commandes envoyées</h1>
        <p className="mb-5 text-sm text-muted-foreground">{supplierCount} fournisseur{supplierCount > 1 ? 's' : ''}</p>
        <Card className="text-center !p-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
            <Check size={28} />
          </div>
          <h3 className="mt-3 text-base font-bold">Confirmé</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">Bons de commande envoyés par email</p>
          <p className="mt-3 text-2xl font-bold">€{total.toFixed(2)}</p>
          <Link href="/stocks" className="mt-4 inline-block w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground text-center">
            Retour aux stocks
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Catalogue</h1>
          <p className="text-sm text-muted-foreground">Meilleur prix par produit</p>
        </div>
        {cart.length > 0 && (
          <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
            €{total.toFixed(0)}
          </span>
        )}
      </div>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Changer de méthode
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw size={16} className="animate-spin" /> Chargement…
        </div>
      ) : productNames.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
          <p className="text-sm text-muted-foreground">Aucun produit fournisseur configuré</p>
        </div>
      ) : (
        <div className="space-y-3">
          {productNames.map(name => {
            const offers  = productMap[name]
            const sel     = getSelection(name)
            const inOffers = offers.filter(o => o.product.stock !== 'out')
            return (
              <Card key={name} className="!p-0 overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2.5">
                  <p className="text-sm font-bold">{name}</p>
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {inOffers.length}/{offers.length} dispo
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {offers.map(({ supplier, product: p }) => {
                    const isSelected = sel?.supplierId === supplier.id && sel.product.id === p.id
                    const isOut      = p.stock === 'out'
                    return (
                      <button key={p.id}
                        onClick={() => !isOut && selectOffer(supplier, p)}
                        disabled={isOut}
                        className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left transition ${
                          isSelected ? 'bg-accent' : ''
                        } ${isOut ? 'cursor-not-allowed opacity-40' : 'active:bg-muted/40'}`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`grid h-5 w-5 place-items-center rounded-full border-2 ${
                            isSelected ? 'border-primary bg-primary' : 'border-border'
                          }`}>
                            {isSelected && <Check size={10} className="text-primary-foreground" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="text-[12px] font-bold">{supplier.name}</p>
                            </div>
                            <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              {p.stock === 'in'  && <><span className="h-1.5 w-1.5 rounded-full bg-success" /> En stock · {supplier.leadTime}</>}
                              {p.stock === 'low' && <><span className="h-1.5 w-1.5 rounded-full bg-warning" /> Stock faible · {supplier.leadTime}</>}
                              {p.stock === 'out' && <><X size={9} className="text-destructive" /> Rupture</>}
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-bold">
                          €{p.price.toFixed(2)}<span className="text-[9px] font-normal text-muted-foreground">/{p.unit}</span>
                        </p>
                      </button>
                    )
                  })}
                </div>
                {sel && sel.product.name === name && (
                  <div className="flex items-center gap-3 border-t border-border bg-accent/50 px-3.5 py-2">
                    <p className="flex-1 text-[11px] font-semibold">Quantité</p>
                    <button onClick={() => updateQty(name, -1)} className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card"><Minus size={12} /></button>
                    <span className="w-10 text-center text-sm font-bold">{sel.qty} <span className="text-[9px] text-muted-foreground">{sel.product.unit}</span></span>
                    <button onClick={() => updateQty(name, 1)}  className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card"><Plus size={12} /></button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {cart.length > 0 && (
        <div className="sticky bottom-24 mt-5 rounded-2xl border border-border bg-card p-4 shadow-lg">
          {error && (
            <p className="mb-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              <AlertCircle size={12} /> {error}
            </p>
          )}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total · {supplierCount} fournisseur{supplierCount > 1 ? 's' : ''}
              </p>
              <p className="text-xl font-bold">€{total.toFixed(2)}</p>
            </div>
            <span className="text-[10px] text-muted-foreground">{cart.length} produit{cart.length > 1 ? 's' : ''}</span>
          </div>
          <button onClick={sendOrders} disabled={sending}
            className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {sending ? <span className="flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Envoi…</span> : 'Envoyer les commandes'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Partner order form ────────────────────────────────────────────────────────

function PartnerOrderForm({ supplier, onBack }: { supplier: Supplier; onBack: () => void }) {
  const [qtys,    setQtys]    = useState<Record<string, number>>(
    Object.fromEntries(supplier.products.filter(p => p.stock !== 'out').map(p => [p.id, 1])),
  )
  const [sent,    setSent]    = useState(false)
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState('')

  const activeProducts = supplier.products.filter(p => p.stock !== 'out')
  const total          = activeProducts.reduce((s, p) => s + p.price * (qtys[p.id] ?? 0), 0)

  async function sendOrder() {
    setSending(true); setError('')
    const items = activeProducts
      .filter(p => (qtys[p.id] ?? 0) > 0)
      .map(p => ({ name: p.name, quantity: qtys[p.id] ?? 0, unit: p.unit, price: p.price }))

    if (!items.length) { setError('Aucun produit sélectionné'); setSending(false); return }

    try {
      const r = await fetch('/api/suppliers/orders', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ supplierId: supplier.id, items, total }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? 'Erreur') }
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur envoi')
    }
    setSending(false)
  }

  if (sent) {
    return (
      <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
        <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commande envoyée</h1>
        <p className="mb-5 text-sm text-muted-foreground">{supplier.name}</p>
        <Card className="text-center !p-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
            <Check size={28} />
          </div>
          <h3 className="mt-3 text-base font-bold">Commande confirmée</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {supplier.email ? 'Email envoyé au fournisseur' : 'Commande enregistrée'}
            {' · '}Livraison sous {supplier.leadTime}
          </p>
          <p className="mt-3 text-2xl font-bold">€{total.toFixed(2)}</p>
          <Link href="/stocks" className="mt-4 inline-block w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground text-center">
            Retour aux stocks
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">{supplier.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {supplier.specialty} · livraison {supplier.leadTime}
        {supplier.email && <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">Email</span>}
      </p>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Autre fournisseur
      </button>

      {activeProducts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-10 text-center">
          <p className="text-sm text-muted-foreground">Aucun produit disponible chez ce fournisseur</p>
        </div>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Bon de commande
          </div>
          <div className="divide-y divide-border">
            {activeProducts.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">€{p.price.toFixed(2)}/{p.unit}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setQtys(s => ({ ...s, [p.id]: Math.max(0, (s[p.id] ?? 0) - 1) }))}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-border">
                    <Minus size={12} />
                  </button>
                  <span className="w-12 text-center text-sm font-bold">
                    {qtys[p.id] ?? 0} <span className="text-[9px] text-muted-foreground">{p.unit}</span>
                  </span>
                  <button
                    onClick={() => setQtys(s => ({ ...s, [p.id]: (s[p.id] ?? 0) + 1 }))}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-border">
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border bg-muted/20 p-4">
            {error && (
              <p className="mb-2 text-[11px] text-destructive">{error}</p>
            )}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Total estimé</span>
              <span className="text-lg font-bold">€{total.toFixed(2)}</span>
            </div>
            <button onClick={sendOrder} disabled={sending || total === 0}
              className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {sending
                ? <span className="flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Envoi…</span>
                : `Envoyer via ${supplier.apiEnabled ? 'API' : supplier.email ? 'Email' : 'WhatsApp'}`
              }
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Self shopping list ────────────────────────────────────────────────────────

function SelfShoppingList({ onBack }: { onBack: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const categories: Record<string, string[]> = {
    'Frais':     ['Poulet mariné · 4 kg', 'Champignons · 2 kg'],
    'Sauce':     ['Sauce butter chicken · 3 L'],
    'Sec':       ['Riz basmati · 5 kg'],
    'Packaging': ['Boîtes kraft · 100 u'],
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Liste de courses</h1>
      <p className="mb-5 text-sm text-muted-foreground">Triée par catégorie</p>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Changer de méthode
      </button>
      <div className="space-y-3">
        {Object.entries(categories).map(([cat, items]) => (
          <Card key={cat} className="!p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">{cat}</p>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              {items.map(item => (
                <li key={item} className="flex items-center gap-2 cursor-pointer" onClick={() => {
                  setChecked(prev => {
                    const next = new Set(prev)
                    next.has(item) ? next.delete(item) : next.add(item)
                    return next
                  })
                }}>
                  <div className={`h-4 w-4 rounded border transition ${checked.has(item) ? 'border-success bg-success' : 'border-border'}`}>
                    {checked.has(item) && <Check size={12} className="text-success-foreground" />}
                  </div>
                  <span className={checked.has(item) ? 'line-through text-muted-foreground' : ''}>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-2 rounded-xl bg-success py-3 text-sm font-bold text-success-foreground">
          <Share2 size={14} /> WhatsApp
        </button>
        <button className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-bold">
          <FileDown size={14} /> Imprimer
        </button>
      </div>
      <Link href="/stocks" className="mt-3 block w-full rounded-xl bg-navy py-3 text-center text-sm font-bold text-navy-foreground">
        Après les courses : mettre à jour
      </Link>
    </div>
  )
}
