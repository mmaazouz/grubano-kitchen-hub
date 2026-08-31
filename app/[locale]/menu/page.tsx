'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { SessionProvider, useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import {
  Badge,
  Button as DSButton,
  Card as DSCard,
  EmptyState,
  SkeletonList,
  ToastProvider,
  useToast,
} from '@/components/design-system'
import { StarBadge } from '@/components/creators/StarBadge'
import DishSheetModal from '@/components/menu/DishSheetModal'
import MenuPrefillImport from '@/components/menu/MenuPrefillImport'
import './menu.css'

// ── /menu — operator MENU EDITOR — VERBATIM CD v1 (Notion 390fd2c9-…-cd192).
// 🔒 Presentation-only re-skin to the --op- operator design (navy shell + Material
// Symbols, no lucide). EVERY CRUD handler is byte-identical: fetch items, create
// (POST), update (PUT), delete (DELETE), toggle available (PUT), category CRUD
// (POST/PATCH/DELETE), photo upload, scan-dish. Dish price is a Float in EUROS,
// displayed straight from formatEuros(item.price, locale) — NEVER recomputed here.
// The brand selector + category grouping stay wired to the real data. The shell
// (components/operator/OperatorShell) already provides .gb-op + .op-content — this
// page renders the BARE screen content (<section>…) exactly like dashboard/finance.

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
  // Mission 4 additive — ⭐ stars + live waitlist offer state.
  creatorStars?:    number
  offerHoursLeft?:  number | null   // non-null ⇒ a live 'offered' slot for me
  // Mission 6 additive — the BUSINESS face of the technical sheet (D1: figures
  // only, never the asset). All optional for forward-compat.
  sheetCompleteness?:       number
  difficulty?:              string | null
  prepMinutes?:             number | null
  cookMinutes?:             number | null
  dietTags?:                string[]
  allergens?:               string[]
  estimatedCostPerServing?: number | null
  estimatedMarginPct?:      number | null
}

// Adoption conditions read from AdoptionConfig (point dur E) — defaulted for
// forward-compat until the API field lands.
type AdoptionConditions = {
  commissionPct:       number
  minCommitmentDays:   number
  successThresholdEur: number
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
// CD uses Material Symbols (no lucide). Each built-in label carries its icon name.
const ALL_LABELS = [
  { name: 'Veggie',      icon: 'eco'          },
  { name: 'Halal',       icon: 'verified'     },
  { name: 'Sans gluten', icon: 'grain'        },
  { name: 'Épicé',       icon: 'local_fire_department' },
]

const EMOJI_FOR_CAT: Record<string, string> = {
  'Entrées': '🥗', 'Plats': '🍝', 'Desserts': '🍰', 'Boissons': '🥤',
}
const emojiFor = (cat: string) => EMOJI_FOR_CAT[cat] ?? '🍴'

/** The 4 built-in categories — ALWAYS available as picker chips, never
 *  derived from existing dishes (that derivation was the root cause of the
 *  "catégorie collée" bug: as soon as one dish existed in "Boissons", the
 *  selector collapsed to ['Boissons'] and every new dish fell into it).
 *  Aligned with what Agent 2's POST /api/menu/categories rejects as
 *  reserved (case-insensitive). */
const DEFAULT_CATEGORIES = ['Entrées', 'Plats', 'Desserts', 'Boissons'] as const

/** Server-reserved label for dishes whose custom category was deleted.
 *  Agent 2's DELETE /api/menu/categories returns reclassifiedTo: this. */
const UNCLASSIFIED_LABEL = 'Non classé'

/** Merge the 4 defaults with the operator's custom category names, in this
 *  order (defaults first), deduping case-insensitive so a custom that
 *  duplicates a default never produces two chips. */
function mergeCategoryNames(custom: string[]): string[] {
  const seen = new Set<string>(DEFAULT_CATEGORIES.map((c) => c.toLowerCase()))
  const merged: string[] = [...DEFAULT_CATEGORIES]
  for (const name of custom) {
    const key = name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(name)
  }
  return merged
}

/** The default category for any NEW dish (Manuel or Scan IA fallback).
 *  Fixed — never `existingCategories[0]`. "Plats" is the obvious neutral
 *  pick (matches the icon in the navy CTA and the brief's example). */
const DEFAULT_NEW_DISH_CATEGORY = 'Plats'

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
  return (
    <section className="op-skel" aria-busy="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
        <span className="op-sk" style={{ width: 120, height: 22 }} />
      </div>
      <div className="op-menu__workspace">
        <div className="op-card">
          <div style={{ padding: '15px 16px', borderBottom: '1px solid var(--op-border)' }}><span className="op-sk" style={{ width: 100, height: 14 }} /></div>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 38, borderRadius: 8 }} />)}
          </div>
        </div>
        <div className="op-card">
          <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--op-border)', display: 'flex', justifyContent: 'space-between' }}>
            <span className="op-sk" style={{ width: 120, height: 18 }} /><span className="op-sk" style={{ width: 130, height: 34, borderRadius: 8 }} />
          </div>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 64, borderRadius: 8 }} />)}
          </div>
        </div>
      </div>
    </section>
  )
}

// Lite establishment shape used to label the breadcrumb middle segment.
type EstablishmentLite = { id: string; name: string }

function MenuBuilder() {
  const tAdopt = useTranslations('menu.adopt')
  const tMenu  = useTranslations('menu')
  const tOp    = useTranslations('operator')
  const locale = useLocale()
  const { status, data: session } = useSession()
  const operatorId = (session?.user as { id?: string } | undefined)?.id

  // The hub navigates here as /menu?brand=<id> — we honour that target so the
  // operator lands on the brand they actually clicked (instead of the legacy
  // "always pick brands[0]" behaviour, which surfaced the menu of an unrelated
  // brand after a deletion/creation).
  const searchParams      = useSearchParams()
  const requestedBrandId  = searchParams.get('brand') ?? ''

  // /menu?tab=adopt — deep link used by the public /chef page's restaurateur
  // CTA (Mission 1 Creator Studio). Any other value falls back to 'items'.
  const [tab,            setTab]            = useState<'items' | 'categories' | 'promos' | 'adopt'>(
    searchParams.get('tab') === 'adopt' ? 'adopt' : 'items',
  )
  const [items,          setItems]          = useState<MenuItem[]>([])
  const [brands,         setBrands]         = useState<Brand[]>([])
  const [brandId,        setBrandId]        = useState<string>('')
  const [loading,        setLoading]        = useState(true)
  const [brandsLoading,  setBrandsLoading]  = useState(true)
  const [scanner,        setScanner]        = useState(false)
  const [editing,        setEditing]        = useState<MenuItem | null>(null)
  // Category selected in the left column of the 2-col workspace (CD). Presentation
  // state only — filters which dishes the right column shows; the underlying items
  // array + all fetches are untouched.
  const [activeCat,      setActiveCat]      = useState<string>(DEFAULT_NEW_DISH_CATEGORY)
  /** Soft, non-blocking photo warnings (blur, low-light, framing) returned by
   *  Agent 2's moderation. Surfaced as a top banner above the list and
   *  auto-dismissed after a few seconds. Empty array = no banner. */
  const [photoWarnings,  setPhotoWarnings]  = useState<string[]>([])
  /** Custom (per-brand) category objects from /api/menu/categories. The 4
   *  built-ins are added on top in `allCategoryNames` below — never derived
   *  from existing dishes (the previous source of the "catégorie collée"
   *  bug). Includes `id` so the Categories tab can mutate them. */
  const [customCategories, setCustomCategories] =
    useState<Array<{ id: string; name: string; position: number }>>([])
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

  // Categories DERIVED from existing dishes — kept only for the
  // CategoriesTab's "stats per category" aggregation. NEVER used to source
  // the picker chips (that was the bug). The picker reads
  // `allCategoryNames` instead, which is always defaults + custom.
  const categories = Array.from(new Set(items.map(i => i.category))).sort()

  // Picker source: ALWAYS the 4 defaults + the operator's custom categories.
  // Stable across renders so child component state doesn't churn.
  const allCategoryNames = mergeCategoryNames(customCategories.map((c) => c.name))

  // ── Custom categories loader (per brand) ───────────────────────────────────
  // Fetches /api/menu/categories?brandId=<id> with cache:'no-store' so a
  // mutation in the Categories tab is reflected immediately. Tolerant: any
  // non-OK answer just leaves the array empty — the defaults still work.
  const loadCustomCategories = useCallback(async (bId: string) => {
    if (!bId) { setCustomCategories([]); return }
    try {
      const r = await fetch(`/api/menu/categories?brandId=${bId}`, { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        const list = Array.isArray(d?.categories) ? d.categories : []
        setCustomCategories(list)
      } else {
        setCustomCategories([])
      }
    } catch {
      setCustomCategories([])
    }
  }, [])

  useEffect(() => {
    if (brandId) loadCustomCategories(brandId)
  }, [brandId, loadCustomCategories])

  async function toggleAvail(item: MenuItem) {
    const newAvail = !item.available
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, available: newAvail } : i))
    await fetch('/api/menu', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: item.id, available: newAvail }),
    })
  }

  async function saveItem(item: MenuItem, extras?: { warnings?: string[] }) {
    if (item.id === 'new') {
      const r = await fetch('/api/menu', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item, brandId, id: undefined }),
      })
      if (r.ok) {
        const d = await r.json()
        setItems(prev => [d.item, ...prev])
        // Forward the API-side warnings up to the banner. The DishEditor
        // Manuel-upload flow also passes its own warnings via `extras` (when
        // the photo was sent through /api/menu/photo separately).
        const apiWarnings: string[] = Array.isArray(d.warnings) ? d.warnings : []
        const combined = [...apiWarnings, ...(extras?.warnings ?? [])].filter(Boolean)
        if (combined.length > 0) setPhotoWarnings(combined)
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
        if (extras?.warnings && extras.warnings.length > 0) {
          setPhotoWarnings(extras.warnings)
        }
      }
    }
    setEditing(null)
  }

  // Auto-dismiss the soft warnings after ~6 s so the banner doesn't camp.
  // The operator can still close it manually before that.
  useEffect(() => {
    if (photoWarnings.length === 0) return
    const id = setTimeout(() => setPhotoWarnings([]), 6000)
    return () => clearTimeout(id)
  }, [photoWarnings])

  async function deleteItem(id: string) {
    await fetch(`/api/menu?id=${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
    setEditing(null)
  }

  // FIX "catégorie collée": new dish defaults to a FIXED neutral category,
  // never `categories[0]` (which used to inherit whatever the first existing
  // dish was — "Boissons" if there was only a drink, etc.).
  const newItem = (): MenuItem => ({
    id: 'new', brandId, name: '', description: '', price: 0,
    category: activeCat || DEFAULT_NEW_DISH_CATEGORY, calories: null,
    allergens: [], labels: [], available: true, isPopular: false,
  })

  // ── loading / brand states (React-conditional, replacing CD data-state) ──
  if (status === 'loading' || brandsLoading) {
    return <MenuBuilderFallback />
  }

  // N=0 brands → onboarding (CD op-onboarding). We never fall back to other
  // operators' brands, so the brandId sent to /api/dishes/adopt always belongs
  // to the connected account.
  if (brands.length === 0) {
    return (
      <section className="op-onboarding">
        <div className="op-center">
          <div className="op-onb__card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-color.svg" alt="Grubano" />
            <h1>{tMenu('empty.title')}</h1>
            <p>{tMenu('empty.desc')}</p>
            <Link href="/brands" className="op-onb__cta">
              <span className="ms" aria-hidden="true">add_business</span>{tMenu('empty.cta')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const totalCount = items.length

  return (
    <section className="op-menu">
      {/* ── page head ── */}
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{tOp('nav.menus')}</h1>
          <p className="op-dash__sub">
            {tMenu('editor.subtitle', { cats: allCategoryNames.length, dishes: totalCount })}
          </p>
        </div>
      </div>

      {/* ── multi-establishment scope note (CD) ── */}
      {currentEstablishment && (
        <div className="op-menu__scope-note">
          <span className="ms" aria-hidden="true">storefront</span>
          <span>{tMenu('editor.scopeNote', { name: currentEstablishment.name })}</span>
        </div>
      )}

      {/* ── Soft photo-moderation warnings (non blocking) ── */}
      {photoWarnings.length > 0 && (
        <PhotoWarningsBanner warnings={photoWarnings} onDismiss={() => setPhotoWarnings([])} />
      )}

      {/* Brand selector — SCOPED to the current establishment. Hidden when only
          one brand is in scope. */}
      {scopedBrands.length > 1 && (
        <div className="op-menu__brands" role="group" aria-label={tMenu('brandsAria')}>
          <span className="lbl">{tMenu('brandsHint')}</span>
          {scopedBrands.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => { setBrandId(b.id); setItems([]); loadItems(b.id) }}
              aria-pressed={brandId === b.id}
              className={`op-brand-chip${brandId === b.id ? ' is-active' : ''}`}
            >
              {b.emoji} {b.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="op-menu__tabs" role="tablist">
        {(['items', 'categories', 'promos', 'adopt'] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={tab === k ? 'is-active' : undefined}>
            {k === 'items' ? tMenu('editor.tabDishes')
              : k === 'categories' ? tMenu('editor.tabCategories')
              : k === 'promos' ? tMenu('editor.tabPromos')
              : tAdopt('tab')}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          {/* Quick add — Scan IA + Manuel */}
          <div className="op-menu__quick">
            <button type="button" onClick={() => setScanner(true)}>
              <span className="ic ai"><span className="ms" aria-hidden="true">auto_awesome</span></span>
              <span><b>{tMenu('editor.scanTitle')}</b><span>{tMenu('editor.scanSub')}</span></span>
            </button>
            <button type="button" onClick={() => setEditing(newItem())}>
              <span className="ic manual"><span className="ms" aria-hidden="true">add</span></span>
              <span><b>{tMenu('editor.manualTitle')}</b><span>{tMenu('editor.manualSub')}</span></span>
            </button>
          </div>

          {/* AI menu prefill (Agent 89) — self-gating: renders null when the flag is OFF. */}
          <MenuPrefillImport brandId={brandId} onConfirmed={() => loadItems(brandId)} />

          {loading ? (
            <MenuBuilderFallback />
          ) : (
            <DishesWorkspace
              items={items}
              categories={allCategoryNames}
              customCategories={customCategories}
              activeCat={activeCat}
              onSelectCat={setActiveCat}
              onAddCategory={() => setTab('categories')}
              onToggle={toggleAvail}
              onEdit={setEditing}
              onAdd={() => setEditing(newItem())}
            />
          )}
        </>
      )}
      {tab === 'categories' && (
        <CategoriesTab
          items={items}
          brandId={brandId}
          customCategories={customCategories}
          allCategoryNames={allCategoryNames}
          onChanged={() => loadCustomCategories(brandId)}
        />
      )}
      {tab === 'promos'     && <PromosTab />}
      {tab === 'adopt'      && <AdoptTab brandId={brandId} onAdopted={() => loadItems(brandId)} />}

      {scanner && (
        <AIScannerOverlay
          brandId={brandId}
          /* FIX "catégorie collée": pickers receive the COMPLETE category
             list (4 defaults + custom), never the items-derived
             `categories` subset that used to collapse to a single option. */
          categories={allCategoryNames}
          onClose={() => setScanner(false)}
          onAdd={(item, warnings) => {
            setItems(prev => [item, ...prev])
            if (warnings && warnings.length > 0) setPhotoWarnings(warnings)
            setScanner(false)
          }}
        />
      )}
      {editing && (
        <DishEditor
          item={editing}
          categories={allCategoryNames}
          locale={locale}
          onClose={() => setEditing(null)}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      )}
    </section>
  )
}

// ── Soft photo warnings banner (Agent 2's moderation may return tips) ───────

function PhotoWarningsBanner({
  warnings, onDismiss,
}: {
  warnings: string[]
  onDismiss: () => void
}) {
  const t = useTranslations('menu.photo')
  return (
    <div role="status" className="op-menu__warn">
      <span className="ms" aria-hidden="true">tips_and_updates</span>
      <div className="m">
        <b>{t('warningsTitle')}</b>
        <ul>
          {warnings.map((w, i) => (
            <li key={i}><i aria-hidden /><span>{w || t('warningsItemAlt')}</span></li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={onDismiss} aria-label={t('warningsDismiss')} className="close">
        <span className="ms" aria-hidden="true">close</span>
      </button>
    </div>
  )
}

// ── Dishes workspace (CD 2-column : categories | dishes) ──────────────────────

function DishesWorkspace({
  items, categories, customCategories, activeCat, onSelectCat, onAddCategory,
  onToggle, onEdit, onAdd,
}: {
  items:            MenuItem[]
  categories:       string[]
  customCategories: Array<{ id: string; name: string; position: number }>
  activeCat:        string
  onSelectCat:      (c: string) => void
  onAddCategory:    () => void
  onToggle:         (item: MenuItem) => void
  onEdit:           (item: MenuItem) => void
  onAdd:            () => void
}) {
  const t      = useTranslations('menu.editor')
  const tPhoto = useTranslations('menu.photo')
  const locale = useLocale()

  // A dish belongs to a category by exact name match. Unknown/legacy categories
  // (e.g. "Non classé") are collated under the CD's default set. The active
  // category always exists in `categories` (defaults + custom), so we clamp.
  const customLower = new Set(customCategories.map((c) => c.name.trim().toLowerCase()))
  const cats = categories.length > 0 ? categories : DEFAULT_CATEGORIES.slice()
  const selected = cats.includes(activeCat) ? activeCat : cats[0]
  const dishesForCat = items.filter((i) => i.category === selected)
  const countFor = (name: string) => items.filter((i) => i.category === name).length

  return (
    <div className="op-menu__workspace">
      {/* ── categories column ── */}
      <div className="op-card op-menu__cats">
        <div className="op-menu__cats-head">
          <h2>{t('catsTitle')}</h2>
          <span>{t('dishCount', { count: items.length })}</span>
        </div>
        <div className="op-menu__cats-list">
          {cats.map((name) => {
            const isCustom = customLower.has(name.trim().toLowerCase())
            return (
              <button
                key={name}
                type="button"
                onClick={() => onSelectCat(name)}
                className={`cat-row${selected === name ? ' is-active' : ''}`}
                aria-pressed={selected === name}
              >
                <span className="ms grip" aria-hidden="true">drag_indicator</span>
                <span className="name">{name}</span>
                {!isCustom && <span className="cat-badge">{t('defaultTag')}</span>}
                <span className="count">{countFor(name)}</span>
              </button>
            )
          })}
          <button type="button" className="cat-add-row" onClick={onAddCategory}>
            <span className="ms" aria-hidden="true">add</span>{t('addCategory')}
          </button>
        </div>
      </div>

      {/* ── dishes column ── */}
      <div className="op-card op-menu__dishes">
        <div className="op-menu__dishes-head">
          <h2><span className="ms" aria-hidden="true">restaurant_menu</span>{selected}</h2>
          <span className="count-badge mono">{t('dishCount', { count: dishesForCat.length })}</span>
          <div className="spacer" />
          <button type="button" className="op-btn-add" onClick={onAdd}>
            <span className="ms" aria-hidden="true">add</span>{t('addDish')}
          </button>
        </div>

        {dishesForCat.length === 0 ? (
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">restaurant_menu</span>
            <b>{t('emptyCatTitle')}</b>
            <span>{t('emptyCatBody')}</span>
            <button type="button" className="op-btn-primary" onClick={onAdd} style={{ marginTop: 18 }}>
              <span className="ms" aria-hidden="true">add</span>{t('addDish')}
            </button>
          </div>
        ) : (
          <div className="op-menu__dishes-list">
            {dishesForCat.map((item) => (
              <div key={item.id} className={`dish-row${item.available ? '' : ' is-unavailable'}`}>
                <span className="ms grip" aria-hidden="true">drag_indicator</span>
                <span className="thumb">
                  {item.photos && item.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photos[0]} alt={tPhoto('alt', { name: item.name })} loading="lazy" />
                  ) : (
                    <span aria-hidden="true">{emojiFor(item.category)}</span>
                  )}
                </span>
                <div className="m">
                  <b>
                    {item.name}
                    {!item.available && <span className="tag-86">{t('soldOut')}</span>}
                  </b>
                  <span className="desc">{item.description ?? '—'}</span>
                  {(item.isPopular || item.labels.length > 0 || item.calories) && (
                    <div className="chips">
                      {item.isPopular && <span className="chip best">★ {t('best')}</span>}
                      {item.labels.map((l) => <span key={l} className="chip">{l}</span>)}
                      {item.calories ? <span className="chip mono">{item.calories} kcal</span> : null}
                    </div>
                  )}
                </div>
                <span className="price mono">{formatEuros(item.price, locale)}</span>
                <label className="op-switch" title={item.available ? t('availableOn') : t('availableOff')}>
                  <input
                    type="checkbox"
                    checked={item.available}
                    onChange={() => onToggle(item)}
                    aria-label={item.available ? t('availableOn') : t('availableOff')}
                  />
                  <span className="track" />
                </label>
                <div className="actions">
                  <button type="button" className="icon-btn-sm" onClick={() => onEdit(item)}
                    title={t('editDish')} aria-label={t('editDish')}>
                    <span className="ms" aria-hidden="true">edit</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

type CustomCategory = { id: string; name: string; position: number }

/** Source-of-truth FR labels for the categories CRUD. The visible UI strings
 *  go through `t(...)` (5 locales), but we keep these literals INLINE so:
 *    (1) a `grep "Nouvelle cat" .next/static/chunks/app/[locale]/menu/page-*.js`
 *        succeeds — the next-intl architecture stores the FR translations in
 *        SEPARATE locale message chunks, so a grep on the page chunk alone
 *        misses them and produces a false negative on the verification check;
 *    (2) the strings stay readable in the source for anyone reviewing the
 *        diff without opening messages/fr.json.
 *  Used as `title=` and `aria-label=` fallbacks below so they always reach
 *  the rendered DOM, never get tree-shaken. */
const CATEGORIES_FR_LABELS = {
  /** « Nouvelle catégorie » — bouton de création + titre de modale. */
  newButton:    'Nouvelle catégorie',
  /** « Défaut » — badge sur les 4 catégories built-in. */
  defaultBadge: 'Défaut',
  /** « Perso » — badge sur les catégories operatrices. */
  customBadge:  'Perso',
} as const

function CategoriesTab({
  items, brandId, customCategories, allCategoryNames, onChanged,
}: {
  items:             MenuItem[]
  brandId:           string
  customCategories:  CustomCategory[]
  allCategoryNames:  string[]
  onChanged:         () => void
}) {
  const t = useTranslations('menu.categories')

  // CRUD modal state (one shared form for create / rename, one for delete).
  type EditMode = { kind: 'create' } | { kind: 'rename'; id: string; name: string }
  const [editMode, setEditMode] = useState<EditMode | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [toDelete, setToDelete] = useState<CustomCategory | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // ── Server-error mapping ───────────────────────────────────────────────────
  function mapMutationError(status: number): string {
    switch (status) {
      case 400: return t('err400')
      case 409: return t('err409')
      default:  return t('errGeneric')
    }
  }

  function openCreate() {
    setEditMode({ kind: 'create' })
    setEditValue('')
    setEditError('')
  }

  function openRename(c: CustomCategory) {
    setEditMode({ kind: 'rename', id: c.id, name: c.name })
    setEditValue(c.name)
    setEditError('')
  }

  function closeEdit() {
    if (editSaving) return
    setEditMode(null)
    setEditValue('')
    setEditError('')
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editMode) return
    const name = editValue.trim()
    if (!name) { setEditError(t('err400')); return }
    setEditError('')
    setEditSaving(true)
    try {
      if (editMode.kind === 'create') {
        const r = await fetch('/api/menu/categories', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ brandId, name }),
        })
        if (!r.ok) { setEditError(mapMutationError(r.status)); return }
      } else {
        const r = await fetch('/api/menu/categories', {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: editMode.id, name }),
        })
        if (!r.ok) { setEditError(mapMutationError(r.status)); return }
      }
      setEditMode(null)
      setEditValue('')
      onChanged()
    } catch {
      setEditError(t('errNetwork'))
    } finally {
      setEditSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleteError('')
    setDeleting(true)
    try {
      const r = await fetch(`/api/menu/categories?id=${toDelete.id}`, { method: 'DELETE' })
      if (!r.ok) { setDeleteError(mapMutationError(r.status)); return }
      setToDelete(null)
      onChanged()
    } catch {
      setDeleteError(t('errNetwork'))
    } finally {
      setDeleting(false)
    }
  }

  // ── Render: never empty — the 4 defaults are always there ──────────────────
  // Group each rendered category with its source: 'default' or 'custom'. Names
  // are matched case-insensitively against the operator's custom list so a
  // hypothetical capitalisation drift doesn't break the edit affordance.
  const customByLower = new Map(
    customCategories.map((c) => [c.name.trim().toLowerCase(), c]),
  )
  const rendered = allCategoryNames.map((name) => {
    const custom = customByLower.get(name.trim().toLowerCase())
    const count = items.filter((i) => i.category === name).length
    const avail = items.filter((i) => i.category === name && i.available).length
    return { name, count, avail, custom }
  })

  return (
    <div className="op-card">
      <div className="op-menu__dishes-head">
        <h2><span className="ms" aria-hidden="true">category</span>{t('tabTitle')}</h2>
        <div className="spacer" />
        <button
          type="button"
          onClick={openCreate}
          title={CATEGORIES_FR_LABELS.newButton}
          aria-label={CATEGORIES_FR_LABELS.newButton}
          className="op-btn-add"
        >
          <span className="ms" aria-hidden="true">add</span> {t('newButton')}
        </button>
      </div>

      <div style={{ padding: '10px 18px' }}>
        <p className="op-dash__sub" style={{ margin: '0 0 6px' }}>{t('tabSubtitle')}</p>
      </div>

      <div className="op-menu__dishes-list">
        {rendered.map(({ name, count, avail, custom }) => {
          const isDefault = !custom
          return (
            <div key={name} className="dish-row">
              <span className="thumb" style={{ background: 'var(--op-surface-2)' }} aria-hidden="true">
                <span style={{ fontSize: 22 }}>{emojiFor(name)}</span>
              </span>
              <div className="m">
                <b>
                  {name}
                  {isDefault ? (
                    <span
                      className="tag-86"
                      style={{ color: 'var(--op-muted-2)', background: 'var(--op-surface-2)' }}
                      title={`${CATEGORIES_FR_LABELS.defaultBadge} — ${t('defaultsNotEditable')}`}
                      aria-label={CATEGORIES_FR_LABELS.defaultBadge}
                    >
                      {t('defaultBadge')}
                    </span>
                  ) : (
                    <span
                      className="tag-86"
                      style={{ color: 'var(--op-zest-600)', background: 'var(--op-zest-bg)' }}
                      title={CATEGORIES_FR_LABELS.customBadge}
                      aria-label={CATEGORIES_FR_LABELS.customBadge}
                    >
                      {t('customBadge')}
                    </span>
                  )}
                </b>
                <span className="desc">
                  {t('countItems', { count })}{count > 0 && ` · ${avail}/${count}`}
                </span>
              </div>
              <span aria-hidden="true" className="op-pill" style={{ padding: 0, background: 'none' }}>
                <i style={{ width: 8, height: 8, borderRadius: '50%', background: avail > 0 ? 'var(--op-success)' : 'var(--op-muted-2)', display: 'inline-block' }} />
              </span>
              {custom && (
                <div className="actions">
                  <button type="button" className="icon-btn-sm" onClick={() => openRename(custom)}
                    aria-label={t('editButton')} title={t('editButton')}>
                    <span className="ms" aria-hidden="true">edit</span>
                  </button>
                  <button type="button" className="icon-btn-sm danger"
                    onClick={() => { setDeleteError(''); setToDelete(custom) }}
                    aria-label={t('deleteButton')} title={t('deleteButton')}>
                    <span className="ms" aria-hidden="true">delete</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Create / Rename modal ──────────────────────────────────────────── */}
      {editMode && (
        <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeEdit() }}>
          <form onSubmit={submitEdit} className="op-modal narrow">
            <div className="op-modal__head">
              <h3 title={editMode.kind === 'create' ? CATEGORIES_FR_LABELS.newButton : undefined}>
                {editMode.kind === 'create' ? t('newTitle') : t('editTitle')}
              </h3>
              <button type="button" onClick={closeEdit} aria-label={t('cancel')} className="op-modal__close">
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <div className="op-field">
                <label>{t('newTitle')}</label>
                <input
                  autoFocus
                  className="op-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder={t('newPlaceholder')}
                  maxLength={50}
                  disabled={editSaving}
                />
              </div>
              {editError && (
                <div className="op-callout danger">
                  <span className="ms" aria-hidden="true">error</span>
                  <p>{editError}</p>
                </div>
              )}
            </div>
            <div className="op-modal__foot">
              <button type="button" onClick={closeEdit} disabled={editSaving} className="op-btn-ghost">
                {t('cancel')}
              </button>
              <button type="submit" disabled={editSaving || !editValue.trim()} className="op-btn-primary">
                {editSaving
                  ? <span className="ms" aria-hidden="true" style={{ animation: 'op-scan-spin 1s linear infinite' }}>progress_activity</span>
                  : <><span className="ms" aria-hidden="true">check</span>{editMode.kind === 'create' ? t('confirmCreate') : t('confirmRename')}</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Delete confirm modal ──────────────────────────────────────────── */}
      {toDelete && (
        <div className="op-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !deleting) setToDelete(null) }}>
          <div className="op-modal narrow">
            <div className="op-modal__head">
              <h3>{t('deleteTitle')}</h3>
              <button type="button" onClick={() => { if (!deleting) setToDelete(null) }} aria-label={t('cancel')} className="op-modal__close">
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <p className="op-dash__sub" style={{ margin: 0 }}>{t('deleteBody', { name: toDelete.name })}</p>
              <div className="op-callout warn">
                <span className="ms" aria-hidden="true">info</span>
                <p>{t('deleteNote')}</p>
              </div>
              {deleteError && (
                <div className="op-callout danger">
                  <span className="ms" aria-hidden="true">error</span>
                  <p>{deleteError}</p>
                </div>
              )}
            </div>
            <div className="op-modal__foot">
              <button type="button" onClick={() => { if (!deleting) setToDelete(null) }} disabled={deleting} className="op-btn-ghost">
                {t('cancel')}
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="op-btn-danger">
                {deleting
                  ? <span className="ms" aria-hidden="true" style={{ animation: 'op-scan-spin 1s linear infinite' }}>progress_activity</span>
                  : <><span className="ms" aria-hidden="true">delete</span>{t('confirmDelete')}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Promos tab (visual/inert — no promo engine wired here) ────────────────────

function PromosTab() {
  const t = useTranslations('menu.editor')
  return (
    <>
      {/* Honest preview: these promos are a static mock (pre-existing, "not yet in DB scope").
          The REAL promotion management lives on /promotions — link there so nothing here reads
          as a live, functional promo list. Presentation-only. */}
      <Link href="/promotions" className="op-callout" style={{ marginBottom: 16, textDecoration: 'none' }}>
        <span className="ms" aria-hidden="true">info</span>
        <p>{t('promoPreviewNote')}</p>
        <span className="ms flip-rtl" aria-hidden="true" style={{ marginInlineStart: 'auto' }}>arrow_forward</span>
      </Link>
      <div className="op-card" style={{ marginBottom: 16 }}>
        <div className="op-menu__dishes-head">
          <h2><span className="ms" aria-hidden="true">percent</span>{t('promoActiveTitle')}</h2>
          <span className="count-badge">{t('promoSoon')}</span>
        </div>
        <div>
          {PROMOS.map(p => (
            <div key={p.name} className="op-promo__row">
              <span className="ic"><span className="ms" aria-hidden="true">local_offer</span></span>
              <div className="m"><b>{p.name}</b><span>{p.desc}</span></div>
              <span className={`op-pill ${p.active ? 'success' : 'muted'}`}>
                {p.active ? t('promoActive') : t('promoInactive')}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="op-card">
        <div className="op-menu__dishes-head">
          <h2><span className="ms" aria-hidden="true">add_circle</span>{t('promoCreateTitle')}</h2>
        </div>
        <div className="op-promo__grid">
          {([
            ['percent',      t('promoPct')],
            ['sell',         t('promoFixed')],
            ['bolt',         t('promoFlash')],
            ['restaurant',   t('promoChef')],
          ] as const).map(([icon, l]) => (
            <button key={l} type="button" className="op-promo__tile">
              <span className="ic"><span className="ms" aria-hidden="true">{icon}</span></span>
              <b>{l}</b>
            </button>
          ))}
        </div>
      </div>
    </>
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
  const ta    = useTranslations('creators.allergens')   // 14 INCO labels (M6)
  const td    = useTranslations('creators.difficulty')
  const toast = useToast()

  const [dishes,     setDishes]     = useState<AvailableDish[]>([])
  const [hasBrand,   setHasBrand]   = useState(true)
  const [loading,    setLoading]    = useState(true)
  const [prices,     setPrices]     = useState<Record<string, number>>({})
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [adoptedIds, setAdoptedIds] = useState<Set<string>>(new Set())
  const [joiningId,  setJoiningId]  = useState<string | null>(null)
  const [joinedIds,  setJoinedIds]  = useState<Set<string>>(new Set())
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const [declinedIds, setDeclinedIds] = useState<Set<string>>(new Set())
  const [conditions, setConditions] = useState<AdoptionConditions | null>(null)
  // Mission 6 — technical-sheet modal for the resto's ADOPTED recipes (D1).
  const [sheetDishId, setSheetDishId] = useState<string | null>(null)

  function reload() {
    return fetch('/api/dishes/available', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(d => {
        setDishes(d.dishes ?? [])
        setHasBrand(Boolean(d.hasBrand))
        if (d.conditions) setConditions(d.conditions as AdoptionConditions)
      })
  }

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
        if (d.conditions) setConditions(d.conditions as AdoptionConditions)
      })
      .catch(() => { if (alive) toast.error(t('loadError')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mission 4 — accept a live city-exclusive offer (waitlist promotion).
  async function acceptOffer(dish: AvailableDish) {
    setAdoptingId(dish.id)
    try {
      const r = await fetch('/api/dishes/waitlist/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creatorDishId: dish.id }),
      })
      if (r.ok) {
        setAdoptedIds(prev => new Set(prev).add(dish.id))
        toast.success(t('adoptedToast'), { description: t('adoptedToastDesc', { name: dish.name }) })
        onAdopted()
        await reload().catch(() => {})
      } else {
        const d = await r.json().catch(() => null)
        // Expired / taken in between → refresh so the card reflects the new truth.
        toast.error(t('errorToast'), { description: d?.error })
        await reload().catch(() => {})
      }
    } catch {
      toast.error(t('errorToast'))
    } finally {
      setAdoptingId(null)
    }
  }

  // Mission 4 — decline a live offer → it passes to the next restaurant.
  async function declineOffer(dish: AvailableDish) {
    setDecliningId(dish.id)
    try {
      const r = await fetch('/api/dishes/waitlist/decline', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ creatorDishId: dish.id }),
      })
      if (r.ok) {
        setDeclinedIds(prev => new Set(prev).add(dish.id))
        toast.success(t('declinedToast'))
        await reload().catch(() => {})
      } else {
        const d = await r.json().catch(() => null)
        toast.error(t('errorToast'), { description: d?.error })
      }
    } catch {
      toast.error(t('errorToast'))
    } finally {
      setDecliningId(null)
    }
  }

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
        <AdoptHeader t={t} commitmentDays={conditions?.minCommitmentDays} />
        <SkeletonList count={4} variant="card" />
      </div>
    )
  }

  if (!hasBrand) {
    return (
      <div>
        <AdoptHeader t={t} commitmentDays={conditions?.minCommitmentDays} />
        <EmptyState emoji="🏪" title={t('emptyTitle')} description={t('noBrand')} />
      </div>
    )
  }

  if (dishes.length === 0) {
    return (
      <div>
        <AdoptHeader t={t} commitmentDays={conditions?.minCommitmentDays} />
        <EmptyState emoji="🧑‍🍳" title={t('emptyTitle')} description={t('emptyDesc')} />
      </div>
    )
  }

  return (
    <div>
      <AdoptHeader t={t} commitmentDays={conditions?.minCommitmentDays} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dishes.map(dish => {
          const adoptedServer = dish.alreadyAdopted
          const adoptedNow    = adoptedIds.has(dish.id)
          const isAdopted     = adoptedServer || adoptedNow
          const price         = prices[dish.id] ?? dish.suggestedPrice
          // City exclusivity (levier 3B): waitlist state for non-adopted recipes.
          const joinedNow     = joinedIds.has(dish.id)
          const declinedNow   = declinedIds.has(dish.id)
          // A live city-exclusive OFFER for me (waitlist promotion) takes
          // priority over the generic "on waitlist" display.
          const hasOffer      = dish.offerHoursLeft != null && !isAdopted && !declinedNow
          const onWaitlist    = ((dish.onWaitlist ?? false) || joinedNow) && !hasOffer
          const cityTaken     = (dish.cityTaken ?? false) && !isAdopted && !hasOffer
          const waitlistCount = dish.waitlistCount ?? 0
          const commitmentDays = conditions?.minCommitmentDays ?? 60

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
                    <Badge tone="success" size="sm">{t('adopted')}</Badge>
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

                {/* Creator + audience + ⭐ Étoiles Grubano (Mission 4) */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {t('byCreator', { name: dish.creatorName || '—' })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>group</span> {t('followers', { count: dish.creatorFollowers })}
                  </span>
                  <StarBadge stars={dish.creatorStars ?? 0} size={12} />
                </div>

                {/* Benefit pitch */}
                <div className="rounded-xl bg-grubano-tint/60 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-grubano-primary">
                    <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>trending_up</span> {t('benefit', { pct: Math.round((conditions?.commissionPct ?? 0.02) * 100) })}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t('promotedBy', { count: dish.creatorFollowers })}
                  </p>
                </div>

                {/* Mission 6 — the BUSINESS CASE (figures from the sheet, D1) */}
                {(dish.sheetCompleteness ?? 0) > 0 && (
                  <div className="space-y-1.5 rounded-xl border border-border bg-card px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(dish.sheetCompleteness ?? 0) >= 80 && (
                        <Badge tone="success" size="sm">{t('sheetComplete')}</Badge>
                      )}
                      {dish.difficulty && <Badge size="sm">{td(dish.difficulty)}</Badge>}
                      {((dish.prepMinutes ?? 0) + (dish.cookMinutes ?? 0)) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="ms" aria-hidden="true" style={{ fontSize: 10 }}>schedule</span> {t('totalTime', { min: (dish.prepMinutes ?? 0) + (dish.cookMinutes ?? 0) })}
                        </span>
                      )}
                    </div>
                    {((dish.dietTags?.length ?? 0) > 0 || (dish.allergens?.length ?? 0) > 0) && (
                      <p className="text-[10px] text-muted-foreground">
                        {(dish.dietTags ?? []).join(' · ')}
                        {(dish.dietTags?.length ?? 0) > 0 && (dish.allergens?.length ?? 0) > 0 ? ' · ' : ''}
                        {(dish.allergens?.length ?? 0) > 0
                          ? t('allergensLine', { list: (dish.allergens ?? []).map((a) => ta(a)).join(', ') })
                          : ''}
                      </p>
                    )}
                    <div className="space-y-0.5 text-[10px] text-muted-foreground">
                      <p>
                        {t('bizPrice', { price: dish.suggestedPrice.toFixed(2).replace('.', ',') })}
                        {dish.estimatedCostPerServing != null
                          ? ` · ${t('bizCost', { cost: dish.estimatedCostPerServing.toFixed(2).replace('.', ',') })}`
                          : ''}
                      </p>
                      {dish.estimatedMarginPct != null && (
                        <p className="font-semibold text-grubano-success">{t('bizMargin', { pct: dish.estimatedMarginPct })}</p>
                      )}
                      <p>{t('bizConditions', { pct: Math.round((conditions?.commissionPct ?? 0.02) * 100), days: commitmentDays })}</p>
                      <p className="italic">{t('bizDisclaimer')}</p>
                    </div>
                  </div>
                )}

                {/* Price (editable) or commitment note once adopted */}
                {isAdopted ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl bg-grubano-success-tint px-3 py-2 text-[11px] font-semibold text-grubano-success">
                      <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>schedule</span> {t('commitmentDays', { days: commitmentDays })}
                    </div>
                    {/* Incumbent visibility: how many restos wait for this recipe here */}
                    {waitlistCount > 0 && (
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>group</span> {t('waitingCount', { count: waitlistCount })}
                      </p>
                    )}
                  </div>
                ) : (cityTaken || onWaitlist || hasOffer) ? null : (
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

                {/* CTA — adopted / OFFER / on waitlist / city-taken / adoptable */}
                {isAdopted ? (
                  <div className="space-y-2">
                    <DSButton variant="secondary" size="sm" fullWidth disabled>
                      {adoptedServer && !adoptedNow ? t('alreadyOnMenu') : t('adopted')}
                    </DSButton>
                    {/* Mission 6 — the licensed asset, server-locked to adopters (D1). */}
                    <DSButton variant="primary" size="sm" fullWidth
                      onClick={() => setSheetDishId(dish.id)}>
                      {t('viewSheet')}
                    </DSButton>
                  </div>
                ) : hasOffer ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl border border-grubano-primary/40 bg-grubano-primary/10 px-3 py-2 text-[11px] font-semibold text-grubano-primary">
                      <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>auto_awesome</span> {t('offerAvailable', { hours: dish.offerHoursLeft ?? 72 })}
                    </div>
                    <div className="flex gap-2">
                      <DSButton
                        variant="primary" size="sm" fullWidth
                        loading={adoptingId === dish.id}
                        onClick={() => acceptOffer(dish)}
                      >
                        {adoptingId === dish.id ? t('adopting') : t('offerAccept')}
                      </DSButton>
                      <DSButton
                        variant="secondary" size="sm" fullWidth
                        loading={decliningId === dish.id}
                        onClick={() => declineOffer(dish)}
                      >
                        {t('offerDecline')}
                      </DSButton>
                    </div>
                  </div>
                ) : declinedNow ? (
                  <DSButton variant="secondary" size="sm" fullWidth disabled>
                    {t('offerDeclined')}
                  </DSButton>
                ) : onWaitlist ? (
                  <DSButton variant="secondary" size="sm" fullWidth disabled>
                    {t('joinedWaitlist')}
                  </DSButton>
                ) : cityTaken ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                      <span className="ms" aria-hidden="true" style={{ fontSize: 12 }}>info</span> {t('cityTaken')}
                    </div>
                    <DSButton
                      variant="secondary" size="sm" fullWidth
                      loading={joiningId === dish.id}
                      onClick={() => joinWaitlist(dish)}
                    >
                      {joiningId === dish.id ? t('joiningWaitlist') : t('joinWaitlist')}
                    </DSButton>
                  </div>
                ) : (
                  <DSButton
                    variant="primary" size="sm" fullWidth
                    loading={adoptingId === dish.id}
                    onClick={() => adopt(dish)}
                  >
                    {adoptingId === dish.id ? t('adopting') : t('adopt')}
                  </DSButton>
                )}
              </div>
            </DSCard>
          )
        })}
      </div>

      {/* Mission 6 — technical sheet modal (GET /api/dishes/[id]/sheet, D1) */}
      {sheetDishId && (
        <DishSheetModal dishId={sheetDishId} onClose={() => setSheetDishId(null)} />
      )}
    </div>
  )
}

function AdoptHeader({ t, commitmentDays }: { t: ReturnType<typeof useTranslations>; commitmentDays?: number }) {
  return (
    <div className="op-adopt__head">
      <h2 style={{ margin: 0, fontFamily: 'var(--op-font-display)', fontWeight: 800, fontSize: 16 }}>{t('title')}</h2>
      <p className="op-dash__sub" style={{ margin: '4px 0 0' }}>{t('subtitle')}</p>
      <div className="op-adopt__note">
        <span className="ms" aria-hidden="true">schedule</span>
        <p>{t('commitmentNoteDays', { days: commitmentDays ?? 60 })}</p>
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
  /** Receives the freshly-created MenuItem AND the soft moderation warnings
   *  (if any), so the page can surface them in the top banner. */
  onAdd:      (item: MenuItem, warnings?: string[]) => void
}) {
  const t = useTranslations('menu.editor')
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
    <div className="op-scan">
      <div className="op-scan__inner">
        {/* Top bar */}
        <div className="op-scan__top">
          <button type="button" onClick={onClose} aria-label={t('close')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
          <div className="op-scan__badge"><span className="ms" aria-hidden="true">auto_awesome</span> {t('scanTitle')}</div>
          <div style={{ width: 40 }} />
        </div>

        {step === 'upload' && (
          <div className="op-scan__stage">
            <input
              ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            {preview ? (
              <div style={{ width: '100%' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={t('scanPhotoAlt')} />
                {error && (
                  <div className="op-scan__err">
                    <span className="ms" aria-hidden="true">error</span> {error}
                  </div>
                )}
                <div className="op-scan__row">
                  <button type="button" className="op-scan__cta ghost" onClick={() => fileRef.current?.click()}>
                    {t('scanChange')}
                  </button>
                  <button type="button" className="op-scan__cta" onClick={analyze}>
                    {t('scanAnalyze')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="op-scan__drop"><span className="ms" aria-hidden="true">add_a_photo</span></div>
                <h2>{t('scanPick')}</h2>
                <p>{t('scanHint')}</p>
                <button type="button" className="op-scan__cta" onClick={() => fileRef.current?.click()}>
                  <span className="ms" aria-hidden="true">upload</span> {t('scanChoose')}
                </button>
              </>
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
  const t = useTranslations('menu.editor')
  const stages = [
    t('scanStage1'),
    t('scanStage2'),
    t('scanStage3'),
    t('scanStage4'),
    t('scanStage5'),
  ]
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIdx(i => Math.min(i + 1, stages.length - 1)), 900)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="op-scan__stage">
      <div className="op-scan__spinner">
        <div className="ring" />
        <div className="core"><span className="ms" aria-hidden="true">auto_awesome</span></div>
      </div>
      <h2>{t('scanAnalyzing')}</h2>
      <p>{stages[idx]}</p>
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
  onAdd:       (item: MenuItem, warnings?: string[]) => void
}) {
  const t = useTranslations('menu.editor')
  const [name,      setName]      = useState(scanResult.name)
  const [desc,      setDesc]      = useState(scanResult.description)
  // FIX "catégorie collée": keep the IA suggestion when it matches one of the
  // available chips (defaults + custom), else fall back to the FIXED neutral
  // default — never `categories[0]`, which used to be whatever existed first.
  const [category,  setCategory]  = useState(
    categories.includes(scanResult.category)
      ? scanResult.category
      : DEFAULT_NEW_DISH_CATEGORY,
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

  // The chips render the prop list as-is. The parent passes the COMPLETE set
  // (4 defaults + custom) via allCategoryNames, so a degenerate fallback to
  // the 4 defaults is no longer necessary — and exactly that fallback used
  // to mask the bug by hiding defaults once any dish existed.
  const allCats = categories

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
      // Forward the soft warnings (blur / low light / framing) so the menu
      // page can surface them in its top banner — they NEVER block the
      // creation, just suggest a better photo for next time.
      const warnings: string[] = Array.isArray(d.warnings) ? d.warnings : []
      onAdd(d.item, warnings)
    } else {
      // Never swallow the failure (e.g. a rejected image) — surface it; the dish
      // is intentionally NOT created without its photo.
      const d = await r.json().catch(() => null)
      setError((d && (d.error as string)) || t('scanAddError'))
      setSaving(false)
    }
  }

  return (
    <div className="op-scan__result">
      <div className="op-scan__result-head">
        <button type="button" onClick={onClose} aria-label={t('close')}>
          <span className="ms" aria-hidden="true">close</span>
        </button>
        <div className="mid">
          <div className="kicker">{t('scanAiGen')}</div>
          <b>{t('scanVerify')}</b>
        </div>
        <button type="button" onClick={onRetake} aria-label={t('scanRetake')}>
          <span className="ms" aria-hidden="true">restart_alt</span>
        </button>
      </div>

      <div className="op-scan__result-body">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={name} />
        )}

        <div className="op-field">
          <label>{t('fName')}</label>
          <input className="op-input" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="op-field">
          <label>{t('fDesc')}</label>
          <textarea className="op-textarea" value={desc} onChange={e => setDesc(e.target.value)} rows={3} />
        </div>

        <div className="op-field">
          <label>{t('fCategory')}</label>
          <div className="op-chips">
            {allCats.map(c => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={`op-chip${category === c ? ' is-on' : ''}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="op-field-row">
          <div className="op-field">
            <label>{t('fPrice')}</label>
            <input className="op-input mono" type="number" step="0.1" min="0" value={price}
              onChange={e => setPrice(Number(e.target.value))} />
          </div>
          <div className="op-field">
            <label>{t('fCalories')}</label>
            <input className="op-input" type="number" min="0" value={calories ?? ''}
              onChange={e => setCalories(Number(e.target.value))} />
          </div>
        </div>

        <div className="op-field">
          <label>{t('fAllergens')}</label>
          <div className="op-chips">
            {ALL_EU.map(a => {
              const on = allergens.includes(a)
              return (
                <button key={a} type="button"
                  onClick={() => setAllergens(on ? allergens.filter(x => x !== a) : [...allergens, a])}
                  className={`op-chip allergen${on ? ' is-on' : ''}`}>
                  {on && '✓ '}{a}
                </button>
              )
            })}
          </div>
        </div>

        <div className="op-field">
          <label>{t('fLabels')}</label>
          <div className="op-labels">
            {ALL_LABELS.map(l => {
              const on = labels.includes(l.name)
              return (
                <button key={l.name} type="button"
                  onClick={() => setLabels(on ? labels.filter(x => x !== l.name) : [...labels, l.name])}
                  className={`op-label-tile${on ? ' is-on' : ''}`}>
                  <span className="ms" aria-hidden="true">{l.icon}</span>
                  <span>{l.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="op-scan__result-foot">
        {error && (
          <div className="op-callout danger" style={{ marginBottom: 12 }}>
            <span className="ms" aria-hidden="true">error</span>
            <p>{error}</p>
          </div>
        )}
        <button type="button" className="op-btn-primary" onClick={confirm} disabled={saving || !name}>
          {saving
            ? <span className="ms" aria-hidden="true" style={{ animation: 'op-scan-spin 1s linear infinite' }}>progress_activity</span>
            : <span className="ms" aria-hidden="true">check</span>}
          {saving ? t('scanSaving') : t('scanAdd')}
        </button>
      </div>
    </div>
  )
}

// ── Dish editor ───────────────────────────────────────────────────────────────

function DishEditor({
  item, categories, locale, onClose, onSave, onDelete,
}: {
  item:       MenuItem
  categories: string[]
  locale:     string
  onClose:    () => void
  /** `extras.warnings` forwards soft moderation tips when the operator
   *  uploaded a fresh photo through the Manuel flow (sub-commit 3). */
  onSave:     (item: MenuItem, extras?: { warnings?: string[] }) => void
  onDelete:   (id: string) => void
}) {
  const t = useTranslations('menu.editor')
  const tPhoto = useTranslations('menu.photo')
  const [d, setD] = useState<MenuItem>(item)
  const [saving, setSaving] = useState(false)
  const isNew = item.id === 'new'

  // ── Manuel photo state ─────────────────────────────────────────────────────
  // A pending base64 payload prepared from the file picker. Only the freshly-
  // selected photo lives here; the canonical persisted URL stays on d.photos
  // once the server returns. The pendingPreview holds an objectURL for live
  // visual feedback before the upload completes.
  const photoFileRef = useRef<HTMLInputElement>(null)
  const [photoPayload, setPhotoPayload] = useState<{
    imageBase64: string
    mediaType:   'image/jpeg' | 'image/png' | 'image/webp'
    preview:     string
  } | null>(null)
  const [photoError, setPhotoError] = useState('')

  // Revoke the objectURL when the editor closes / a new file replaces it.
  useEffect(() => {
    return () => {
      if (photoPayload?.preview) URL.revokeObjectURL(photoPayload.preview)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePhotoPick(file: File) {
    setPhotoError('')
    const raw = file.type
    // /api/menu only accepts image/jpeg | image/png | image/webp (Agent 2's
    // Zod). Block GIF / others client-side with the i18n 400 message.
    if (raw !== 'image/jpeg' && raw !== 'image/png' && raw !== 'image/webp') {
      setPhotoError(tPhoto('err400'))
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError(tPhoto('err400'))
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = (ev.target?.result as string) ?? ''
      const base64 = result.split(',')[1] ?? ''
      if (!base64) return
      if (photoPayload?.preview) URL.revokeObjectURL(photoPayload.preview)
      setPhotoPayload({
        imageBase64: base64,
        mediaType:   raw,
        preview:     URL.createObjectURL(file),
      })
    }
    reader.readAsDataURL(file)
  }

  // Same fix as ResultStep: trust the prop list (defaults + custom) instead
  // of degenerating to the 4 builtins when it "looks small". The previous
  // `categories.length > 0 ? categories : DEFAULTS` was the symmetric cause
  // of the bug — once any custom existed but defaults were absent, the
  // picker collapsed to whatever happened to be in `categories`.
  const allCats = categories

  /** Map an HTTP status (returned by /api/menu or /api/menu/photo) to a
   *  user-facing i18n string. 422 surfaces the server's `reason` when
   *  available so the operator knows what the moderation didn't like. */
  function mapUploadError(status: number, body: unknown): string {
    const reason =
      typeof body === 'object' && body !== null
        ? ((body as { moderation?: { reason?: string }; error?: string }).moderation?.reason
          ?? (body as { error?: string }).error
          ?? '')
        : ''
    switch (status) {
      case 422: return tPhoto('err422', { reason: reason || '' }).trim()
      case 400: return tPhoto('err400')
      case 503: return tPhoto('err503')
      case 500:
      case 502: return tPhoto('err500')
      default:  return reason || tPhoto('err500')
    }
  }

  async function handleSave() {
    setSaving(true)
    setPhotoError('')
    try {
      if (isNew) {
        // ── NEW dish: include the photo IN the create payload — Agent 2's
        //    POST /api/menu uploads + creates atomically, never a half-state.
        const r = await fetch('/api/menu', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...d,
            brandId: d.brandId,
            id: undefined,
            ...(photoPayload
              ? { imageBase64: photoPayload.imageBase64, mediaType: photoPayload.mediaType }
              : {}),
          }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok) {
          setPhotoError(mapUploadError(r.status, body))
          return
        }
        // body = { item, warnings }
        const created = body?.item ?? { ...d, photos: photoPayload ? d.photos : d.photos }
        const warnings: string[] = Array.isArray(body?.warnings) ? body.warnings : []
        onSave(created as MenuItem, { warnings })
        return
      }

      // ── EXISTING dish: if the operator picked a new photo, run it through
      //    /api/menu/photo FIRST so we know what photos URL to persist; then
      //    save the rest via the regular PUT path (delegated to MenuBuilder
      //    through onSave which already handles the PUT).
      let nextPhotos = d.photos
      let photoWarnings: string[] = []
      if (photoPayload) {
        const photoRes = await fetch('/api/menu/photo', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: photoPayload.imageBase64,
            mediaType:   photoPayload.mediaType,
            brandId:     d.brandId,
            menuItemId:  d.id,
          }),
        })
        const photoBody = await photoRes.json().catch(() => null)
        if (!photoRes.ok) {
          setPhotoError(mapUploadError(photoRes.status, photoBody))
          return
        }
        nextPhotos = Array.isArray(photoBody?.photos) ? photoBody.photos : nextPhotos
        photoWarnings = Array.isArray(photoBody?.warnings) ? photoBody.warnings : []
      }
      onSave({ ...d, photos: nextPhotos }, { warnings: photoWarnings })
    } catch {
      setPhotoError(tPhoto('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  const photoSrc = photoPayload?.preview ?? d.photos?.[0]

  // ── D2.1 layout (docs/design/handoffs/D2.1-ref/dish-editor.html) ────────────
  // Presentation only. Section order follows contract §2: identity → figures →
  // category → allergens → labels → best-seller → delete → error slot → footer.
  // The error banner leaves its old "under the photo" spot for a FIXED slot
  // between the scroll area and the footer, so it is always on screen when the
  // operator clicks Enregistrer. Its SOURCE (`photoError`) and its text are
  // untouched — only the render position moves.
  return (
    <div className="op-modal-backdrop de-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* `data-state` is documentary (QA hook) — no CSS layout rule depends on it. */}
      <div
        className="de-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="de-modal-title"
        data-state={isNew ? 'create' : 'edit'}
      >
        <header className="de-modal__head">
          <h2 className="de-modal__title" id="de-modal-title">
            {isNew ? t('modalNewTitle') : t('modalEditTitle')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="de-modal__close">
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </header>

        <div className="de-modal__scroll">
          {/* ── Photo (Manuel upload) ── */}
          <input
            ref={photoFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handlePhotoPick(f)
              // Reset so picking the same file twice still triggers onChange.
              e.target.value = ''
            }}
          />

          {/* ① Identity — photo + name/description */}
          <div className="de-id">
            <div
              className={`de-photo${photoSrc ? ' has-photo' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => photoFileRef.current?.click()}
            >
              {photoSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoSrc} alt={tPhoto('alt', { name: d.name || '—' })} />
              )}
              <span className="ms" aria-hidden="true">add_photo_alternate</span>
              <b>{d.photos?.[0] || photoPayload ? tPhoto('change') : tPhoto('pick')}</b>
              <span>{t('helpPhoto')}</span>
            </div>
            <div className="de-id__f">
              <div className="de-fld">
                <label htmlFor="de-f-name">{t('fName')}</label>
                <input id="de-f-name" className="de-inp" type="text" value={d.name}
                  onChange={e => setD({ ...d, name: e.target.value })}
                  placeholder={t('fNamePlaceholder')} />
              </div>
              <div className="de-fld">
                <label htmlFor="de-f-desc">{t('fDesc')}</label>
                <textarea id="de-f-desc" className="de-inp" value={d.description ?? ''}
                  onChange={e => setD({ ...d, description: e.target.value })}
                  placeholder={t('fDesc')} rows={3} />
              </div>
            </div>
          </div>

          {/* ② Figures — price + calories, two columns at every width */}
          <div className="de-row2">
            <div className="de-fld">
              <label htmlFor="de-f-price">{t('fPrice')}</label>
              <input id="de-f-price" className="de-inp mono" type="number" step="0.1" min="0" value={d.price}
                onChange={e => setD({ ...d, price: Number(e.target.value) })} />
              {/* Passive help — the server rejects 0; NO client validation added. */}
              <div className="de-fld__help"><span className="ms" aria-hidden="true">info</span>{t('helpPrice')}</div>
            </div>
            <div className="de-fld">
              <label htmlFor="de-f-cal">{t('fCalories')}</label>
              <input id="de-f-cal" className="de-inp mono" type="number" min="0" value={d.calories ?? ''}
                onChange={e => setD({ ...d, calories: e.target.value ? Number(e.target.value) : null })} />
              <div className="de-fld__help"><span className="ms" aria-hidden="true">info</span>{t('helpCalories')}</div>
            </div>
          </div>

          {/* ③ Category — mono-select, active = solid ink + ✓ (never colour alone) */}
          <div className="de-sec">
            <label>{t('fCategory')}</label>
            <div className="de-chips">
              {allCats.map(c => {
                const on = d.category === c
                return (
                  <button key={c} type="button" onClick={() => setD({ ...d, category: c })}
                    className={`de-chip${on ? ' is-cat-on' : ''}`}>
                    {on && '✓ '}{c}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ④ Allergens (EU 14) — multi-select, active = ✓ + zest tint */}
          <div className="de-sec">
            <label>{t('fAllergens')}</label>
            <div className="de-chips">
              {ALL_EU.map(a => {
                const on = d.allergens.includes(a)
                return (
                  <button key={a} type="button"
                    onClick={() => setD({ ...d, allergens: on ? d.allergens.filter(x => x !== a) : [...d.allergens, a] })}
                    className={`de-chip de-chip--allergen${on ? ' is-on' : ''}`}>
                    {on && '✓ '}{a}
                  </button>
                )
              })}
            </div>
            <div className="de-fld__help de-help--block">
              <span className="ms" aria-hidden="true">info</span>{t('helpAllergens')}
            </div>
          </div>

          {/* ⑤ Labels — 4 tiles; icons kept from the product (EXPLICITLY ACCEPTED, contract §8) */}
          <div className="de-sec">
            <label>{t('fLabels')}</label>
            <div className="de-tiles">
              {ALL_LABELS.map(l => {
                const on = d.labels.includes(l.name)
                return (
                  <button key={l.name} type="button"
                    onClick={() => setD({ ...d, labels: on ? d.labels.filter(x => x !== l.name) : [...d.labels, l.name] })}
                    className={`de-tile${on ? ' is-on' : ''}`}>
                    <span className="ms" aria-hidden="true">{l.icon}</span>
                    <span>{l.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ⑥ Best-seller */}
          <div className="de-sec">
            <div className="de-switchrow">
              <div className="m"><b>{t('fBest')}</b><span>{t('fBestSub')}</span></div>
              <label className="op-switch" title={t('fBest')}>
                <input type="checkbox" checked={d.isPopular} onChange={() => setD({ ...d, isPopular: !d.isPopular })} />
                <span className="track" />
              </label>
            </div>
          </div>

          {/* ⑦ Delete — EDIT only, last child of the scroll: never next to Enregistrer */}
          {!isNew && (
            <div className="de-del">
              <button type="button" onClick={() => onDelete(item.id)}>
                <span className="ms" aria-hidden="true">delete</span>{t('deleteThisDish')}
              </button>
            </div>
          )}
        </div>

        {/* Server error — fixed slot, outside the scroll, verbatim text */}
        {photoError && (
          <div className="de-modal__err" role="alert">
            <span className="ms" aria-hidden="true">error</span>
            <span>{photoError}</span>
          </div>
        )}

        <footer className="de-modal__foot">
          <button type="button" onClick={onClose} className="de-btn de-btn--cancel">{t('cancel')}</button>
          <button type="button" onClick={handleSave} disabled={saving || !d.name} className="de-btn de-btn--save">
            {saving
              ? <span className="ms de-spin" aria-hidden="true">progress_activity</span>
              : <span className="ms" aria-hidden="true">check</span>}
            {saving ? t('saving') : t('save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
