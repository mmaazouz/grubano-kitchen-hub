'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatCuisineList } from '@/lib/categories'
import { showToast } from '@/lib/eat-cart'
import './reviews.css'

// ── /eat/r/[id]/reviews — « Avis & notes » ─────────────────────────────────────
// VERBATIM CD design (Notion 38efd2c9-…-818c) wired to the REAL consumer review
// backend (P0-DATA-2): model Review + GET/POST /api/restaurants/[id]/reviews.
//   • SCORE + review COUNT (headline) bind to the REAL Restaurant.rating /
//     reviewCount (GET /api/restaurants/[id]) — the platform-wide aggregate, kept
//     as the headline (it is NOT recomputed from on-platform reviews — a later
//     product decision).
//   • The DISTRIBUTION bars + the review LIST come from the real published reviews
//     (GET …/reviews). Empty/loading states stay honest (no fabricated reviews).
//   • « Publier » does a REAL POST (upserts the user's one review for this resto);
//     it requires a logged-in session and a chosen rating.
//   • The AI summary stays INERT (« à venir »).

interface RestaurantInfo {
  id: string
  name: string
  cuisine: string[]
  rating: number
  reviewCount: number
}

interface ReviewItem {
  id: string
  rating: number
  text: string
  tags: string[]
  authorName: string | null
  createdAt: string
}

// CD filter set (Tous / Avec photos / Plus récents / Mieux notés / Critiques).
const FILTER_KEYS = ['all', 'photos', 'recent', 'top', 'critical'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

// CD « Qu'avez-vous aimé ? » tags.
const TAG_KEYS = ['taste', 'service', 'speed', 'value', 'ambiance'] as const
const KNOWN_TAGS = new Set<string>(TAG_KEYS)
// Rotating CD avatar palettes.
const AV_CLASSES = ['a1', 'a2', 'a3'] as const

export default function RestaurantReviewsScreen() {
  const t = useTranslations('eat.reviews')
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { status: authStatus } = useSession()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')

  // real reviews + per-star distribution (P0-DATA-2)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [distribution, setDistribution] = useState<Record<string, number>>({})
  const [reviewsLoading, setReviewsLoading] = useState(true)

  // write-review slide-over state
  const [writeOpen, setWriteOpen] = useState(false)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [published, setPublished] = useState(false)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/restaurants/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        if (d?.restaurant) {
          setRestaurant({
            id: d.restaurant.id,
            name: d.restaurant.name,
            cuisine: Array.isArray(d.restaurant.cuisine) ? d.restaurant.cuisine : [],
            rating: typeof d.restaurant.rating === 'number' ? d.restaurant.rating : 0,
            reviewCount: typeof d.restaurant.reviewCount === 'number' ? d.restaurant.reviewCount : 0,
          })
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])

  // Published reviews + distribution (real).
  const loadReviews = useCallback(async () => {
    try {
      const r = await fetch(`/api/restaurants/${id}/reviews`)
      if (!r.ok) return
      const d = await r.json()
      setReviews(Array.isArray(d.reviews) ? d.reviews : [])
      setDistribution(d.distribution && typeof d.distribution === 'object' ? d.distribution : {})
    } catch {
      /* keep current */
    }
  }, [id])

  useEffect(() => {
    let alive = true
    setReviewsLoading(true)
    loadReviews().finally(() => { if (alive) setReviewsLoading(false) })
    return () => { alive = false }
  }, [loadReviews])

  // ── real score / count (headline aggregate) ──────────────────────────────────
  const rating = restaurant?.rating ?? 0
  const reviewCount = restaurant?.reviewCount ?? 0
  const fullStars = Math.max(0, Math.min(5, Math.round(rating)))
  const starGlyphs = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars)
  const scoreText = rating > 0 ? rating.toFixed(1).replace('.', locale === 'en' ? '.' : ',') : '—'

  // ── distribution (real, from published reviews) ──────────────────────────────
  const distTotal = useMemo(
    () => Object.values(distribution).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0),
    [distribution],
  )
  const hasDistribution = distTotal > 0

  // ── review list (real) + client-side filter ─────────────────────────────────
  const filteredReviews = useMemo(() => {
    const list = [...reviews]
    switch (filter) {
      case 'top':
        return list.sort((a, b) => b.rating - a.rating)
      case 'critical':
        return list.filter((r) => r.rating <= 2)
      case 'recent':
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      case 'photos':
        return [] // no photo storage yet → honestly empty for this filter
      default:
        return list
    }
  }, [reviews, filter])

  const subtitle = restaurant
    ? formatCuisineList(restaurant.cuisine, locale, '') || t('partner')
    : ''

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }
  function openWrite() {
    setPublished(false)
    setStars(0)
    setComment('')
    setTags([])
    setWriteOpen(true)
  }
  function closeWrite() {
    setWriteOpen(false)
  }

  // Real publish → POST (upsert). Requires a session + a chosen rating.
  async function publish() {
    if (publishing) return
    if (stars < 1) {
      showToast(t('ratingRequired'))
      return
    }
    if (authStatus !== 'authenticated') {
      showToast(t('loginToReview'))
      return
    }
    setPublishing(true)
    try {
      const res = await fetch(`/api/restaurants/${id}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating: stars, text: comment.trim() || undefined, tags }),
      })
      if (!res.ok) throw new Error('publish_failed')
      setPublished(true)
      await loadReviews()
    } catch {
      showToast(t('publishError'))
    } finally {
      setPublishing(false)
    }
  }

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-MA' : locale, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch {
      return ''
    }
  }
  const reviewStars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)))

  return (
    <div className="gb gb-reviews">
      {/* ── header: back + title (resto) + write CTA ── */}
      <div className="rv-top">
        <button type="button" className="ms back" onClick={() => router.back()} aria-label={t('back')}>arrow_back</button>
        <h1>{t('title')}{restaurant && <span>{restaurant.name}{subtitle ? ` · ${subtitle}` : ''}</span>}</h1>
        <button type="button" className="rv-btn rv-btn--primary" onClick={openWrite}>
          <span className="ms" aria-hidden="true">rate_review</span>{t('writeReview')}
        </button>
      </div>

      {/* ── summary: real score + distribution ── */}
      <div className="summary">
        <div className="score">
          <b>{loading ? '—' : scoreText}</b>
          <div className="stars" aria-hidden="true">{starGlyphs}</div>
          <small>{t('reviewCount', { count: reviewCount.toLocaleString(locale === 'ar' ? 'ar-MA' : locale) })}</small>
        </div>
        {hasDistribution ? (
          <div className="dist">
            {[5, 4, 3, 2, 1].map((star) => {
              const n = distribution[String(star)] ?? 0
              const pct = distTotal ? Math.round((n / distTotal) * 100) : 0
              return (
                <div className="row" key={star}>
                  <span className="n">{star}<span className="ms" aria-hidden="true">star</span></span>
                  <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                  <span className="p">{pct}%</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="dist--empty">{t('distributionUnavailable')}</p>
        )}
      </div>

      {/* ── AI summary (INERT — « à venir ») ── */}
      <div className="ai">
        <div className="ai__in">
          <span className="ai__ic"><span className="ms" aria-hidden="true">auto_awesome</span></span>
          <div className="ai__tx">
            <div className="h"><b>{t('aiTitle')}</b><span className="soon">{t('aiSoon')}</span></div>
            <p>{t('aiPlaceholder')}</p>
            <div className="chips">
              <span className="pos">{t('aiChip1')}</span>
              <span className="pos">{t('aiChip2')}</span>
              <span className="pos">{t('aiChip3')}</span>
              <span>{t('aiChip4')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── filters ── */}
      <div className="rfilters" role="tablist" aria-label={t('filtersLabel')}>
        {FILTER_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            className={`rchip${filter === k ? ' on' : ''}`}
            onClick={() => setFilter(k)}
          >
            {t(`filter_${k}` as 'filter_all')}
          </button>
        ))}
      </div>

      {/* ── review list (real) ── */}
      {reviewsLoading ? (
        <div className="rlist">
          {[0, 1, 2].map((i) => <div key={i} className="rskel" />)}
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="rempty">
          <div className="rempty__ico"><span className="ms" aria-hidden="true">reviews</span></div>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="rlist">
          {filteredReviews.map((r, i) => {
            const shownTags = r.tags.filter((tg) => KNOWN_TAGS.has(tg))
            return (
              <div className="review" key={r.id}>
                <div className="review__head">
                  <div className={`review__av ${AV_CLASSES[i % AV_CLASSES.length]}`}>
                    {(r.authorName || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="review__who">
                    <b>{r.authorName || t('anonymous')}</b>
                    <span>{fmtDate(r.createdAt)}</span>
                  </div>
                  <div className="review__stars" aria-hidden="true">{reviewStars(r.rating)}</div>
                </div>
                {r.text ? <p>{r.text}</p> : null}
                {shownTags.length > 0 ? (
                  <div className="review__foot">
                    {shownTags.map((tg) => (
                      <span className="review__dish" key={tg}>
                        <span className="ms" aria-hidden="true">sell</span>{t(`tag_${tg}` as 'tag_taste')}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* ════ « ÉCRIRE UN AVIS » SLIDE-OVER (modal ≥760px / sheet <760px) ════ */}
      {writeOpen && (
        <div
          className="backdrop"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) closeWrite() }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('writeTitle')}
          >
            <div className="sheet__head">
              <h2>{t('writeTitle')}</h2>
              <button type="button" className="ms x" onClick={closeWrite} aria-label={t('close')}>close</button>
            </div>

            {published ? (
              <>
                <div className="sheet__body">
                  <div className="wdone">
                    <div className="wdone__ico"><span className="ms" aria-hidden="true">check_circle</span></div>
                    <h3>{t('publishedTitle')}</h3>
                    <p>{t('publishedBody')}</p>
                  </div>
                </div>
                <div className="sheet__foot">
                  <button type="button" className="rv-btn rv-btn--primary rv-btn--full" onClick={closeWrite}>
                    {t('done')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sheet__body">
                  <div className="rate">
                    <small>{restaurant?.name ?? ''}</small>
                    <b>{t('ratePrompt')}</b>
                    <div className="stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`ms${n > stars ? ' off' : ''}`}
                          onClick={() => setStars(n)}
                          aria-label={t('starLabel', { n })}
                          aria-pressed={n <= stars}
                        >
                          star
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="wlabel">{t('commentLabel')}</p>
                  <div className="wfield">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={t('commentPlaceholder')}
                      aria-label={t('commentLabel')}
                      maxLength={1000}
                    />
                  </div>

                  <p className="wlabel">{t('likedLabel')}</p>
                  <div className="wtags">
                    {TAG_KEYS.map((k) => {
                      const label = t(`tag_${k}` as 'tag_taste')
                      const on = tags.includes(k)
                      return (
                        <button
                          key={k}
                          type="button"
                          className={`wtag${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => toggleTag(k)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  <button type="button" className="wphoto">
                    <span className="ms" aria-hidden="true">add_a_photo</span>{t('addPhotos')}
                  </button>
                </div>
                <div className="sheet__foot">
                  <button
                    type="button"
                    className="rv-btn rv-btn--primary rv-btn--full"
                    onClick={publish}
                    disabled={publishing}
                    aria-busy={publishing}
                  >
                    {t('publish')}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
