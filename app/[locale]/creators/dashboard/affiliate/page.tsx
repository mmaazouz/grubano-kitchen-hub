'use client'

/**
 * CR5 · Affiliation (CreatorShell --op-/--op-cr, CD verbatim). VOLUMES ONLY — this
 * screen NEVER shows € (the gains live on CR6 / « Mes gains »). Built future-proof
 * over the owner-scoped, session-resolved:
 *
 *   GET /api/creator/affiliate-stats
 *   → { isInfluencer, links{base,code,slug}, earnings{…}, referrals{newCustomers,
 *       orders[]}, payout{…}, tier, streak, badges, leaderboard{top[]…}, commissionPct }
 *
 * RE-SKIN = 0 migration, money engine untouched, EVERY fetch/handler byte-identical.
 * Honest surface (founder Option 1): SHOW REAL (no €) → the real referral link (Copier /
 * Partager / vrai QR), « Nouveaux clients » (data.referrals.newCustomers), a recent-
 * activity feed (dates/restaurants only, NO € amounts) and the leaderboard (rank + name +
 * tier from data.leaderboard) OR an honest empty state. « BIENTÔT » inert (no fabricated
 * number): Clics 30 j, Taux de conversion, Commandes générées, dedicated / deep links &
 * « Nouveau lien », and the share-kit visuals / captions. The real QR of the real link is
 * allowed. The screen + its shell tab stay conditional on isInfluencer (clean locked state).
 * 4 states: loading skeleton / error / (non-influencer) locked / empty / loaded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import { buildAffiliateLink, buildAffiliateRestaurantLink } from '@/lib/affiliate-link'
import AffiliateStudio from '@/components/creators/AffiliateStudio'
import '../creator-affiliate.css'

// ── Contract (mirrored locally — the route is the source of truth) ────────────
interface ByMonth { month: string; gainCents: number }
interface AffOrder {
  id: string; date: string; restaurant: string | null; orderTotalCents: number | null
  grubanoFeeCents: number; creatorEarningCents: number; bonusCents: number
  status: 'pending' | 'matured' | 'cancelled' | 'paid' | string; maturedAt: string | null
}
interface AffiliatePayload {
  isInfluencer: boolean
  links:     { base: string | null; code: string | null; slug: string | null }
  earnings:  { maturedCents: number; pendingCents: number; byMonth: ByMonth[] }
  referrals: { newCustomers: number; orders: AffOrder[] }
  payout:    { claimableCents: number; status: string }
  tier:      null | { key: string; floorCents: number; nextKey: string | null; nextFloorCents: number | null; progressPct: number }
  streak:    { weeks: number }
  badges:    { key: string; achieved: boolean }[]
  leaderboard: null | { top: { rank: number; name: string; tierKey: string; isMe: boolean }[]; myRank: number | null; total: number }
  commissionPct: number | null
}
interface Opportunity {
  kind: string
  restaurantId: string
  restaurantName: string
  dishId: string | null
  dishName: string | null
  reasonKey: string
  reasonParams?: Record<string, string | number>
  estimatedGainCents: number
}

export default function AffiliateDashboardPage() {
  const t = useTranslations('creators.affiliate')
  const locale = useLocale()

  const [data, setData]       = useState<AffiliatePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState<string | null>(null)
  const [qrOpen, setQrOpen]   = useState<'base' | 'deep' | null>(null)
  // Deep-link generator: a small restaurant picker (public list, read-only).
  const [restos, setRestos]   = useState<{ id: string; name: string }[]>([])
  const [restoId, setRestoId] = useState('')
  // Slice 2d — « Opportunités du jour » (read-only brief) + the studio preset it
  // fills when the influencer clicks « Générer le contenu » on an opportunity.
  const [opps, setOpps] = useState<Opportunity[] | null>(null)
  const [studioPreset, setStudioPreset] = useState<{ restaurantId: string; dishId?: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/creator/affiliate-stats', { cache: 'no-store' })
      if (res.status === 404) { setError(t('noProfile')); return }
      if (!res.ok) throw new Error('load_failed')
      setData(await res.json() as AffiliatePayload)
    } catch {
      setError(t('errLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  // Opportunities / brief du jour (Slice 2d) — best-effort, read-only heuristic.
  useEffect(() => {
    let cancelled = false
    fetch('/api/creator/affiliate-opportunities', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setOpps(d && Array.isArray(d.opportunities) ? d.opportunities : []) })
      .catch(() => { if (!cancelled) setOpps([]) })
    return () => { cancelled = true }
  }, [])

  // Public restaurant list for the deep-link generator (best-effort, read-only).
  useEffect(() => {
    let cancelled = false
    fetch('/api/restaurants?take=50', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        const list = Array.isArray(d) ? d : (d.restaurants ?? d.items ?? [])
        if (Array.isArray(list)) {
          setRestos(list.filter((x) => x && x.id && x.name).map((x) => ({ id: String(x.id), name: String(x.name) })))
        }
      })
      .catch(() => { /* picker simply stays empty */ })
    return () => { cancelled = true }
  }, [])

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key); setTimeout(() => setCopied(null), 2000)
    } catch { /* clipboard unavailable — no crash */ }
  }

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
    [locale],
  )
  // Relative time for the activity feed ("il y a 2 h") — precursor of live pings.
  const rel = useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return (iso: string) => {
      const diffMs = new Date(iso).getTime() - Date.now()
      const mins = Math.round(diffMs / 60000)
      if (Math.abs(mins) < 60) return rtf.format(mins, 'minute')
      const hrs = Math.round(mins / 60)
      if (Math.abs(hrs) < 24) return rtf.format(hrs, 'hour')
      return rtf.format(Math.round(hrs / 24), 'day')
    }
  }, [locale])

  const slug = data?.links.slug ?? null
  const baseLink = useMemo(() => buildAffiliateLink(slug), [slug])
  const deepLink = useMemo(
    () => (restoId ? buildAffiliateRestaurantLink(slug, restoId, locale) : null),
    [slug, restoId, locale],
  )

  // Tier i18n label (dynamic key → the seed defines every one).
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const tierLabel = (k: string) => t(`tier${cap(k)}`)
  // Initials for the leaderboard avatar (name-based, no fabricated data).
  const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '·'

  // Web-Share for the real link (Copier stays the guaranteed fallback).
  async function share(link: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: t('title'), url: link })
      } else {
        await copy('base', link)
      }
    } catch { /* user cancelled / unavailable — no crash */ }
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 120, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 110, borderRadius: 12 }} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 300, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 300, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{error || t('errLoad')}</p>
          <button className="op-btn-primary" onClick={load}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  // ── Non-influencer → clean locked state ───────────────────────────────────────
  if (!data.isInfluencer) {
    return (
      <section>
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">link</span>
          <b>{t('lockedTitle')}</b>
          <span>{t('lockedBody')}</span>
        </div>
      </section>
    )
  }

  const { referrals } = data

  // ── Empty influencer — no link yet AND no referrals (honest, guided) ──────────
  const isEmpty = !baseLink && !data.links.code && referrals.newCustomers === 0 && referrals.orders.length === 0
  if (isEmpty) {
    return (
      <section>
        <div className="op-dash__head"><div><h1 className="op-dash__title">{t('title')}</h1></div></div>
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">link</span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyBody')}</span>
        </div>
      </section>
    )
  }

  const displayLink = baseLink ?? data.links.code ?? ''

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
      </div>

      {/* ── Hero — real referral link (Copier / Partager / vrai QR) ─────────────── */}
      <div className="op-card aff-hero">
        <h3>{t('heroTitle')}</h3>
        <p>{t('heroDesc')}</p>
        {displayLink ? (
          <>
            <div className="aff-linkbox">
              <span className="url">{displayLink}</span>
              <div className="acts">
                <button type="button" className="aff-copy" onClick={() => copy('base', displayLink)}>
                  <span className="ms" aria-hidden="true">{copied === 'base' ? 'check' : 'content_copy'}</span>
                  {copied === 'base' ? t('copied') : t('heroCopy')}
                </button>
                <button type="button" className="aff-share" title={t('heroShare')} aria-label={t('heroShare')} onClick={() => share(displayLink)}>
                  <span className="ms" aria-hidden="true">share</span>
                </button>
                {baseLink && (
                  <button type="button" className={`aff-share${qrOpen === 'base' ? ' on' : ''}`} title={t('heroQr')} aria-label={t('heroQr')}
                    aria-pressed={qrOpen === 'base'} onClick={() => setQrOpen((v) => (v === 'base' ? null : 'base'))}>
                    <span className="ms" aria-hidden="true">qr_code_2</span>
                  </button>
                )}
              </div>
            </div>
            {qrOpen === 'base' && baseLink && (
              <div className="aff-qr">
                <QRCodeSVG value={baseLink} size={168} includeMargin />
                <p>{t('qrHint')}</p>
              </div>
            )}
          </>
        ) : (
          <div className="lk-soon">
            <span className="ms" aria-hidden="true">hourglass_empty</span>
            <span>{t('noCode')}</span>
          </div>
        )}
      </div>

      {/* ── Stats — VOLUMES ONLY, no €. Only « Nouveaux clients » is real; the volume
          aggregates (clics, commandes générées, taux) are honest « bientôt ». ── */}
      <div className="vol-grid">
        <div className="op-card vol soon">
          <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">ads_click</span></span><span className="vol__label">{t('volClicks')}</span></div>
          <div className="vol__val">—</div>
          <span className="vol__soon">{t('soonBadge')}</span>
        </div>
        <div className="op-card vol soon">
          <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">shopping_bag</span></span><span className="vol__label">{t('volOrders')}</span></div>
          <div className="vol__val">—</div>
          <span className="vol__soon">{t('soonBadge')}</span>
        </div>
        <div className="op-card vol soon">
          <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">percent</span></span><span className="vol__label">{t('volConversion')}</span></div>
          <div className="vol__val">—</div>
          <span className="vol__soon">{t('soonBadge')}</span>
        </div>
        <div className="op-card vol">
          <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">group_add</span></span><span className="vol__label">{t('volNewCustomers')}</span></div>
          <div className="vol__val">{referrals.newCustomers}</div>
          <div className="vol__sub">{t('volNewCustomersSub')}</div>
        </div>
      </div>

      <div className="aff-two">
        {/* ── Vos liens — only the real main link is live; dedicated links = « bientôt ». ── */}
        <div className="op-card card-pad">
          <div className="card-pad__hd">
            <h3>{t('linksTitle')}</h3>
            <span className="op-soon"><span className="ms" aria-hidden="true">add</span>{t('linksNew')}<span className="tag">{t('soonBadge')}</span></span>
          </div>
          <div className="hint">{t('linksHint')}</div>
          <div className="lk-thead"><span>{t('linksColLink')}</span><span>{t('linksColClicks')}</span><span>{t('linksColConv')}</span><span>{t('linksColRate')}</span></div>
          {displayLink && (
            <div className="lk-row">
              <div className="lk-name">
                <span className="lk-ic"><span className="ms" aria-hidden="true">link</span></span>
                <div className="lk-name__t"><b>{t('linksMain')}</b><span>{displayLink}</span></div>
              </div>
              <span className="lk-num lk-clicks">—</span>
              <span className="lk-num lk-conv">—</span>
              <span className="lk-num lk-rate">—</span>
              <span className="lk-mini">{t('linksMiniSoon')}</span>
            </div>
          )}
          {/* Deep-link generator — a real, attributed link to a precise restaurant. */}
          {baseLink && (
            <div className="lk-soon" style={{ borderStyle: 'solid', flexWrap: 'wrap', gap: 10 }}>
              <span className="ms" aria-hidden="true">storefront</span>
              <span style={{ fontWeight: 700, color: 'var(--op-text)' }}>{t('deepLinkTitle')}</span>
              <select value={restoId} onChange={(e) => { setRestoId(e.target.value); setQrOpen(null) }}
                aria-label={t('deepLinkTitle')}
                style={{ flex: 1, minWidth: 180, marginInlineStart: 'auto', border: '1px solid var(--op-border)', background: 'var(--op-surface-2)', borderRadius: 'var(--op-r-sm)', padding: '8px 10px', fontSize: 12.5, color: 'var(--op-text)' }}>
                <option value="">{t('deepLinkPick')}</option>
                {restos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {deepLink && (
                <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span className="url" style={{ flex: 1, minWidth: 180, fontFamily: 'var(--op-font-mono)', fontSize: 12, color: 'var(--op-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'ltr', unicodeBidi: 'isolate' }}>{deepLink}</span>
                  <button type="button" className="aff-copy" onClick={() => copy('deep', deepLink)}>
                    <span className="ms" aria-hidden="true">{copied === 'deep' ? 'check' : 'content_copy'}</span>
                    {copied === 'deep' ? t('copied') : t('heroCopy')}
                  </button>
                  <button type="button" className={`aff-share${qrOpen === 'deep' ? ' on' : ''}`} title={t('heroQr')} aria-label={t('heroQr')}
                    aria-pressed={qrOpen === 'deep'} onClick={() => setQrOpen((v) => (v === 'deep' ? null : 'deep'))}>
                    <span className="ms" aria-hidden="true">qr_code_2</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {qrOpen === 'deep' && deepLink && (
            <div className="aff-qr">
              <QRCodeSVG value={deepLink} size={168} includeMargin />
              <p>{t('qrHint')}</p>
            </div>
          )}
        </div>

        {/* ── Classement créateurs — VOLUMES ONLY, no €. Real rank + name + tier, or empty. ── */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('leaderboardCardTitle')}</h3></div>
          <div className="lb-note"><span className="ms" aria-hidden="true">info</span><span>{t('leaderboardNote')}</span></div>
          {data.leaderboard && data.leaderboard.top.length > 0 ? (
            <>
              {data.leaderboard.top.map((e) => (
                <div key={e.rank} className={`lb-row${e.isMe ? ' me' : ''}`}>
                  <span className="lb-rank">{e.rank}</span>
                  <span className="lb-av">{initials(e.name)}</span>
                  <div className="lb-m"><b>{e.isMe ? t('leaderboardYou', { name: e.name }) : e.name}</b></div>
                  <span className="lb-tier">{tierLabel(e.tierKey)}</span>
                </div>
              ))}
              {data.leaderboard.myRank && data.leaderboard.myRank > data.leaderboard.top.length && (
                <div className="lb-row me">
                  <span className="lb-rank">{data.leaderboard.myRank}</span>
                  <span className="lb-av">{initials(t('leaderboardYou'))}</span>
                  <div className="lb-m"><b>{t('leaderboardYou')}</b></div>
                </div>
              )}
            </>
          ) : (
            <div className="lb-empty">
              <span className="ms" aria-hidden="true">leaderboard</span>
              {t('leaderboardEmpty')}
            </div>
          )}
        </div>
      </div>

      {/* ── Activité récente — dates + restaurants only, NO € (feed of referred orders). ── */}
      {referrals.orders.length > 0 && (
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('activityTitle')}</h3></div>
          <div className="hint">{t('activityHint')}</div>
          {referrals.orders.slice(0, 6).map((o) => (
            <div key={o.id} className="asset-row">
              <span className="asset-ic"><span className="ms" aria-hidden="true">receipt_long</span></span>
              <div className="asset-m">
                <b>{o.restaurant ?? '—'}</b>
                <span>{dateFmt.format(new Date(o.date))}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--op-muted-2)', fontWeight: 600, flexShrink: 0 }}>{rel(o.date)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Kit de partage — le vrai QR est OK (générable) ; visuels / textes = « bientôt ». ── */}
      <div className="op-card card-pad">
        <div className="card-pad__hd"><h3>{t('kitTitle')}</h3></div>
        <div className="hint">{t('kitHint')}</div>
        {baseLink && (
          <div className="asset-row">
            <span className="asset-ic"><span className="ms" aria-hidden="true">qr_code_2</span></span>
            <div className="asset-m"><b>{t('kitQrTitle')}</b><span>{t('kitQrDesc')}</span></div>
            <button type="button" className="asset-dl" onClick={() => setQrOpen((v) => (v === 'base' ? null : 'base'))}>
              <span className="ms" aria-hidden="true">qr_code_2</span>{qrOpen === 'base' ? t('hideQr') : t('showQr')}
            </button>
          </div>
        )}
        <div className="asset-row">
          <span className="asset-ic"><span className="ms" aria-hidden="true">image</span></span>
          <div className="asset-m"><b>{t('kitVisualsTitle')}</b><span>{t('kitVisualsDesc')}</span></div>
          <span className="asset-soon">{t('soonBadge')}</span>
        </div>
        <div className="asset-row">
          <span className="asset-ic"><span className="ms" aria-hidden="true">description</span></span>
          <div className="asset-m"><b>{t('kitCaptionsTitle')}</b><span>{t('kitCaptionsDesc')}</span></div>
          <span className="asset-soon">{t('soonBadge')}</span>
        </div>
      </div>

      {/* ── OPPORTUNITÉS / BRIEF DU JOUR (Slice 2d) — heuristic, READ-ONLY: what's worth
          promoting today. « Générer le contenu » pre-fills the studio (VOLUMES / labels,
          no € shown here). ─────────────────────────────────────────────────────────── */}
      {opps !== null && opps.length > 0 && (
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('oppTitle')}</h3></div>
          <div className="hint">{t('oppDesc')}</div>
          {opps.map((o) => (
            <div key={`${o.kind}-${o.restaurantId}`} className="asset-row">
              <span className="asset-ic"><span className="ms" aria-hidden="true">lightbulb</span></span>
              <div className="asset-m">
                <b>{o.dishName ?? o.restaurantName}</b>
                <span>{o.dishName ? `${o.restaurantName} · ` : ''}{t(o.reasonKey, o.reasonParams ?? {})}</span>
              </div>
              <button type="button" className="asset-dl" onClick={() => setStudioPreset({ restaurantId: o.restaurantId, dishId: o.dishId ?? undefined })}>
                <span className="ms" aria-hidden="true">auto_fix_high</span>{t('oppGenerate')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── STUDIO DE CONTENU IA (Slice 2b) — real feature, pre-fillable from an opportunity. ── */}
      <AffiliateStudio restos={restos} preset={studioPreset} onPresetApplied={() => setStudioPreset(null)} />
    </section>
  )
}
