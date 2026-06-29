'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { readCart, type EatCartData } from '@/lib/eat-cart'
import { formatEuros } from '@/lib/format-money'
import './group.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/**
 * /eat/group — « Commande de groupe & partage d'addition » — VERBATIM reproduction of
 * the FROZEN CD ref (Notion 38efd2c9-…-8132, file eat/group-order.html). NEW EPIC,
 * FULLY VISUAL / INERT.
 *
 * ⚠ NO BACKEND (future chantier après Wave 5): there is no multi-payer order model, no
 * share link, no real split calculation, no per-payer charge. This screen is a faithful
 * CD shell with INERT controls — exactly like the « bientôt » AI blocks. NOTHING here
 * moves money or creates state:
 *   - « Copier » / share / « Valider ma part » are inert (no invite, no charge).
 *   - the split toggle (« À parts égales » / « Par article ») only flips the visual
 *     selection + the share-box caption/figure (verbatim CD setSplit), NO real math.
 *   - the « Partage intelligent » AI row is a « bientôt » placeholder.
 *
 * REAL-DATA where trivially available, NEVER FABRICATED as a real split:
 *   - the HOST row (« Vous ») and the invite participant count reflect the REAL current
 *     cart (lib/eat-cart) when one exists: the host's item count + dish names + euro
 *     total come straight from the live cart. This is honest (it's the user's own cart,
 *     not an invented charge).
 *   - the « Votre part » figure is a clearly-framed PREVIEW placeholder driven only by
 *     the inert toggle — the real per-payer split is the future epic, so we do NOT
 *     compute or charge it. When a cart exists the « à parts égales » preview shows the
 *     real cart total ÷ the demo party size purely as an illustrative preview (labelled
 *     « aperçu »); with no cart it falls back to the CD placeholder figures verbatim.
 *   - the other participants (Marco / Aisha / Liam) are CD DEMO content — there is no
 *     participant backend to bind them to. The whole screen is framed as a preview.
 */

type Split = 'evenly' | 'byitem'

// CD demo party (placeholders — no participant backend). The host row is overridden by
// the real cart when present; the rest stay as a clearly-framed preview.
const DEMO = {
  hostAmount: 33.0,
  hostItemsCount: 2,
  shareEvenly: 19.25, // CD placeholder « votre part » (à parts égales)
}

export default function GroupOrderScreen() {
  const t = useTranslations('eat.groupOrder')
  const locale = useLocale()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [split, setSplit] = useState<Split>('evenly')

  useEffect(() => {
    // Read the real current cart once (client-side only). No network — lib/eat-cart.
    setCart(readCart())
    setLoading(false)
  }, [])

  // ── HOST row (« Vous ») — bound to the REAL cart when present, else CD demo ──────
  const hostItemsCount = cart ? cart.items.reduce((s, l) => s + l.qty, 0) : DEMO.hostItemsCount
  const hostTotal = cart ? cart.items.reduce((s, l) => s + l.item.price * l.qty, 0) : DEMO.hostAmount
  // First two dish names — the CD host row lists « Tagliatelles, Tiramisu ».
  const hostDishes =
    cart && cart.items.length
      ? cart.items.slice(0, 2).map((l) => l.item.name).join(', ')
      : t('hostDemoDishes')

  // Demo party size for the illustrative preview (CD shows 4 people).
  const partySize = 4
  // « Votre part » PREVIEW figure — inert. With a real cart, the « evenly » preview is
  // the real cart total ÷ party size (illustrative only, labelled « aperçu »); the
  // « byitem » preview shows the host's own total. With no cart → CD placeholders.
  const shareEvenly = cart ? hostTotal / partySize : DEMO.shareEvenly
  const shareByItem = cart ? hostTotal : DEMO.hostAmount
  const shareValue = split === 'evenly' ? shareEvenly : shareByItem
  const isPreview = !!cart // real-cart figures are previews (no real split charge)

  if (loading) {
    return (
      <div className="gb gb-grouporder">
        <div className="sk go-skel" />
      </div>
    )
  }

  return (
    <div className="gb gb-grouporder">
      <section className="go-card">
        {/* ── head: back + title + (inert) share ── */}
        <div className="go-head">
          <button className="lead" type="button" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
          <button className="share" type="button" aria-label={t('shareAria')}>
            <span className="ms" aria-hidden="true">ios_share</span>
          </button>
        </div>

        <div className="go-body">
          {/* ── invite banner (inert link, framed as a preview) ── */}
          <div className="go-invite">
            <span className="ms" aria-hidden="true">group</span>
            <div className="m">
              <b>{t('inviteTitle', { count: partySize })}</b>
              <span><bdi>{t('inviteLink')}</bdi></span>
            </div>
            <button className="copy" type="button">{t('copy')}</button>
          </div>

          {/* ── participants ── */}
          <div className="go-lbl">{t('participants')}</div>

          {/* HOST (« Vous ») — real cart when present */}
          <div className="go-person">
            <span className="av a1">SM</span>
            <div className="who">
              <b>{t('you')} <span className="you">{t('host')}</span></b>
              <span>{t('itemsAnd', { count: hostItemsCount, dishes: hostDishes })}</span>
            </div>
            <span className="amt"><bdi>{formatEuros(hostTotal, locale)}</bdi></span>
          </div>

          {/* DEMO participants (no participant backend → clearly a preview) */}
          <div className="go-person">
            <span className="av a2">MD</span>
            <div className="who">
              <b>{t('demoName1')}</b>
              <span>{t('itemsAnd', { count: 1, dishes: t('demoDishes1') })}</span>
            </div>
            <span className="amt"><bdi>{formatEuros(18, locale)}</bdi></span>
          </div>
          <div className="go-person">
            <span className="av a3">AR</span>
            <div className="who">
              <b>{t('demoName2')}</b>
              <span>{t('itemsAnd', { count: 2, dishes: t('demoDishes2') })}</span>
            </div>
            <span className="amt"><bdi>{formatEuros(26, locale)}</bdi></span>
          </div>
          <div className="go-person">
            <span className="av a2">LW</span>
            <div className="who">
              <b>{t('demoName3')}</b>
              <span className="wait">{t('choosing')}</span>
            </div>
            <span className="amt pending">{t('pending')}</span>
          </div>

          {/* ── split toggle (INERT — visual selection only) ── */}
          <div className="go-split" role="tablist">
            <button role="tab" type="button" aria-selected={split === 'evenly'} onClick={() => setSplit('evenly')}>
              <span className="ms" aria-hidden="true">balance</span>{t('splitEvenly')}
            </button>
            <button role="tab" type="button" aria-selected={split === 'byitem'} onClick={() => setSplit('byitem')}>
              <span className="ms" aria-hidden="true">receipt_long</span>{t('splitByItem')}
            </button>
          </div>

          {/* ── AI « bientôt » (inert) ── */}
          <div className="go-ai">
            <div className="go-ai__in">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <div className="t">
                <div className="h"><b>{t('aiTitle')}</b><span className="soon">{t('soon')}</span></div>
                <p>{t('aiBody')}</p>
              </div>
            </div>
          </div>

          {/* ── your-share box (PREVIEW figure — inert) ── */}
          <div className="go-sharebox">
            <span>
              {t('yourShare')}{' '}
              <span style={{ opacity: 0.7 }}>
                ({split === 'evenly' ? t('splitEvenlyParen') : t('splitByItemParen')}{isPreview ? ` · ${t('previewTag')}` : ''})
              </span>
            </span>
            <b><bdi>{formatEuros(shareValue, locale)}</bdi></b>
          </div>
        </div>

        {/* ── footer: inert validate ── */}
        <div className="go-foot">
          <button className="go-btn" type="button">
            <span className="ms" aria-hidden="true">lock</span>{t('validate')}
          </button>
          <small>{t('footnote')}</small>
        </div>
      </section>
    </div>
  )
}
