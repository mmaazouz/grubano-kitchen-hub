'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import './reviews.css'

// ── /reviews — operator AVIS, VERBATIM CD v1 LOT 4 (Notion 390fd2c9-…-0c1e).
// Presentation-only re-skin rendered inside the shared OperatorShell (navy --op-* chrome)
// via AppChrome — this page emits ONLY the content <section>.
//
// HONESTLY DE-MOCKED. The legacy page shipped a hard-coded MOCK_REVIEWS array + a
// non-persistent "Envoyer" (local state only). This version:
//  • REAL reviews + distribution — read-only GET /api/restaurants/{id}/reviews for the
//    CURRENT establishment (restaurantId = currentId from GET /api/establishments + the
//    grubano_estab cookie, exactly like the shell). No establishment → onboarding.
//    No review → honest empty state. NEVER the old fabricated reviews.
//  • REAL AI reply draft — POST /api/reviews/generate-reply (Claude). Byte-identical
//    payload { platform, authorName, rating, text } → { reply }.
//  • Multi-platform IMPORT (Google/TripAdvisor/…) has NO backend → honest « bientôt ».
//  • Reply PERSISTENCE has no backend → the composer generates + edits the draft, but
//    "Envoyer" is honestly gated « bientôt » (no fake persisted "answered" state, no
//    fabricated review counts / ratings / sources).
// 🔒 No money. No mutation of any real review. Figures carry className="mono".

const ESTABLISHMENT_COOKIE = 'grubano_estab'

// On-platform reviews come from a single real channel today. The CD renders a « source »
// badge — for real Grubano reviews that channel is "Grubano".
const REAL_SOURCE = 'Grubano'

const AV_GRADS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#8B74E0,#6E56CF)',
  'linear-gradient(135deg,#E8A63D,#B9740A)',
  'linear-gradient(135deg,#2E78F0,#6FB6F5)',
]

type ApiReview = {
  id: string
  rating: number
  text: string
  tags: string[]
  authorName: string | null
  createdAt: string
}

type ReviewsResponse = {
  reviews: ApiReview[]
  distribution: Record<string, number>
  count: number
}

type Establishment = { id: string; name: string; city: string | null; isActive: boolean }

type Stage = 'loading' | 'error' | 'onboarding' | 'empty' | 'ready'
type Tab = 'all' | 'pending' | 'answered'
type Tone = 'warm' | 'pro' | 'concise'

function initials(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export default function ReviewsPage() {
  const t = useTranslations('operator')
  const locale = useLocale()

  const [stage, setStage] = useState<Stage>('loading')
  const [data, setData] = useState<ReviewsResponse | null>(null)
  const [tab, setTab] = useState<Tab>('all')

  // composer (real AI draft; reply persistence « bientôt »)
  const [composer, setComposer] = useState<ApiReview | null>(null)
  const [composerIdx, setComposerIdx] = useState(0)
  const [tone, setTone] = useState<Tone>('warm')
  const [draft, setDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(false)

  async function load() {
    setStage('loading')
    try {
      // 1) shape (0 / current establishment). Same source as the shell.
      const eRes = await fetch('/api/establishments', { cache: 'no-store' })
      if (!eRes.ok) throw new Error('estab')
      const eJson = (await eRes.json()) as { establishments?: Establishment[]; currentId?: string | null }
      const establishments = Array.isArray(eJson.establishments) ? eJson.establishments : []
      if (establishments.length === 0) {
        setStage('onboarding')
        return
      }
      // cookie wins (like the shell), else the API's currentId, else the oldest.
      const cookieId = readCookie(ESTABLISHMENT_COOKIE)
      const restaurantId =
        (cookieId && establishments.some((e) => e.id === cookieId) ? cookieId : null) ||
        eJson.currentId ||
        establishments[0].id

      // 2) REAL reviews for the current establishment (read-only).
      const rRes = await fetch(`/api/restaurants/${encodeURIComponent(restaurantId)}/reviews`, { cache: 'no-store' })
      if (!rRes.ok) throw new Error('reviews')
      const rJson = (await rRes.json()) as ReviewsResponse
      setData(rJson)
      setStage((rJson.count ?? rJson.reviews?.length ?? 0) === 0 ? 'empty' : 'ready')
    } catch {
      setStage('error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    [locale],
  )

  // ── derived aggregates (real, from the API distribution) ──
  const agg = useMemo(() => {
    const dist = data?.distribution ?? { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
    const total = (['1', '2', '3', '4', '5'] as const).reduce((s, k) => s + (dist[k] ?? 0), 0)
    const weighted = (['1', '2', '3', '4', '5'] as const).reduce((s, k) => s + Number(k) * (dist[k] ?? 0), 0)
    const avg = total ? weighted / total : 0
    return { dist, total, avg }
  }, [data])

  const rounded = Math.round(agg.avg)

  // Reply persistence has no backend → no review is a stored "answered". The pending
  // count is therefore every review (all await a reply). "Répondus" stays honest at 0.
  const pendingCount = data?.reviews.length ?? 0
  const answeredCount = 0

  const visible = useMemo(() => {
    const all = data?.reviews ?? []
    if (tab === 'answered') return []
    return all // "all" and "pending" are identical while replies aren't persisted
  }, [data, tab])

  function openComposer(rev: ApiReview, idx: number) {
    setComposer(rev)
    setComposerIdx(idx)
    setTone('warm')
    setDraft('')
    setGenError(false)
    setGenerating(false)
  }
  function closeComposer() {
    setComposer(null)
  }

  // REAL AI draft generation (byte-identical POST /api/reviews/generate-reply).
  async function generateDraft() {
    if (!composer) return
    setGenerating(true)
    setGenError(false)
    try {
      const res = await fetch('/api/reviews/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: REAL_SOURCE,
          authorName: composer.authorName || t('reviews.anon'),
          rating: composer.rating,
          text: composer.text,
        }),
      })
      if (!res.ok) throw new Error('gen')
      const d = (await res.json()) as { reply?: string }
      if (d.reply) setDraft(d.reply)
      else throw new Error('gen')
    } catch {
      setGenError(true)
    } finally {
      setGenerating(false)
    }
  }

  const Stars = ({ n }: { n: number }) => (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`ms${i < n ? '' : ' empty'}`} aria-hidden="true">
          star
        </span>
      ))}
    </>
  )

  // ── loading skeleton ──
  if (stage === 'loading') {
    return (
      <section aria-busy="true">
        <div style={{ marginBottom: 18 }}>
          <span className="op-sk" style={{ width: 80, height: 22 }} />
        </div>
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div style={{ padding: 20, display: 'flex', gap: 28 }}>
            <span className="op-sk" style={{ width: 80, height: 80, borderRadius: '50%' }} />
            <span className="op-sk" style={{ flex: 1, height: 60, borderRadius: 8 }} />
            <span className="op-sk" style={{ width: 80, height: 60, borderRadius: 8 }} />
          </div>
        </div>
        <span className="op-sk" style={{ width: 220, height: 38, borderRadius: 999, marginBottom: 18, display: 'block' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="op-sk" style={{ width: '100%', height: 120, borderRadius: 12 }} />
          ))}
        </div>
      </section>
    )
  }

  // ── error ──
  if (stage === 'error') {
    return (
      <section>
        <div className="op-center">
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">cloud_off</span>
            <h2>{t('reviews.errorTitle')}</h2>
            <p>{t('dash.errorBody')}</p>
            <button type="button" className="op-btn-primary" onClick={load}>
              <span className="ms" aria-hidden="true">refresh</span>
              {t('dash.retry')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ── onboarding (N=0 establishment) ──
  if (stage === 'onboarding') {
    return (
      <section>
        <div className="op-center">
          <div className="op-onb__card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-color.svg" alt="Grubano" />
            <h1>{t('onb.title')}</h1>
            <p>{t('reviews.onbBody')}</p>
            <Link href="/dashboard/establishments" className="op-onb__cta">
              <span className="ms" aria-hidden="true">add_business</span>
              {t('onb.cta')}
            </Link>
            <div className="op-onb__steps">
              {(['1', '2', '3'] as const).map((n) => (
                <div key={n} className="step">
                  <span className="n">{n}</span>
                  <b>{t(`onb.s${n}t`)}</b>
                  <span>{t(`onb.s${n}d`)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  // ── empty (establishment exists, no published review yet) ──
  if (stage === 'empty') {
    return (
      <section>
        <div className="op-dash__head">
          <div>
            <h1 className="op-dash__title">{t('reviews.title')}</h1>
          </div>
          <button type="button" className="op-refresh" onClick={load}>
            <span className="ms" aria-hidden="true">refresh</span>
            {t('dash.refresh')}
          </button>
        </div>
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">rate_review</span>
            <b>{t('reviews.emptyTitle')}</b>
            <span>{t('reviews.emptyBody')}</span>
          </div>
        </div>
      </section>
    )
  }

  // ── ready (real reviews) ──
  const reviews = data?.reviews ?? []

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('reviews.title')}</h1>
          <p className="op-dash__sub">{t('reviews.subtotal', { count: agg.total })}</p>
        </div>
        <button type="button" className="op-refresh" onClick={load}>
          <span className="ms" aria-hidden="true">refresh</span>
          {t('dash.refresh')}
        </button>
      </div>

      {/* honest « bientôt » — multi-platform import has no backend */}
      <div className="rv-import">
        <span className="ms" aria-hidden="true">hub</span>
        <div className="m">
          <b>{t('reviews.importTitle')}</b>
          <span>{t('reviews.importBody')}</span>
        </div>
        <span className="tag-soon">{t('soon')}</span>
      </div>

      {/* overview — average + distribution + à répondre (all real) */}
      <div className="op-card rv-overview">
        <div className="rv-avg">
          <div className="num">{agg.avg.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
          <div className="stars"><Stars n={rounded} /></div>
          <span>{t('reviews.count', { count: agg.total })}</span>
        </div>
        <div className="dist">
          {(['5', '4', '3', '2', '1'] as const).map((k) => {
            const c = agg.dist[k] ?? 0
            const pct = agg.total ? Math.round((c / agg.total) * 100) : 0
            return (
              <div key={k} className="dist-row">
                <span className="n">{k}</span>
                <span className="bar"><i style={{ width: `${pct}%` }} /></span>
                <span className="pct">{pct}%</span>
              </div>
            )
          })}
        </div>
        <div className="rv-torespond">
          <span className="ms ic" aria-hidden="true">forum</span>
          <span className="num">{pendingCount}</span>
          <span>{t('reviews.toRespond')}</span>
        </div>
      </div>

      {/* tabs */}
      <div className="rv-tabs" role="tablist">
        <button
          type="button"
          className={tab === 'all' ? 'is-active' : undefined}
          onClick={() => setTab('all')}
          role="tab"
          aria-selected={tab === 'all'}
        >
          {t('reviews.tabAll')} <span className="tab-count">{reviews.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'pending' ? 'is-active' : undefined}
          onClick={() => setTab('pending')}
          role="tab"
          aria-selected={tab === 'pending'}
        >
          {t('reviews.tabPending')} <span className="tab-count">{pendingCount}</span>
        </button>
        <button
          type="button"
          className={tab === 'answered' ? 'is-active' : undefined}
          onClick={() => setTab('answered')}
          role="tab"
          aria-selected={tab === 'answered'}
        >
          {t('reviews.tabAnswered')} <span className="tab-count">{answeredCount}</span>
        </button>
      </div>

      {/* list */}
      {tab === 'answered' ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">mark_chat_read</span>
            <b>{t('reviews.answeredEmptyTitle')}</b>
            <span>{t('reviews.answeredEmptyBody')}</span>
          </div>
        </div>
      ) : (
        <div className="rv-list">
          {visible.map((r, idx) => (
            <div key={r.id} className="rv-card">
              <div className="rv-card__top">
                <span className="rv-av" style={{ background: AV_GRADS[idx % AV_GRADS.length] }}>
                  {initials(r.authorName)}
                </span>
                <div className="rv-card__meta">
                  <div className="name-row">
                    <b>{r.authorName || t('reviews.anon')}</b>
                    <span className="rv-source">{REAL_SOURCE}</span>
                  </div>
                  <div className="rv-rating">
                    <Stars n={r.rating} />
                    <span className="rv-date">{dateFmt.format(new Date(r.createdAt))}</span>
                  </div>
                </div>
                <span className="rv-badge pending">{t('reviews.badgePending')}</span>
              </div>
              {r.text ? <p className="rv-text">{r.text}</p> : null}
              {r.tags.length > 0 ? (
                <div className="rv-tags">
                  {r.tags.map((tag) => (
                    <span key={tag} className="rv-tag">{tag}</span>
                  ))}
                </div>
              ) : null}
              <div className="rv-actions">
                <button type="button" className="rv-reply-btn" onClick={() => openComposer(r, idx)}>
                  <span className="ms" aria-hidden="true">reply</span>
                  {t('reviews.reply')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ composer modal (real AI draft; reply persistence « bientôt ») ═══ */}
      {composer && (
        <div
          className="op-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeComposer()
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="op-modal">
            <div className="op-modal__head">
              <h3>{t('reviews.composerTitle')}</h3>
              <button type="button" className="op-modal__close" onClick={closeComposer} aria-label={t('reviews.cancel')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <div className="composer-src">
                <span className="rv-av" style={{ background: AV_GRADS[composerIdx % AV_GRADS.length] }}>
                  {initials(composer.authorName)}
                </span>
                <div className="m">
                  <b>{composer.authorName || t('reviews.anon')}</b>
                  <span>
                    {'★'.repeat(composer.rating)}{'☆'.repeat(5 - composer.rating)} · {REAL_SOURCE} ·{' '}
                    {dateFmt.format(new Date(composer.createdAt))}
                  </span>
                </div>
              </div>

              {composer.text ? <p className="cp-review-text">{composer.text}</p> : null}

              <div className="op-field">
                <label>{t('reviews.toneLabel')}</label>
                <div className="tone-select">
                  {(['warm', 'pro', 'concise'] as const).map((tn) => (
                    <button
                      key={tn}
                      type="button"
                      className={tone === tn ? 'is-active' : undefined}
                      onClick={() => setTone(tn)}
                    >
                      {t(`reviews.tone_${tn}`)}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="ai-generate-btn" onClick={generateDraft} disabled={generating}>
                <span className={`ms${generating ? ' spin' : ''}`} aria-hidden="true">
                  {generating ? 'progress_activity' : 'auto_awesome'}
                </span>
                {generating ? t('reviews.generating') : t('reviews.generate')}
              </button>

              <div className="op-field">
                <label>{t('reviews.draftLabel')}</label>
                <textarea
                  className="op-textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('reviews.draftPlaceholder')}
                />
              </div>

              {genError && (
                <div className="op-callout err">
                  <span className="ms" aria-hidden="true">error</span>
                  <p>{t('reviews.genError')}</p>
                </div>
              )}

              <div className="op-callout ai-callout">
                <span className="ms" aria-hidden="true">auto_awesome</span>
                <p>{t('reviews.aiNote')}</p>
              </div>

              <div className="source-note">
                <span className="ms" aria-hidden="true">info</span>
                <p>{t('reviews.sourceNote')}</p>
              </div>
            </div>
            <div className="op-modal__foot">
              {/* Reply persistence has no backend → honest « bientôt », no fake send. */}
              <span className="cp-soon">
                <span className="ms" aria-hidden="true">schedule</span>
                {t('reviews.sendSoon')}
              </span>
              <button type="button" className="op-btn-ghost" onClick={closeComposer}>
                {t('reviews.close')}
              </button>
              <button type="button" className="op-btn-primary" disabled title={t('reviews.sendSoon')}>
                <span className="ms" aria-hidden="true">send</span>
                {t('reviews.send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
