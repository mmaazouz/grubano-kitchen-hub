'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatCuisineList } from '@/lib/categories'
import './reviews.css'

// ── /eat/r/[id]/reviews — « Avis & notes » ─────────────────────────────────────
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-818c): global
// score + distribution bars + inert AI summary + filters + review list + a
// « Écrire un avis » slide-over (modal ≥760px / bottom-sheet <760px).
//
// Renders INSIDE the EatShell, which treats every /eat/r/* path as `is-bare`
// (rail kept, top bar + mobile chrome dropped). This page therefore brings its
// OWN back arrow + title, exactly like the CD design.
//
// REAL DATA — the consumer review backend does NOT exist yet (no Review model,
// no consumer reviews GET/POST endpoint — the only `Review` is the B2B
// ServiceReview, operator-gated). So:
//   • SCORE + review COUNT bind to the REAL Restaurant.rating / reviewCount
//     (GET /api/restaurants/[id]). The big number + ★ + « N avis » are real.
//   • The DISTRIBUTION breakdown + the per-review LIST have no data source →
//     honest empty/loading states (NO fabricated reviews — task rule).
//   • The AI summary stays INERT (« à venir »).
//   • « Publier » has no write endpoint → a no-op « bientôt » confirmation,
//     reported as a gap (a real review-creation mutation is a later brick).

interface RestaurantInfo {
  id: string
  name: string
  cuisine: string[]
  rating: number
  reviewCount: number
}

// CD filter set (Tous / Avec photos / Plus récents / Mieux notés / Critiques).
const FILTER_KEYS = ['all', 'photos', 'recent', 'top', 'critical'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

// CD « Qu'avez-vous aimé ? » tags.
const TAG_KEYS = ['taste', 'service', 'speed', 'value', 'ambiance'] as const

export default function RestaurantReviewsScreen() {
  const t = useTranslations('eat.reviews')
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')

  // write-review slide-over state
  const [writeOpen, setWriteOpen] = useState(false)
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [published, setPublished] = useState(false)

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

  // ── real score / count ──────────────────────────────────────────────────────
  const rating = restaurant?.rating ?? 0
  const reviewCount = restaurant?.reviewCount ?? 0
  // ★ row: full stars from the rounded rating (display only, CD uses solid glyphs).
  const fullStars = Math.max(0, Math.min(5, Math.round(rating)))
  const starGlyphs = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars)
  const scoreText = rating > 0 ? rating.toFixed(1).replace('.', locale === 'en' ? '.' : ',') : '—'

  // ── distribution: there is no real per-star breakdown source → CD-empty state.
  // (We never synthesise the 86/9/3/1/1 split — that would be fabricated data.)
  const hasDistribution = false

  // ── review list: no consumer review store → empty (NO fabricated reviews) ────
  const reviews: never[] = useMemo(() => [], [])
  const subtitle = restaurant
    ? formatCuisineList(restaurant.cuisine, locale, '') || t('partner')
    : ''

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }
  function openWrite() {
    setPublished(false)
    setWriteOpen(true)
  }
  function closeWrite() {
    setWriteOpen(false)
  }
  // No write endpoint yet → no-op confirmation. Reported as a gap.
  function publish() {
    setPublished(true)
  }

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
            {/* distribution rows would render here once a real breakdown exists */}
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

      {/* ── review list (empty/loading — no consumer reviews backend yet) ── */}
      {loading ? (
        <div className="rlist">
          {[0, 1, 2].map((i) => <div key={i} className="rskel" />)}
        </div>
      ) : reviews.length === 0 ? (
        <div className="rempty">
          <div className="rempty__ico"><span className="ms" aria-hidden="true">reviews</span></div>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="rlist">{/* real reviews would render here */}</div>
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
                    <h3>{t('publishSoonTitle')}</h3>
                    <p>{t('publishSoonBody')}</p>
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
                  <button type="button" className="rv-btn rv-btn--primary rv-btn--full" onClick={publish}>
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
