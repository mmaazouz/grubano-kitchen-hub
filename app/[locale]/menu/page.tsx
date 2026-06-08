'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import {
  Sparkles, Plus, Clock, Eye, EyeOff, Percent, Flame, Leaf, WheatOff, Star,
  Tag, X, Check, ChevronLeft, ChevronRight, Upload, GripVertical, RefreshCw, Trash2,
  Wand2, ImageIcon, RotateCcw, BadgeCheck, AlertCircle, Users, TrendingUp,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SessionProvider, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/navigation'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'
import {
  Badge,
  Button as DSButton,
  Card as DSCard,
  EmptyState,
  SkeletonList,
  ToastProvider,
  useToast,
} from '@/components/design-system'

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
  /** Cloudinary URLs (already square c_fill,g_auto,ar_1:1) — Agent 2 stores
   *  exactly one entry today, but the array is preserved for forward compat. */
  photos?:     string[]
}

// /api/brands/summary item — exposes restaurantId since Agent 2's commit
// b5a850f, which is the scoping key we use to filter the brand selector to
// the marques of the SAME establishment as the currently-opened brand.
// `restaurantId` may still be null on legacy rows → in that case we keep the
// historical behaviour and show every brand (no false-empty scoping).
type Brand = {
  id:            string
  name:          string
  emoji:         string
  restaurantId?: string | null
}

// Catalogue entry returned by GET /api/dishes/available (brique 3C-1).
type AvailableDish = {
  id:               string
  name:             string
  description:      string | null
  photo:            string | null
  cuisineType:      string
  suggestedPrice:   number
  commission:       number
  creatorName:      string
  creatorFollowers: number
  alreadyAdopted:   boolean
  // City exclusivity (levier 3B) — defaulted in the UI for forward-compat.
  cityTaken?:       boolean
  onWaitlist?:      boolean
  waitlistCount?:   number
}

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

// Operator pages have no global SessionProvider (the dashboard reads the session
// server-side via getServerSession). /menu is a client page that needs the
// logged-in operator id to scope brands, so it mounts its own provider — same
// pattern as components/EatSessionProvider for the consumer app.
export default function MenuPage() {
  return (
    <SessionProvider>
      {/* useSearchParams() must be inside <Suspense> in Next.js 14 App Router,
          otherwise the page can't be statically analysed at build time. */}
      <Suspense fallback={<MenuBuilderFallback />}>
        <MenuBuilder />
      </Suspense>
    </SessionProvider>
  )
}

function MenuBuilderFallback() {
  const tMenu = useTranslations('menu')
  return (
    <div className="mx-auto max-w-lg px-5 pt-12 md:max-w-3xl">
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <RefreshCw size={16} className="animate-spin" /> {tMenu('loading')}
      </div>
    </div>
  )
}

// Lite establishment shape used to label the breadcrumb middle segment.
type EstablishmentLite = { id: string; name: string }

function MenuBuilder() {
  const tAdopt = useTranslations('menu.adopt')
  const tMenu  = useTranslations('menu')
  const { status, data: session } = useSession()
  const operatorId = (session?.user as { id?: string } | undefined)?.id

  // The hub navigates here as /menu?brand=<id> — we honour that target so the
  // operator lands on the brand they actually clicked (instead of the legacy
  // "always pick brands[0]" behaviour, which surfaced the menu of an unrelated
  // brand after a deletion/creation).
  const searchParams      = useSearchParams()
  const requestedBrandId  = searchParams.get('brand') ?? ''

  const [tab,            setTab]            = useState<'items' | 'categories' | 'promos' | 'adopt'>('items')
  const [items,          setItems]          = useState<MenuItem[]>([])
  const [brands,         setBrands]         = useState<Brand[]>([])
  const [brandId,        setBrandId]        = useState<string>('')
  const [loading,        setLoading]        = useState(true)
  const [brandsLoading,  setBrandsLoading]  = useState(true)
  const [scanner,        setScanner]        = useState(false)
  const [editing,        setEditing]        = useState<MenuItem | null>(null)
  // Establishments list — used to label the breadcrumb middle segment with the
  // real establishment name. Falls back to "" if the call fails (we still show
  // the breadcrumb root + brand name, just without the middle label).
  const [establishments, setEstablishments] = useState<EstablishmentLite[]>([])

  const loadItems = useCallback(async (bId: string) => {
    if (!bId) return
    setLoading(true)
    try {
      // cache: 'no-store' — client fetches don't go through the Next.js Data
      // Cache (server-side only) but the BROWSER may heuristically cache GETs
      // when the API doesn't send Cache-Control. Without no-store, a brand
      // mutation in another tab leaves /menu showing the pre-mutation items
      // until a manual reload (the exact symptom Mohammed reported).
      const r = await fetch(`/api/menu?brandId=${bId}`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        setItems(d.items ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Brand + establishment loader (extracted so we can reuse it on regain of
  //    focus). cache: 'no-store' for the same reason as loadItems above. ─────
  const loadBrandsAndEstablishments = useCallback(
    async (preferredBrandId: string) => {
      const [brandsResp, estResp] = await Promise.all([
        fetch('/api/brands/summary', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/establishments',  { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      const list: Brand[] = Array.isArray(brandsResp?.brands) ? brandsResp.brands : []
      const ests: EstablishmentLite[] = Array.isArray(estResp?.establishments)
        ? estResp.establishments.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))
        : []
      return { list, ests, preferredBrandId }
    },
    [],
  )

  useEffect(() => {
    // Wait for the session before fetching — owner-scoping is enforced
    // server-side on /api/brands/summary (operatorId from session, never body),
    // so the page only ever sees brands the connected operator owns.
    if (status === 'loading') return
    if (!operatorId) { setBrandsLoading(false); setLoading(false); return }

    setBrandsLoading(true)
    let cancelled = false
    loadBrandsAndEstablishments(requestedBrandId)
      .then(({ list, ests }) => {
        if (cancelled) return
        setBrands(list)
        setEstablishments(ests)
        if (list.length > 0) {
          // Honour ?brand=<id> when it points at one of the operator's own
          // brands; otherwise fall back to the first brand. Server-side
          // owner-scoping on the summary endpoint guarantees the requested id
          // is always one the caller owns (or it just won't be in `list`).
          const chosen = requestedBrandId && list.some((b) => b.id === requestedBrandId)
            ? requestedBrandId
            : list[0].id
          setBrandId(chosen)
          setItems([])      // avoid showing stale items from a previous brand
          loadItems(chosen)
        } else {
          setLoading(false)
        }
      })
      .catch(() => { if (!cancelled) setLoading(false) })
      .finally(() => { if (!cancelled) setBrandsLoading(false) })
    return () => { cancelled = true }
  }, [status, operatorId, requestedBrandId, loadItems, loadBrandsAndEstablishments])

  // ── Cross-tab / cross-window freshness ─────────────────────────────────────
  // When the operator creates or deletes a brand from the hub (another tab) and
  // comes back to /menu, refresh the brand list + items so the page reflects
  // reality without a manual reload. Trigger on:
  //   • visibilitychange → user switches back to the tab,
  //   • pageshow         → BFCache restore (Safari, iPhone Mohammed test).
  // If the currently-selected brand has just been DELETED upstream, fall back
  // to the first available brand in the SAME establishment scope; if that
  // establishment is now brand-less, fall back to the first remaining brand
  // overall — never get stuck on a dangling id that would show the menu of a
  // brand that no longer exists.
  useEffect(() => {
    if (!operatorId) return

    function refreshFromFocus() {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      loadBrandsAndEstablishments(brandId)
        .then(({ list, ests }) => {
          setBrands(list)
          setEstablishments(ests)
          if (list.length === 0) {
            setBrandId('')
            setItems([])
            return
          }
          // Did the currently-selected brand survive?
          const stillExists = list.some((b) => b.id === brandId)
          if (stillExists) {
            // Brand still alive — re-pull its items to catch upstream menu
            // edits (e.g. a dish toggled by another tab).
            loadItems(brandId)
            return
          }
          // Selected brand vanished → pick a replacement, preferring one in
          // the same establishment if we can guess which it was. We resolve
          // the previous restaurantId from the PREVIOUS `brands` snapshot (the
          // closure value) rather than the derived `currentRestaurantId`, so
          // this effect can't depend on a value declared later in the body.
          const prev = brands.find((b) => b.id === brandId) ?? null
          const prevRestaurantId = prev?.restaurantId ?? null
          const sameEstab = prevRestaurantId
            ? list.find((b) => b.restaurantId === prevRestaurantId)
            : null
          const next = sameEstab ?? list[0]
          setBrandId(next.id)
          setItems([])
          loadItems(next.id)
        })
        .catch(() => { /* keep current state on transient errors */ })
    }

    document.addEventListener('visibilitychange', refreshFromFocus)
    window.addEventListener('pageshow', refreshFromFocus)
    return () => {
      document.removeEventListener('visibilitychange', refreshFromFocus)
      window.removeEventListener('pageshow', refreshFromFocus)
    }
  }, [operatorId, brandId, brands, loadItems, loadBrandsAndEstablishments])

  // ── Scope the brand selector to the CURRENT establishment ─────────────────
  // The brand opened via ?brand=<id> belongs to ONE establishment
  // (Brand.restaurantId). The selector at the top must list only the brands of
  // THAT establishment — not every brand of every establishment the operator
  // owns. At 1 brand in scope (the common case) we drop the selector entirely
  // and lean on the breadcrumb to communicate "which brand we're on".
  //
  // FALLBACK: when no brand carries a restaurantId (legacy data still being
  // backfilled), we keep the historical behaviour and show every brand — so
  // we never produce a false-empty scoping that hides every option.
  const currentBrand          = brands.find((b) => b.id === brandId) ?? null
  const currentRestaurantId   = currentBrand?.restaurantId ?? null
  const someBrandHasRestaurant = brands.some((b) => b.restaurantId != null)
  const scopedBrands = currentRestaurantId && someBrandHasRestaurant
    ? brands.filter((b) => b.restaurantId === currentRestaurantId)
    : brands
  const currentEstablishment   = currentRestaurantId
    ? establishments.find((e) => e.id === currentRestaurantId) ?? null
    : null

  const categories = Array.from(new Set(items.map(i => i.category))).sort()

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

      {/* ── Breadcrumb ─ « Mes établissements ▸ {Étab} ▸ {Marque} » ─────────
          Cohérent avec EstablishmentHub.tsx Breadcrumb. C'est le moyen de
          REMONTER vers l'établissement (et donc de CHANGER d'établissement
          sans onglet 60-marques). Le suffix "Menu" rappelle où l'on est. */}
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Link href="/dashboard/establishments" className="hover:text-primary transition-colors">
          {tMenu('bc.root')}
        </Link>
        {currentEstablishment && (
          <>
            <ChevronRight size={11} className="text-muted-foreground/50 rtl:rotate-180" />
            <Link
              href={`/dashboard/establishments/${currentEstablishment.id}`}
              className="hover:text-primary transition-colors truncate max-w-[10rem]"
            >
              {currentEstablishment.name}
            </Link>
          </>
        )}
        {currentBrand && (
          <>
            <ChevronRight size={11} className="text-muted-foreground/50 rtl:rotate-180" />
            <span className="font-semibold text-foreground truncate max-w-[10rem]" aria-current="page">
              {currentBrand.emoji} {currentBrand.name}
            </span>
          </>
        )}
        <ChevronRight size={11} className="text-muted-foreground/50 rtl:rotate-180" />
        <span className="text-muted-foreground">{tMenu('bc.menuLabel')}</span>
      </nav>

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

      {(status === 'loading' || brandsLoading) ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw size={16} className="animate-spin" /> {tMenu('loading')}
        </div>
      ) : brands.length === 0 ? (
        /* No brand belongs to this operator → invite them to set one up. We
           never fall back to other operators' brands, so the brandId sent to
           /api/dishes/adopt always belongs to the connected account. */
        <EmptyState
          emoji="🏪"
          title={tMenu('empty.title')}
          description={tMenu('empty.desc')}
          action={
            <Link
              href="/brands"
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white shadow-grubano-cta transition-colors hover:bg-grubano-primaryHover"
            >
              {tMenu('empty.cta')}
            </Link>
          }
        />
      ) : (
        <>

      {/* Brand selector — SCOPED to the current establishment.
          Hidden when there's only one brand in scope: the breadcrumb already
          communicates which brand we're on, no need for a one-button selector.
          When the operator has multiple brands in this establishment, a sober
          hint above the chips names what the row represents. */}
      {scopedBrands.length > 1 && (
        <div className="mb-4">
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {tMenu('brandsHint')}
          </p>
          <div
            role="group"
            aria-label={tMenu('brandsAria')}
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {scopedBrands.map(b => {
              const onSelect = () => {
                setBrandId(b.id)
                setItems([])      // avoid flashing the previous brand's items
                loadItems(b.id)
              }
              return (
                <button
                  key={b.id}
                  onClick={onSelect}
                  aria-pressed={brandId === b.id}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                    brandId === b.id
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-card text-muted-foreground'
                  }`}
                >
                  {b.emoji} {b.name}
                </button>
              )
            })}
          </div>
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
        {(['items', 'categories', 'promos', 'adopt'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition ${
              tab === k ? 'bg-card shadow text-foreground' : 'text-muted-foreground'
            }`}>
            {k === 'items' ? 'Plats'
              : k === 'categories' ? 'Catégories'
              : k === 'promos' ? 'Promos'
              : tAdopt('tab')}
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
      {tab === 'adopt'      && <AdoptTab brandId={brandId} onAdopted={() => loadItems(brandId)} />}
        </>
      )}

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
  const tPhoto = useTranslations('menu.photo')

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
        <p className="text-sm text-muted-foreground">Aucun plat dans cette marque</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Utilisez « Scan IA » ou « Manuel » pour ajouter</p>
      </div>
    )
  }

  const cats = categories.length > 0 ? categories : Array.from(new Set(items.map(i => i.category))).sort()

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
                    {/* Real photo (Cloudinary, already square via Agent 2's
                        c_fill,g_auto,ar_1:1 transform). Falls back to the
                        category emoji tile when there's no photo yet — same
                        size + radius so nothing reflows. */}
                    {item.photos && item.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.photos[0]}
                        alt={tPhoto('alt', { name: item.name })}
                        loading="lazy"
                        className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-primary/10 text-2xl">
                        {emojiFor(cat)}
                      </div>
                    )}
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
  const cats = categories.length > 0 ? categories : Array.from(new Set(items.map(i => i.category))).sort()

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

// ── Adopt tab (creator recipes a restaurateur can add to their menu) ──────────
// Brique 3C-1. Wrapped in a LOCAL ToastProvider (operator pages have no global
// provider — same pattern as components/dashboard/FulfillmentForm).

function AdoptTab(props: { brandId: string; onAdopted: () => void }) {
  return (
    <ToastProvider>
      <AdoptTabInner {...props} />
    </ToastProvider>
  )
}

function AdoptTabInner({ brandId, onAdopted }: { brandId: string; onAdopted: () => void }) {
  const t     = useTranslations('menu.adopt')
  const toast = useToast()

  const [dishes,     setDishes]     = useState<AvailableDish[]>([])
  const [hasBrand,   setHasBrand]   = useState(true)
  const [loading,    setLoading]    = useState(true)
  const [prices,     setPrices]     = useState<Record<string, number>>({})
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [adoptedIds, setAdoptedIds] = useState<Set<string>>(new Set())
  const [joiningId,  setJoiningId]  = useState<string | null>(null)
  const [joinedIds,  setJoinedIds]  = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    setLoading(true)
    // cache: 'no-store' — without it the browser may serve a stale catalogue
    // after the operator adopts a dish in another tab, masking the
    // alreadyAdopted/cityTaken flags this UI depends on.
    fetch('/api/dishes/available', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(d => {
        if (!alive) return
        setDishes(d.dishes ?? [])
        setHasBrand(Boolean(d.hasBrand))
      })
      .catch(() => { if (alive) toast.error(t('loadError')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function adopt(dish: AvailableDish) {
    if (!brandId) { toast.warning(t('noBrand')); return }
    setAdoptingId(dish.id)
    try {
      const sellingPrice = prices[dish.id] ?? dish.suggestedPrice
      const r = await fetch('/api/dishes/adopt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creatorDishId: dish.id, brandId, sellingPrice }),
      })
      if (r.ok) {
        setAdoptedIds(prev => new Set(prev).add(dish.id))
        toast.success(t('adoptedToast'), { description: t('adoptedToastDesc', { name: dish.name }) })
        onAdopted()
      } else if (r.status === 409) {
        setAdoptedIds(prev => new Set(prev).add(dish.id))
        toast.warning(t('alreadyToast'), { description: t('alreadyToastDesc') })
      } else {
        const d = await r.json().catch(() => null)
        toast.error(t('errorToast'), { description: d?.error })
      }
    } catch {
      toast.error(t('errorToast'))
    } finally {
      setAdoptingId(null)
    }
  }

  // Join the city waitlist for a recipe already taken in this city (levier 3B).
  async function joinWaitlist(dish: AvailableDish) {
    setJoiningId(dish.id)
    try {
      const r = await fetch('/api/dishes/waitlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creatorDishId: dish.id }),
      })
      if (r.ok) {
        setJoinedIds(prev => new Set(prev).add(dish.id))
        toast.success(t('waitlistJoinedToast'), { description: t('waitlistJoinedToastDesc') })
      } else {
        const d = await r.json().catch(() => null)
        toast.error(t('waitlistErrorToast'), { description: d?.error })
      }
    } catch {
      toast.error(t('waitlistErrorToast'))
    } finally {
      setJoiningId(null)
    }
  }

  if (loading) {
    return (
      <div>
        <AdoptHeader t={t} />
        <SkeletonList count={4} variant="card" />
      </div>
    )
  }

  if (!hasBrand) {
    return (
      <div>
        <AdoptHeader t={t} />
        <EmptyState emoji="🏪" title={t('emptyTitle')} description={t('noBrand')} />
      </div>
    )
  }

  if (dishes.length === 0) {
    return (
      <div>
        <AdoptHeader t={t} />
        <EmptyState emoji="🧑‍🍳" title={t('emptyTitle')} description={t('emptyDesc')} />
      </div>
    )
  }

  return (
    <div>
      <AdoptHeader t={t} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dishes.map(dish => {
          const adoptedServer = dish.alreadyAdopted
          const adoptedNow    = adoptedIds.has(dish.id)
          const isAdopted     = adoptedServer || adoptedNow
          const price         = prices[dish.id] ?? dish.suggestedPrice
          // City exclusivity (levier 3B): waitlist state for non-adopted recipes.
          const joinedNow     = joinedIds.has(dish.id)
          const onWaitlist    = (dish.onWaitlist ?? false) || joinedNow
          const cityTaken     = (dish.cityTaken ?? false) && !isAdopted
          const waitlistCount = dish.waitlistCount ?? 0

          return (
            <DSCard key={dish.id} className="overflow-hidden !p-0">
              {/* Visual */}
              <div className="relative h-28 w-full">
                {dish.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={dish.photo} alt={dish.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-grubano-tint to-grubano-primary/20 text-4xl">
                    🍽️
                  </div>
                )}
                <span className="absolute left-2 top-2">
                  <Badge tone="dark" size="sm">{dish.cuisineType}</Badge>
                </span>
                {isAdopted && (
                  <span className="absolute right-2 top-2">
                    <Badge tone="success" size="sm" icon={<Check size={12} />}>{t('adopted')}</Badge>
                  </span>
                )}
              </div>

              <div className="space-y-3 p-3">
                <div>
                  <p className="text-sm font-bold leading-tight">{dish.name}</p>
                  {dish.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{dish.description}</p>
                  )}
                </div>

                {/* Creator + audience */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {t('byCreator', { name: dish.creatorName || '—' })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users size={12} /> {t('followers', { count: dish.creatorFollowers })}
                  </span>
                </div>

                {/* Benefit pitch */}
                <div className="rounded-xl bg-grubano-tint/60 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-grubano-primary">
                    <TrendingUp size={12} /> {t('benefit')}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t('promotedBy', { count: dish.creatorFollowers })}
                  </p>
                </div>

                {/* Price (editable) or commitment note once adopted */}
                {isAdopted ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl bg-grubano-success-tint px-3 py-2 text-[11px] font-semibold text-grubano-success">
                      <Clock size={12} /> {t('commitment60')}
                    </div>
                    {/* Incumbent visibility: how many restos wait for this recipe here */}
                    {waitlistCount > 0 && (
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Users size={12} /> {t('waitingCount', { count: waitlistCount })}
                      </p>
                    )}
                  </div>
                ) : (cityTaken || onWaitlist) ? null : (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t('priceLabel')}
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="number" step="0.1" min="0" value={price}
                        onChange={e => setPrices(p => ({ ...p, [dish.id]: Number(e.target.value) }))}
                        className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold focus:border-primary focus:outline-none"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {t('suggestedPriceHint', { price: dish.suggestedPrice.toFixed(2).replace('.', ',') })}
                      </span>
                    </div>
                  </div>
                )}

                {/* CTA — 4 states: adopted / on waitlist / city-taken / adoptable */}
                {isAdopted ? (
                  <DSButton variant="secondary" size="sm" fullWidth disabled leftIcon={<Check size={14} />}>
                    {adoptedServer && !adoptedNow ? t('alreadyOnMenu') : t('adopted')}
                  </DSButton>
                ) : onWaitlist ? (
                  <DSButton variant="secondary" size="sm" fullWidth disabled leftIcon={<Check size={14} />}>
                    {t('joinedWaitlist')}
                  </DSButton>
                ) : cityTaken ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                      <AlertCircle size={12} /> {t('cityTaken')}
                    </div>
                    <DSButton
                      variant="secondary" size="sm" fullWidth
                      loading={joiningId === dish.id}
                      onClick={() => joinWaitlist(dish)}
                      leftIcon={joiningId === dish.id ? undefined : <Clock size={14} />}
                    >
                      {joiningId === dish.id ? t('joiningWaitlist') : t('joinWaitlist')}
                    </DSButton>
                  </div>
                ) : (
                  <DSButton
                    variant="primary" size="sm" fullWidth
                    loading={adoptingId === dish.id}
                    onClick={() => adopt(dish)}
                    leftIcon={adoptingId === dish.id ? undefined : <Sparkles size={14} />}
                  >
                    {adoptingId === dish.id ? t('adopting') : t('adopt')}
                  </DSButton>
                )}
              </div>
            </DSCard>
          )
        })}
      </div>
    </div>
  )
}

function AdoptHeader({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="mb-4">
      <SectionTitle hint={t('subtitle')}>{t('title')}</SectionTitle>
      <div className="mt-1 flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <Clock size={14} className="mt-0.5 shrink-0 text-primary" />
        <p className="text-[11px] leading-snug text-muted-foreground">{t('commitmentNote')}</p>
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
            imageBase64={imageB64}
            mediaType={mediaType}
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
  scanResult, preview, brandId, categories, imageBase64, mediaType, onClose, onRetake, onAdd,
}: {
  scanResult:  ScanResult
  preview:     string
  brandId:     string
  categories:  string[]
  imageBase64: string
  mediaType:   'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  onClose:     () => void
  onRetake:    () => void
  onAdd:       (item: MenuItem) => void
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
  const [error,  setError]  = useState('')

  const allCats = categories.length > 0 ? categories : ['Entrées', 'Plats', 'Desserts', 'Boissons']

  async function confirm() {
    setError('')
    setSaving(true)
    // Persist the scanned photo: the server moderates + uploads it and writes
    // photos=[url] at creation. mediaType is coerced to an allowed type (gif is
    // not stored as a dish photo) so the create payload never fails validation.
    const safeType =
      mediaType === 'image/png' || mediaType === 'image/webp' ? mediaType : 'image/jpeg'
    const r = await fetch('/api/menu', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        brandId, name, description: desc, price, category,
        calories, allergens, labels, available: true, isPopular: false,
        imageBase64, mediaType: safeType,
      }),
    })
    if (r.ok) {
      const d = await r.json()
      onAdd(d.item)
    } else {
      // Never swallow the failure (e.g. a rejected image) — surface it; the dish
      // is intentionally NOT created without its photo.
      const d = await r.json().catch(() => null)
      setError((d && (d.error as string)) || "Échec de l'ajout, réessayez.")
      setSaving(false)
    }
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
        {error && (
          <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <AlertCircle size={12} className="shrink-0" /> {error}
          </p>
        )}
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
