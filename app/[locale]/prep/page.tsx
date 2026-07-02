'use client'

/**
 * /prep — operator CUISINE (KDS) screen. VERBATIM CD v1 LOT 5 (Notion 390fd2c9-…-c0a6).
 * ⚠️ APERÇU HONNÊTE (phase 3) — NO BACKEND, NO STATE MACHINE.
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome, « Cuisine »
 * active in the rail + mobile bottom-nav). This component renders ONLY the screen content =
 * a <section> inside op-content.
 *
 * 🔒 HONEST PREVIEW. The real-time kitchen display (live feed of accepted-order tickets,
 * per-item bump, station routing, wiring back into the Orders state machine) is a phase-3
 * build — NOT connected. There is NO fetch and NO real transition here. A « bientôt »
 * preview banner is KEPT visible in the empty AND loaded states, and every figure/timer is
 * an ILLUSTRATIVE example (labelled « exemple »), never presented as live data.
 *
 * The « Prêt » bump and « Remettre en cours » undo mutate LOCAL React state only (DOM demo,
 * same behaviour as the CD's bumpTicket/undoTicket) — they do NOT call any API and do NOT
 * touch the Orders state machine. No money on this screen (it's the kitchen). All figures
 * carry className="mono" (RTL-safe: direction:ltr;unicode-bidi:isolate applied in prep.css).
 *
 * Legacy screen was already a local-state mock (checkbox prep list). Re-skinned to the CD KDS
 * board; no data logic to preserve (there was never any backend for this route).
 */

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import './prep.css'

type Channel = 'delivery' | 'pickup' | 'dinein'
type Status = 'open' | 'ready'
type Age = 'fresh' | 'warn' | 'late'

interface KitItem {
  qty: number
  name: string
  note?: { icon: string; text: string }
}
interface KitTicket {
  id: string
  num: string
  channel: Channel
  channelLabelRaw?: string // dine-in shows « Table 6 » (raw); others use the i18n channel label
  timer: string // ILLUSTRATIVE example string (mono)
  age: Age
  status: Status
  items: KitItem[]
}

// ILLUSTRATIVE demo tickets — « exemple » (mirrors the CD board 1:1). NOT live data:
// no fetch, no state machine. Purely to preview the phase-3 kitchen display.
const DEMO_TICKETS: KitTicket[] = [
  {
    id: 't1', num: '#1042', channel: 'delivery', timer: '4 min', age: 'fresh', status: 'open',
    items: [
      { qty: 1, name: 'Truffle Tagliatelle', note: { icon: 'warning', text: 'sans noix' } },
      { qty: 1, name: 'Tiramisu' },
    ],
  },
  {
    id: 't2', num: '#1043', channel: 'dinein', channelLabelRaw: 'Table 6', timer: '12 min', age: 'warn', status: 'open',
    items: [
      { qty: 2, name: 'Margherita DOP', note: { icon: 'local_fire_department', text: 'bien cuite' } },
      { qty: 1, name: 'Panna Cotta' },
    ],
  },
  {
    id: 't3', num: '#1039', channel: 'pickup', timer: '18 min', age: 'warn', status: 'open',
    items: [
      { qty: 1, name: 'Diavola', note: { icon: 'warning', text: 'sans piment' } },
      { qty: 1, name: 'Quattro Formaggi' },
      { qty: 1, name: 'Tiramisu' },
    ],
  },
  {
    id: 't4', num: '#1036', channel: 'delivery', timer: '26 min', age: 'late', status: 'open',
    items: [
      { qty: 1, name: 'Osso Buco' },
      { qty: 1, name: 'Risotto ai Funghi', note: { icon: 'warning', text: 'allergie fruits de mer — vérifier' } },
    ],
  },
  {
    id: 't5', num: '#1040', channel: 'delivery', timer: '2 min', age: 'fresh', status: 'ready',
    items: [
      { qty: 1, name: 'Lasagne della Nonna' },
      { qty: 2, name: 'Cacio e Pepe' },
    ],
  },
  {
    id: 't6', num: '#1028', channel: 'pickup', timer: '8 min', age: 'fresh', status: 'ready',
    items: [
      { qty: 2, name: 'Gnocchi Sorrentina' },
    ],
  },
]

const CHANNEL_ICON: Record<Channel, string> = { delivery: 'moped', pickup: 'shopping_bag', dinein: 'table_restaurant' }

export default function PrepPage() {
  const t = useTranslations('operator')
  const locale = useLocale()

  // Local demo state ONLY — no backend, no state machine, no fetch.
  const [tickets, setTickets] = useState<KitTicket[]>(DEMO_TICKETS)
  const [filter, setFilter] = useState<'all' | 'open' | 'ready'>('all')

  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    [locale],
  )

  const openCount = tickets.filter(t => t.status === 'open').length
  const readyCount = tickets.filter(t => t.status === 'ready').length

  const shown = tickets.filter(t => filter === 'all' || t.status === filter)

  // DOM demo — local state only, NO fetch, NO Orders state-machine transition (phase 3).
  const bump = (id: string) =>
    setTickets(ts => ts.map(t => (t.id === id ? { ...t, status: 'ready', age: 'fresh', timer: t.timer } : t)))
  const undo = (id: string) =>
    setTickets(ts => ts.map(t => (t.id === id ? { ...t, status: 'open', age: 'warn' } : t)))

  const channelLabel = (tk: KitTicket) =>
    tk.channelLabelRaw ?? t(`kitchen.channel.${tk.channel}`)

  return (
    <section className="op-kit">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('kitchen.title')}</h1>
        <p className="op-dash__sub">
          <span className="op-agg-label">{t('kitchen.aggPrefix')}</span>{dateLabel}
        </p>
      </div>

      {/* Honest « bientôt » preview banner — KEPT while the real-time KDS does not exist */}
      <div className="preview-banner">
        <span className="ms" aria-hidden="true">skillet</span>
        <div className="m">
          <b>{t('kitchen.previewTitle')}</b>
          <p>{t('kitchen.previewBody')}</p>
        </div>
        <span className="tag">{t('soon')}</span>
      </div>

      {/* Stats strip — ILLUSTRATIVE examples (mono), not live data */}
      <div className="op-card stat-strip">
        <div className="stat">
          <span className="lbl">{t('kitchen.statOpen')}</span>
          <b className="mono">{String(openCount)}</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('kitchen.statAvg')}</span>
          <b className="mono">14 min</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('kitchen.statOldest')}</span>
          <b className="mono alert">26 min</b>
        </div>
      </div>

      {/* Filters — Tous / En cours / Prêts (+ mono counts) */}
      <div className="kit-filters">
        <button
          type="button"
          className={filter === 'all' ? 'is-active' : undefined}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          {t('kitchen.filterAll')} <span className="cnt">{String(tickets.length)}</span>
        </button>
        <button
          type="button"
          className={filter === 'open' ? 'is-active' : undefined}
          onClick={() => setFilter('open')}
          aria-pressed={filter === 'open'}
        >
          {t('kitchen.filterOpen')} <span className="cnt">{String(openCount)}</span>
        </button>
        <button
          type="button"
          className={filter === 'ready' ? 'is-active' : undefined}
          onClick={() => setFilter('ready')}
          aria-pressed={filter === 'ready'}
        >
          {t('kitchen.filterReady')} <span className="cnt">{String(readyCount)}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">soup_kitchen</span>
            <b>{t('kitchen.emptyTitle')}</b>
            <span>{t('kitchen.emptyBody')}</span>
          </div>
        </div>
      ) : (
        <div className="tickets-grid">
          {shown.map(tk => {
            const stateCls = tk.status === 'ready' ? 'ready' : tk.age
            return (
              <div key={tk.id} className={`kt-card ${stateCls}`} data-status={tk.status}>
                <div className="kt-top">
                  <span className="kt-num">{tk.num}</span>
                  <span className={`kt-channel ${tk.channel}`}>
                    <span className="ms" aria-hidden="true">{CHANNEL_ICON[tk.channel]}</span>
                    {channelLabel(tk)}
                  </span>
                  <span className="kt-timer mono">
                    <span className="ms" aria-hidden="true">{tk.status === 'ready' ? 'check' : 'schedule'}</span>
                    {tk.timer}
                  </span>
                </div>
                <div className="kt-items">
                  {tk.items.map((it, i) => (
                    <div className="kt-item" key={i}>
                      <span className="qty mono">{it.qty}×</span>
                      <div className="m">
                        <b>{it.name}</b>
                        {it.note && (
                          <span className="note">
                            <span className="ms" aria-hidden="true">{it.note.icon}</span>
                            {it.note.text}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="kt-foot">
                  {tk.status === 'ready' ? (
                    <>
                      <div className="kt-ready-tag">
                        <span className="ms" aria-hidden="true">check_circle</span>
                        {t('kitchen.ready')}
                      </div>
                      <button type="button" className="kt-undo" onClick={() => undo(tk.id)}>
                        {t('kitchen.undo')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="kt-bump" onClick={() => bump(tk.id)}>
                      <span className="ms" aria-hidden="true">check_circle</span>
                      {t('kitchen.bump')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
