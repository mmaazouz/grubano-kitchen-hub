'use client'

import './search.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` icon font.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import { useGeolocation } from '@/lib/use-geolocation'
import { readFavs, toggleFav, FAV_EVENT } from '@/lib/eat-cart'
import { getRestaurantCover } from '@/lib/food-images'

// ── /eat/search — CONSUMER search screen, re-skinned to the FROZEN CD refs ──────
//
//   · MOBILE  : « Recherche mobile — suggestions au fil de la frappe » (Notion
//               38efd2c9-8146-8135) — idle (recents + popular) / typing (restos
//               + dishes + "all-restaurants" search) / no-match.
//   · DESKTOP : « Recherche DESKTOP (barre unique + carte + filtre Favoris) »
//               (Notion 38efd2c9-8146-81e3) — subbar (filters/sort/count) + 2-col
//               grid + INERT map panel + REAL Favoris filter.
//
// The page renders INSIDE EatShell (rail + topbar). It is a TOP-LEVEL nav tab, so
// on DESKTOP the shell topbar — WITH its AI search input — is shown above: the page
// does NOT draw its own desktop search bar; the query is read from the URL ?q= that
// the topbar routes to. On MOBILE the shell has no search field, so the page keeps
// its own search affordance (the typeahead screen). Layout switch is pure-CSS at
// 900px (search.css). Real data: GET /api/restaurants?q=&category=&sort= + REAL
// favorites (lib/eat-cart). The CD's unsupported filters (open-now / $$ / free-
// delivery / 4.5+ / dietary) have NO backing → rendered INERT/decorative. The AI
// ranking line + the map panel are « à venir » INERT placeholders.

// Popular cuisines (CD "Populaire en ce moment" chips) — mapped to the REAL search
// categories (the CUISINES const drives the ?category= filter, kept from the prior
// build). Each chip launches the corresponding real search.
const CUISINES = [
  { labelKey: 'cuisineItalian', ms: 'local_pizza', q: 'italian' },
  { labelKey: 'cuisineAsian', ms: 'ramen_dining', q: 'asian' },
  { labelKey: 'cuisineBurgers', ms: 'lunch_dining', q: 'burger' },
  { labelKey: 'cuisineHealthy', ms: 'eco', q: 'healthy' },
  { labelKey: 'cuisineSushi', ms: 'set_meal', q: 'sushi' },
  { labelKey: 'cuisineDesserts', ms: 'icecream', q: 'desserts' },
]
// V4-2 : le tri « Note » est retiré — il s'appuyait sur la colonne rating
// FABRIQUÉE (seed, jamais recalculée). Il reviendra avec un vrai agrégat d'avis.
const SORTS = [
  { labelKey: 'sortNewest', value: 'newest' },
  { labelKey: 'sortDelivery', value: 'delivery' },
]
// CD desktop subbar filters that have NO backing data → INERT/decorative. Rendered
// visually (per CD) but they do NOT filter (noted in the report). `veg` carries the
// CD green-on variant class; the rest are neutral chips. NONE are interactive.
const INERT_FILTERS = [
  { labelKey: 'filterOpen', ms: 'schedule', cls: '' },
  { labelKey: 'filterPrice', ms: 'payments', cls: '' },
  { labelKey: 'filterFreeDelivery', ms: 'two_wheeler', cls: '' },
  { labelKey: 'filterVeg', ms: 'eco', cls: 'veg' },
  { labelKey: 'filterTopRated', ms: 'star', cls: '' },
]

interface Restaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number | null // V4-2 : null tant qu'aucun avis réel (l'API gate la colonne fabriquée)
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
  deliveryEnabled?: boolean
  coverPhoto?: string
  city: string
  address: string
  distanceKm?: number
}

interface SearchResponse {
  restaurants?: Restaurant[]
  /** Set by the API when the requested category had no hits and the list
   *  fell back to nearest-of-any. Always show alternatives, never empty. */
  categoryHadNoMatch?: boolean
}

// ── REAL recents — a genuine per-user store of submitted queries (localStorage).
// No prior search-history key existed, so we add one HERE (own to this page). It is
// real user data (never fabricated): we record a term only when a search is actually
// run, and the idle view replays the last few. Cleared via the « Effacer » action.
const RECENTS_KEY = 'grubano_search_recents'
function readRecents(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}
function pushRecent(term: string) {
  const t = term.trim()
  if (!t || typeof window === 'undefined') return
  try {
    const next = [t, ...readRecents().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
function clearRecents() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(RECENTS_KEY)
  } catch {
    /* ignore */
  }
}

// Highlight the typed substring inside a label (CD `<mark>`).
function Highlighted({ text, term }: { text: string; term: string }) {
  const q = term.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

// rotating CD thumb tints (visual only) for the mobile result rows
const THUMB_TINTS = ['t1', 't2', 't3']
// rotating CD image tints (visual only) for the desktop cards
const CARD_TINTS = ['t1', 't4', 't3', 't2']

function SearchContent() {
  const t = useTranslations('eat.search')
  const tc = useTranslations('common')
  const tr = useTranslations('eat.restaurant')
  const locale = useLocale()
  const params = useSearchParams()
  const router = useRouter()
  const { coords } = useGeolocation()

  // Desktop query = URL ?q= (the shell topbar routes here). Mobile query = the
  // page's own input, seeded from ?q=. Both drive the SAME real fetch.
  const urlQuery = params.get('q') ?? ''
  const [query, setQuery] = useState(urlQuery)
  const [cuisine, setCuisine] = useState(params.get('cuisine') ?? '')
  const [sort, setSort] = useState('newest') // V4-2 : défaut honnête (ex-'rating' fabriqué)
  const [results, setResults] = useState<Restaurant[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)

  // Favorites (REAL — lib/eat-cart), live via FAV_EVENT + cross-tab storage.
  const [favs, setFavsState] = useState<string[]>([])
  const [favFilter, setFavFilter] = useState(false)
  useEffect(() => {
    const sync = () => setFavsState(readFavs())
    sync()
    window.addEventListener(FAV_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(FAV_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Recents (REAL — own localStorage store). Loaded on mount, refreshed on submit.
  const [recents, setRecents] = useState<string[]>([])
  useEffect(() => setRecents(readRecents()), [])

  // Keep the page query in sync with the URL ?q= the shell topbar updates.
  useEffect(() => setQuery(urlQuery), [urlQuery])

  const run = useCallback(async () => {
    setLoading(true)
    const sp = new URLSearchParams()
    if (query) sp.set('q', query)
    if (cuisine) sp.set('category', cuisine)
    if (coords) {
      sp.set('lat', String(coords.lat))
      sp.set('lng', String(coords.lng))
    } else {
      sp.set('sort', sort)
    }
    sp.set('take', '50')
    try {
      const res = await fetch(`/api/restaurants?${sp}`)
      const data: SearchResponse = await res.json()
      setResults(data.restaurants ?? [])
      setFallback(Boolean(data.categoryHadNoMatch))
    } catch {
      setResults([])
      setFallback(false)
    } finally {
      setLoading(false)
    }
  }, [query, cuisine, sort, coords])

  useEffect(() => {
    run()
  }, [run])

  const sortLabel = t(SORTS.find((s) => s.value === sort)?.labelKey ?? 'sortNewest')
  const cycleSort = () => {
    if (coords) return // geo drives the order — sort is inert when location is on
    const i = SORTS.findIndex((s) => s.value === sort)
    setSort(SORTS[(i + 1) % SORTS.length].value)
  }

  const onToggleFav = (id: string) => {
    toggleFav(id)
    setFavsState(readFavs())
  }

  // Submit a free-text term (mobile field / "all restaurants" row / a recent / a chip).
  const submit = (term: string, cat = '') => {
    const tt = term.trim()
    if (tt) pushRecent(tt)
    setRecents(readRecents())
    setQuery(tt)
    setCuisine(cat)
    // reflect in the URL so the shell topbar + desktop stay in sync
    router.push(tt ? `/eat/search?q=${encodeURIComponent(tt)}` : '/eat/search')
  }

  const meta = useCallback(
    (r: Restaurant) => {
      const base = formatCuisineList(r.cuisine, locale, t('cuisineVaried'))
      if (typeof r.distanceKm === 'number') {
        // Haversine à vol d'oiseau — annoncée comme approximative (lot véracité).
        return `${base} · ${tr('distanceApprox', { distance: formatDistance(r.distanceKm, locale, tc('km')) })}`
      }
      return base
    },
    [locale, t, tc, tr],
  )

  const favCount = useMemo(() => results.filter((r) => favs.includes(r.id)).length, [results, favs])
  const typing = query.trim().length > 0
  const noMatch = typing && !loading && results.length === 0

  return (
    <div className="gb gb-search" data-fav={favFilter ? 'on' : 'off'}>
      {/* ════════════════════════════════════════════════════════════════════
          MOBILE — typeahead screen (CD search-typeahead.html). <900px only.
          ════════════════════════════════════════════════════════════════════ */}
      <div className="se-mobile">
        {/* sticky search header — the page's own mobile search affordance */}
        <div className="search-bar">
          <button className="ms back" onClick={() => router.push('/eat')} aria-label={tc('back')}>
            arrow_back
          </button>
          <form
            className="search-field"
            onSubmit={(e) => {
              e.preventDefault()
              submit(query)
            }}
          >
            <span className="ms" aria-hidden="true">search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('title')}
              autoFocus
            />
            {query && (
              <button type="button" className="ms clear" onClick={() => setQuery('')} aria-label={t('clear')}>
                close
              </button>
            )}
          </form>
        </div>

        <div className="panel">
          {loading && typing ? (
            // typing → loading suggestions
            <>
              <div className="grp"><h3>{t('groupRestaurants')}</h3></div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div className="res-skel" key={i}>
                  <span className="sk-thumb" />
                  <div style={{ flex: 1 }}>
                    <div className="sk-line" style={{ width: '55%', marginBottom: 7 }} />
                    <div className="sk-line" style={{ width: '35%' }} />
                  </div>
                </div>
              ))}
            </>
          ) : !typing ? (
            // ===== VIEW A — idle (recents + popular) =====
            <>
              {recents.length > 0 && (
                <>
                  <div className="grp">
                    <h3>{t('recentSearches')}</h3>
                    <button
                      onClick={() => {
                        clearRecents()
                        setRecents([])
                      }}
                    >
                      {t('clearRecents')}
                    </button>
                  </div>
                  {recents.map((term) => (
                    <button className="row" key={term} onClick={() => submit(term)}>
                      <span className="lead"><span className="ms" aria-hidden="true">history</span></span>
                      <div className="txt"><b>{term}</b></div>
                      <span className="ms up" aria-hidden="true">north</span>
                    </button>
                  ))}
                </>
              )}

              <div className="grp"><h3>{t('popularNow')}</h3></div>
              <div className="chips">
                {CUISINES.map((c) => (
                  <button className="se-chip" key={c.q} onClick={() => submit('', c.q)}>
                    <span className="ms" aria-hidden="true">{c.ms}</span>
                    {t(c.labelKey)}
                  </button>
                ))}
              </div>
            </>
          ) : noMatch ? (
            // ===== VIEW C — no match =====
            <div className="nomatch">
              <div className="nomatch__ico"><span className="ms" aria-hidden="true">search_off</span></div>
              <h2>{t('noMatchTitle')}</h2>
              <p>{t.rich('noMatchBody', { term: query, b: (c) => <b>{c}</b> })}</p>
              <div className="chips" style={{ justifyContent: 'center' }}>
                {CUISINES.slice(0, 3).map((c) => (
                  <button className="se-chip" key={c.q} onClick={() => submit('', c.q)}>
                    <span className="ms" aria-hidden="true">{c.ms}</span>
                    {t(c.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // ===== VIEW B — typing (real restaurant matches + all-restaurants row) =====
            <>
              <div className="grp"><h3>{t('groupRestaurants')}</h3></div>
              {results.slice(0, 8).map((r, i) => (
                <button className="res" key={r.id} onClick={() => router.push(`/eat/r/${r.id}`)}>
                  <div
                    className={`thumb ${THUMB_TINTS[i % THUMB_TINTS.length]}`}
                    style={
                      r.coverPhoto || getRestaurantCover(r.id)
                        ? { backgroundImage: `url(${r.coverPhoto || getRestaurantCover(r.id)})` }
                        : undefined
                    }
                  />
                  <div className="txt">
                    <b><Highlighted text={r.name} term={query} /></b>
                    <span>{meta(r)}</span>
                  </div>
                  {r.rating != null && (
                    <span className="rating"><span className="ms" aria-hidden="true">star</span>{r.rating.toLocaleString(locale)}</span>
                  )}
                </button>
              ))}

              <div className="grp"><h3>{t('groupSearches')}</h3></div>
              <button className="row" onClick={() => submit(query)}>
                <span className="lead"><span className="ms" aria-hidden="true">search</span></span>
                <div className="txt">
                  <b><mark>{query}</mark></b>
                  <span>{t('inAllRestaurants')}</span>
                </div>
                <span className="ms go" aria-hidden="true">chevron_right</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          DESKTOP — subbar + 2-col grid + INERT map panel (CD search-desktop).
          ≥900px only. The shell topbar IS the search bar (no page bar here).
          ════════════════════════════════════════════════════════════════════ */}
      <div className="se-desktop">
        {/* SUBBAR : filters (mostly inert) + REAL Favoris filter + REAL count + REAL sort */}
        <div className="subbar">
          <div className="filters">
            {INERT_FILTERS.map((f) => (
              <span className={`fchip inert ${f.cls}`} key={f.labelKey} aria-hidden="true">
                <span className="ms">{f.ms}</span>
                {t(f.labelKey)}
              </span>
            ))}
            <button
              type="button"
              className={`fchip fav${favFilter ? ' on' : ''}`}
              onClick={() => setFavFilter((v) => !v)}
              aria-pressed={favFilter}
            >
              <span className="ms" aria-hidden="true">favorite</span>
              {t('filterFavorites')}
            </button>
          </div>
          <span className="count">
            <span className="all">
              {query
                ? t.rich('countForQuery', { count: results.length, term: query, b: (c) => <b>{c}</b> })
                : t.rich('countAll', { count: results.length, b: (c) => <b>{c}</b> })}
            </span>
            <span className="favc">{t.rich('countFavs', { count: favCount, b: (c) => <b>{c}</b> })}</span>
          </span>
          <button type="button" className="sort" onClick={cycleSort} disabled={Boolean(coords)}>
            <span className="ms" aria-hidden="true">swap_vert</span>
            <span>{t('sortLabel', { sort: sortLabel })}</span>
          </button>
        </div>

        {/* CONTENT : real results (2 col) + INERT map placeholder */}
        <div className="content">
          <div className="results">
            {/* AI ranking — INERT « à venir » */}
            <div className="ai-line">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <p>{t('aiRankingBody')}</p>
              <span className="soon">{t('aiSoon')}</span>
            </div>

            {loading ? (
              <div className="grid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div className="card-skel" key={i}>
                    <div className="sk-img" />
                    <div className="sk-b">
                      <div className="sk-line" style={{ width: '60%' }} />
                      <div className="sk-line" style={{ width: '40%' }} />
                      <div className="sk-line" style={{ width: '50%' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="empty">
                <div className="empty__ico"><span className="ms" aria-hidden="true">search_off</span></div>
                <h2>{t('emptyTitle')}</h2>
                <p>{t('emptyDescription')}</p>
              </div>
            ) : (
              <div className="grid">
                {results.map((r, i) => {
                  const fav = favs.includes(r.id)
                  const cover = r.coverPhoto || getRestaurantCover(r.id)
                  return (
                    <article
                      className={`se-card${fav ? ' is-fav' : ''}`}
                      key={r.id}
                      onClick={() => router.push(`/eat/r/${r.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/eat/r/${r.id}`) } }}
                      role="button"
                      tabIndex={0}
                    >
                      <div
                        className={`card__img ${CARD_TINTS[i % CARD_TINTS.length]}`}
                        style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                      >
                        <button
                          type="button"
                          className={`card__fav${fav ? ' on' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleFav(r.id)
                          }}
                          aria-label={fav ? t('unfavorite') : t('favorite')}
                          aria-pressed={fav}
                        >
                          <span className="ms" aria-hidden="true">favorite</span>
                        </button>
                      </div>
                      <div className="card__b">
                        <div className="card__row">
                          <b>{r.name}</b>
                          {r.rating != null && (
                            <span className="card__rating"><span className="ms" aria-hidden="true">star</span>{r.rating.toLocaleString(locale)}</span>
                          )}
                        </div>
                        <div className="card__meta">{meta(r)}</div>
                        {/* REAL tag: free delivery. Other CD tags (veg/popular) have no
                            backing data → omitted (decorative-only in the CD mock). */}
                        {r.deliveryEnabled === true && r.deliveryFee === 0 && (
                          <div className="card__tags">
                            <span className="tag tag--free">{tc('free')}</span>
                          </div>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {/* category-fallback banner — never empty; show alternatives explicitly */}
            {fallback && cuisine && !loading && results.length > 0 && (
              <div className="ai-line" style={{ marginTop: 18, marginBottom: 0 }}>
                <span className="ms" aria-hidden="true">auto_awesome</span>
                <p>{t('categoryFallbackTitle', { category: t(CUISINES.find((c) => c.q === cuisine)?.labelKey ?? 'cuisineVaried') })}</p>
                <button type="button" className="soon" onClick={() => { setCuisine(''); }}>
                  {t('clearCategory')}
                </button>
              </div>
            )}
          </div>

          {/* MAP PANEL — INERT « à venir » placeholder (faux pins + faux card). No real
              geocoded map yet → decorative, hidden ≤1100px. */}
          <div className="mappanel" aria-hidden="true">
            <span className="map-soon">{t('mapSoon')}</span>
            <div className="mpin act" style={{ top: '34%', left: '42%' }}><div className="b"><span className="ms">star</span>4,8</div><div className="tip" /></div>
            <div className="mpin" style={{ top: '54%', left: '62%' }}><div className="b"><span className="ms">star</span>4,8</div><div className="tip" /></div>
            <div className="mpin" style={{ top: '64%', left: '32%' }}><div className="b"><span className="ms">star</span>4,7</div><div className="tip" /></div>
            <div className="mpin" style={{ top: '44%', left: '74%' }}><div className="b"><span className="ms">star</span>4,6</div><div className="tip" /></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ExploreScreen() {
  return (
    <Suspense fallback={<div className="gb gb-search" />}>
      <SearchContent />
    </Suspense>
  )
}
