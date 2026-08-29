'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import { formatEuros } from '@/lib/format-money'
import { useGeolocation } from '@/lib/use-geolocation'
import { readFavs, toggleFav, FAV_EVENT } from '@/lib/eat-cart'
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

export default function HomeScreen() {
  const t = useTranslations('eat.home')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { coords, status, request, clear } = useGeolocation()

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  // WAVE 2 — distance du resto géocodé le plus proche (message honnête « rien tout près »)
  const [nearestKm, setNearestKm] = useState<number | null>(null)
  const [recent, setRecent] = useState<RecentOrder[]>([])
  const [favs, setFavs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

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

  // Favorites (real, localStorage) — live via FAV_EVENT.
  useEffect(() => {
    const sync = () => setFavs(readFavs())
    sync()
    window.addEventListener(FAV_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(FAV_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Restaurants — nearest-first when geo is on, else newest (V4-2 : le tri par
  // note s'appuyait sur la colonne fabriquée du seed — repli honnête nouveauté).
  useEffect(() => {
    setLoading(true)
    const sp = new URLSearchParams({ take: '20' })
    if (coords) {
      sp.set('lat', String(coords.lat))
      sp.set('lng', String(coords.lng))
    } else {
      sp.set('sort', 'newest')
    }
    fetch(`/api/restaurants?${sp}`)
      .then((r) => r.json())
      .then((d) => {
        setRestaurants(d.restaurants ?? [])
        // WAVE 2 — méta honnêteté géo : distance du plus proche (message « rien
        // tout près ») ; les restos sans coords arrivent déjà appendus par l'API.
        setNearestKm(typeof d.nearestKm === 'number' ? d.nearestKm : null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [coords])

  // Recommander — the consumer's real recent orders (reorder). Signed-out / none →
  // empty → the whole section is omitted below.
  useEffect(() => {
    let alive = true
    fetch('/api/eat/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
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
        setRecent(out)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])


  const cuisineWithMeta = useCallback(
    (r: Restaurant) => {
      const base = formatCuisineList(r.cuisine, locale, t('cuisineVaried'))
      if (typeof r.distanceKm === 'number') {
        return `${base} · ${formatDistance(r.distanceKm, locale, tc('km'))}`
      }
      return base
    },
    [locale, t, tc],
  )

  const geoActive = status === 'granted' && !!coords
  const popular = restaurants.slice(0, 6)
  const popularTitle = geoActive ? t('nearYou') : t('popular')

  // ETA window label e.g. "20–30 min" (real deliveryTime ± the CD ~10-min window).
  const etaWindow = (mins: number) => `${Math.max(5, mins - 5)}–${mins + 5} min`

  const onHeart = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const now = toggleFav(id)
    setFavs((f) => (now ? [...f, id] : f.filter((x) => x !== id)))
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
              {status === 'denied'
                ? t('geoBannerDenied')
                : status === 'unavailable'
                  ? t('geoBannerUnavailable')
                  : t('geoBannerSubtitle')}
            </span>
          </div>
          <button
            type="button"
            className="gbtn"
            onClick={request}
            disabled={status === 'unavailable' || status === 'requesting'}
          >
            {t('geoEnable')}
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
                    <span className="hm-card__time">{etaWindow(r.deliveryTime)}</span>
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
                      {r.deliveryFee === 0 && <span className="hm-tag hm-tag--free">{tc('free')}</span>}
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
