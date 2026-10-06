'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import { formatEuros } from '@/lib/format-money'
import { useGeolocation } from '@/lib/use-geolocation'
import {
  favOwner, setFavOwner, readFavsForOwner, toggleFavForOwner,
  favEventIsMine, favStorageIsMine, FAV_EVENT,
} from '@/lib/eat-cart'
import { useSession } from 'next-auth/react'
import { getRestaurantCover } from '@/lib/food-images'
// gb-foundation FIRST: gb-tokens.css begins with `@import …Material+Symbols…`, which
// the CSS spec only honours when it is the first rule of the route's stylesheet. If
// page CSS is bundled before it, the @import is dropped and `.ms` ligatures render as
// raw text. Keep this order; a robust <link> in the root <head> is the belt for it.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './home.css'

// /eat HOME — « Accueil ». VERBATIM reproduction of the FROZEN CD ref
// (Notion 38efd2c9-…-81bf, file eat/home.html). Renders INSIDE the consumer nav
// SHELL (components/eat/EatShell.tsx), like /orders & /rewards — the shell owns the
// top bar (« Livrer à » + AI search + bag), so NO page header is reproduced here.
//
// Order (CD): hero (promo Sunrise + IA card « bientôt », INERT) → cuisines (scroll)
// → Recommander (recent orders, reorder) → Populaires (grid 3→2→1).
//
// REAL DATA (never hardcoded):
//   • promo  = hero fixe « bienvenue » (D2 closed beta : le résumé -X % retiré)
//     banner with NO fabricated %/€ (the home never promises what doesn't exist).
//   • cuisines = the app's real fixed taxonomy (CUISINES), → /eat/search?cuisine=…
//   • Recommander = the consumer's real recent orders (GET /api/eat/orders, past +
//     current), « Recommander » → the restaurant page. No source / signed-out →
//     the section is omitted.
//   • Populaires = real restaurants (GET /api/restaurants), nearest-first when geo is
//     on. Hearts = REAL favorites (lib/eat-cart toggleFav/readFavs).
//   • IA card « Pour vous ce soir » = INERT (« bientôt » badge, decorative button).


// Real fixed taxonomy → rendered in the CD cuisine-tile style (Material icon in a
// tinted rounded square). `q` is the real /eat/search?cuisine slug.
const CUISINES = [
  { key: 'cuiPizza', q: 'pizza', icon: 'local_pizza', bg: '#FFF1E7', fg: '#F2570E' },
  { key: 'cuiSushi', q: 'sushi', icon: 'set_meal', bg: '#EAEFF6', fg: '#1E3E60' },
  { key: 'cuiBurgers', q: 'burgers', icon: 'lunch_dining', bg: '#FCF0D9', fg: '#B5760A' },
  { key: 'cuiHealthy', q: 'healthy', icon: 'eco', bg: '#EAF7EF', fg: '#1E8C4B' },
  { key: 'cuiPasta', q: 'asian', icon: 'ramen_dining', bg: '#FFF1E7', fg: '#F2570E' },
  { key: 'cuiDessert', q: 'desserts', icon: 'icecream', bg: '#FBEAF1', fg: '#B83A6E' },
] as const

const TINTS = ['t1', 't2', 't3', 't4', 't5', 't6'] as const
const ROW_TINTS = ['t1', 't2', 't5', 't4'] as const

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
  logo?: string
  city: string
  address: string
  distanceKm?: number
}

interface RecentOrder {
  id: string
  restaurantName: string
  itemsCount: number
  total: number
  restaurantId?: string
}

/** Stable identity for the fail-closed empty row. Frozen, because every gated render
 *  shares the one array. */
const NO_RECENT: RecentOrder[] = Object.freeze([]) as unknown as RecentOrder[]
/** Stable identity for the ungated case, so the gate does not churn the memos below. */
const NO_ROWS: Restaurant[] = Object.freeze([]) as unknown as Restaurant[]

/** Stable identity for the fail-closed empty list: a fresh [] per render would churn the
 *  memos that depend on it. Frozen, because every gated render shares the one array. */
const NO_FAVS: string[] = Object.freeze([]) as unknown as string[]

export default function HomeScreen() {
  const t = useTranslations('eat.home')
  const tc = useTranslations('common')
  // « à env. {distance} » — même clé que la fiche restaurant (S1.1), une seule source.
  const tr = useTranslations('eat.restaurant')
  const locale = useLocale()
  const router = useRouter()
  // the geolocation hook is called below, once `favsOwner` exists — see GEO OWNER

  // OWNER-STAMPED. Every row carries `distanceKm` measured FROM THIS ACCOUNT'S POSITION
  // (app/api/restaurants/route.ts attaches it per row at 0.1 km resolution and sorts by
  // it), so the response is account content even though the rows themselves are public.
  // Twenty distances to restaurants whose coordinates are public locate the account by
  // multilateration, which is a STRONGER statement about where it was than the single
  // `nearestKm` this lot already gated -- that number is just the minimum of this vector.
  const [restaurantState, setRestaurantState] = useState<{ owner: string | null; rows: Restaurant[] }>({ owner: null, rows: [] })
  // WAVE 2 — distance du resto géocodé le plus proche (message honnête « rien tout près »)
  /** RAW — read only through the gate below. The number is derived from the account's own
   *  position, so « rien à moins de 25 km » is a weak but real statement about where the
   *  PREVIOUS account was; it survives an identity change exactly as the coords did. */
  const [nearestState, setNearestState] = useState<{ owner: string | null; km: number | null }>({ owner: null, km: null })
  /** RAW — read only through `recent` below: the cards AND the identity they were fetched
   *  for. The row shows a restaurant name, an item count and a euro total per card, plus a
   *  link into that restaurant, so it is the account's purchase history in miniature. */
  const [recentState, setRecentState] = useState<{ owner: string | null; cards: RecentOrder[] }>({ owner: null, cards: [] })
  /** RAW — read only through the gate below: the ids AND the owner they were read for. */
  // ── FAVOURITES OWNER, RESOLVED DURING RENDER ───────────────────────────────────
  // The hearts belong to a session, so the identity has to be read in the same render as
  // the session — an effect runs after the frame that has already painted the previous
  // account's hearts. `null` while the session resolves, and null for an authenticated
  // session with no usable id: fail closed.
  const { data: favSession, status: favSessionStatus } = useSession()
  const favLiveUserId = (favSession?.user as { id?: string } | undefined)?.id
  const favsOwner = favOwner(favSessionStatus, favLiveUserId)
  /** The same value under the name it actually has: `favOwner` delegates to
   *  sessionCartStamp, so this IS the live session identity — `u:<userId>` authenticated,
   *  `guest` signed out, null while it resolves or when the id is unusable. Aliased rather
   *  than re-derived: a second definition of identity is a second thing to get wrong. */
  const liveOwner = favsOwner

  // ── GEO OWNER ──────────────────────────────────────────────────────────────────
  // A position is a physical fact about a person, and the reverse-geocoded label is their
  // street. The hook is given the live identity so a fix captured by one account is never
  // shown, sent or measured for another — including on the first frame, before any effect.
  const { coords, status, request, clear } = useGeolocation(liveOwner)
  // THE TWO NUMBERS, pulled out of the gated object. The catalogue effect below is keyed
  // on THESE, not on `coords`: /api/geo/reverse enriches the fix with a postal label a
  // moment after it lands, which gives `coords` a new identity for the SAME position and
  // used to re-fire the whole catalogue request. Same latitude and longitude ⇒ no refetch;
  // a real move ⇒ a refetch, because the numbers themselves changed.
  const lat = coords?.lat ?? null
  const lng = coords?.lng ?? null

  const [favsState, setFavsState] = useState<{ owner: string | null; ids: string[] }>({ owner: null, ids: [] })
  /** The ONLY list this screen may show: this owner's, or none. */
  const favs = favsOwner !== null && favsState.owner === favsOwner ? favsState.ids : NO_FAVS
  /** The ONLY cards « Recommander » may show. Derived DURING RENDER, so the row of the
   *  previous account disappears in the same frame the session changes — an effect would
   *  run after that frame has already painted it. A signed-out visitor has no order
   *  history, so 'guest' can never own this row either. */
  const recent = liveOwner !== null && liveOwner !== 'guest' && recentState.owner === liveOwner
    ? recentState.cards
    : NO_RECENT
  // RAW: is a request in flight. `loading` is derived from it below, because a frame whose
  // rows belong to another identity must keep the skeleton up rather than claim « nothing ».
  const [fetching, setFetching] = useState(true)

  // First visit of the session → play the splash once (real wiring, kept).
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('grubano_splash_seen')) {
        router.replace('/eat/splash')
      }
    } catch {
      /* ignore */
    }
  }, [router])

  // Favorites (real, localStorage, PER OWNER) — live via FAV_EVENT.
  useEffect(() => {
    if (favsOwner === null) {
      // Unknown identity: declare nothing, hold nothing, show nothing.
      setFavOwner(null)
      setFavsState({ owner: null, ids: [] })
      return
    }
    // Declared so the library can REFUSE a write for anyone else — including from a
    // handler this render captured, clicked after the session has moved on.
    setFavOwner(favsOwner)
    const sync = () => setFavsState({ owner: favsOwner, ids: readFavsForOwner(favsOwner) })
    sync()
    // Both events are filtered BY OWNER: another account's change must not even cause a
    // re-read here, and an event that names no owner is foreign (fail closed).
    const onFav = (e: Event) => { if (favEventIsMine(e, favsOwner)) sync() }
    const onStore = (e: StorageEvent) => { if (favStorageIsMine(e, favsOwner)) sync() }
    window.addEventListener(FAV_EVENT, onFav)
    window.addEventListener('storage', onStore)
    return () => {
      window.removeEventListener(FAV_EVENT, onFav)
      window.removeEventListener('storage', onStore)
    }
  }, [favsOwner])

  // Restaurants — nearest-first when geo is on, else newest (V4-2 : le tri par
  // note s'appuyait sur la colonne fabriquée du seed — repli honnête nouveauté).
  useEffect(() => {
    // Captured before the request leaves, and the response is stamped with it.
    const requestOwner = liveOwner
    // INVALIDATION. The stamp decides whether a response may be SEEN; this flag decides
    // whether it may be WRITTEN AT ALL. They are not the same guarantee: a late response
    // for A, landing after B's own response has already committed, re-stamped the state as
    // A's — the gate then hid it from B and `rowsAreMine` went false, leaving B on the
    // skeleton until a dependency happened to change. The identity was never leaked and B's
    // screen was never right either. Cleared by the cleanup below, so this request stops
    // existing the moment it is superseded or the mount goes away.
    let alive = true
    setFetching(true)
    const sp = new URLSearchParams({ take: '20' })
    if (lat !== null && lng !== null) {
      sp.set('lat', String(lat))
      sp.set('lng', String(lng))
    } else {
      sp.set('sort', 'newest')
    }
    fetch(`/api/restaurants?${sp}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setRestaurantState({ owner: requestOwner, rows: d.restaurants ?? [] })
        // WAVE 2 — méta honnêteté géo : distance du plus proche (message « rien
        // tout près ») ; les restos sans coords arrivent déjà appendus par l'API.
        setNearestState({ owner: requestOwner, km: typeof d.nearestKm === 'number' ? d.nearestKm : null })
      })
      // A REQUEST THAT HAS NOT ANSWERED IS NOT AN ANSWER. This used to swallow the error
      // and leave the previous rows painted: if the refetch for the new identity failed
      // (offline, 500), the skeleton closed over the OLD account's distance vector and it
      // stayed on screen for the whole mount. /eat/search already cleared here.
      .catch(() => {
        if (!alive) return
        setRestaurantState({ owner: requestOwner, rows: [] })
      })
      // …and a superseded request may not touch the flag either: an old `finally` firing
      // while a newer request is still in flight would close the skeleton over nothing.
      .finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
    // keyed on the identity as well as the position: the coordinates are already gated, but
    // the DERIVED number must be re-attributed too, and the request must not carry A's
    // lat/lng once B is live. The position enters as two NUMBERS so that a reverse-geocode
    // enrichment — same place, new object — does not re-run this.
  }, [lat, lng, liveOwner])

  // Recommander — the consumer's real recent orders (reorder). Signed-out / none →
  // empty → the whole section is omitted below.
  useEffect(() => {
    // Nothing to ask for, and nobody to ask as: a visitor has no order history (the route
    // answers 401), and an unresolved identity must not produce a request we could not
    // attribute. So we do not call the endpoint at all, and we hold nothing.
    if (liveOwner === null || liveOwner === 'guest') {
      setRecentState({ owner: null, cards: [] })
      return
    }
    // The identity this request is FOR, captured before it leaves. The response is stamped
    // with this and never with whatever the session has become by the time it resolves.
    const requestOwner = liveOwner
    // DROP THE PREVIOUS ACCOUNT'S COPY — and be precise about WHEN. The render-time gate
    // above stopped showing it in the frame the session changed; THIS runs later, in the
    // effect, after that frame has committed. So the two are not simultaneous, and the
    // guarantee for the gap is not "it is gone" but "it is unreachable": the gate fails in
    // that frame and every later one, and the only handler on a card is created inside
    // `recent.map(...)`, so with the row empty no card and therefore no handler exists.
    // This effect only re-runs when the identity CHANGED, so there is no reason to keep
    // another account's purchase history in memory while we fetch this one's — and if the
    // new request fails, nothing of theirs is left held either.
    setRecentState({ owner: null, cards: [] })
    let alive = true
    fetch('/api/eat/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // A non-2xx or a transport error commits NOTHING: an empty row stamped for B would
        // say « B has never ordered », which a failure does not establish. The section is
        // simply omitted by the `recent.length > 0` guard below, which is the honest
        // outcome for an optional row.
        if (!alive || !d) return
        const cards = [...(d.current ?? []), ...(d.past ?? [])] as Array<{
          id: string; restaurantName: string; itemsCount: number; total: number; restaurantId?: string
        }>
        // De-dup by restaurant (most-recent first, as the API already sorts) and cap at 8.
        const seen = new Set<string>()
        const out: RecentOrder[] = []
        for (const c of cards) {
          const k = c.restaurantId ?? c.id
          if (seen.has(k)) continue
          seen.add(k)
          out.push({ id: c.id, restaurantName: c.restaurantName, itemsCount: c.itemsCount, total: c.total, restaurantId: c.restaurantId })
          if (out.length >= 8) break
        }
        setRecentState({ owner: requestOwner, cards: out })
      })
      .catch(() => {})
    return () => { alive = false }
    // KEYED ON THE IDENTITY. With `[]` this never re-ran, and A → logout → B login begins
    // and ends at 'authenticated', so B kept A's row for the life of the mount.
    //
    // WHAT ACTUALLY GUARANTEES SAFETY HERE, because naming the wrong mechanism is how the
    // right one gets deleted later. React flushes passive effects AFTER paint, so there is
    // a real window between the commit of the B render and this cleanup: a response for A
    // landing inside it still sees `alive === true` and still commits
    // { owner: 'u:A', cards: A }. That is harmless, and it is harmless because of the
    // STAMP and the render-time gate — the row is hidden in that frame and in every later
    // one because its owner contradicts the live identity. The cleanup's job is narrower
    // than it looks: it stops a late response for A from CLOBBERING a row already
    // committed for B, which is a correctness problem for B rather than a leak of A's.
  }, [liveOwner])


  const cuisineWithMeta = useCallback(
    (r: Restaurant) => {
      const base = formatCuisineList(r.cuisine, locale, t('cuisineVaried'))
      if (typeof r.distanceKm === 'number') {
        // Haversine à vol d'oiseau — toujours annoncée comme approximative (lot
        // véracité), jamais nue, jamais accolée à une durée.
        return `${base} · ${tr('distanceApprox', { distance: formatDistance(r.distanceKm, locale, tc('km')) })}`
      }
      return base
    },
    [locale, t, tc, tr],
  )

  /** The only distance this screen may state. */
  const nearestKm = liveOwner !== null && nearestState.owner === liveOwner ? nearestState.km : null
  // RENDER-TIME GATE, the same shape as nearestKm above: rows whose owner contradicts the
  // live identity are not shown, and the skeleton stays up instead of telling an account
  // that has restaurants that there are none.
  const rowsAreMine = liveOwner !== null && restaurantState.owner === liveOwner
  const restaurants = rowsAreMine ? restaurantState.rows : NO_ROWS
  const loading = fetching || !rowsAreMine
  const geoActive = status === 'granted' && !!coords
  const popular = restaurants.slice(0, 6)
  const popularTitle = geoActive ? t('nearYou') : t('popular')

  // LOT VÉRACITÉ : le badge « 20–30 min » (etaWindow sur deliveryTime, un champ
  // qu'AUCUNE UI ne saisit — défaut de schéma 30) est retiré : c'était une
  // promesse de livraison fabriquée, affichée même pour un resto sans livraison.

  const onHeart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    // Named owner, and the library refuses unless it is still the declared one: a click
    // that lands after the session changed writes nothing (null), and nothing is shown.
    if (favsOwner === null) return
    const now = toggleFavForOwner(favsOwner, id)
    if (now === null) return
    setFavsState((s) => (s.owner !== favsOwner
      ? s
      : { owner: favsOwner, ids: now ? [...s.ids, id] : s.ids.filter((x) => x !== id) }))
  }

  return (
    <div className="gb-home">
      {/* ════ GEO opt-in (real) — CD has no geo block; styled in the home tone ════ */}
      {!geoActive ? (
        <div className="geo">
          <span className="ms" aria-hidden="true">near_me</span>
          <div className="gtxt">
            <b>{t('geoBannerTitle')}</b>
            <span>
              {/* A TIMEOUT USED TO LAND HERE AS `unavailable`, which this banner renders
                  as « la géolocalisation n'est pas disponible sur cet appareil » — a false
                  statement about a device that can locate itself perfectly well, it just
                  needed longer. That text now belongs to `unsupported` alone. */}
              {status === 'requesting'
                ? t('geoBannerLocating')
                : status === 'denied'
                  ? t('geoBannerDenied')
                  : status === 'timeout'
                    ? t('geoBannerTimeout')
                    : status === 'unsupported'
                      ? t('geoBannerUnsupported')
                      : status === 'unavailable'
                        ? t('geoBannerUnavailable')
                        : t('geoBannerSubtitle')}
            </span>
          </div>
          <button
            type="button"
            className="gbtn"
            onClick={request}
            disabled={status === 'requesting' || status === 'unsupported'}
            aria-busy={status === 'requesting'}
          >
            {status === 'requesting' ? t('geoEnabling') : t('geoEnable')}
          </button>
        </div>
      ) : (
        <div className="geo geo--on">
          <span className="ms" aria-hidden="true">near_me</span>
          <div className="gtxt">
            <b>{t('geoActive')}</b>
            {/* WAVE 2 — localisation LISIBLE (reverse BAN/IGN) : la promesse design.
                Reverse indisponible → on n'invente RIEN (titre seul, honnête). */}
            {coords?.label && <span>{coords.label}</span>}
            {typeof nearestKm === 'number' && nearestKm > 25 && (
              <span>{t('geoFarNotice')}</span>
            )}
          </div>
          <button type="button" className="gclose" onClick={clear} aria-label={t('geoDisable')}>
            <span className="ms" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      {/* ════ HERO — promo Sunrise (real) + IA card (INERT « bientôt ») ════ */}
      <div className="hm-hero">
        <div className="hm-promo">
          {/* D2 (closed beta) — la variante « −X % offerts · appliquée au paiement »
              et son CTA « Voir les offres » (destination sans liste d'offres) sont RETIRÉS :
              une promo d'UN restaurant s'affichait comme claim GLOBAL du home. Le moteur
              promotionnel serveur (best-of au paiement) reste intact. */}
          <h2>{t('promoWelcomeTitle')}</h2>
          <p>{t('promoWelcomeSubtitle')}</p>
        </div>

        <div className="hm-foryou">
          <div className="hm-foryou__in">
            <div className="hm-foryou__h">
              <span className="ic"><span className="ms" aria-hidden="true">auto_awesome</span></span>
              <b>{t('iaTitle')}</b>
              <span className="soon">{t('iaSoon')}</span>
            </div>
            <p>{t('iaBody')}</p>
            <button type="button" className="b" disabled aria-disabled="true">{t('iaCta')}</button>
          </div>
        </div>
      </div>

      {/* ════ CUISINES (real taxonomy) ════ */}
      <div className="cuisines">
        {CUISINES.map((c) => (
          <button
            key={c.key}
            type="button"
            className="cui"
            onClick={() => router.push(`/eat/search?cuisine=${c.q}`)}
          >
            <span className="c" style={{ background: c.bg }}>
              <span className="ms" style={{ color: c.fg }} aria-hidden="true">{c.icon}</span>
            </span>
            <span>{t(c.key)}</span>
          </button>
        ))}
      </div>

      {/* ════ RECOMMANDER — real recent orders. Omitted when there are none. ════ */}
      {recent.length > 0 && (
        <section className="sec">
          <div className="sec__h">
            <b>{t('recommend')}</b>
            <button type="button" className="a-link" onClick={() => router.push('/eat/orders')}>
              {t('seeMyOrders')}
            </button>
          </div>
          <div className="hrow">
            {recent.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className="hcard"
                onClick={() => o.restaurantId && router.push(`/eat/r/${o.restaurantId}`)}
              >
                <div
                  className={`him ${ROW_TINTS[i % ROW_TINTS.length]}`}
                  style={o.restaurantId ? { backgroundImage: `url(${getRestaurantCover(o.restaurantId)})` } : undefined}
                >
                  <span className="again">{t('reorder')}</span>
                </div>
                <b>{o.restaurantName}</b>
                <span>{t('itemsAndTotal', { count: o.itemsCount, total: formatEuros(o.total, locale) })}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ════ POPULAIRES près de vous — real restaurants, grid 3→2→1 ════ */}
      <section className="sec">
        <div className="sec__h">
          <b>{popularTitle}</b>
          <button type="button" className="a-link" onClick={() => router.push('/eat/search')}>
            {t('seeAll')}
          </button>
        </div>

        {loading ? (
          <div className="grid">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="hm-skel" />)}
          </div>
        ) : popular.length === 0 ? (
          <div className="empty">
            <div className="empty__ico"><span className="ms" aria-hidden="true">restaurant</span></div>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyDescription')}</p>
          </div>
        ) : (
          <div className="grid">
            {popular.map((r, i) => {
              const cover = r.coverPhoto || getRestaurantCover(r.id)
              const on = favs.includes(r.id)
              return (
                <article
                  key={r.id}
                  className="hm-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/eat/r/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/eat/r/${r.id}`) } }}
                >
                  <div
                    className={`hm-card__img ${TINTS[i % TINTS.length]}`}
                    style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                  >
                    <button
                      type="button"
                      className={`hm-card__heart${on ? ' on' : ''}`}
                      onClick={(e) => onHeart(e, r.id)}
                      aria-pressed={on}
                      aria-label={on ? t('unfavorite') : t('favorite')}
                    >
                      <span className="ms" aria-hidden="true">favorite</span>
                    </button>
                  </div>
                  <div className="hm-card__b">
                    <div className="hm-card__row">
                      <b>{r.name}</b>
                      {r.rating != null && (
                        <span className="hm-card__rating"><span className="ms" aria-hidden="true">star</span>{r.rating.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                      )}
                    </div>
                    <div className="hm-card__meta">{cuisineWithMeta(r)}</div>
                    <div className="hm-card__tags">
                      {/* « Gratuit » = frais de LIVRAISON offerts : n'a de sens que si la
                          livraison est réellement activée pour ce restaurant. */}
                      {r.deliveryEnabled === true && r.deliveryFee === 0 && <span className="hm-tag hm-tag--free">{tc('free')}</span>}
                      {r.rating != null && r.rating >= 4.7 && <span className="hm-tag hm-tag--pop">{t('tagPopular')}</span>}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
