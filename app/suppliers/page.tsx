'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Truck, Check, Clock, ShoppingBasket, FileDown, Star,
  ChevronRight, Minus, Plus, Share2, X, Sparkles, AlertCircle,
} from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

// ── Data ─────────────────────────────────────────────────────────────────────

const partners = [
  { name: 'Metro Pro',     specialty: 'Cash & carry',       zone: 'Paris 75011',   lead: '24h', min: 80,  rating: 4.8, api: true  },
  { name: 'Transgourmet',  specialty: 'Restauration pro',   zone: 'Île-de-France', lead: '24h', min: 150, rating: 4.9, api: true  },
  { name: 'Frais Direct',  specialty: 'Légumes & viandes',  zone: 'Paris 75002',   lead: '24h', min: 100, rating: 4.7, api: false },
  { name: 'Ferme Locale',  specialty: 'Producteur bio',     zone: 'Île-de-France', lead: '48h', min: 60,  rating: 4.6, api: false },
] as const

type Partner = typeof partners[number]

type Offer = { supplier: string; price: number; stock: 'in' | 'low' | 'out'; lead: string; badge?: string }
type CatalogItem = { name: string; unit: string; needed: number; offers: Offer[] }

const catalog: CatalogItem[] = [
  {
    name: 'Blanc de poulet', unit: 'kg', needed: 4,
    offers: [
      { supplier: 'Metro Pro',    price: 8.5, stock: 'in',  lead: 'Demain 8h' },
      { supplier: 'Transgourmet', price: 9.1, stock: 'out', lead: '—' },
      { supplier: 'Ferme Locale', price: 9.2, stock: 'low', lead: 'Jeudi' },
    ],
  },
  {
    name: 'Sauce butter chicken', unit: 'L', needed: 3,
    offers: [
      { supplier: 'Metro Pro',    price: 6.1, stock: 'in', lead: 'Demain 8h' },
      { supplier: 'Transgourmet', price: 5.8, stock: 'in', lead: 'Demain 6h' },
    ],
  },
  {
    name: 'Champignons de Paris', unit: 'kg', needed: 2,
    offers: [
      { supplier: 'Frais Direct', price: 6.8, stock: 'in', lead: 'Demain 7h' },
      { supplier: 'Ferme Locale', price: 7.5, stock: 'in', lead: 'Jeudi', badge: 'Bio' },
    ],
  },
  {
    name: 'Riz basmati', unit: 'kg', needed: 5,
    offers: [
      { supplier: 'Metro Pro',    price: 3.2, stock: 'in', lead: 'Demain 8h' },
      { supplier: 'Transgourmet', price: 3.5, stock: 'in', lead: 'Demain 6h' },
    ],
  },
]

const suggested = [
  { name: 'Poulet mariné',         qty: 4, unit: 'kg', price: 8.5 },
  { name: 'Sauce butter chicken',  qty: 3, unit: 'L',  price: 6.1 },
  { name: 'Champignons',           qty: 2, unit: 'kg', price: 6.8 },
]

// ── Main page ─────────────────────────────────────────────────────────────────

type Mode = 'choice' | 'catalog' | 'partner' | 'self'

export default function SuppliersPage() {
  const [mode,     setMode]     = useState<Mode>('choice')
  const [supplier, setSupplier] = useState<Partner | null>(null)

  if (mode === 'catalog') {
    return <CatalogView onBack={() => setMode('choice')} />
  }

  if (mode === 'partner' && !supplier) {
    return (
      <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
        <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Fournisseurs</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Sélectionnez un partenaire
          <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">4 vérifiés</span>
        </p>
        <button onClick={() => setMode('choice')} className="mb-3 text-[11px] font-semibold text-muted-foreground">
          ← Changer de méthode
        </button>
        <div className="space-y-2">
          {partners.map((p) => (
            <button key={p.name} onClick={() => setSupplier(p)}
              className="w-full rounded-2xl border border-border bg-card p-3.5 text-left transition active:scale-[0.99]">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent font-bold text-primary">
                  {p.name[0]}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold">{p.name}</p>
                    {p.api && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-bold text-success">API</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{p.specialty} · {p.zone}</p>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {p.lead}</span>
                    <span>Min €{p.min}</span>
                    <span className="inline-flex items-center gap-1"><Star size={10} className="text-warning" /> {p.rating}</span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (mode === 'partner' && supplier) {
    return <PartnerOrderForm supplier={supplier} onBack={() => setSupplier(null)} />
  }

  if (mode === 'self') {
    return <SelfShoppingList onBack={() => setMode('choice')} />
  }

  // mode === 'choice'
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commander</h1>
      <p className="mb-5 text-sm text-muted-foreground">Comment souhaitez-vous restocker ?</p>

      <button onClick={() => setMode('catalog')}
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

      <button onClick={() => setMode('partner')}
        className="mb-3 w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-left transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-navy text-navy-foreground"><Truck size={20} /></div>
          <div className="flex-1">
            <p className="text-base font-bold">Un seul fournisseur</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">4 partenaires vérifiés près de chez vous</p>
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

      <SectionTitle hint="Suggéré par l'IA">À commander aujourd&apos;hui</SectionTitle>
      <Card className="!p-3">
        <ul className="space-y-2">
          {suggested.map((s) => (
            <li key={s.name} className="flex items-center justify-between text-[12px]">
              <span className="font-semibold">{s.name}</span>
              <span className="text-muted-foreground">{s.qty} {s.unit}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

// ── Catalog view ──────────────────────────────────────────────────────────────

function CatalogView({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<Record<string, string>>({
    'Blanc de poulet':      'Metro Pro',
    'Sauce butter chicken': 'Transgourmet',
    'Champignons de Paris': 'Frais Direct',
    'Riz basmati':          'Metro Pro',
  })
  const [sent, setSent] = useState(false)

  const total = catalog.reduce((sum, item) => {
    const offer = item.offers.find(o => o.supplier === selected[item.name])
    return sum + (offer ? offer.price * item.needed : 0)
  }, 0)

  const supplierCount = new Set(Object.values(selected)).size

  if (sent) {
    return (
      <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
        <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Commandes envoyées</h1>
        <p className="mb-5 text-sm text-muted-foreground">{supplierCount} fournisseurs</p>
        <Card className="text-center !p-6">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
            <Check size={28} />
          </div>
          <h3 className="mt-3 text-base font-bold">Confirmé</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">Livraisons demain entre 6h et 8h</p>
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
        <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
          €{total.toFixed(0)}
        </span>
      </div>

      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Changer de méthode
      </button>

      <Card className="!bg-navy !text-navy-foreground border-transparent mb-4 !p-3">
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-primary shrink-0" />
          <p className="text-[11px]">
            <span className="font-bold">Économie : €4,20</span> en combinant 3 fournisseurs au lieu d&apos;un seul.
          </p>
        </div>
      </Card>

      <div className="space-y-3">
        {catalog.map((item) => (
          <Card key={item.name} className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3.5 py-2.5">
              <div>
                <p className="text-sm font-bold">{item.name}</p>
                <p className="text-[10px] text-muted-foreground">Besoin : {item.needed} {item.unit}</p>
              </div>
              <span className="text-[10px] font-bold text-muted-foreground">
                {item.offers.filter(o => o.stock !== 'out').length}/{item.offers.length} dispo
              </span>
            </div>
            <div className="divide-y divide-border">
              {item.offers.map((o) => {
                const isSelected = selected[item.name] === o.supplier
                const isOut      = o.stock === 'out'
                return (
                  <button key={o.supplier}
                    onClick={() => !isOut && setSelected({ ...selected, [item.name]: o.supplier })}
                    disabled={isOut}
                    className={`flex w-full items-center justify-between px-3.5 py-2.5 text-left transition
                      ${isSelected ? 'bg-accent' : ''}
                      ${isOut ? 'cursor-not-allowed opacity-40' : 'active:bg-muted/40'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`grid h-5 w-5 place-items-center rounded-full border-2 ${
                        isSelected ? 'border-primary bg-primary' : 'border-border'
                      }`}>
                        {isSelected && <Check size={10} className="text-primary-foreground" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[12px] font-bold">{o.supplier}</p>
                          {o.badge && (
                            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[8px] font-bold text-success">
                              {o.badge}
                            </span>
                          )}
                        </div>
                        <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          {o.stock === 'in'  && <><span className="h-1.5 w-1.5 rounded-full bg-success" /> En stock</>}
                          {o.stock === 'low' && <><span className="h-1.5 w-1.5 rounded-full bg-warning" /> Stock faible</>}
                          {o.stock === 'out' && <><X size={9} className="text-destructive" /> Rupture</>}
                          {!isOut && <> · {o.lead}</>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">
                        €{o.price.toFixed(2)}<span className="text-[9px] font-normal text-muted-foreground">/{item.unit}</span>
                      </p>
                      {!isOut && (
                        <p className="text-[10px] text-muted-foreground">= €{(o.price * item.needed).toFixed(2)}</p>
                      )}
                    </div>
                  </button>
                )
              })}
              {item.offers.every(o => o.stock === 'out') && (
                <div className="flex items-center gap-2 bg-warning/5 px-3.5 py-2 text-[11px] text-warning">
                  <AlertCircle size={12} />
                  <button className="font-bold underline">Suggérer une alternative IA</button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="sticky bottom-24 mt-5 rounded-2xl border border-border bg-card p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total · {supplierCount} fournisseurs
            </p>
            <p className="text-xl font-bold">€{total.toFixed(2)}</p>
          </div>
          <span className="text-[10px] text-muted-foreground">Livraison demain</span>
        </div>
        <button onClick={() => setSent(true)} className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
          Envoyer les commandes
        </button>
      </div>
    </div>
  )
}

// ── Partner order form ────────────────────────────────────────────────────────

function PartnerOrderForm({ supplier, onBack }: { supplier: Partner; onBack: () => void }) {
  const [draft, setDraft] = useState<Record<string, number>>(
    Object.fromEntries(suggested.map((s) => [s.name, s.qty])),
  )
  const [sent, setSent] = useState(false)

  const total = suggested.reduce((s, i) => s + (draft[i.name] || 0) * i.price, 0)

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
          <p className="mt-1 text-[12px] text-muted-foreground">Livraison estimée jeudi 8h–12h</p>
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
      <p className="mb-4 text-sm text-muted-foreground">{supplier.specialty} · livraison {supplier.lead}</p>
      <button onClick={onBack} className="mb-3 text-[11px] font-semibold text-muted-foreground">
        ← Autre fournisseur
      </button>
      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Bon de commande
        </div>
        <div className="divide-y divide-border">
          {suggested.map((i) => (
            <div key={i.name} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{i.name}</p>
                <p className="text-[11px] text-muted-foreground">€{i.price.toFixed(2)}/{i.unit}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setDraft((s) => ({ ...s, [i.name]: Math.max(0, (s[i.name] || 0) - 1) }))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-border">
                  <Minus size={12} />
                </button>
                <span className="w-12 text-center text-sm font-bold">
                  {draft[i.name] || 0}{' '}
                  <span className="text-[9px] text-muted-foreground">{i.unit}</span>
                </span>
                <button
                  onClick={() => setDraft((s) => ({ ...s, [i.name]: (s[i.name] || 0) + 1 }))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-border">
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Total estimé</span>
            <span className="text-lg font-bold">€{total.toFixed(2)}</span>
          </div>
          <button onClick={() => setSent(true)} className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
            Envoyer via {supplier.api ? 'API' : 'WhatsApp Business'}
          </button>
        </div>
      </Card>
    </div>
  )
}

// ── Self shopping list ────────────────────────────────────────────────────────

function SelfShoppingList({ onBack }: { onBack: () => void }) {
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
              {items.map((i) => (
                <li key={i} className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded border border-border" />
                  <span>{i}</span>
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
