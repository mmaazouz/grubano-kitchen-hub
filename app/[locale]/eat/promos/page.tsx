'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/navigation'
import './promos.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/**
 * /eat/promos — « Offres & promos » — VERBATIM reproduction of the FROZEN CD ref
 * (Notion 38efd2c9-…-831f, file eat/offers-promos.html), bound to REAL data via
 * GET /api/eat/promos (the P1 engine: restaurants with ≥ 1 ACTIVE promotion + the
 * real maxPercent / bestFixed across the catalogue). Renders inside the EatShell as
 * an IMMERSIVE (is-bare) screen → carries its OWN top bar + back arrow.
 *
 * REAL-DATA / NEVER-FABRICATE (🔒 promo = ARGENT):
 *  - the « offre du moment » banner figure = the real maxPercent (else bestFixed);
 *    no active promo at all → the banner is dropped.
 *  - each ticket card = a real restaurant promotion (amount/name/condition from the
 *    engine), « Utiliser » → the restaurant (the P1 engine alone applies it at
 *    checkout). The Promotion model carries NO per-user redeemable CODE and NO
 *    expiry on this endpoint → the CD code-chip / expiry are OMITTED (not invented),
 *    and the code-entry box has NO validate backend → it stays a neutral affordance
 *    that only reports « unknown code » (honest .err), never a fake .ok discount.
 *  - zero promos → the CD empty state.
 */

type PromoRestaurant = {
  id: string
  name: string
  city: string
  photo: string | null
  promo: { id: string; name: string; type: string; discount: number; minOrderEur: number | null }
  promoCount: number
}
type PromosPayload = {
  restaurants: PromoRestaurant[]
  totalPromos: number
  maxPercent: number
  bestFixed: number
}

export default function PromosScreen() {
  const t = useTranslations('eat.promos')
  const router = useRouter()
  const [data, setData] = useState<PromosPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/eat/promos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.restaurants)) setData(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // The big figure on a ticket: « 10€ » (fixed) or « 30% » (percent). LTR via <bdi>.
  const amountTop = (p: PromoRestaurant['promo']) =>
    p.type === 'percent' ? `${p.discount}%` : `${p.discount}€`
  const amountSub = (p: PromoRestaurant['promo']) =>
    p.type === 'percent' ? t('amtOff') : t('amtSaved')

  // Card description: real restaurant + city + (optional) real min-order condition.
  const cardDesc = (r: PromoRestaurant) =>
    r.promo.minOrderEur
      ? t('cardDescMin', { city: r.city, min: r.promo.minOrderEur })
      : t('cardDesc', { city: r.city })

  // « Offre du moment » headline from the REAL best active figure across the catalogue.
  const featTitle = (): string | null => {
    const mp = data?.maxPercent ?? 0
    const bf = data?.bestFixed ?? 0
    if (mp > 0) return t('featPercent', { pct: mp })
    if (bf > 0) return t('featFixed', { eur: bf })
    return null
  }

  // No validate endpoint → an entered code can only be reported as not (yet) valid here.
  const applyCode = (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    setCodeErr(true)
  }

  const restaurants = data?.restaurants ?? []
  const feat = !loading ? featTitle() : null
  const isEmpty = !loading && restaurants.length === 0

  return (
    <div className="gb gb-promos">
      <div className="pr-bar">
        <button className="back" type="button" onClick={() => router.back()} aria-label={t('back')}>
          <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
        </button>
        <h1>{t('title')}</h1>
      </div>

      <div className="pr-body">
        {/* ── code entry (no fake success — see header note) ── */}
        <form className="pr-codebox" onSubmit={applyCode}>
          <div className="pr-codein">
            <span className="ms" aria-hidden="true">confirmation_number</span>
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); if (codeErr) setCodeErr(false) }}
              placeholder={t('codePlaceholder')}
              aria-label={t('codePlaceholder')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <button className="pr-applybtn" type="submit" disabled={!code.trim()}>{t('apply')}</button>
        </form>
        {codeErr && (
          <div className="pr-codemsg err">
            <span className="ms" aria-hidden="true">cancel</span>{t('codeInvalid')}
          </div>
        )}

        {loading ? (
          <>
            <div className="sk pr-skfeat" />
            <p className="pr-lbl">{t('availableLabel')}</p>
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="sk pr-skcard" />)}
          </>
        ) : isEmpty ? (
          /* ZERO active promo → the honest empty state, never invented offers. */
          <div className="pr-empty">
            <span className="ms" aria-hidden="true">local_offer</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyBody')}</span>
          </div>
        ) : (
          <>
            {feat && (
              <div className="pr-feat">
                <span className="ms bg" aria-hidden="true">redeem</span>
                <small>{t('featKicker')}</small>
                <b>{feat}</b>
                <p>{t('featBody')}</p>
                <Link href={`/eat/r/${restaurants[0].id}`} className="cta">
                  <span className="ms" style={{ fontSize: 16 }} aria-hidden="true">bolt</span>{t('featCta')}
                </Link>
              </div>
            )}

            <p className="pr-lbl">{t('availableLabel')}</p>
            {restaurants.map((r) => (
              <button
                key={r.id}
                type="button"
                className="pr-card"
                onClick={() => router.push(`/eat/r/${r.id}`)}
              >
                <div className="pr-amt">
                  <b><bdi>{amountTop(r.promo)}</bdi></b>
                  <small>{amountSub(r.promo)}</small>
                </div>
                <div className="pr-m">
                  <b>{r.name}</b>
                  <p>{cardDesc(r)}</p>
                  <div className="meta">
                    <span className="pr-code"><bdi>{r.promo.name}</bdi></span>
                    {r.promoCount > 1 && (
                      <span className="pr-exp">
                        <span className="ms" aria-hidden="true">local_offer</span>
                        {t('moreOffers', { count: r.promoCount - 1 })}
                      </span>
                    )}
                  </div>
                </div>
                <span className="pr-use">{t('use')}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
