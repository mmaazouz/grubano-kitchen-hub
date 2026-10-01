'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowLeft, MapPin, Wrench, Loader2, MonitorSmartphone, Send, X, CheckCircle2, CalendarDays, Star, CreditCard } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge, Button } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'

// ── /marketplace/prestataires/[id] — prestataire fiche + REQUEST A QUOTE (P3, Agent 76) ──
// A restaurateur views ONE prestataire + its active services. Reuses the discovery endpoint
// (ACTIVE-only + restaurant/admin-gated) and finds the id. P3 replaces the P2 "coming soon"
// notice with a real « Demander un devis » flow: the resto describes the need (optionally for
// a specific service) → POST /api/marketplace/prestataire-missions creates a ServiceMission
// in status 'requested'. NO money — the prestataire will quote an amount later (pure data).
// NO cart / price here. Operator-gated; the parent server page 404s when the flag is OFF.

interface DiscoverOffering { id: string; title: string; description: string | null; category: string; modality: string; indicativeRate: string | null; fixedPriceCents: number | null }
interface DiscoverPrestataire {
  id: string
  companyName: string
  city: string | null
  serviceCategories: string[]
  coverageZones: string[]
  modality: string
  indicativeRate: string | null
  availableWeekdays: string[]
  availabilityNote: string | null
  serviceOfferings: DiscoverOffering[]
}

const SVC_LABEL: Record<string, string> = {
  electricity: 'svcElectricity', plumbing: 'svcPlumbing', haccp: 'svcHaccp', cleaning: 'svcCleaning',
  pest_control: 'svcPestControl', fridge_repair: 'svcFridgeRepair', kitchen_maintenance: 'svcKitchenMaintenance',
  accounting: 'svcAccounting', training: 'svcTraining', other: 'svcOther',
}
const MOD_LABEL: Record<string, string> = { on_site: 'modalityOnSite', remote: 'modalityRemote', both: 'modalityBoth' }
const WD_LABEL: Record<string, string> = { mon: 'wdMon', tue: 'wdTue', wed: 'wdWed', thu: 'wdThu', fri: 'wdFri', sat: 'wdSat', sun: 'wdSun' }

interface Review { id: string; rating: number; comment: string | null; createdAt: string }

export default function PrestataireDetailClient({ id, forfaitEnabled = false }: { id: string; forfaitEnabled?: boolean }) {
  const t  = useTranslations('prestataire')
  const tm = useTranslations('marketplace.prestataires')
  const locale = useLocale()

  const [p, setP] = useState<DiscoverPrestataire | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    fetch('/api/marketplace/prestataires', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const found = (d.prestataires as DiscoverPrestataire[]).find((x) => x.id === id)
        if (found) setP(found)
        else setMissing(true)
      })
      .catch(() => setMissing(true))
      .finally(() => setLoading(false))
  }, [id])

  // P5 — reviews + average (operator-gated GET, calque discovery). Best-effort: a failure
  // simply leaves the section empty (the fiche still renders the rest).
  const [reviews, setReviews]         = useState<Review[]>([])
  const [avg, setAvg]                 = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  useEffect(() => {
    fetch(`/api/prestataire-reviews?prestataireProfileId=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setReviews(Array.isArray(d.reviews) ? d.reviews : [])
        setAvg(typeof d.average === 'number' ? d.average : 0)
        setReviewCount(typeof d.count === 'number' ? d.count : 0)
      })
      .catch(() => {})
  }, [id])

  const svcLabel = (c: string) => (c in SVC_LABEL ? t(SVC_LABEL[c] as 'svcOther') : c)
  const modLabel = (m: string) => t((MOD_LABEL[m] ?? 'modalityOnSite') as 'modalityOnSite')
  const wdLabel  = (dd: string) => (dd in WD_LABEL ? t(WD_LABEL[dd] as 'wdMon') : dd)

  const byCategory = useMemo(() => {
    const map = new Map<string, DiscoverOffering[]>()
    for (const o of p?.serviceOfferings ?? []) {
      const arr = map.get(o.category) ?? []
      arr.push(o); map.set(o.category, arr)
    }
    return Array.from(map.entries())
  }, [p])

  // ── « Demander un devis » (P3) — create a ServiceMission in status 'requested'. ──
  // NO money: the prestataire quotes an amount later; here we only describe the need.
  const [reqOpen, setReqOpen]             = useState(false)
  const [reqOfferingId, setReqOfferingId] = useState<string | null>(null)
  const [details, setDetails]             = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [reqError, setReqError]           = useState('')
  const [reqDone, setReqDone]             = useState(false)

  // ── P8b — « Commander (prix fixe) »: order + pay a FORFAIT upfront (resto, double-flag). ──
  // The amount is NEVER sent: the server charges the offering's fixed price and routes the
  // payout to the prestataire (5% to Grubano). Redirects to the Stripe Checkout (TEST).
  const [orderingId, setOrderingId] = useState<string | null>(null)
  const [orderErr, setOrderErr]     = useState('')
  async function orderForfait(offeringId: string) {
    if (orderingId) return
    setOrderingId(offeringId); setOrderErr('')
    try {
      const res = await fetch(`/api/prestataire-forfait/${offeringId}/order`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.url) { window.location.href = d.url; return }
      setOrderErr(d?.error || tm('orderForfaitErr'))
    } catch {
      setOrderErr(tm('orderForfaitErr'))
    } finally {
      setOrderingId(null)
    }
  }

  function openRequest(offeringId: string | null) {
    setReqError(''); setReqDone(false); setDetails(''); setReqOfferingId(offeringId); setReqOpen(true)
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || !p) return
    if (!details.trim()) { setReqError(tm('requestDetailsRequired')); return }
    setSubmitting(true); setReqError('')
    try {
      const res = await fetch('/api/marketplace/prestataire-missions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prestataireProfileId: p.id, serviceOfferingId: reqOfferingId, requestDetails: details.trim() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setReqError(d?.error || tm('requestErr'))
        return
      }
      setReqDone(true)
    } catch {
      setReqError(tm('requestErr'))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedOffering = p?.serviceOfferings.find((o) => o.id === reqOfferingId) ?? null

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-grubano-primary" /></div>
  if (missing || !p) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-grubano-ink-muted">{tm('notFound')}</p>
        <Link href="/marketplace/prestataires" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
          <ArrowLeft size={14} /> {tm('backToList')}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <Link href="/marketplace/prestataires" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
        <ArrowLeft size={15} /> {tm('backToList')}
      </Link>

      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Wrench size={20} />
        </span>
        <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{p.companyName}</h1>
      </div>
      <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-grubano-ink-muted">
        {p.city && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {p.city}</span>}
        <span className="inline-flex items-center gap-1"><MonitorSmartphone size={13} /> {modLabel(p.modality)}</span>
        {reviewCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <Star size={13} className="fill-current text-grubano-warning" />
            <span className="font-semibold text-grubano-ink">{avg.toFixed(1)}</span> {tm('reviewsCount', { count: reviewCount })}
          </span>
        )}
      </p>
      {p.coverageZones.length > 0 && (
        <p className="mb-3 text-sm text-grubano-ink-muted">
          <span className="font-medium text-grubano-ink">{tm('coverageLabel')}:</span> {p.coverageZones.join(', ')}
        </p>
      )}

      {/* P4 — declared availability (READ-ONLY for the restaurant; NO booking). */}
      {(p.availableWeekdays.length > 0 || p.availabilityNote) && (
        <div className="mb-5 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-grubano-ink">
            <CalendarDays size={14} className="text-grubano-ink-muted" /> {tm('availabilityTitle')}
          </p>
          {p.availableWeekdays.length > 0 && (
            <p className="text-sm text-grubano-ink-muted">
              <span className="font-medium text-grubano-ink">{tm('availabilityDaysLabel')}:</span> {p.availableWeekdays.map(wdLabel).join(', ')}
            </p>
          )}
          {p.availabilityNote && <p className="mt-0.5 text-sm text-grubano-ink-muted whitespace-pre-line">{p.availabilityNote}</p>}
        </div>
      )}

      {/* P3 — « Demander un devis » (real flow; replaces the P2 "coming soon" notice). */}
      <Card elevation="sm" padding="md" className="mb-5 border-grubano-primary/20 bg-grubano-tint/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-grubano-ink">{tm('requestQuoteTitle')}</p>
            <p className="text-sm text-grubano-ink-muted">{tm('requestQuoteDesc')}</p>
          </div>
          <Button variant="primary" size="md" leftIcon={<Send size={15} />} onClick={() => openRequest(null)}>
            {tm('requestQuoteCta')}
          </Button>
        </div>
      </Card>

      <h2 className="mb-2 font-display text-lg font-bold text-grubano-ink">{tm('servicesTitle')}</h2>
      {orderErr && <p className="mb-3 rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{orderErr}</p>}
      <div className="space-y-5">
        {byCategory.map(([cat, offerings]) => (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-grubano-ink-faint">{svcLabel(cat)}</h3>
            <ul className="space-y-2">
              {offerings.map((o) => (
                <li key={o.id}>
                  <Card elevation="sm" padding="md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-grubano-ink">{o.title}</p>
                        {o.description && <p className="mt-0.5 text-sm text-grubano-ink-muted">{o.description}</p>}
                      </div>
                      <Badge tone="neutral" size="sm">{modLabel(o.modality)}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      {/* A forfait shows its FIXED price; otherwise the free-text rate / « sur devis ». */}
                      {o.fixedPriceCents != null ? (
                        <p className="text-sm font-bold text-grubano-ink">
                          {formatMoney(o.fixedPriceCents, locale)} <span className="font-medium text-grubano-ink-muted">· {tm('forfaitLabel')}</span>
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-grubano-ink">{o.indicativeRate?.trim() || tm('onQuote')}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        {/* P8b — « Commander (prix fixe) »: pay upfront. Only for a forfait, under the double flag. */}
                        {o.fixedPriceCents != null && forfaitEnabled && (
                          <button onClick={() => orderForfait(o.id)} disabled={orderingId === o.id}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-grubano-lg bg-grubano-primary px-3.5 py-1.5 text-sm font-semibold text-white shadow-grubano-sm disabled:opacity-60">
                            {orderingId === o.id ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} {tm('orderForfaitCta')}
                          </button>
                        )}
                        <button onClick={() => openRequest(o.id)} className="shrink-0 text-sm font-semibold text-grubano-primary hover:underline">
                          {tm('requestServiceCta')}
                        </button>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* P5 — reviews (READ-ONLY; from restaurants that had a 'done' mission). */}
      {reviewCount > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 flex flex-wrap items-center gap-2 font-display text-lg font-bold text-grubano-ink">
            {tm('reviewsTitle')}
            <span className="inline-flex items-center gap-1 text-sm font-medium text-grubano-ink-muted">
              <Star size={14} className="fill-current text-grubano-warning" /> {avg.toFixed(1)} · {tm('reviewsCount', { count: reviewCount })}
            </span>
          </h2>
          <ul className="space-y-2">
            {reviews.map((rv) => (
              <li key={rv.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
                      <Star key={n} size={14} className={n <= rv.rating ? 'fill-current text-grubano-warning' : 'text-grubano-border'} />
                    ))}
                    <span className="ml-1 text-xs text-grubano-ink-faint">{new Date(rv.createdAt).toLocaleDateString(locale)}</span>
                  </div>
                  {rv.comment && <p className="mt-1 text-sm text-grubano-ink-muted whitespace-pre-line">{rv.comment}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Request-a-quote modal (P3) ── */}
      {reqOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !submitting && setReqOpen(false)}>
          <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
            {reqDone ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-grubano-pill bg-grubano-success-tint">
                  <CheckCircle2 size={28} className="text-grubano-success" />
                </span>
                <p className="font-display text-base font-bold text-grubano-ink">{tm('requestDoneTitle')}</p>
                <p className="max-w-xs text-sm text-grubano-ink-muted">{tm('requestDoneBody')}</p>
                <Link href="/marketplace/prestataire-missions" className="mt-1 inline-flex items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-5 py-2.5 font-semibold text-white">
                  {tm('requestDoneCta')}
                </Link>
              </div>
            ) : (
              <form onSubmit={submitRequest} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-grubano-ink">{tm('requestQuoteTitle')}</h2>
                  <button type="button" onClick={() => setReqOpen(false)} aria-label={tm('requestCancel')}><X size={18} className="text-grubano-ink-muted" /></button>
                </div>
                {selectedOffering && (
                  <p className="rounded-grubano-md bg-grubano-tint/50 px-3 py-2 text-[13px] text-grubano-ink-muted">
                    {tm('requestForService', { service: selectedOffering.title })}
                  </p>
                )}
                {reqError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{reqError}</p>}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{tm('requestDetailsLabel')}</label>
                  <textarea rows={4} required value={details} onChange={(e) => setDetails(e.target.value)} placeholder={tm('requestDetailsPlaceholder')}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="secondary" size="md" fullWidth onClick={() => setReqOpen(false)}>{tm('requestCancel')}</Button>
                  <Button type="submit" variant="primary" size="md" fullWidth loading={submitting} leftIcon={submitting ? undefined : <Send size={16} />}>
                    {submitting ? tm('requestSending') : tm('requestSend')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
