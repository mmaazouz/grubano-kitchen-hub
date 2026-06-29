'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatCuisineList } from '@/lib/categories'
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
// ⚠️ NEW EPIC — FULLY VISUAL / INERT. There is NO waitlist backend yet (real queue,
// position, ETA, SMS/notif = a future chantier AFTER Wave 5). So:
//   • Only the restaurant IDENTITY is bound to REAL data (name + cuisine, fetched
//     from GET /api/restaurants/[id]). Everything else is a deliberate PLACEHOLDER:
//       – « COMPLET » badge, queue position (~3 / #2), wait time (~25 / ~12 min),
//         the conic-gradient ring fill, and the 3-step progress are HARD-CODED
//         visuals (never presented as real backend numbers).
//       – party-size selector + SMS/notif toggle = inert (visual only).
//       – the « AI found similar tables » alternatives are INERT (« bientôt »).
//   • The CTAs « Rejoindre la liste » / « Quitter la liste » are INERT — they flip a
//     local aria-live status to a « bientôt » message; no network, no mutation.
//   • The data-state="join|queued" toggle is a LOCAL UI switch so both CD states are
//     reachable for design review; it carries no real meaning.
//
// When the waitlist backend lands, this screen binds: real position/ETA from the
// queue service, a real party-size POST, a real notify pref, and real AI re-ranked
// nearby openings — none of which exist today.

type WlState = 'join' | 'queued'

// CD party-size options (« 5+ » is the 5th). INERT — index 1 (« 2 ») pre-selected
// to mirror the CD reference markup exactly.
const PARTY = ['1', '2', '3', '4', '5+']

export default function WaitlistPage() {
  const t = useTranslations('eat.waitlist')
  const locale = useLocale()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const restaurantId = params?.id ?? ''

  const [restoName, setRestoName] = useState<string | null>(null)
  const [cuisine, setCuisine] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Local-only UI state (no backend) — see the file header.
  const [wlState, setWlState] = useState<WlState>('join')
  const [party, setParty] = useState(1) // index — « 2 » selected (CD .sel)
  const [notify, setNotify] = useState(true) // CD switch shown ON
  const [notice, setNotice] = useState('') // aria-live « bientôt » feedback

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
                  <span className="pos">~3</span>
                  <small>{t('beforeYou')}</small>
                </div>
              </div>
              <h2>{t('fullTonight')}</h2>
              <p>{t('joinBody')}</p>
              <span className="eta"><span className="ms" aria-hidden="true">schedule</span>{t('etaEstimate', { min: 25 })}</span>
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
                  <span className="pos">#2</span>
                  <small>{t('inLine')}</small>
                </div>
              </div>
              <h2>{t('soonYours')}</h2>
              <p>{t('queuedBody', { count: 2 })}</p>
              <span className="eta"><span className="ms" aria-hidden="true">schedule</span>{t('etaRemaining', { min: 12 })}</span>
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
            <button type="button" className="wl-btn wl-btn--primary" onClick={() => { setWlState('queued'); soon() }}>
              <span className="ms" aria-hidden="true">hourglass_top</span>{t('joinCta')}
            </button>
          </div>
          <div className="s-queued">
            <button type="button" className="wl-btn wl-btn--primary" onClick={() => restaurantId && router.push(`/eat/r/${restaurantId}`)}>
              <span className="ms" aria-hidden="true">restaurant_menu</span>{t('viewMenuCta')}
            </button>
            <button type="button" className="wl-btn wl-btn--line" onClick={() => { setWlState('join'); soon() }}>
              <span className="ms" aria-hidden="true">close</span>{t('leaveCta')}
            </button>
          </div>
          <p className="sr-only" role="status" aria-live="polite">{notice}</p>
        </div>
      </section>
    </div>
  )
}
