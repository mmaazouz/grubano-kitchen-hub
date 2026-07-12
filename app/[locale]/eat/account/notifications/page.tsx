'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { showToast } from '@/lib/eat-cart'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './notifications.css'

// /eat/account/notifications — « Préférences de notifications » (consumer). VERBATIM
// reproduction of the FROZEN CD ref (Notion 38efd2c9-…-644055ce, file
// eat/notification-preferences.html). Renders INSIDE the EatShell with the `is-bare`
// (immersive) treatment, so the shell drops its own header → this page supplies its own
// back-bar. Material Symbols (not lucide); --gb-* tokens; design CSS in notifications.css.
//
// ⚠️ REAL-DATA VERDICT — INERT, NO BACKEND. Wave 5 (consumer notifications) is NOT built:
// there is NO notification-preferences backend, NO sending pipeline, NO persistence. So
// every toggle/channel here is VISUAL local state that resets on reload; nothing is saved
// and no endpoint is called. The whole screen is framed as a « bientôt » preview (header
// pill) so we don't fabricate persisted prefs. The CD's `.sw.dis` behaviour (a row greys
// out when its parent channel is OFF) is reproduced so the preview reads correctly.
//
// The CD's generic `.row`/`.group`/`.body`/`.bar`/`.lbl`/`.sw` collide with nothing in the
// foundation once scoped under `.gb-notifprefs`, but `.bar`/`.body`/`.row`/`.group` are
// renamed to `.np-*` to stay clear of any future generic + match the addresses pattern.

type Channel = 'push' | 'email' | 'sms'

const CHANNELS: { key: Channel; icon: string }[] = [
  { key: 'push', icon: 'notifications' },
  { key: 'email', icon: 'mail' },
  { key: 'sms', icon: 'sms' },
]

// Order + marketing rows (CD verbatim icons/copy → i18n keys).
const ORDER_ROWS = [
  { key: 'status', icon: 'local_shipping' },
  { key: 'courier', icon: 'near_me' },
  { key: 'reviews', icon: 'rate_review' },
] as const
const MARKETING_ROWS = [
  { key: 'offers', icon: 'sell' },
  { key: 'newResto', icon: 'restaurant' },
  { key: 'rewards', icon: 'redeem' },
] as const

type RowKey =
  | (typeof ORDER_ROWS)[number]['key']
  | (typeof MARKETING_ROWS)[number]['key']

export default function NotificationsPrefsPage() {
  const t = useTranslations('eat.notifPrefs')
  const router = useRouter()

  // INERT local state — initial values mirror the CD mock (Push/E-mail ON, SMS OFF; the
  // toggle defaults below match the CD's `.sw.on`). NOT persisted, NOT fetched.
  const [channels, setChannels] = useState<Record<Channel, boolean>>({
    push: true,
    email: true,
    sms: false,
  })
  const [rows, setRows] = useState<Record<RowKey, boolean>>({
    status: true,
    courier: true,
    reviews: false,
    offers: true,
    newResto: false,
    rewards: true,
  })
  const [quiet, setQuiet] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstSave = useRef(true)

  // Load the saved preferences (P1-NOTIFPREF). A guest (401) keeps the CD defaults.
  useEffect(() => {
    let alive = true
    fetch('/api/eat/account', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.notifPrefs || typeof d.notifPrefs !== 'object') return
        const p = d.notifPrefs as {
          channels?: Partial<Record<Channel, boolean>>
          rows?: Partial<Record<RowKey, boolean>>
          quiet?: boolean
        }
        if (p.channels) setChannels((c) => ({ ...c, ...p.channels }))
        if (p.rows) setRows((r) => ({ ...r, ...p.rows }))
        if (typeof p.quiet === 'boolean') setQuiet(p.quiet)
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  // Auto-save (debounced) on any change after load. Skips the initial load-triggered run
  // (never re-saves the just-loaded values or toasts on open). A guest's PATCH 401s → silent.
  useEffect(() => {
    if (!loaded) return
    if (firstSave.current) { firstSave.current = false; return }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      fetch('/api/eat/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notifPrefs: { channels, rows, quiet } }),
      })
        .then((r) => { if (r.ok) showToast(t('saved')) })
        .catch(() => {})
    }, 600)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [channels, rows, quiet, loaded, t])

  // A channel-row is « dis » (greyed, inert) only when EVERY channel is cut — there is no
  // way to receive the notif at all. Mirrors the CD `.sw.dis` "parent channel coupé" note.
  const noChannel = !channels.push && !channels.email && !channels.sms

  const toggleChannel = (k: Channel) =>
    setChannels((c) => ({ ...c, [k]: !c[k] }))
  const toggleRow = (k: RowKey) => {
    if (noChannel) return
    setRows((r) => ({ ...r, [k]: !r[k] }))
  }

  return (
    <div className="gb gb-notifprefs">
      <main className="screen">
        {/* OWN back-bar — the shell is `is-bare` on this route, so the page header governs. */}
        <div className="np-bar">
          <button type="button" className="np-back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h2>{t('title')}</h2>
          <span className="np-soon-top">{t('soon')}</span>
        </div>

        <div className="np-body">
          {/* Preview banner — makes the « not persisted yet » framing explicit (no CD ref;
              on-brand, replaces nothing). */}
          <div className="np-preview">
            <span className="ms" aria-hidden="true">info</span>
            <span>{t('previewNote')}</span>
          </div>

          {/* ── Canaux ── */}
          <p className="np-lbl">{t('channels')}</p>
          <div className="chans">
            {CHANNELS.map((c) => {
              const on = channels[c.key]
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`chan${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleChannel(c.key)}
                >
                  <span className="ms" aria-hidden="true">{c.icon}</span>
                  <b>{t(`channel_${c.key}`)}</b>
                  <small>{on ? t('on') : t('off')}</small>
                </button>
              )
            })}
          </div>

          {/* ── Commandes ── */}
          <p className="np-lbl">{t('groupOrders')}</p>
          <div className="np-group" aria-disabled={noChannel}>
            {ORDER_ROWS.map((r) => (
              <div className="np-row" key={r.key}>
                <span className="ic"><span className="ms" aria-hidden="true">{r.icon}</span></span>
                <div className="m">
                  <b>{t(`row_${r.key}`)}</b>
                  <span>{t(`row_${r.key}_sub`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!noChannel && rows[r.key]}
                  aria-label={t(`row_${r.key}`)}
                  className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel ? ' dis' : ''}`}
                  onClick={() => toggleRow(r.key)}
                >
                  <i />
                </button>
              </div>
            ))}
          </div>

          {/* ── Promotions & marketing ── */}
          <p className="np-lbl">{t('groupMarketing')}</p>
          <div className="np-group" aria-disabled={noChannel}>
            {MARKETING_ROWS.map((r) => (
              <div className="np-row" key={r.key}>
                <span className="ic"><span className="ms" aria-hidden="true">{r.icon}</span></span>
                <div className="m">
                  <b>{t(`row_${r.key}`)}</b>
                  <span>{t(`row_${r.key}_sub`)}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!noChannel && rows[r.key]}
                  aria-label={t(`row_${r.key}`)}
                  className={`sw${!noChannel && rows[r.key] ? ' on' : ''}${noChannel ? ' dis' : ''}`}
                  onClick={() => toggleRow(r.key)}
                >
                  <i />
                </button>
              </div>
            ))}
          </div>

          {/* ── Résumé intelligent — INERT (bientôt), no toggle ── */}
          <div className="aibox">
            <span className="ms" aria-hidden="true">auto_awesome</span>
            <div className="m">
              <b>{t('aiTitle')}</b>
              <span>{t('aiSub')}</span>
            </div>
            <span className="soon">{t('soon')}</span>
          </div>

          {/* ── Ne pas déranger ── */}
          <p className="np-lbl">{t('groupQuiet')}</p>
          <div className="quiet">
            <span className="ms" aria-hidden="true">bedtime</span>
            <div className="m">
              <b>{t('quietTitle')}</b>
              <span>{t('quietRange')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={quiet}
              aria-label={t('quietTitle')}
              className={`sw${quiet ? ' on' : ''}`}
              onClick={() => setQuiet((v) => !v)}
            >
              <i />
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
