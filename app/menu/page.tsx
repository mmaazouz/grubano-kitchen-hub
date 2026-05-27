'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sparkles, Plus, Clock, Eye, EyeOff, Percent, Flame, Leaf, WheatOff, Star,
  Tag, X, Check, ChevronLeft, Upload, GripVertical, RefreshCw, Trash2,
  Wand2, ImageIcon, RotateCcw, BadgeCheck, AlertCircle,
} from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

// ── Types ─────────────────────────────────────────────────────────────────────

type MenuItem = {
  id:          string
  brandId:     string
  name:        string
  description: string | null
  price:       number
  category:    string
  calories:    number | null
  allergens:   string[]
  labels:      string[]
  available:   boolean
  isPopular:   boolean
}

type Brand = { id: string; name: string; emoji: string }

type ScanResult = {
  name:             string
  description:      string
  ingredients:      string[]
  allergens:        string[]
  calories_min:     number
  calories_max:     number
  category:         string
  suggested_labels: string[]
}

const ALL_EU = ['Gluten','Lactose','Œuf','Soja','Arachide','Fruits à coque','Poisson','Crustacés','Mollusques','Céleri','Moutarde','Sésame','Sulfites','Lupin']
const ALL_LABELS = [
  { name: 'Veggie',      icon: Leaf      },
  { name: 'Halal',       icon: BadgeCheck },
  { name: 'Sans gluten', icon: WheatOff  },
  { name: 'Épicé',       icon: Flame     },
]

const EMOJI_FOR_CAT: Record<string, string> = {
  'Entrées': '🥗', 'Plats': '🍝', 'Desserts': '🍰', 'Boissons': '🥤',
}
const emojiFor = (cat: string) => EMOJI_FOR_CAT[cat] ?? '🍴'

// ── Mock promotions (Phase 2 — not yet in DB scope) ───────────────────────────

const PROMOS = [
  { name: 'Happy hour',        desc: '-20% entre 14h–17h',          active: true  },
  { name: 'Bundle midi',       desc: '2 plats + 2 boissons = -15%', active: true  },
  { name: 'Première commande', desc: '-5€ nouveaux clients',         active: false },
]

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MenuBuilder() {
  const [tab,     setTab]     = useState<'items' | 'categories' | 'promos'>('items')
  const [items,   setItems]   = useState<MenuItem[]>([])
  const [brands,  setBrands]  = useState<Brand[]>([])
  const [brandId, setBrandId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [scanner, setScanner] = useState(false)
  const [editing, setEditing] = useState<MenuItem | null>(null)

  const loadItems = useCallback(async (bId: string) => {
    if (!bId) return
    setLoading(true)
    try {
      const r = await fetch(`/api/menu?brandId=${bId}`)
      if (r.ok) {
        const d = await r.json()
        setItems(d.items ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/brands')
      .then(r => r.json())
      .then(d => {
        const list: Brand[] = d.brands ?? []
        setBrands(list)
        if (list.length > 0) {
          setBrandId(list[0].id)
          loadItems(list[0].id)
        } else {
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
  }, [loadItems])

  const categories = [...new Set(items.map(i => i.category))].sort()

  async function toggleAvail(item: MenuItem) {
    const newAvail = !item.available
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, available: newAvail } : i))
    await fetch('/api/menu', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: item.id, available: newAvail }),
    })
  }

  async function saveItem(item: MenuItem) {
    if (item.id === 'new') {
      const r = await fetch('/api/menu', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item, brandId, id: undefined }),
      })
      if (r.ok) {
        const d = await r.json()
        setItems(prev => [d.item, ...prev])
      }
    } else {
      const r = await fetch('/api/menu', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(item),
      })
      if (r.ok) {
        const d = await r.json()
        setItems(prev => prev.map(i => i.id === item.id ? d.item : i))
      }
    }
    setEditing(null)
  }

  async function deleteItem(id: string) {
    await fetch(`/api/menu?id=${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
    setEditing(null)
  }

  const newItem = (): MenuItem => ({
    id: 'new', brandId, name: '', description: '', price: 0,
    category: categories[0] ?? 'Plats', calories: null,
    allergens: [], labels: [], available: true, isPopular: false,
  })

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Menu</h1>
          <p className="text-sm text-muted-foreground">Carte, options &amp; promotions</p>
        </div>
        <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
          {items.length} plats
        </span>
      </div>

      {/* Brand selector */}
      {brands.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {brands.map(b => (
            <button key={b.id} onClick={() => setBrandId(b.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                brandId === b.id
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-muted-foreground'
              }`}>
              {b.emoji} {b.name}
            </button>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button onClick={() => setScanner(true)}
          className="flex items-center gap-2.5 rounded-2xl bg-navy p-3 text-left text-navy-foreground transition active:scale-[0.99]">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles size={16} />
          </div>
          <div>
            <p className="text-[12px] font-bold">Scan IA</p>
            <p className="text-[10px] text-navy-foreground/60">Ajouter par photo</p>
          </div>
        </button>
        <button onClick={() => setEditing(newItem())}
          className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.99]">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
            <Plus size={16} />
          </div>
          <div>
            <p className="text-[12px] font-bold">Manuel</p>
            <p className="text-[10px] text-muted-foreground">Créer un plat</p>
          </div>
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-muted p-1">
        {(['items', 'categories', 'promos'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition ${
              tab === k ? 'bg-card shadow text-foreground' : 'text-muted-foreground'
            }`}>
            {k === 'items' ? 'Plats' : k === 'categories' ? 'Catégories' : 'Promos'}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        loading
          ? <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <RefreshCw size={16} className="animate-spin" /> Chargement…
            </div>
          : <ItemsTab items={items} categories={categories} onToggle={toggleAvail} onEdit={setEditing} />
      )}
      {tab === 'categories' && <CategoriesTab items={items} categories={categories} />}
      {tab === 'promos'     && <PromosTab />}

      {scanner && (
        <AIScannerOverlay
          brandId={brandId}
          categories={categories}
          onClose={() => setScanner(false)}
          onAdd={(item) => { setItems(prev => [item, ...prev]); setScanner(false) }}
        />
      )}
      {editing && (
        <DishEditor
          item={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      )}
    </div>
  )
}

// ── Items tab ─────────────────────────────────────────────────────────────────

function ItemsTab({
  items, categories, onToggle, onEdit,
}: {
  items:      MenuItem[]
  categories: string[]
  onToggle:   (item: MenuItem) => void
  onEdit:     (item: MenuItem) => void
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
        <p className="text-sm text-muted-foreground">Aucun plat dans cette marque</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Utilisez « Scan IA » ou « Manuel » pour ajouter</p>
      </div>
    )
  }

  const cats = categories.length > 0 ? categories : [...new Set(items.map(i => i.category))].sort()

  return (
    <div className="space-y-4">
      {cats.map(cat => {
        const list = items.filter(i => i.category === cat)
        if (!list.length) return null
        return (
          <div key={cat}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {emojiFor(cat)} {cat}
              </p>
              <span className="text-[10px] text-muted-foreground">{list.length} plat{list.length > 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {list.map(item => (
                <button key={item.id} onClick={() => onEdit(item)}
                  className="w-full rounded-2xl border border-border bg-card p-3 text-left transition active:scale-[0.99]">
                  <div className="flex items-start gap-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-primary/10 text-2xl">
                      {emojiFor(cat)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-bold leading-tight">{item.name}</p>
                        <p className="shrink-0 text-sm font-bold text-primary">€{item.price.toFixed(2)}</p>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {item.description ?? '—'}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {item.isPopular && (
                          <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold text-warning">★ Best</span>
                        )}
                        {item.labels.map(l => (
                          <span key={l} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{l}</span>
                        ))}
                        {item.calories && (
                          <span className="text-[10px] text-muted-foreground">· {item.calories} kcal</span>
                        )}
                      </div>
                    </div>
                    <div
                      onClick={(e) => { e.stopPropagation(); onToggle(item) }}
                      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition ${
                        item.available ? 'bg-success' : 'bg-muted'
                      }`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                        item.available ? 'left-5' : 'left-0.5'
                      }`} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

function CategoriesTab({ items, categories }: { items: MenuItem[]; categories: string[] }) {
  const cats = categories.length > 0 ? categories : [...new Set(items.map(i => i.category))].sort()

  if (cats.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
        <p className="text-sm text-muted-foreground">Aucune catégorie — ajoutez des plats d&apos;abord</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {cats.map(cat => {
        const count = items.filter(i => i.category === cat).length
        const avail = items.filter(i => i.category === cat && i.available).length
        return (
          <Card key={cat} className="!p-3">
            <div className="flex items-center gap-3">
              <span className="text-xl">{emojiFor(cat)}</span>
              <div className="flex-1">
                <p className="text-sm font-bold">{cat}</p>
                <p className="text-[10px] text-muted-foreground">
                  {count} plat{count > 1 ? 's' : ''} · {avail} disponible{avail > 1 ? 's' : ''}
                </p>
              </div>
              <span className={`h-2 w-2 rounded-full ${avail > 0 ? 'bg-success' : 'bg-muted-foreground'}`} />
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Promos tab ────────────────────────────────────────────────────────────────

function PromosTab() {
  return (
    <div>
      <SectionTitle hint="Actives & planifiées">Promotions</SectionTitle>
      <div className="space-y-2">
        {PROMOS.map(p => (
          <Card key={p.name} className="!p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Percent size={16} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{p.desc}</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                p.active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              }`}>
                {p.active ? 'Actif' : 'Inactif'}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle>Créer une promo</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {([
          [Percent,  'Remise %'],
          [Tag,      'Montant fixe'],
          [Flame,    'Flash deal'],
          [Star,     'Plat du chef'],
        ] as const).map(([Icon, l]) => (
          <button key={l}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-3 transition active:scale-[0.99]">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-primary"><Icon size={14} /></div>
            <span className="text-[11px] font-bold">{l}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── AI Scanner overlay ────────────────────────────────────────────────────────

function AIScannerOverlay({
  brandId, categories, onClose, onAdd,
}: {
  brandId:    string
  categories: string[]
  onClose:    () => void
  onAdd:      (item: MenuItem) => void
}) {
  const [step,       setStep]       = useState<'upload' | 'analyzing' | 'result'>('upload')
  const [imageB64,   setImageB64]   = useState<string>('')
  const [mediaType,  setMediaType]  = useState<'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'>('image/jpeg')
  const [preview,    setPreview]    = useState<string>('')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [error,      setError]      = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(file: File) {
    const type = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    setMediaType(type)
    setPreview(URL.createObjectURL(file))
    const reader = new FileReader()
    reader.onload = e => {
      const result = e.target?.result as string
      setImageB64(result.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  async function analyze() {
    if (!imageB64) return
    setStep('analyzing')
    setError('')
    try {
      const r = await fetch('/api/menu/scan-dish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageBase64: imageB64, mediaType }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'Erreur analyse')
      setScanResult(data)
      setStep('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
      setStep('upload')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-navy">
      <div className="mx-auto h-full max-w-md flex flex-col">

        {/* Top bar */}
        <div className="flex items-center justify-between p-4">
          <button onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full bg-black/40 text-white backdrop-blur">
            <X size={18} />
          </button>
          <div className="rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur">
            Scan IA
          </div>
          <div className="h-10 w-10" />
        </div>

        {step === 'upload' && (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <input
              ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {preview ? (
              <div className="w-full space-y-4">
                <img src={preview} alt="Photo plat" className="w-full rounded-2xl object-cover max-h-60" />
                {error && (
                  <div className="flex items-center gap-2 rounded-xl bg-destructive/20 px-3 py-2 text-[11px] text-destructive">
                    <AlertCircle size={12} /> {error}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => fileRef.current?.click()}
                    className="flex-1 rounded-xl border border-white/20 py-3 text-sm font-semibold text-white">
                    Changer
                  </button>
                  <button onClick={analyze}
                    className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
                    Analyser avec l&apos;IA
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full space-y-4">
                <div className="grid h-32 w-32 place-items-center rounded-2xl bg-white/10 mx-auto">
                  <ImageIcon size={40} className="text-white/50" />
                </div>
                <p className="text-white font-semibold">Choisissez une photo du plat</p>
                <p className="text-[11px] text-white/60">
                  L&apos;IA détecte automatiquement le nom, les ingrédients, les allergènes et les calories
                </p>
                <button onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground">
                  <Upload size={16} /> Choisir une photo
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'analyzing' && <AnalyzingStep />}

        {step === 'result' && scanResult && (
          <ResultStep
            scanResult={scanResult}
            preview={preview}
            brandId={brandId}
            categories={categories}
            onClose={onClose}
            onRetake={() => setStep('upload')}
            onAdd={onAdd}
          />
        )}
      </div>
    </div>
  )
}

function AnalyzingStep() {
  const stages = [
    'Détection du plat…',
    'Identification des ingrédients…',
    'Calcul nutritionnel…',
    'Recherche allergènes…',
    'Génération de la fiche…',
  ]
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIdx(i => Math.min(i + 1, stages.length - 1)), 900)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="relative">
        <div className="grid h-28 w-28 place-items-center rounded-full bg-primary/20">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-primary text-primary-foreground animate-pulse">
            <Sparkles size={32} />
          </div>
        </div>
        <div className="absolute -inset-2 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />
      </div>
      <h2 className="mt-8 text-2xl font-bold text-white">L&apos;IA analyse…</h2>
      <p className="mt-2 text-sm text-navy-foreground/70">{stages[idx]}</p>
    </div>
  )
}

function ResultStep({
  scanResult, preview, brandId, categories, onClose, onRetake, onAdd,
}: {
  scanResult: ScanResult
  preview:    string
  brandId:    string
  categories: string[]
  onClose:    () => void
  onRetake:   () => void
  onAdd:      (item: MenuItem) => void
}) {
  const [name,      setName]      = useState(scanResult.name)
  const [desc,      setDesc]      = useState(scanResult.description)
  const [category,  setCategory]  = useState(
    categories.includes(scanResult.category) ? scanResult.category : (categories[0] ?? 'Plats'),
  )
  const [price,     setPrice]     = useState(
    Math.round((scanResult.calories_min / 100 + 7) * 10) / 10,
  )
  const [allergens, setAllergens] = useState<string[]>(scanResult.allergens)
  const [labels,    setLabels]    = useState<string[]>(scanResult.suggested_labels)
  const [calories,  setCalories]  = useState(
    Math.round((scanResult.calories_min + scanResult.calories_max) / 2),
  )
  const [saving, setSaving] = useState(false)

  const allCats = categories.length > 0 ? categories : ['Entrées', 'Plats', 'Desserts', 'Boissons']

  async function confirm() {
    setSaving(true)
    const r = await fetch('/api/menu', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        brandId, name, description: desc, price, category,
        calories, allergens, labels, available: true, isPopular: false,
      }),
    })
    if (r.ok) {
      const d = await r.json()
      onAdd(d.item)
    }
    setSaving(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
          <X size={16} />
        </button>
        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Généré par IA</p>
          <p className="text-sm font-bold">Vérifier la fiche</p>
        </div>
        <button onClick={onRetake} className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-32">
        {preview && (
          <img src={preview} alt={name} className="w-full rounded-2xl object-cover max-h-48" />
        )}

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nom</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold focus:border-primary focus:outline-none" />
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3}
            className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Catégorie</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {allCats.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                  category === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                {emojiFor(c)} {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prix €</label>
            <input type="number" step="0.1" min="0" value={price}
              onChange={e => setPrice(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-bold focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Calories</label>
            <input type="number" min="0" value={calories ?? ''}
              onChange={e => setCalories(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Allergènes (UE 14)</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ALL_EU.map(a => {
              const on = allergens.includes(a)
              return (
                <button key={a}
                  onClick={() => setAllergens(on ? allergens.filter(x => x !== a) : [...allergens, a])}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                    on
                      ? 'border-destructive/30 bg-destructive/15 text-destructive'
                      : 'border-transparent bg-muted text-muted-foreground'
                  }`}>
                  {on && '✓ '}{a}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Labels</label>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {ALL_LABELS.map(l => {
              const on = labels.includes(l.name)
              return (
                <button key={l.name}
                  onClick={() => setLabels(on ? labels.filter(x => x !== l.name) : [...labels, l.name])}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
                    on ? 'border-primary bg-accent text-primary' : 'border-border bg-card text-muted-foreground'
                  }`}>
                  <l.icon size={14} />
                  <span className="text-[9px] font-bold">{l.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-card p-4">
        <button onClick={confirm} disabled={saving || !name}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground disabled:opacity-60">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={16} />}
          {saving ? 'Enregistrement…' : 'Ajouter au menu'}
        </button>
      </div>
    </div>
  )
}

// ── Dish editor ───────────────────────────────────────────────────────────────

function DishEditor({
  item, categories, onClose, onSave, onDelete,
}: {
  item:       MenuItem
  categories: string[]
  onClose:    () => void
  onSave:     (item: MenuItem) => void
  onDelete:   (id: string) => void
}) {
  const [d, setD] = useState<MenuItem>(item)
  const [saving, setSaving] = useState(false)
  const isNew = item.id === 'new'

  const allCats = categories.length > 0 ? categories : ['Entrées', 'Plats', 'Desserts', 'Boissons']

  async function handleSave() {
    setSaving(true)
    await onSave(d)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl bg-background p-5">
        <div className="mb-4 flex items-center justify-between">
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
            <ChevronLeft size={16} />
          </button>
          <p className="text-base font-bold">{isNew ? 'Nouveau plat' : 'Modifier'}</p>
          <button onClick={handleSave} disabled={saving || !d.name}
            className="rounded-xl bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-60">
            {saving ? '…' : 'Enregistrer'}
          </button>
        </div>

        <div className="space-y-3">
          <input value={d.name} onChange={e => setD({ ...d, name: e.target.value })}
            placeholder="Nom du plat"
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold focus:border-primary focus:outline-none" />

          <textarea value={d.description ?? ''} onChange={e => setD({ ...d, description: e.target.value })}
            placeholder="Description" rows={3}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Prix €</label>
              <input type="number" step="0.1" min="0" value={d.price}
                onChange={e => setD({ ...d, price: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-bold focus:border-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Calories</label>
              <input type="number" min="0" value={d.calories ?? ''}
                onChange={e => setD({ ...d, calories: e.target.value ? Number(e.target.value) : null })}
                className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm focus:border-primary focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Catégorie</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {allCats.map(c => (
                <button key={c} onClick={() => setD({ ...d, category: c })}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    d.category === c ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                  {emojiFor(c)} {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Allergènes</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ALL_EU.map(a => {
                const on = d.allergens.includes(a)
                return (
                  <button key={a}
                    onClick={() => setD({ ...d, allergens: on ? d.allergens.filter(x => x !== a) : [...d.allergens, a] })}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                      on ? 'border-destructive/30 bg-destructive/15 text-destructive' : 'border-transparent bg-muted text-muted-foreground'
                    }`}>
                    {on && '✓ '}{a}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Labels</label>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {ALL_LABELS.map(l => {
                const on = d.labels.includes(l.name)
                return (
                  <button key={l.name}
                    onClick={() => setD({ ...d, labels: on ? d.labels.filter(x => x !== l.name) : [...d.labels, l.name] })}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition ${
                      on ? 'border-primary bg-accent text-primary' : 'border-border bg-card text-muted-foreground'
                    }`}>
                    <l.icon size={14} />
                    <span className="text-[9px] font-bold">{l.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5">
            <span className="text-sm font-semibold">Best-seller</span>
            <div
              onClick={() => setD({ ...d, isPopular: !d.isPopular })}
              className={`relative h-6 w-11 cursor-pointer rounded-full transition ${d.isPopular ? 'bg-warning' : 'bg-muted'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${d.isPopular ? 'left-5' : 'left-0.5'}`} />
            </div>
          </div>

          {!isNew && (
            <button onClick={() => onDelete(item.id)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 py-2.5 text-[12px] font-bold text-destructive">
              <Trash2 size={13} /> Supprimer ce plat
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
