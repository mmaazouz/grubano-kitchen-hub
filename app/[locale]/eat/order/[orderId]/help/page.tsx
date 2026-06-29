'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros, formatAmount } from '@/lib/format-money'
import './help.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` font. The page wraps in
// `.gb` so the foundation tokens/font resolve; all component CSS lives in help.css.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/order/[orderId]/help — « Aide & problème de commande » ────────────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81f5). Three views,
// client-toggled on ONE screen (the CD file ships A active + B/C in its project):
//   A « Aide »          : search + REAL order banner + 3 problem options + topics + contact
//   B « Remboursement » : REAL per-item list (checkboxes) + reason + photo + estimate
//   C « Support »       : chat bubbles + « IA bientôt » pill + composer
//
// REAL DATA (read-only): the order banner + the refund item list come from the REAL
// order via GET /api/orders/[orderId] (restaurant name, ref, items, prices, total,
// status). NO amount is fabricated — the refund estimate is the SUM of the selected
// REAL item prices.
//
// INERT (no live backend — see report):
//  • Refund SUBMIT is inert. A consumer claims/refund backend EXISTS (/api/claims) but
//    is GATED OFF (CLAIMS_ENABLED, default off → 403). With it off there is no live
//    refund path, so the action shows a « bientôt » state and writes NOTHING.
//  • Support chat is inert (no support-chat backend); composer + send are disabled,
//    « Réponses suggérées par l'IA — bientôt » pill is non-interactive.
//  • « Retard » routes to the EXISTING /eat/track; « Annuler » is inert (no cancel API).
//  • Help topics + e-mail/chat contact are inert placeholders (no help-article backend).

interface OrderItem { name: string; qty: number; price: number }
interface Order {
  id: string
  status: string
  total: number
  items: OrderItem[]
  restaurant?: { name?: string } | null
}

type View = 'help' | 'refund' | 'chat'

// Short, human-friendly reference derived from the real id (matches /api/eat/orders).
const refOf = (id: string) => 'GR-' + id.slice(-5).toUpperCase()

export default function OrderHelpScreen() {
  const t = useTranslations('eat.help')
  const locale = useLocale()
  const router = useRouter()
  const { orderId } = useParams<{ orderId: string }>()
  const { status: authStatus } = useSession()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('help')
  // refund view local state — which REAL items are flagged + the description.
  const [selected, setSelected] = useState<Record<number, boolean>>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (authStatus === 'loading') return
    if (authStatus !== 'authenticated') { setLoading(false); return }
    let alive = true
    fetch(`/api/orders/${orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setOrder(d?.order ?? null) })
      .catch(() => { if (alive) setOrder(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [authStatus, orderId])

  const items = useMemo<OrderItem[]>(() => (Array.isArray(order?.items) ? order!.items : []), [order])
  const itemsCount = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 1), 0), [items])
  // Refund estimate = sum of the SELECTED real item prices (× qty). Real data, not invented.
  const estimate = useMemo(
    () => items.reduce((s, it, i) => (selected[i] ? s + it.price * (it.qty ?? 1) : s), 0),
    [items, selected],
  )
  const anySelected = Object.values(selected).some(Boolean)

  const statusLabel = (s?: string) =>
    s === 'received' ? t('statusReceived')
      : s === 'preparing' ? t('statusPreparing')
        : s === 'ready' ? t('statusReady')
          : s === 'picked_up' ? t('statusEnRoute')
            : s === 'delivered' ? t('statusDelivered')
              : s === 'cancelled' ? t('statusCancelled')
                : t('statusReceived')

  const restaurantName = order?.restaurant?.name ?? '—'

  function goBack() {
    if (view !== 'help') { setView('help'); setSubmitted(false); return }
    router.back()
  }

  // ── Not signed in → invite to sign in (the order needs a session) ──────────
  if (authStatus === 'unauthenticated') {
    return (
      <div className="gb gb-help">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
        </div>
        <div className="body">
          <div className="ord" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <b style={{ fontFamily: 'var(--gb-font-display)', fontSize: 15 }}>{t('signInTitle')}</b>
            <button className="submit" type="button" style={{ width: 'auto', padding: '12px 20px' }} onClick={() => router.push('/eat/auth')}>
              <span className="ms" aria-hidden="true">login</span><b>{t('signInCta')}</b>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ VIEW HEADER (shared) ════════════════════════
  const Header = ({ titleKey, online }: { titleKey: string; online?: boolean }) => (
    <div className="bar">
      <button type="button" className="back" onClick={goBack} aria-label={t('back')}>
        <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
      </button>
      <h1>{t(titleKey)}</h1>
      {online && <span className="online">{t('online')}</span>}
    </div>
  )

  // ════════════════════════════ B) REFUND VIEW ══════════════════════════════
  if (view === 'refund') {
    return (
      <div className="gb gb-help">
        <Header titleKey="refundTitle" />
        <div className="body">
          <p className="lbl">{t('refundWhich')}</p>
          <div className="rcard">
            <div className="items">
              {loading ? (
                [0, 1].map((i) => <div key={i} className="sk" style={{ height: 22 }} />)
              ) : items.length ? (
                items.map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    className="it"
                    aria-pressed={!!selected[i]}
                    onClick={() => setSelected((s) => ({ ...s, [i]: !s[i] }))}
                  >
                    <span className={`cb${selected[i] ? ' on' : ''}`}>
                      {selected[i] && <span className="ms" aria-hidden="true">check</span>}
                    </span>
                    <span className="nm">{it.qty > 1 ? `${it.qty}× ${it.name}` : it.name}</span>
                    <span className="pr">{formatEuros(it.price * (it.qty ?? 1), locale)}</span>
                  </button>
                ))
              ) : (
                <span className="nm" style={{ color: 'var(--gb-muted)' }}>{t('refundNoItems')}</span>
              )}
            </div>
          </div>

          <p className="lbl">{t('refundWhat')}</p>
          <div className="field">
            <textarea placeholder={t('refundPlaceholder')} aria-label={t('refundWhat')} />
          </div>

          <button type="button" className="photo">
            <span className="ms" aria-hidden="true">add_a_photo</span>{t('refundAddPhoto')}
          </button>

          {/* Inert — the consumer claims/refund backend is gated OFF (CLAIMS_ENABLED). */}
          <div className="soon">
            <span className="ms" aria-hidden="true">schedule</span>{t('refundSoon')}
            <span className="pill">{t('soonBadge')}</span>
          </div>

          <div className="refund-note">
            <span className="ms" aria-hidden="true">verified_user</span>
            <p>
              {anySelected
                ? t.rich('refundEstimate', { amount: formatAmount(estimate, locale), b: (c) => <b><bdi>{c} €</bdi></b> })
                : t('refundPickToEstimate')}
            </p>
          </div>
        </div>

        <div className="foot">
          <div className="inner">
            <button type="button" className="submit" disabled={!anySelected || submitted} onClick={() => setSubmitted(true)}>
              <span className="ms" aria-hidden="true">{submitted ? 'schedule' : 'send'}</span>
              <b>{submitted ? t('refundSubmittedSoon') : t('refundSubmit')}</b>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ C) SUPPORT CHAT VIEW ════════════════════════
  if (view === 'chat') {
    return (
      <div className="gb gb-help">
        <Header titleKey="supportTitle" online />
        <div className="body chat">
          <div className="chat-date">{t('chatToday')}</div>
          <div className="msg-agent">
            <span className="av"><span className="ms" aria-hidden="true">support_agent</span></span>
            <div className="bub">{t('chatAgent1', { ref: refOf(orderId) })}</div>
          </div>
          <div className="msg-me">{t('chatMe1')}</div>
          <div className="msg-agent">
            <span className="av"><span className="ms" aria-hidden="true">support_agent</span></span>
            <div className="bub">{t('chatAgent2')}</div>
          </div>
          {/* « Réponses suggérées par l'IA — bientôt » — inert, no support/AI backend. */}
          <div className="ai-soon">
            <span className="ms" aria-hidden="true">auto_awesome</span>{t('chatAiSuggest')}
            <span className="pill">{t('soonBadge')}</span>
          </div>
        </div>
        <div className="foot">
          <div className="composer">
            <input placeholder={t('chatPlaceholder')} aria-label={t('chatPlaceholder')} disabled />
            <span className="ms" aria-hidden="true">send</span>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ A) HELP CENTRE VIEW ═════════════════════════
  return (
    <div className="gb gb-help">
      <Header titleKey="title" />
      <div className="body">
        <div className="hp-search">
          <span className="ms" aria-hidden="true">search</span>
          <input placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>

        <p className="lbl">{t('problemLabel')}</p>
        {loading ? (
          <div className="sk" style={{ height: 72, marginBottom: 16 }} />
        ) : (
          <div className="ord">
            <span className="th" />
            <div className="m">
              <b>{restaurantName}</b>
              <span>
                <bdi>{refOf(orderId)}</bdi> · {t('items', { count: itemsCount })} · <bdi>{formatEuros(order?.total ?? 0, locale)}</bdi>
              </span>
            </div>
            <span className="st">{statusLabel(order?.status)}</span>
          </div>
        )}

        <div className="opts">
          <button type="button" className="opt warn" onClick={() => setView('refund')}>
            <span className="ic"><span className="ms" aria-hidden="true">remove_shopping_cart</span></span>
            <div className="t"><b>{t('optMissingTitle')}</b><span>{t('optMissingSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="opt info" onClick={() => router.push(`/eat/track/${orderId}`)}>
            <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
            <div className="t"><b>{t('optLateTitle')}</b><span>{t('optLateSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="opt neutral" onClick={() => setView('chat')}>
            <span className="ic"><span className="ms" aria-hidden="true">cancel</span></span>
            <div className="t"><b>{t('optCancelTitle')}</b><span>{t('optCancelSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <p className="lbl">{t('topicsLabel')}</p>
        <div className="topics">
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">payments</span>
            <span>{t('topicPayments')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">account_circle</span>
            <span>{t('topicAccount')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">redeem</span>
            <span>{t('topicRewards')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <p className="lbl">{t('contactLabel')}</p>
        <div className="contact">
          <button type="button" className="cbtn" onClick={() => setView('chat')}>
            <span className="ms" aria-hidden="true">chat</span>
            <b>{t('contactChat')}</b><span>{t('contactChatEta')}</span>
          </button>
          <button type="button" className="cbtn">
            <span className="ms" aria-hidden="true">mail</span>
            <b>{t('contactEmail')}</b><span>{t('contactEmailEta')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
