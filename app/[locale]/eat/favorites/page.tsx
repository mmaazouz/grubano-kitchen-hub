'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatCuisineList } from '@/lib/categories'
import { formatDistance } from '@/lib/format'
import {
  favOwner, setFavOwner, readFavsForOwner, toggleFavForOwner,
  favEventIsMine, favStorageIsMine, FAV_EVENT, showToast,
} from '@/lib/eat-cart'
import { useSession } from 'next-auth/react'
import { getRestaurantCover } from '@/lib/food-images'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './favorites.css'

// /eat/favorites — « Favoris / Enregistrés ». Verbatim reproduction of the FROZEN
// CD ref (Notion 38efd2c9-…-8156, file eat/favorites.html). Renders INSIDE the
// existing EatShell (top-level framed page, like /orders & /rewards) → the shell
// governs nav, so the CD top back-arrow is dropped. REAL DATA:
//   • Restaurants tab — favorited restaurant ids (lib/eat-cart readFavs/toggleFav),
//     enriched from GET /api/restaurants. Heart = REAL un-favorite.
//   • Plats (dishes) tab — there is NO dish-favorites store in the app, so this tab
//     always renders the EMPTY state (count 0). Documented gap (see report).
// The hint links to /eat/search (the search Favoris filter).

interface Restaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number | null // V4-2 : null tant qu'aucun avis réel (l'API gate la colonne fabriquée)
  reviewCount: number
  deliveryTime: number
  deliveryFee: number
  deliveryEnabled?: boolean
  coverPhoto?: string
  city: string
  distanceKm?: number | null
}

const TINTS = ['t1', 't2', 't3', 't4', 't5', 't6']

/** Stable identity for the fail-closed empty list: a fresh [] per render would churn the
 *  memos that depend on it. Frozen, because every gated render shares the one array. */
const NO_FAVS: string[] = Object.freeze([]) as unknown as string[]

export default function FavoritesScreen() {
  const t = useTranslations('eat.favorites')
  const tc = useTranslations('common')
  const tr = useTranslations('eat.restaurant')
  const locale = useLocale()
  const router = useRouter()

  const [all, setAll] = useState<Restaurant[]>([])
  // ── FAVOURITES OWNER, RESOLVED DURING RENDER ───────────────────────────────────
  // The hearts belong to a session, so the identity has to be read in the same render as
  // the session — an effect runs after the frame that has already painted the previous
  // account's hearts. `null` while the session resolves, and null for an authenticated
  // session with no usable id: fail closed.
  const { data: favSession, status: favSessionStatus } = useSession()
  const favLiveUserId = (favSession?.user as { id?: string } | undefined)?.id
  const favsOwner = favOwner(favSessionStatus, favLiveUserId)

  /** RAW — read only through the gate below: the ids AND the owner they were read for. */
  const [favsState, setFavsState] = useState<{ owner: string | null; ids: string[] }>({ owner: null, ids: [] })
  /** The ONLY list this screen may show: this owner's, or none. */
  const favs = favsOwner !== null && favsState.owner === favsOwner ? favsState.ids : NO_FAVS
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'resto' | 'dish'>('resto')
  const bold = (chunks: ReactNode) => <b>{chunks}</b>

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

  // The restaurant catalogue is public and identity-free, so it is fetched once and is not
  // part of the favourites gate.
  useEffect(() => {
    fetch('/api/restaurants?take=50')
      .then((r) => r.json())
      .then((d) => setAll(d.restaurants ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Real favorited restaurants, preserving the user's save order.
  const favRestaurants = favs
    .map((id) => all.find((r) => r.id === id))
    .filter((r): r is Restaurant => Boolean(r))

  // « Plats » has no store → its count is always 0; its pane shows a tab-local empty.
  const dishCount = 0

  // GLOBAL empty (CD empty block — hides tabs + hint) ONLY when the user has zero
  // restaurant favorites after load. The dish tab keeps the tabs visible (so the
  // user can switch back) and renders its own pane-local empty instead.
  // « Aucun favori » is a statement about THIS account, so it waits for an identity: while
  // the session is unresolved the list is empty for lack of an owner, not for lack of
  // favourites.
  const restoEmpty = !loading && favsOwner !== null && favRestaurants.length === 0
  const state = restoEmpty ? 'empty' : 'list'

  function remove(id: string) {
    if (favsOwner === null) return
    if (toggleFavForOwner(favsOwner, id) === null) return   // refused: say nothing, do nothing
    showToast(t('removedToast'))
  }

  return (
    <div className="gb gb-favorites" data-tab={tab} data-state={state}>
      <div className="fav-top">
        <h1>
          <span className="ms" aria-hidden="true">favorite</span>
          {t('title')}
        </h1>
      </div>
      <p className="fav-sub">{t('subtitle')}</p>

      <div className="fav-hint">
        <span className="ms" aria-hidden="true">tips_and_updates</span>
        <span>{t.rich('hint', { b: bold })}</span>
        <Link href="/eat/search">{t('hintLink')}</Link>
      </div>

      <div className="fav-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'resto'} onClick={() => setTab('resto')}>
          {t('tabRestaurants')} <span className="count">{favRestaurants.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'dish'} onClick={() => setTab('dish')}>
          {t('tabDishes')} <span className="count">{dishCount}</span>
        </button>
      </div>

      {/* RESTAURANTS */}
      <div className="pane-resto">
        <div className="fav-grid">
          {loading
            ? [0, 1, 2].map((i) => <div key={i} className="fav-skel" />)
            : favRestaurants.map((r, i) => {
                const dist = typeof r.distanceKm === 'number' ? tr('distanceApprox', { distance: formatDistance(r.distanceKm, locale, tc('km')) }) : ''
                const meta = [formatCuisineList(r.cuisine, locale, t('cuisineVaried')), dist].filter(Boolean).join(' · ')
                const cover = r.coverPhoto || getRestaurantCover(r.id)
                return (
                  <article
                    key={r.id}
                    className="fav-card"
                    onClick={() => router.push(`/eat/r/${r.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/eat/r/${r.id}`) } }}
                    role="button"
                    tabIndex={0}
                  >
                    <div
                      className={`card__img ${TINTS[i % TINTS.length]}`}
                      style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                    >
                      <button
                        type="button"
                        className="card__heart"
                        aria-label={t('removeAria')}
                        onClick={(e) => {
                          e.stopPropagation()
                          remove(r.id)
                        }}
                      >
                        <span className="ms" aria-hidden="true">favorite</span>
                      </button>
                    </div>
                    <div className="card__b">
                      <div className="card__row">
                        <b>{r.name}</b>
                        {r.rating != null && (
                          <span className="card__rating">
                            <span className="ms" aria-hidden="true">star</span>
                            {r.rating.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </span>
                        )}
                      </div>
                      <div className="card__meta">{meta}</div>
                      {r.deliveryEnabled === true && r.deliveryFee === 0 && (
                        <div className="card__tags">
                          <span className="fav-tag fav-tag--free">{tc('free')}</span>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
        </div>
      </div>

      {/* PLATS — no dish-favorites store yet → tab-local empty (tabs stay visible) */}
      <div className="pane-dish">
        <div className="fav-empty fav-empty--pane">
          <div className="empty__ico">
            <span className="ms" aria-hidden="true">favorite_border</span>
          </div>
          <h2>{t('emptyDishTitle')}</h2>
          <p>{t('emptyDishBody')}</p>
          <Link href="/eat" className="fav-btn fav-btn--primary">
            <span className="ms" aria-hidden="true">search</span>
            {t('explore')}
          </Link>
        </div>
      </div>

      {/* ÉTAT VIDE GLOBAL (aucun favori resto) — CD empty block */}
      <div className="fav-empty">
        <div className="empty__ico">
          <span className="ms" aria-hidden="true">favorite_border</span>
        </div>
        <h2>{t('emptyTitle')}</h2>
        <p>{t('emptyBody')}</p>
        <Link href="/eat" className="fav-btn fav-btn--primary">
          <span className="ms" aria-hidden="true">search</span>
          {t('explore')}
        </Link>
      </div>
    </div>
  )
}
