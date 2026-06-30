'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatCuisineList } from '@/lib/categories'
import { showToast } from '@/lib/eat-cart'
import './waitlist.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/r/[id]/waitlist ──────────────────────────────────────────────────────
//
// CONSUMER « Liste d'attente » (restos complets). VERBATIM re-skin of the FROZEN CD
// ref (Notion 38efd2c9-…-8167, eat/waitlist.html) onto the gb- foundation + Material
// Symbols. Renders inside EatShell in is-bare / immersive mode (route /eat/r/ is
// IMMERSIVE → desktop rail kept, no top bar; this page's header governs), exactly
// like /eat/r/[id]/reserver. CONTENT only — never duplicates the nav shell.
//
// P2-WAITLIST — the queue is now REAL (join/leave + live position/total).
//   • Restaurant IDENTITY is REAL (name + cuisine, GET /api/restaurants/[id]).
//   • The queue is REAL via /api/restaurants/[id]/waitlist (session-gated, owner-scoped,
//     @@unique([restaurantId, userId])):
//       – GET on mount (if authenticated) → an existing 'waiting' entry flips wlState to
//         'queued' with my REAL #position; else 'join' showing the REAL total waiting.
//       – party-size selector → REAL partySize (index 0..4 → 1,2,3,4,5; '5+' → 5).
//       – SMS/notif toggle → REAL `notify` preference (PERSISTED only — the actual
//         SMS/notification SENDING is a later chantier, Wave 5).
//       – Join CTA → POST (guests get a login toast); Leave CTA → DELETE.
//   • ETA is a transparent heuristic estimate (Math.max(5, position*8) min) — clearly a
//     « ~ » estimate, not a backend SLA.
//   • KEPT INERT (no backend): the « COMPLET » badge, the conic-gradient ring fill, the
//     3-step progress visual, and the « AI found similar tables » alternatives (no
//     re-ranking backend) — these still flip a local aria-live « bientôt » message.

type WlState = 'join' | 'queued'

// CD party-size options (« 5+ » is the 5th). Index 0..4 maps to a REAL partySize of
// 1,2,3,4,5 (« 5+ » → 5). Index 1 (« 2 ») pre-selected to mirror the CD markup.
const PARTY = ['1', '2', '3', '4', '5+']
// index → real party size sent to the API.
const partySizeFor = (i: number) => Math.min(i + 1, 5)

export default function WaitlistPage() {
  const t = useTranslations('eat.waitlist')
  const locale = useLocale()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const restaurantId = params?.id ?? ''
  const { status: authStatus } = useSession()
  const isAuthed = authStatus === 'authenticated'

  const [restoName, setRestoName] = useState<string | null>(null)
  const [cuisine, setCuisine] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // UI state. wlState/position/total are driven by the REAL queue API; party + notify
  // are the REAL join inputs. notice = aria-live « bientôt » feedback (inert visuals).
  const [wlState, setWlState] = useState<WlState>('join')
  const [party, setParty] = useState(1) // index — « 2 » selected (CD .sel)
  const [notify, setNotify] = useState(true) // CD switch shown ON
  const [notice, setNotice] = useState('') // aria-live « bientôt » feedback
  const [position, setPosition] = useState(0) // my 1-based rank when queued
  const [total, setTotal] = useState(0) // total people waiting
  const [busy, setBusy] = useState(false) // join/leave in-flight guard

  // REAL data — the restaurant this waitlist is for (identity only).
  useEffect(() => {
    if (!restaurantId) { setLoading(false); return }
    let alive = true
    setLoading(true)
    fetch(`/api/restaurants/${restaurantId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setRestoName(d?.restaurant?.name ?? null)
        setCuisine(Array.isArray(d?.restaurant?.cuisine) ? d.restaurant.cuisine : [])
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [restaurantId])

  // « Italien · $$ · 1,2 km » — only the cuisine is real; the price tier + distance
  // are NOT available on this screen, so we keep the CD placeholder tail verbatim.
  const restoMeta = useMemo(
    () => `${formatCuisineList(cuisine, locale, t('cuisineFallback'))} · ${t('metaPlaceholder')}`,
    [cuisine, locale, t],
  )

  const soon = () => setNotice(t('soon'))

  // REAL queue — read my entry + the live numbers. Authenticated only (401 for guests).
  const refresh = useCallback(async () => {
    if (!restaurantId || !isAuthed) return
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/waitlist`)
      if (!r.ok) return
      const d = await r.json()
      setTotal(typeof d?.total === 'number' ? d.total : 0)
      if (d?.entry) {
        setWlState('queued')
        setPosition(typeof d?.position === 'number' ? d.position : 0)
        if (typeof d.entry.partySize === 'number') {
          setParty(Math.max(0, Math.min(4, d.entry.partySize - 1)))
        }
        if (typeof d.entry.notify === 'boolean') setNotify(d.entry.notify)
      } else {
        setWlState('join')
        setPosition(0)
      }
    } catch { /* keep current UI on a transient failure */ }
  }, [restaurantId, isAuthed])

  // On mount (once auth is resolved + the resto id is known), sync the real queue state.
  useEffect(() => { void refresh() }, [refresh])

  // Join CTA → real POST (guests get a login toast).
  const join = useCallback(async () => {
    if (!isAuthed) { showToast(t('loginToJoin')); return }
    if (!restaurantId || busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/restaurants/${restaurantId}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partySize: partySizeFor(party), notify }),
      })
      if (!r.ok) { showToast(t('joinError')); return }
      const d = await r.json()
      setWlState('queued')
      setPosition(typeof d?.position === 'number' ? d.position : 0)
      setTotal(typeof d?.total === 'number' ? d.total : 0)
    } catch {
      showToast(t('joinError'))
    } finally {
      setBusy(false)
    }
  }, [isAuthed, restaurantId, busy, party, notify, t])

  // Leave CTA → real DELETE.
  const leave = useCallback(async () => {
    if (!restaurantId || busy) return
    setBusy(true)
    try {
      await fetch(`/api/restaurants/${restaurantId}/waitlist`, { method: 'DELETE' })
      setWlState('join')
      setPosition(0)
      await refresh()
    } catch {
      showToast(t('joinError'))
    } finally {
      setBusy(false)
    }
  }, [restaurantId, busy, refresh, t])

  // Real numbers shown in the dials. join « ~N » = total waiting; queued « #N » = my
  // position. ETA = a transparent heuristic (~ position×8 min, min 5).
  const joinBefore = total
  const etaMinutes = Math.max(5, (position || 1) * 8)

  return (
    <div className="gb gb-waitlist" data-state={wlState}>
      <section className="wl">
        {/* header */}
        <div className="wl__head">
          <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
        </div>

        <div className="wl__body">
          {/* restaurant identity (REAL name + cuisine; « COMPLET » + distance = placeholder) */}
          <div className="rst">
            <span className="img" />
            <div className="m">
              <b>
                {loading ? <span className="sk sk-line lg" style={{ width: 120 }} /> : <bdi>{restoName ?? t('restaurantFallback')}</bdi>}
                <span className="full">{t('full')}</span>
              </b>
              <span><bdi>{restoMeta}</bdi></span>
            </div>
          </div>

          {/* ── JOIN state ───────────────────────────────────────────────────── */}
          <div className="s-join">
            <div className="dial">
              <div className="dial__ring">
                <div className="dial__in">
                  <span className="pos">~{joinBefore}</span>
                  <small>{t('beforeYou')}</small>
                </div>
              </div>
              <h2>{t('fullTonight')}</h2>
              <p>{t('joinBody')}</p>
              <span className="eta"><span className="ms" aria-hidden="true">schedule</span>{t('etaEstimate', { min: Math.max(5, (joinBefore || 1) * 8) })}</span>
            </div>

            <div className="field">
              <div className="lbl">{t('partyLabel')}</div>
              <div className="party" role="group" aria-label={t('partyLabel')}>
                {PARTY.map((p, i) => (
                  <span key={p} className={i === party ? 'sel' : undefined} onClick={() => setParty(i)}>{p}</span>
                ))}
              </div>
            </div>

            <div className="notify">
              <span className="ms" aria-hidden="true">sms</span>
              <div className="m">
                <b>{t('notifyTitle')}</b>
                <span>{t('notifyBody')}</span>
              </div>
              <span
                className="switch"
                role="switch"
                aria-checked={notify}
                aria-label={t('notifyTitle')}
                tabIndex={0}
                onClick={() => setNotify((v) => !v)}
                style={notify ? undefined : { background: 'var(--gb-border-strong)' }}
              >
                <i style={notify ? undefined : { insetInlineEnd: 'auto', insetInlineStart: 2 }} />
              </span>
            </div>
          </div>

          {/* ── QUEUED state ─────────────────────────────────────────────────── */}
          <div className="s-queued">
            <div className="live"><i />{t('inQueue')}</div>
            <div className="dial">
              <div className="dial__ring queued">
                <div className="dial__in">
                  <span className="pos">#{position || 1}</span>
                  <small>{t('inLine')}</small>
                </div>
              </div>
              <h2>{t('soonYours')}</h2>
              <p>{t('queuedBody', { count: Math.max(0, (position || 1) - 1) })}</p>
              <span className="eta"><span className="ms" aria-hidden="true">schedule</span>{t('etaRemaining', { min: etaMinutes })}</span>
            </div>

            <div className="steps" aria-hidden="true">
              <span className="d on" /><span className="s on" />
              <span className="d cur" /><span className="s" />
              <span className="d" />
            </div>

            <div className="lbl2">
              {t('whileWaiting')}
              <span className="ai-tag"><span className="ms" style={{ fontSize: 12 }} aria-hidden="true">auto_awesome</span>{t('soonTag')}</span>
            </div>

            {/* INERT AI suggestions — visual only (no real re-ranking backend) */}
            <button type="button" className="alt" onClick={soon} style={{ border: 'none', cursor: 'pointer', width: '100%' }}>
              <span className="alt__in">
                <span className="img g" />
                <span className="m"><b><bdi>Casa Caldo</bdi></b><span>{t('altMeta1')}</span></span>
                <span className="open">{t('open')}</span>
              </span>
            </button>
            <button type="button" className="alt" onClick={soon} style={{ border: 'none', cursor: 'pointer', width: '100%' }}>
              <span className="alt__in">
                <span className="img b" />
                <span className="m"><b><bdi>Verde Bowl</bdi></b><span>{t('altMeta2')}</span></span>
                <span className="open">{t('open')}</span>
              </span>
            </button>
          </div>
        </div>

        {/* footer (INERT CTAs) */}
        <div className="wl__foot">
          <div className="s-join">
            <button type="button" className="wl-btn wl-btn--primary" onClick={join} disabled={busy}>
              <span className="ms" aria-hidden="true">hourglass_top</span>{t('joinCta')}
            </button>
          </div>
          <div className="s-queued">
            <button type="button" className="wl-btn wl-btn--primary" onClick={() => restaurantId && router.push(`/eat/r/${restaurantId}`)}>
              <span className="ms" aria-hidden="true">restaurant_menu</span>{t('viewMenuCta')}
            </button>
            <button type="button" className="wl-btn wl-btn--line" onClick={leave} disabled={busy}>
              <span className="ms" aria-hidden="true">close</span>{t('leaveCta')}
            </button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">{notice}</p>
        </div>
      </section>
    </div>
  )
}
