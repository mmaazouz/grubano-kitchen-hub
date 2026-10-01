'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import './notifications.css'

// ── /notifications — operator NOTIFICATION CENTER — VERBATIM CD v1 (Notion 390fd2c9-…-537e0f).
//
// ⚠️ APERÇU HONNÊTE — écran NON BRANCHÉ. The real-time notification system is still to be
// built (backend to create). This page renders the CD « loaded » preview: the MANDATORY
// « Aperçu — bientôt » banner stays visible, and every feed row is an ILLUSTRATIVE example
// (labelled by the banner), never a live notification. Payment amounts carry className="mono"
// and are illustrative only. « Tout marquer comme lu » + the filter chips are LOCAL visual
// state only — no fetch, no backend, no fake data presented as real.
//
// Presentation-only re-skin of the legacy MOCK page: the old lucide table of hard-coded
// notifications becomes the CD navy content with Material Symbols. Reached from the topbar
// bell (no sidebar item). The demo bar + setScale/setState/setTheme scripts of the CD are
// dropped; the CD's markAllRead / setFilter are reproduced as React state.

type NotifType = 'orders' | 'reviews' | 'stock' | 'reservations' | 'payments'
type Filter = 'all' | NotifType

interface NotifExample {
  id: string
  type: NotifType
  icon: string
  titleKey: string
  descKey: string
  timeKey: string
  amount?: string // ILLUSTRATIVE payment amount (mono) — never a real figure
  unread: boolean
  day: 'today' | 'yesterday'
}

// Illustrative EXAMPLES (labelled « Aperçu — bientôt » by the banner). Not live data.
const EXAMPLES: NotifExample[] = [
  { id: 'x1', type: 'orders', icon: 'receipt_long', titleKey: 'item.newOrder.title', descKey: 'item.newOrder.desc', timeKey: 'time.min5', amount: '28,40 €', unread: true, day: 'today' },
  { id: 'x2', type: 'reviews', icon: 'reviews', titleKey: 'item.newReview.title', descKey: 'item.newReview.desc', timeKey: 'time.min22', unread: true, day: 'today' },
  { id: 'x3', type: 'stock', icon: 'inventory_2', titleKey: 'item.lowStock.title', descKey: 'item.lowStock.desc', timeKey: 'time.hour1', unread: true, day: 'today' },
  { id: 'x4', type: 'reservations', icon: 'event_seat', titleKey: 'item.reservation.title', descKey: 'item.reservation.desc', timeKey: 'time.hour2', unread: false, day: 'today' },
  { id: 'x5', type: 'payments', icon: 'payments', titleKey: 'item.payout.title', descKey: 'item.payout.desc', timeKey: 'time.hour3', amount: '312,40 €', unread: false, day: 'today' },
  { id: 'x6', type: 'stock', icon: 'inventory_2', titleKey: 'item.supplierOrder.title', descKey: 'item.supplierOrder.desc', timeKey: 'time.yest1820', unread: false, day: 'yesterday' },
  { id: 'x7', type: 'orders', icon: 'receipt_long', titleKey: 'item.cancelled.title', descKey: 'item.cancelled.desc', timeKey: 'time.yest1410', unread: false, day: 'yesterday' },
  { id: 'x8', type: 'reviews', icon: 'reviews', titleKey: 'item.review4.title', descKey: 'item.review4.desc', timeKey: 'time.yest0940', unread: false, day: 'yesterday' },
]

const FILTERS: { key: Filter; icon?: string }[] = [
  { key: 'all' },
  { key: 'orders', icon: 'receipt_long' },
  { key: 'reviews', icon: 'reviews' },
  { key: 'stock', icon: 'inventory_2' },
  { key: 'reservations', icon: 'event_seat' },
  { key: 'payments', icon: 'payments' },
]

// Preferences rows (visual only — no backend). [app, email, sms] default states.
const PREFS: { key: string; app: boolean; email: boolean; sms: boolean }[] = [
  { key: 'orders', app: true, email: true, sms: false },
  { key: 'reviews', app: true, email: false, sms: false },
  { key: 'stock', app: true, email: true, sms: false },
  { key: 'reservations', app: true, email: false, sms: true },
  { key: 'payments', app: true, email: true, sms: false },
]

export default function NotificationsPage() {
  const t = useTranslations('operator.notif')

  const [filter, setFilter] = useState<Filter>('all')
  const [readAll, setReadAll] = useState(false) // local visual state — no backend

  const unread = useMemo(
    () => (readAll ? 0 : EXAMPLES.filter((n) => n.unread).length),
    [readAll],
  )

  const visible = EXAMPLES.filter((n) => filter === 'all' || n.type === filter)
  const today = visible.filter((n) => n.day === 'today')
  const yesterday = visible.filter((n) => n.day === 'yesterday')

  const renderItem = (n: NotifExample) => {
    const isUnread = n.unread && !readAll
    return (
      <div key={n.id} className={`notif-item${isUnread ? ' is-unread' : ''}`}>
        <span className={`notif-ic t-${n.type}`}>
          <span className="ms" aria-hidden="true">{n.icon}</span>
        </span>
        <div className="notif-body">
          <div className="notif-body__top">
            <b>{t(n.titleKey)}</b>
            <span className="notif-time">{t(n.timeKey)}</span>
          </div>
          <p>
            {n.amount ? (
              t.rich(n.descKey, {
                amt: () => <span className="notif-amt mono">{n.amount}</span>,
              })
            ) : (
              t(n.descKey)
            )}
          </p>
        </div>
        {isUnread && <span className="unread-dot" aria-hidden="true" />}
      </div>
    )
  }

  return (
    <section className="op-notif-wrap">
      <div className="notif-head-row">
        <div className="notif-head-l">
          <h1 className="op-dash__title" style={{ margin: 0 }}>{t('title')}</h1>
          <span className="unread-count mono">{t('unread', { count: unread })}</span>
        </div>
        <button type="button" className="op-btn-ghost" onClick={() => setReadAll(true)} disabled={unread === 0}>
          <span className="ms" aria-hidden="true">done_all</span>{t('markAll')}
        </button>
      </div>

      {/* APERÇU HONNÊTE — MANDATORY banner, stays until the real system exists */}
      <div className="preview-banner">
        <span className="ms" aria-hidden="true">notifications_active</span>
        <div className="m">
          <b>{t('banner.title')}</b>
          <p>{t('banner.body')}</p>
        </div>
        <span className="tag">{t('banner.tag')}</span>
      </div>

      {/* filter chips — local visual state */}
      <div className="notif-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
          >
            {f.icon && <span className="ms" aria-hidden="true">{f.icon}</span>}
            {t(`filter.${f.key}`)}
          </button>
        ))}
      </div>

      {/* feed — grouped by day. All rows are ILLUSTRATIVE examples. */}
      <div className="op-card" style={{ marginBottom: 18 }}>
        {today.length > 0 && (
          <>
            <div className="day-label" style={{ padding: '14px 18px 0' }}>{t('today')}</div>
            <div className="notif-list">{today.map(renderItem)}</div>
          </>
        )}
        {yesterday.length > 0 && (
          <>
            <div className="day-label" style={{ padding: '0 18px' }}>{t('yesterday')}</div>
            <div className="notif-list">{yesterday.map(renderItem)}</div>
          </>
        )}
      </div>

      {/* preferences — VISUAL only, no backend */}
      <div className="op-card">
        <div className="op-card__head">
          <h2><span className="ms" aria-hidden="true">tune</span>{t('prefs.title')}</h2>
        </div>
        <div className="pref-head-row">
          <span>{t('prefs.event')}</span>
          <span>{t('prefs.inApp')}</span>
          <span>{t('prefs.email')}</span>
          <span>{t('prefs.sms')}</span>
        </div>
        {PREFS.map((p) => (
          <div key={p.key} className="pref-row">
            <span className="lbl">{t(`prefs.row.${p.key}`)}</span>
            <div className="switches">
              <div className="sw">
                <label className="op-switch"><input type="checkbox" defaultChecked={p.app} /><span className="track" /></label>
                <span>{t('prefs.inApp')}</span>
              </div>
              <div className="sw">
                <label className="op-switch"><input type="checkbox" defaultChecked={p.email} /><span className="track" /></label>
                <span>{t('prefs.email')}</span>
              </div>
              <div className="sw">
                <label className="op-switch"><input type="checkbox" defaultChecked={p.sms} /><span className="track" /></label>
                <span>{t('prefs.sms')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
