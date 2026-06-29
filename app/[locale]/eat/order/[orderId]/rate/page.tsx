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
 *  • 💶 POURBOIRE → VISUAL/inert. There is NO post-delivery tip backend (no model, no charge
 *    path). The selector is purely visual — NEVER charges, NEVER invents an amount. The submit
 *    label echoes the *selected* tip (user choice), but no money moves. Reported as a gap.
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
  restaurant: { name: string }
}

// CD quick-tags (order rating) — keys, rendered via t(`qtag_${k}`).
const QTAG_KEYS = ['delicious', 'wellPacked', 'hot', 'generous'] as const
// CD tip presets (€). The selector is VISUAL ONLY — no charge (see header).
const TIP_PRESETS = [1, 2, 3, 5] as const

export default function PostDeliveryScreen() {
  const t = useTranslations('eat.postDelivery')
  const locale = useLocale()
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()

  const [order, setOrder] = useState<OrderLite | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Local UI state (all INERT — no review/tip backend; see header).
  const [stars, setStars] = useState(4)
  const [tags, setTags] = useState<string[]>(['delicious', 'hot'])
  const [tip, setTip] = useState<number | null>(2)
  const [customTip, setCustomTip] = useState('')
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

  // The displayed/selected tip — VISUAL only (custom field wins when filled & numeric).
  const customNum = customTip.trim() ? Number(customTip.replace(',', '.')) : NaN
  const effectiveTip = Number.isFinite(customNum) && customNum > 0 ? customNum : tip

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
          {/* tip confirmation only if the user picked a (visual) tip; no money moved */}
          <p>{effectiveTip ? t('thanksTipBody', { amount: formatEuros(effectiveTip, locale) }) : t('thanksBody')}</p>
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

  // Submit label echoes the (visual) selected tip — user's own choice, no charge.
  const submitLabel = effectiveTip
    ? t('submitWithTip', { amount: formatEuros(effectiveTip, locale) })
    : t('submit')

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

        {/* 💶 courier rating + tip — courier is a NEUTRAL placeholder; tip is VISUAL only */}
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
          <div className="ttl" style={{ textAlign: 'start', fontSize: 13, marginBottom: 10 }}>{t('addTip')}</div>
          <div className="pd-tips">
            {TIP_PRESETS.map((amt) => (
              <button
                key={amt}
                type="button"
                className={`pd-tip${tip === amt && !customTip.trim() ? ' on' : ''}`}
                aria-pressed={tip === amt && !customTip.trim()}
                onClick={() => { setTip(amt); setCustomTip('') }}
              >
                <bdi>{formatEuros(amt, locale)}</bdi>
              </button>
            ))}
          </div>
          <div className="tip-custom">
            <span className="ms" aria-hidden="true">euro</span>
            <input
              inputMode="decimal"
              value={customTip}
              onChange={(e) => { setCustomTip(e.target.value); if (e.target.value.trim()) setTip(null) }}
              placeholder={t('tipCustomPlaceholder')}
              aria-label={t('tipCustomPlaceholder')}
            />
          </div>
          <div className="tip-note"><span className="ms" aria-hidden="true">volunteer_activism</span>{t('tipNote')}</div>
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
