'use client'

/**
 * /dinein — operator SERVICE À TABLE (Dine-in) screen. VERBATIM CD v1 LOT 4
 * (Notion 390fd2c9-8146-81ac-8be7-c62a5679a381). ⚠️ APERÇU PHASE-3, NON CÂBLÉ.
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome). This
 * component renders ONLY the screen content = a <section> inside op-content. There is
 * no dedicated sidebar entry for /dinein → « Réservations & Salle » (→ /tables) stays
 * active in the rail; nothing is force-activated here (acceptable, per the CD note).
 *
 * ⚠️ HONEST PREVIEW. The real-time table-ordering service does NOT exist yet (phase 3,
 * tied to the kitchen / KDS). The « Aperçu — bientôt » banner is MANDATORY and visible
 * in both the empty AND loaded states, and every ticket below is explicitly labelled as
 * an EXAMPLE — never presented as a live feed.
 *
 * 🔒 PRESENTATION ONLY — nothing here moves money or is billed.
 *   • No /api/tickets/* is called (those serve the /tables « Addition » tab). No Stripe.
 *   • The service (10% of the subtotal) is shown as an EXAMPLE aligned on the consumer
 *     G1 rate — it is NOT actively billed here (phase C1; the real rate lives in
 *     Restaurant.dineInServiceRatePct on the backend, never hardcoded as a live charge).
 *   • The example amounts are already-final EUR floats, DISPLAYED via formatEuros —
 *     never recomputed here. Each carries className="mono" (RTL-safe via the shell).
 *   • « Voir le ticket » opens a VISUAL ticket modal (local state). « Encaisser » /
 *     « Marquer comme servi » / split views are INERT — no real charge is issued.
 *   • The REAL « Gérer les réservations » → /tables link is preserved.
 *
 * The old page rendered hardcoded counters (3/6 tables, 18 min, 5 plats), 6 hardcoded
 * QR codes and « Imprimer » buttons AS IF live. Those fabricated live-looking figures
 * are NOT reproduced as such: the whole surface is an explicit preview (« exemple » /
 * « aperçu » / « bientôt »), and the inert QR/print controls are dropped.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import './dinein.css'

type Establishment = { id: string; name: string; city: string | null; isActive: boolean }

// ── EXAMPLE preview data (illustrative — NOT a live feed, NOT billed). Amounts are
// already-final EUR floats displayed straight via formatEuros; the 10% service line is
// a pre-computed example (0.10 × subtotal), shown only to illustrate the future layout.
type ExampleTable = {
  id: string
  num: string
  status: 'ordering' | 'served' | 'tocharge'
  covers: number
  openedAt: string
  itemsPreview: string
  subtotal: number
  service: number
  total: number
}

const EXAMPLE_TABLES: ExampleTable[] = [
  { id: 't4',  num: 'Table 4',     status: 'ordering', covers: 2, openedAt: '19:12', itemsPreview: 'Truffle Tagliatelle, Cacio e Pepe, 2× eau plate…',             subtotal: 36.0,  service: 3.6,  total: 39.6  },
  { id: 't7',  num: 'Table 7',     status: 'served',   covers: 4, openedAt: '12:30', itemsPreview: 'Margherita DOP, Diavola, Tiramisu ×2, 4× soda…',              subtotal: 68.5,  service: 6.85, total: 75.35 },
  { id: 't12', num: 'Table 12',    status: 'tocharge', covers: 6, openedAt: '13:00', itemsPreview: 'Osso Buco, Risotto ai Funghi ×2, Saltimbocca…',                subtotal: 148.0, service: 14.8, total: 162.8 },
  { id: 't2',  num: 'Table 2',     status: 'ordering', covers: 2, openedAt: '20:05', itemsPreview: 'Burrata & tomates confites, Lasagne della Nonna…',            subtotal: 31.0,  service: 3.1,  total: 34.1  },
  { id: 't9',  num: 'Table 9',     status: 'served',   covers: 3, openedAt: '19:40', itemsPreview: 'Cacio e Pepe, Quattro Formaggi, Panna Cotta…',                 subtotal: 42.5,  service: 4.25, total: 46.75 },
  { id: 't15', num: 'Table 14+15', status: 'tocharge', covers: 8, openedAt: '20:00', itemsPreview: 'Groupe entreprise — carte partagée, plusieurs plats…',        subtotal: 214.0, service: 21.4, total: 235.4 },
]

// Example ticket lines for the modal (illustrative, matches the CD Table 12 ticket).
const EXAMPLE_TICKET = {
  lines: [
    { qty: '2×', name: 'Osso Buco',                 price: 48.0 },
    { qty: '2×', name: 'Risotto ai Funghi',         price: 35.0 },
    { qty: '1×', name: 'Saltimbocca alla Romana',   price: 22.0 },
    { qty: '1×', name: 'Burrata & tomates confites', price: 12.0 },
    { qty: '3×', name: 'Chianti Classico (verre)',  price: 21.0 },
    { qty: '6×', name: 'Eau plate / gazeuse',       price: 10.0 },
  ],
  subtotal: 148.0,
  service: 14.8,
  total: 162.8,
  splitEqual: 27.13,
  splitPerson: [32.5, 32.5, 24.6, 24.6, 24.3, 24.3],
}

export default function DineInPage() {
  const t = useTranslations('operator')
  const locale = useLocale()

  const [establishments, setEstablishments] = useState<Establishment[] | null>(null)

  // Ticket modal — VISUAL / INERT (no /api/tickets, no Stripe). Local UI only.
  const [ticket, setTicket] = useState<{ num: string; meta: string } | null>(null)
  const [split, setSplit] = useState<'none' | 'equal' | 'person'>('none')

  // Establishment shape drives ONLY the honest onboarding (N=0) state. No dine-in feed
  // exists yet, so a failure just proceeds to the preview (never a blocking error).
  useEffect(() => {
    fetch('/api/establishments', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEstablishments(d && Array.isArray(d.establishments) ? d.establishments : []))
      .catch(() => setEstablishments([]))
  }, [])

  // DISPLAY-only EUR formatting (locale-aware). Never mutates a value.
  const eur = useMemo(() => (n: number) => formatEuros(n ?? 0, locale), [locale])

  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
    [locale],
  )

  function openTicket(num: string, meta: string) {
    setSplit('none')
    setTicket({ num, meta })
  }

  // ── loading skeleton (mirrors CD .op-skel) ──
  if (establishments === null) {
    return (
      <section aria-busy="true">
        <div style={{ marginBottom: 18 }}><span className="op-sk" style={{ width: 160, height: 22 }} /></div>
        <span className="op-sk" style={{ width: '100%', height: 56, borderRadius: 12, marginBottom: 18, display: 'block' }} />
        <div className="op-card" style={{ marginBottom: 18 }}>
          <div style={{ padding: 18, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span className="op-sk" style={{ width: 100, height: 34 }} /><span className="op-sk" style={{ width: 100, height: 34 }} />
            <span className="op-sk" style={{ width: 100, height: 34 }} /><span className="op-sk" style={{ width: 100, height: 34 }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          <span className="op-sk" style={{ width: '100%', height: 220, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 220, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 220, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── onboarding (N=0) — no establishment yet ──
  if (establishments.length === 0) {
    return (
      <section>
        <div className="op-center">
          <div className="op-onb__card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/grubano-symbol-color.svg" alt="" />
            <h1>{t('onb.title')}</h1>
            <p>{t('onb.body')}</p>
            <Link href="/dashboard/establishments" className="op-onb__cta">
              <span className="ms" aria-hidden="true">add_business</span>{t('onb.cta')}
            </Link>
            <div className="op-onb__steps">
              <div className="step"><span className="n">1</span><b>{t('onb.s1t')}</b><span>{t('onb.s1d')}</span></div>
              <div className="step"><span className="n">2</span><b>{t('onb.s2t')}</b><span>{t('onb.s2d')}</span></div>
              <div className="step"><span className="n">3</span><b>{t('onb.s3t')}</b><span>{t('onb.s3d')}</span></div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const aggLabel = establishments.length > 1 ? `${t('dash.agg', { count: establishments.length })} · ` : ''

  // ── loaded PREVIEW (honest — banner mandatory, tickets are examples) ──
  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('dinein.title')}</h1>
          <p className="op-dash__sub"><span className="op-agg-label">{aggLabel}</span>{dateLabel}</p>
        </div>
        <button type="button" className="op-refresh" onClick={() => location.reload()}>
          <span className="ms" aria-hidden="true">refresh</span>{t('dash.refresh')}
        </button>
      </div>

      {/* ══ MANDATORY preview banner — never let this look live ══ */}
      <div className="preview-banner">
        <span className="ms" aria-hidden="true">visibility</span>
        <div className="m">
          <b>{t('dinein.previewTitle')}</b>
          <p>{t('dinein.previewBody')}</p>
        </div>
        <span className="tag">{t('soon')}</span>
      </div>

      {/* ══ EXAMPLE stats strip (mono) — illustrative, NOT a live count ══ */}
      <div className="op-card stat-strip" style={{ marginBottom: 18 }}>
        <div className="stat"><span className="lbl">{t('dinein.statTables')}</span><b className="mono">6</b></div>
        <div className="stat"><span className="lbl">{t('dinein.statCovers')}</span><b className="mono">22</b></div>
        <div className="stat"><span className="lbl">{t('dinein.statAvgTicket')}</span><b className="mono">{eur(52.4)}</b></div>
        <div className="stat"><span className="lbl">{t('dinein.statTotal')}</span><b className="mono">{eur(314.6)}</b></div>
      </div>

      {/* ══ EXAMPLE open-tables grid ══ */}
      <div className="tables-grid">
        {EXAMPLE_TABLES.map((tb) => {
          const meta = t('dinein.tableMeta', { covers: tb.covers, time: tb.openedAt })
          return (
            <div className="tb-card" key={tb.id}>
              <div className="tb-card__top">
                <span className="tnum">{tb.num}</span>
                <span className={`op-pill ${tb.status}`}><i className="dot" />{t(`dinein.status.${tb.status}`)}</span>
              </div>
              <div className="tb-card__meta">
                <span className="ms" aria-hidden="true">groups</span>{t('dinein.covers', { count: tb.covers })}
                <span className="ms" aria-hidden="true" style={{ marginInlineStart: 6 }}>schedule</span>{t('dinein.openedAt', { time: tb.openedAt })}
              </div>
              <div className="tb-items">{tb.itemsPreview}</div>
              <div className="tb-lines">
                <div className="row"><span>{t('dinein.subtotal')}</span><span className="tb-amt mono">{eur(tb.subtotal)}</span></div>
                <div className="row"><span>{t('dinein.serviceExample')}</span><span className="tb-amt mono">{eur(tb.service)}</span></div>
                <div className="row total"><span>{t('dinein.total')}</span><span className="tb-amt mono">{eur(tb.total)}</span></div>
              </div>
              <div className="tb-card__actions">
                <button type="button" className="tb-btn" onClick={() => openTicket(tb.num, meta)}>
                  <span className="ms" aria-hidden="true">receipt_long</span>{t('dinein.viewTicket')}
                </button>
                {tb.status === 'tocharge' && (
                  <button type="button" className="tb-btn primary" onClick={() => openTicket(tb.num, meta)}>
                    <span className="ms" aria-hidden="true">payments</span>{t('dinein.charge')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ══ REAL link — « Gérer les réservations » → /tables (preserved) ══ */}
      <Link href="/tables" className="op-dinein__link">
        <span className="ic"><span className="ms" aria-hidden="true">event_seat</span></span>
        <div className="m">
          <b>{t('dinein.manageResa')}</b>
          <span>{t('dinein.manageResaSub')}</span>
        </div>
        <span className="ms chev" aria-hidden="true">chevron_right</span>
      </Link>

      {/* ══ TICKET modal — VISUAL / INERT (example ticket, no Stripe, no /api/tickets) ══ */}
      <div className={`op-modal-backdrop${ticket ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setTicket(null) }}>
        <div className="op-modal" role="dialog" aria-modal="true">
          <div className="op-modal__head">
            <h3>{t('dinein.ticketTitle')}</h3>
            <button type="button" className="op-modal__close" onClick={() => setTicket(null)} aria-label={t('dinein.close')}>
              <span className="ms" aria-hidden="true">close</span>
            </button>
          </div>
          <div className="op-modal__body">
            <div className="tk-table-meta">
              <span className="ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
              <div className="m"><b>{ticket?.num}</b><span>{ticket?.meta}</span></div>
            </div>

            {/* Example ticket lines (illustrative) */}
            <div className="tk-items">
              {EXAMPLE_TICKET.lines.map((l, i) => (
                <div className="tk-row" key={i}>
                  <span className="qty mono">{l.qty}</span>
                  <span className="name">{l.name}</span>
                  <span className="price mono">{eur(l.price)}</span>
                </div>
              ))}
            </div>

            <div className="tk-total">
              <div className="row"><span>{t('dinein.subtotal')}</span><span className="mono">{eur(EXAMPLE_TICKET.subtotal)}</span></div>
              <div className="row"><span>{t('dinein.serviceLineExample')}</span><span className="mono">{eur(EXAMPLE_TICKET.service)}</span></div>
              <div className="row grand"><span>{t('dinein.total')}</span><b className="mono">{eur(EXAMPLE_TICKET.total)}</b></div>
            </div>

            {/* Split selector — VISUAL example only */}
            <div className="op-seg">
              <button type="button" className={split === 'none' ? 'is-active' : undefined} onClick={() => setSplit('none')}>{t('dinein.splitOne')}</button>
              <button type="button" className={split === 'equal' ? 'is-active' : undefined} onClick={() => setSplit('equal')}>{t('dinein.splitEqual')}</button>
              <button type="button" className={split === 'person' ? 'is-active' : undefined} onClick={() => setSplit('person')}>{t('dinein.splitPerson')}</button>
            </div>
            <div className={`split-view${split === 'equal' ? ' active' : ''}`}>
              <div className="split-row"><span className="name">{t('dinein.perPerson', { count: EXAMPLE_TICKET.splitPerson.length })}</span><span className="split-amt mono">{eur(EXAMPLE_TICKET.splitEqual)}</span></div>
            </div>
            <div className={`split-view${split === 'person' ? ' active' : ''}`}>
              {EXAMPLE_TICKET.splitPerson.map((amt, i) => (
                <div className="split-row" key={i}><span className="name">{t('dinein.person', { n: i + 1 })}</span><span className="split-amt mono">{eur(amt)}</span></div>
              ))}
            </div>

            {/* HONEST: preview — service/split are backend-computed; Stripe charge not active */}
            <div className="op-callout">
              <span className="ms" aria-hidden="true">info</span>
              <p>{t('dinein.ticketNote')}</p>
            </div>
          </div>
          <div className="op-modal__foot">
            {/* INERT — no live status mutation / no Stripe charge on this preview */}
            <button type="button" className="op-btn-ghost" disabled aria-disabled="true">
              <span className="ms" aria-hidden="true" style={{ fontSize: 15, verticalAlign: -3, marginInlineEnd: 4 }}>check_circle</span>{t('dinein.markServed')}
            </button>
            <button type="button" className="op-btn-primary" disabled aria-disabled="true">
              <span className="ms" aria-hidden="true">payments</span>{t('dinein.charge')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
