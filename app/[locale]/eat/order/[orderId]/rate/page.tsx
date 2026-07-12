'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import './post-delivery.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/* ─────────────────────────────────────────────────────────────────────────────
 * /eat/order/[orderId]/rate — « Après livraison » (note + pourboire + écran Merci)
 * VERBATIM re-skin of the FROZEN CD ref (Notion 38efd2c9-…-81e5, eat/post-delivery.html).
 * Material Symbols (NOT lucide), gb-foundation tokens, page CSS scoped `.gb-postdelivery`.
 * Shown AFTER an order is delivered (linked from /eat/track or /eat/orders). The flow has
 * its OWN .pd-bar (close / skip) → IMMERSIVE in EatShell (see report: /eat/order must be
 * added to the EatShell IMMERSIVE list so the shell drops its top bar / mobile chrome).
 *
 * REAL DATA vs INERT (no fabrication — task rule):
 *  • HERO line = REAL order: restaurant name · ref (GR-XXXX) · total (GET /api/orders/[id]).
 *  • ⭐ ORDER RATING + quick tags → INERT. There is NO consumer review backend (confirmed:
 *    /eat/r/[id]/reviews has no write endpoint — the only `Review` is the B2B ServiceReview,
 *    operator-gated). Local state only; submit shows the « Merci » view WITHOUT a network
 *    write. Reported as a gap (a real review-creation mutation is a later brick).
 *  • 💶 POURBOIRE → READ-ONLY RECAP (P2-TIP). The courier tip is now CHARGED AT CHECKOUT
 *    (cart), so this page NO LONGER offers a tip selector (which would imply a 2nd charge).
 *    It reads order.tipCents and, when > 0, shows « pourboire ajouté · X € » — informational
 *    only, no money moves here. When 0 (or TIPS_ENABLED off), nothing tip-related shows.
 *  • COURIER card → NEUTRAL placeholder. The order API exposes NO real driver model (name/
 *    rating/vehicle); we do NOT fabricate a named courier (same stance as /eat/track). Generic
 *    « Votre livreur » + icon avatar; the courier-rating stars are inert too.
 *  • « Merci » / +points = REAL loyalty. order.pointsEarned (1pt/€, credited on `delivered`)
 *    is shown ONLY when > 0; otherwise a generic thank-you with NO fabricated number.
 *  • « Signaler un souci » → Aide flow (routes to /eat for now; no dedicated help route yet).
 * ───────────────────────────────────────────────────────────────────────────── */

interface OrderLite {
  id: string
  status: string
  total: number
  pointsEarned: number
  // P2-TIP — the courier tip CHARGED AT CHECKOUT (cents). The tip is no longer
  // collected here; this page shows it as a READ-ONLY recap. 0 = no tip.
  tipCents: number
  restaurant: { name: string }
}

// CD quick-tags (order rating) — keys, rendered via t(`qtag_${k}`).
const QTAG_KEYS = ['delicious', 'wellPacked', 'hot', 'generous'] as const

export default function PostDeliveryScreen() {
  const t = useTranslations('eat.postDelivery')
  const locale = useLocale()
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()

  const [order, setOrder] = useState<OrderLite | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Local UI state (rating INERT — no review backend; see header). The tip is no
  // longer collected here (it is charged at checkout — P2-TIP), so there is no tip
  // input state: tipCents comes from the order as a read-only recap.
  const [stars, setStars] = useState(4)
  const [tags, setTags] = useState<string[]>(['delicious', 'hot'])
  const [done, setDone] = useState(false)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (res.status === 401) { router.push('/eat/auth'); return }
      if (!res.ok) { setNotFound(true); return }
      const data = await res.json()
      const o = data?.order
      if (!o) { setNotFound(true); return }
      setOrder({
        id: o.id,
        status: o.status,
        total: typeof o.total === 'number' ? o.total : 0,
        pointsEarned: typeof o.pointsEarned === 'number' ? o.pointsEarned : 0,
        tipCents: typeof o.tipCents === 'number' ? o.tipCents : 0,
        restaurant: { name: o.restaurant?.name ?? '' },
      })
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [orderId, router])

  useEffect(() => { fetchOrder() }, [fetchOrder])

  function toggleTag(k: string) {
    setTags((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  // P2-TIP — the tip ALREADY charged at checkout (read-only recap, euros). > 0 → a
  // confirmation line shows; never editable here, no money moves on this page.
  const tipEur = (order?.tipCents ?? 0) / 100

  // Submit = INERT. No review write, no tip charge — just reveal the « Merci » view.
  function submit() { setDone(true) }

  const shortRef = order ? `GR-${order.id.slice(-4).toUpperCase()}` : ''

  // ── not found ────────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="gb gb-postdelivery">
        <div className="pd-bar">
          <span className="ms ms-flip" role="button" tabIndex={0} onClick={() => router.push('/eat')} aria-label={t('close')}>arrow_back</span>
        </div>
        <div className="pd-body">
          <div className="dhero">
            <h1>{t('notFoundTitle')}</h1>
            <p>{t('notFoundBody')}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── « Merci » view (after submit) ────────────────────────────────────────────
  if (done) {
    const pts = order?.pointsEarned ?? 0
    return (
      <div className="gb gb-postdelivery">
        <div className="pd-done">
          <div className="ic"><span className="ms" aria-hidden="true">favorite</span></div>
          <h2>{t('thanksTitle')}</h2>
          {/* tip confirmation only if the order carried a (checkout-charged) tip */}
          <p>{tipEur > 0 ? t('thanksTipBody', { amount: formatEuros(tipEur, locale) }) : t('thanksBody')}</p>
          {/* REAL loyalty points — shown only when the order actually earned some */}
          {pts > 0 && (
            <span className="pts"><span className="ms" aria-hidden="true">redeem</span>{t('pointsEarned', { points: pts })}</span>
          )}
          <div className="acts">
            <button type="button" className="w" onClick={() => router.push(`/eat/track/${orderId}`)}>{t('viewReceipt')}</button>
            <button type="button" className="o" onClick={() => router.push('/eat')}>{t('reorder')}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── rate + tip view ──────────────────────────────────────────────────────────
  // Hero meta = REAL resto · ref · total (skeletons while loading).
  const heroMeta = loading
    ? null
    : `${order?.restaurant.name ?? ''} · ${shortRef} · ${formatEuros(order?.total ?? 0, locale)}`

  // Submit label — the tip is charged at checkout, so the label is the plain submit
  // (no « +tip » charge implication). The recap line below shows the charged tip.
  const submitLabel = t('submit')

  return (
    <div className="gb gb-postdelivery">
      <div className="pd-bar">
        <span className="ms ms-flip" role="button" tabIndex={0} onClick={() => router.push('/eat')} aria-label={t('close')}>close</span>
        <button type="button" className="skip" onClick={() => router.push('/eat')}>{t('skip')}</button>
      </div>

      <div className="pd-body">
        {/* delivered hero — real order context */}
        <div className="dhero">
          <div className="ic"><span className="ms" aria-hidden="true">check</span></div>
          <h1>{t('heroTitle')}</h1>
          {loading
            ? <p><span className="sk sk-line" style={{ width: 200, height: 12, margin: '6px auto 0' }} /></p>
            : <p><bdi>{heroMeta}</bdi></p>}
        </div>

        {/* ⭐ order rating + quick tags — INERT (no review backend) */}
        <div className="pd-card">
          <div className="ttl">{t('rateOrderTitle')}</div>
          <div className="hint">{t('rateOrderHint')}</div>
          <div className="pd-stars" role="radiogroup" aria-label={t('rateOrderTitle')}>
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
          <div className="qtags">
            {QTAG_KEYS.map((k) => {
              const on = tags.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  className={`qtag${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleTag(k)}
                >
                  {t(`qtag_${k}` as 'qtag_delicious')}
                </button>
              )
            })}
          </div>
        </div>

        {/* 💶 courier rating (NEUTRAL placeholder, inert) + tip RECAP (P2-TIP).
            The tip is charged at CHECKOUT now — no selector here. When the order
            carried a tip (tipEur > 0) we show a read-only « pourboire ajouté · X € »
            line; no money moves. When there is no tip, nothing tip-related shows. */}
        <div className="pd-card">
          <div className="courier">
            <span className="av" aria-hidden="true"><span className="ms" style={{ fontSize: 22, color: '#1E3E60' }}>sports_motorsports</span></span>
            <div className="m">
              <b>{t('courierName')}</b>
              <span>{t('courierRole')}</span>
            </div>
            <div className="pd-stars" role="radiogroup" aria-label={t('rateCourier')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className="ms" aria-label={t('courierStarLabel', { n })}>star</button>
              ))}
            </div>
          </div>
          {tipEur > 0 && (
            <div className="tip-recap">
              <span className="ms" aria-hidden="true">volunteer_activism</span>
              <span className="tip-recap__txt">{t('tipRecap', { amount: formatEuros(tipEur, locale) })}</span>
            </div>
          )}
        </div>

        {/* signaler un souci → Aide */}
        <button type="button" className="report" onClick={() => router.push('/eat')}>
          <span className="ms" aria-hidden="true">flag</span>{t('reportIssue')}
        </button>
      </div>

      {/* sticky footer — submit (INERT: no review write, no tip charge) */}
      <div className="pd-foot">
        <div className="inner">
          <button type="button" className="pd-submit" onClick={submit}>
            <span className="ms" aria-hidden="true">send</span>
            <b>{submitLabel}</b>
          </button>
        </div>
      </div>
    </div>
  )
}
