'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Wrench, ChevronLeft, Loader2, ClipboardList, Calendar, Check, X, Star, Send, FileText } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, type BadgeTone } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'
import { RATING_MIN, RATING_MAX } from '@/lib/service-review'
import ServiceInvoiceModal from '@/components/ServiceInvoiceModal'

// ── /marketplace/prestataire-missions — the resto's quote requests (P3, Agent 76) ──
// CLONE of /marketplace/orders (resto order history), adapted to the DEVIS cycle. Renders
// inside the operator chrome (operator-gated). The resto ACCEPTS / DECLINES a quoted mission
// or CANCELS a still-requested one via /api/marketplace/prestataire-missions/[id] (server-
// side state machine + ownership). NO money — the quote amount is only displayed. Rendered
// by the SERVER page.tsx, which 404s when the flag is OFF.

interface Mission {
  id: string
  status: string
  requestDetails: string
  quoteAmountCents: number | null
  quoteDescription: string | null
  proposedDate: string | null
  scheduledDate: string | null
  createdAt: string
  prestataireProfile: { id: string; companyName: string; city: string | null } | null
  serviceOffering: { id: string; title: string; category: string } | null
  review: { id: string; rating: number } | null
}

const STATUS_TONE: Record<string, BadgeTone> = {
  requested: 'neutral', quoted: 'warning', accepted: 'success', done: 'success', declined: 'danger', cancelled: 'neutral',
}

export default function RestoMissionsClient() {
  const t  = useTranslations('marketplace.prestataireMissions')
  const locale = useLocale()

  const [items, setItems]     = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null) // missionId | null — invoice viewer (P6)

  function load() {
    setLoading(true)
    fetch('/api/marketplace/prestataire-missions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.missions) ? d.missions : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s: string) => t((`status_${s}`) as 'status_requested')
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : null)

  async function act(id: string, status: 'accepted' | 'declined' | 'cancelled') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/marketplace/prestataire-missions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  // ── Review (P5) — only on a 'done' mission not yet reviewed (anti-fraud server-side too). ──
  const [reviewFor, setReviewFor] = useState<{ id: string; name: string } | null>(null) // null = closed
  const [rating, setRating]       = useState(0)
  const [comment, setComment]     = useState('')
  const [posting, setPosting]     = useState(false)
  const [reviewError, setReviewError] = useState('')

  function openReview(m: Mission) {
    setReviewError(''); setRating(0); setComment('')
    setReviewFor({ id: m.id, name: m.prestataireProfile?.companyName ?? '' })
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!reviewFor || posting) return
    if (rating < RATING_MIN || rating > RATING_MAX) { setReviewError(t('reviewRatingRequired')); return }
    setPosting(true); setReviewError('')
    try {
      const res = await fetch('/api/prestataire-reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceMissionId: reviewFor.id, rating, comment: comment.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setReviewError(d?.error || t('reviewErr'))
        return
      }
      setReviewFor(null); load()
    } catch {
      setReviewError(t('reviewErr'))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
            <ClipboardList size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
            <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
          </div>
        </div>
        <Link href="/marketplace/prestataires" className="inline-flex shrink-0 items-center gap-1 rounded-grubano-lg border border-grubano-border px-3 py-2 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
          <Wrench size={15} /> {t('discoverNav')}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : items.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{t('empty')}</p>
            <Link href="/marketplace/prestataires" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
              <ChevronLeft size={14} /> {t('discoverNav')}
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id}>
              <Card elevation="sm" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display font-bold text-grubano-ink truncate">{m.prestataireProfile?.companyName ?? '—'}</h2>
                      <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} size="sm">{statusLabel(m.status)}</Badge>
                      {m.serviceOffering && <span className="text-xs text-grubano-ink-faint">· {m.serviceOffering.title}</span>}
                    </div>
                    <p className="mt-1 text-sm text-grubano-ink-muted whitespace-pre-line">{m.requestDetails}</p>
                    {m.quoteAmountCents != null && (
                      <div className="mt-2 rounded-grubano-md bg-grubano-tint/40 px-3 py-2">
                        <p className="text-sm font-semibold text-grubano-ink">{t('quoteLabel')}: {formatMoney(m.quoteAmountCents, locale)}</p>
                        {m.quoteDescription && <p className="text-[13px] text-grubano-ink-muted">{m.quoteDescription}</p>}
                        {(m.scheduledDate || m.proposedDate) && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-grubano-ink-faint">
                            <Calendar size={12} /> {fmtDate(m.scheduledDate ?? m.proposedDate)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {m.status === 'requested' && (
                      <Button variant="secondary" size="sm" loading={busyId === m.id} onClick={() => act(m.id, 'cancelled')}>
                        {t('cancelCta')}
                      </Button>
                    )}
                    {m.status === 'quoted' && (
                      <>
                        <Button variant="primary" size="sm" loading={busyId === m.id} leftIcon={<Check size={14} />} onClick={() => act(m.id, 'accepted')}>
                          {t('acceptCta')}
                        </Button>
                        <Button variant="secondary" size="sm" loading={busyId === m.id} leftIcon={<X size={14} />} onClick={() => act(m.id, 'declined')}>
                          {t('declineCta')}
                        </Button>
                      </>
                    )}
                    {m.status === 'done' && !m.review && (
                      <Button variant="secondary" size="sm" leftIcon={<Star size={14} />} onClick={() => openReview(m)}>
                        {t('reviewCta')}
                      </Button>
                    )}
                    {m.status === 'done' && m.review && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-grubano-ink-muted">
                        <Star size={13} className="text-grubano-warning" /> {t('reviewed')} · {m.review.rating}/5
                      </span>
                    )}
                    {m.status === 'done' && (
                      <Button variant="ghost" size="sm" leftIcon={<FileText size={14} />} onClick={() => setInvoiceFor(m.id)}>
                        {t('invoiceCta')}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ── Review modal (P5) — only reachable from a 'done', un-reviewed mission ── */}
      {reviewFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !posting && setReviewFor(null)}>
          <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-grubano-ink">{t('reviewTitle')}{reviewFor.name ? ` — ${reviewFor.name}` : ''}</h2>
              <button onClick={() => !posting && setReviewFor(null)} aria-label={t('reviewCancel')}><X size={18} className="text-grubano-ink-muted" /></button>
            </div>
            <form onSubmit={submitReview} className="space-y-3">
              {reviewError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{reviewError}</p>}
              <div>
                <p className="mb-1.5 text-sm font-medium text-grubano-ink">{t('reviewRatingLabel')}</p>
                <div className="flex gap-1">
                  {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n}/${RATING_MAX}`} className="p-0.5">
                      <Star size={28} className={n <= rating ? 'fill-current text-grubano-warning' : 'text-grubano-border'} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('reviewCommentLabel')}</label>
                <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('reviewCommentPlaceholder')}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" fullWidth onClick={() => setReviewFor(null)}>{t('reviewCancel')}</Button>
                <Button type="submit" variant="primary" size="md" fullWidth loading={posting} leftIcon={posting ? undefined : <Send size={16} />}>
                  {posting ? t('reviewSending') : t('reviewSend')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Invoice viewer (P6) — resto view: amount + PDF; the commission split is server-withheld ── */}
      {invoiceFor && (
        <ServiceInvoiceModal missionId={invoiceFor} onClose={() => setInvoiceFor(null)} />
      )}
    </div>
  )
}
