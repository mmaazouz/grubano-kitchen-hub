'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { readCart, showToast, type EatCartData } from '@/lib/eat-cart'
import { formatEuros } from '@/lib/format-money'
import './group.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/**
 * /eat/group — « Partage d'addition » — P2-GROUP **Model A: SPLIT CALCULATOR**.
 *
 * Model A in one line: the HOST pays the FULL bill via the EXISTING checkout, and the
 * shares shown here are a CLIENT-SIDE calculation the host settles with friends OUTSIDE
 * the app (cash / virement / Lydia…). There is NO multi-payer order, NO per-friend
 * charge, NO backend, NO schema. We split the host's OWN real cart — we do NOT fabricate
 * participants who add their own items.
 *
 * ⚠ NON-MONEY screen. It NEVER mutates the cart, never calls placeOrder, never hits
 * /api/orders. The single money action is the footer CTA, which simply routes to the
 * existing /eat/cart (byte-identical checkout) where the host pays everything.
 *
 * CENT-EXACT guarantee: every amount is computed in INTEGER CENTS off the live cart
 * subtotal (Σ item.price × qty — item.price already includes supplements). The shares
 * always sum EXACTLY to the cart total; the host's row (« Toi ») absorbs any rounding
 * remainder so no cent is created or lost.
 *
 *   • EVENLY  — base = floor(totalCents / partySize) per person; the leftover cents
 *               (totalCents − base × partySize) are added to the host's share.
 *   • BY-ITEM — each cart line is assigned to a person (cycle Toi → Invité 2 … →
 *               partySize); a person's share = Σ of their lines' cents. Unassigned lines
 *               are « à assigner » and excluded from every share until assigned.
 *
 * The « Partage intelligent » AI row stays inert (« bientôt »).
 */

type SplitMode = 'evenly' | 'byitem'

/** Sum of a cart, expressed in integer CENTS (item.price already includes supplements). */
function cartCents(cart: EatCartData): number {
  return cart.items.reduce((s, l) => s + Math.round(l.item.price * l.qty * 100), 0)
}

/** Per-line cents for one cart line. */
function lineCents(line: EatCartData['items'][number]): number {
  return Math.round(line.item.price * line.qty * 100)
}

const AV_CLASSES = ['a1', 'a2', 'a3'] as const
/** Avatar palette class for person index p (0 = host). Cycles the 3 CD swatches. */
function avClass(p: number): string {
  return AV_CLASSES[p % AV_CLASSES.length]
}

export default function GroupSplitScreen() {
  const t = useTranslations('eat.groupOrder')
  const locale = useLocale()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [cart, setCart] = useState<EatCartData | null>(null)
  const [mode, setMode] = useState<SplitMode>('evenly')
  const [partySize, setPartySize] = useState(2) // EVENLY party size (2..8)
  // BY-ITEM: assignment[lineIndex] = personIndex (0 = host/Toi), or -1 = unassigned.
  const [assign, setAssign] = useState<number[]>([])

  useEffect(() => {
    // Read the real current cart once (client-side only). No network — lib/eat-cart.
    const c = readCart()
    setCart(c)
    setAssign(c ? c.items.map(() => -1) : [])
    setLoading(false)
  }, [])

  // Person label for index p: 0 → « Toi », else « Invité {n} » (n = p + 1).
  const personLabel = (p: number) => (p === 0 ? t('selfLabel') : t('guestLabel', { n: p + 1 }))

  // ── total (cents) ───────────────────────────────────────────────────────────
  const totalCents = useMemo(() => (cart ? cartCents(cart) : 0), [cart])

  // ── EVENLY shares (cents) — host absorbs the rounding remainder ──────────────
  const evenlyShares = useMemo<number[]>(() => {
    if (!cart) return []
    const base = Math.floor(totalCents / partySize)
    const remainder = totalCents - base * partySize
    return Array.from({ length: partySize }, (_, p) => (p === 0 ? base + remainder : base))
  }, [cart, totalCents, partySize])

  // ── BY-ITEM shares (cents) — sum of each person's assigned lines ─────────────
  const byItemShares = useMemo<number[]>(() => {
    if (!cart) return []
    // People present in BY-ITEM = host + every assigned guest index (≥ 1).
    const maxPerson = assign.reduce((m, p) => (p > m ? p : m), 0)
    const people = Array.from({ length: maxPerson + 1 }, () => 0)
    cart.items.forEach((line, i) => {
      const p = assign[i]
      if (p >= 0) people[p] += lineCents(line)
    })
    return people
  }, [cart, assign])

  const unassignedCount = useMemo(
    () => (mode === 'byitem' ? assign.filter((p) => p < 0).length : 0),
    [mode, assign],
  )

  // Rows to render under « Participants » (cents per person).
  const rows = mode === 'evenly' ? evenlyShares : byItemShares
  // « Ta part » = the host's (index 0) own share.
  const yourShareCents = rows.length ? rows[0] : 0

  // Cycle a cart line through Toi → Invité 2 … → partySize-of-people → « à assigner ».
  // In BY-ITEM the people count follows the EVENLY partySize control so the two
  // modes share one notion of « combien de personnes ».
  const cycleAssign = (lineIndex: number) => {
    setAssign((prev) => {
      const next = [...prev]
      const cur = next[lineIndex]
      // sequence: -1 (à assigner) → 0 (Toi) → 1 … → partySize-1 → back to -1
      next[lineIndex] = cur + 1 >= partySize ? -1 : cur + 1
      return next
    })
  }

  // ── Footer CTA: the host pays the FULL bill via the EXISTING checkout ─────────
  const payFullBill = () => router.push('/eat/cart')

  // ── Copy a plain-text recap of the split ─────────────────────────────────────
  const buildSummary = (): string => {
    const lines = rows.map((c, p) => `${personLabel(p)} : ${formatEuros(c / 100, locale)}`)
    const total = `${t('summaryTotalLabel')} : ${formatEuros(totalCents / 100, locale)}`
    return [t('summaryHeader'), ...lines, total].join('\n')
  }

  const copySummary = async () => {
    if (!cart) return
    const text = buildSummary()
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        showToast(t('copied'))
        return
      }
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ text })
        return
      }
      showToast(t('copyUnavailable'))
    } catch {
      // user dismissed the share sheet, or clipboard denied → honest fallback toast
      showToast(t('copyUnavailable'))
    }
  }

  if (loading) {
    return (
      <div className="gb gb-grouporder">
        <div className="sk go-skel" />
      </div>
    )
  }

  // ── EMPTY STATE: no cart → invite the user to add items first ────────────────
  if (!cart || cart.items.length === 0) {
    return (
      <div className="gb gb-grouporder">
        <section className="go-card">
          <div className="go-head">
            <button className="lead" type="button" onClick={() => router.back()} aria-label={t('back')}>
              <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
            </button>
            <h1>{t('title')}</h1>
            <span className="share" aria-hidden="true" style={{ visibility: 'hidden' }} />
          </div>
          <div className="go-body">
            <div className="go-empty">
              <span className="ms" aria-hidden="true">receipt_long</span>
              <b>{t('emptyCartTitle')}</b>
              <p>{t('emptyCartBody')}</p>
              <button className="go-btn" type="button" onClick={() => router.push('/eat')}>
                {t('emptyCartCta')}
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="gb gb-grouporder">
      <section className="go-card">
        {/* ── head: back + title + share (copies the recap) ── */}
        <div className="go-head">
          <button className="lead" type="button" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
          <button className="share" type="button" aria-label={t('shareAria')} onClick={copySummary}>
            <span className="ms" aria-hidden="true">ios_share</span>
          </button>
        </div>

        <div className="go-body">
          {/* ── Model A note: the host pays everything; shares are for splitting ── */}
          <div className="go-invite">
            <span className="ms" aria-hidden="true">info</span>
            <div className="m">
              <b>{t('hostPaysTitle')}</b>
              <span>{t('hostPaysNote')}</span>
            </div>
          </div>

          {/* ── party-size control (drives the EVENLY split & the BY-ITEM people) ── */}
          <div className="go-party">
            <span className="lbl">{t('partySizeLabel')}</span>
            <div className="stepper" role="group" aria-label={t('partySizeLabel')}>
              <button
                type="button"
                aria-label={t('partyMinus')}
                disabled={partySize <= 2}
                onClick={() => setPartySize((n) => Math.max(2, n - 1))}
              >
                <span className="ms" aria-hidden="true">remove</span>
              </button>
              <b aria-live="polite">{partySize}</b>
              <button
                type="button"
                aria-label={t('partyPlus')}
                disabled={partySize >= 8}
                onClick={() => setPartySize((n) => Math.min(8, n + 1))}
              >
                <span className="ms" aria-hidden="true">add</span>
              </button>
            </div>
          </div>

          {/* ── split toggle (REAL — switches the calculation) ── */}
          <div className="go-split" role="tablist" aria-label={t('splitModeAria')}>
            <button role="tab" type="button" aria-selected={mode === 'evenly'} onClick={() => setMode('evenly')}>
              <span className="ms" aria-hidden="true">balance</span>{t('splitEvenly')}
            </button>
            <button role="tab" type="button" aria-selected={mode === 'byitem'} onClick={() => setMode('byitem')}>
              <span className="ms" aria-hidden="true">receipt_long</span>{t('splitByItem')}
            </button>
          </div>

          {/* ── BY-ITEM: per-cart-line person picker ── */}
          {mode === 'byitem' && (
            <>
              <div className="go-lbl">{t('assignLabel')}</div>
              {unassignedCount > 0 && <p className="go-hint">{t('assignHint', { count: unassignedCount })}</p>}
              {cart.items.map((line, i) => {
                const p = assign[i]
                const assigned = p >= 0
                return (
                  <button
                    key={`${line.item.id}-${i}`}
                    type="button"
                    className={`go-assign${assigned ? '' : ' is-unassigned'}`}
                    onClick={() => cycleAssign(i)}
                  >
                    <div className="who">
                      <b>{line.item.name}</b>
                      <span>{t('lineQty', { qty: line.qty })} · <bdi>{formatEuros(lineCents(line) / 100, locale)}</bdi></span>
                    </div>
                    <span className={`pick${assigned ? '' : ' is-unassigned'}`}>
                      {assigned ? personLabel(p) : t('unassigned')}
                    </span>
                  </button>
                )
              })}
            </>
          )}

          {/* ── per-person shares ── */}
          <div className="go-lbl">{t('participants')}</div>
          {rows.map((cents, p) => (
            <div className="go-person" key={p}>
              <span className={`av ${avClass(p)}`}>{p + 1}</span>
              <div className="who">
                <b>
                  {personLabel(p)}
                  {p === 0 && <span className="you">{t('host')}</span>}
                </b>
                {p === 0 && <span>{t('hostRowNote')}</span>}
              </div>
              <span className="amt"><bdi>{formatEuros(cents / 100, locale)}</bdi></span>
            </div>
          ))}

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

          {/* ── « Ta part » summary (the host's own real share) ── */}
          <div className="go-sharebox">
            <span>
              {t('yourShare')}{' '}
              <span style={{ opacity: 0.7 }}>
                ({mode === 'evenly' ? t('splitEvenlyParen') : t('splitByItemParen')})
              </span>
            </span>
            <b><bdi>{formatEuros(yourShareCents / 100, locale)}</bdi></b>
          </div>

          {/* ── copy the recap (clipboard → share → toast fallback) ── */}
          <button className="go-copy" type="button" onClick={copySummary}>
            <span className="ms" aria-hidden="true">content_copy</span>{t('copySummary')}
          </button>
        </div>

        {/* ── footer: the host pays the FULL bill via the existing checkout ── */}
        <div className="go-foot">
          <button className="go-btn" type="button" onClick={payFullBill}>
            <span className="ms" aria-hidden="true">lock</span>{t('payFullBill')}
          </button>
          <small>{t('footnote')}</small>
        </div>
      </section>
    </div>
  )
}
