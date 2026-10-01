'use client'

/**
 * AF2 · Mes liens (AffiliateShell --op-/--op-af teal, CD verbatim). Calque of CR5
 * (creators/dashboard/affiliate) — VOLUMES ONLY: this screen NEVER shows € (the gains
 * live on AF3/AF4). Owner-scoped, session-resolved:
 *
 *   GET /api/affiliate/stats
 *   → { enabled, links{base,code,slug}, referrals{newCustomers, orders[]},
 *       leaderboard{top[{rank,name,tierKey,isMe}], myRank, total}, … }
 *
 * RE-SKIN = 0 migration, money engine untouched, the stats route byte-identical.
 * Honest surface (Option 1, like CR5): SHOW REAL (no €) → the real referral link
 * (Copier / Partager / real QR) + « Nouveaux clients » (referrals.newCustomers) + the
 * leaderboard (rank + name + tier from data.leaderboard) OR an honest empty state.
 * « BIENTÔT » inert (no fabricated number): Clics 30 j / Commandes générées / Taux de
 * conversion, per-link clicks/conv/rate, « Nouveau lien » (dedicated links), per-affiliate
 * volume in the leaderboard, and the share-kit visuals / captions. The real QR of the real
 * link is allowed. 4 states: loading / error / empty / loaded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { QRCodeSVG } from 'qrcode.react'
import { buildAffiliateLink } from '@/lib/affiliate-link'

interface AffOrder { id: string; date: string; restaurant: string | null; status: string }
interface Payload {
  links:     { base: string | null; code: string | null; slug: string | null }
  referrals: { newCustomers: number; orders: AffOrder[] }
  leaderboard: null | { top: { rank: number; name: string; tierKey: string; isMe: boolean }[]; myRank: number | null; total: number }
}

export default function AffiliateLinksClient() {
  const t = useTranslations('affiliate.links')
  const locale = useLocale()

  const [data, setData]       = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)
  const [qrOpen, setQrOpen]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/affiliate/stats', { cache: 'no-store' })
      if (res.status === 404) { setError(t('noProfile')); return }
      if (!res.ok) throw new Error('load_failed')
      setData((await res.json()) as Payload)
    } catch {
      setError(t('errorBody'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const slug     = data?.links.slug ?? null
  const baseLink = useMemo(() => buildAffiliateLink(slug), [slug])

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const tierLabel = (k: string) => t(`tier${cap(k)}` as 'tierBronze')
  const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '·'

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }
  async function share(link: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) { await navigator.share({ title: t('title'), url: link }) }
      else { await copy(link) }
    } catch { /* cancelled / unavailable — no crash */ }
  }

  // ── loading ──
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

  // ── error ──
  if (error || !data) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('errorTitle')}</h2>
          <p>{error || t('errorBody')}</p>
          <button className="op-btn-primary" onClick={load}><span className="ms" aria-hidden="true">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  const { referrals, leaderboard } = data
  const displayLink = baseLink ?? data.links.code ?? ''

  // ── empty (no link yet AND no referrals) ──
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

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>
      </div>

      {/* ── hero — real referral link (Copier / Partager / real QR) ── */}
      <div className="op-card aff-hero">
        <h3>{t('heroTitle')}</h3>
        <p>{t('heroDesc')}</p>
        {displayLink ? (
          <>
            <div className="aff-linkbox">
              <span className="url">{displayLink}</span>
              <div className="acts">
                <button type="button" className="aff-copy" onClick={() => copy(displayLink)}>
                  <span className="ms" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{copied ? t('copied') : t('copy')}
                </button>
                <button type="button" className="aff-share" title={t('share')} aria-label={t('share')} onClick={() => share(displayLink)}>
                  <span className="ms" aria-hidden="true">share</span>
                </button>
                {baseLink && (
                  <button type="button" className={`aff-share${qrOpen ? ' on' : ''}`} title={t('qr')} aria-label={t('qr')}
                    aria-pressed={qrOpen} onClick={() => setQrOpen((v) => !v)}>
                    <span className="ms" aria-hidden="true">qr_code_2</span>
                  </button>
                )}
              </div>
            </div>
            {qrOpen && baseLink && (
              <div className="aff-qr">
                <QRCodeSVG value={baseLink} size={168} includeMargin />
                <p>{t('qrHint')}</p>
              </div>
            )}
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--op-muted)' }}>{t('noCode')}</p>
        )}
      </div>

      {/* ── stats — VOLUMES ONLY. Only « Nouveaux clients » is real; the funnel is « bientôt ». ── */}
      <div className="vol-grid">
        {([
          { icon: 'ads_click',    label: t('volClicks') },
          { icon: 'shopping_bag', label: t('volOrders') },
          { icon: 'percent',      label: t('volConversion') },
        ] as const).map((v) => (
          <div key={v.label} className="op-card vol">
            <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">{v.icon}</span></span><span className="vol__label">{v.label}</span></div>
            <div className="vol__val soon">—</div>
            <div className="vol__sub soon"><span className="ms" aria-hidden="true">schedule</span>{t('soon')}</div>
          </div>
        ))}
        <div className="op-card vol">
          <div className="vol__top"><span className="vol__ic"><span className="ms" aria-hidden="true">group_add</span></span><span className="vol__label">{t('volNewCustomers')}</span></div>
          <div className="vol__val">{referrals.newCustomers}</div>
          <div className="vol__sub">{t('volNewCustomersSub')}</div>
        </div>
      </div>

      <div className="two">
        {/* ── Vos liens — only the real main link is live; dedicated links = « bientôt ». ── */}
        <div className="op-card card-pad">
          <div className="card-pad__hd">
            <h3>{t('linksTitle')}</h3>
            <span className="op-soon"><span className="ms" aria-hidden="true">add</span>{t('linksNew')}<span className="tag">{t('soon')}</span></span>
          </div>
          <div className="hint">{t('linksHint')}</div>
          <div className="lk-thead"><span>{t('linksColLink')}</span><span>{t('linksColClicks')}</span><span>{t('linksColConv')}</span><span>{t('linksColRate')}</span></div>
          {displayLink ? (
            <div className="lk-row">
              <div className="lk-name">
                <span className="lk-ic"><span className="ms" aria-hidden="true">link</span></span>
                <div className="lk-name__t"><b>{t('linksMain')}</b><span>{displayLink}</span></div>
              </div>
              <span className="lk-num soon lk-clicks">—</span>
              <span className="lk-num soon lk-conv">—</span>
              <span className="lk-num soon lk-rate2">—</span>
              <span className="lk-mini">{t('linksMiniSoon')}</span>
            </div>
          ) : (
            <div className="lb-empty"><span className="ms" aria-hidden="true">link</span>{t('noCode')}</div>
          )}
        </div>

        {/* ── Classement affiliés — VOLUMES ONLY, no €. Real rank + name + tier, volume « bientôt ». ── */}
        <div className="op-card card-pad">
          <div className="card-pad__hd"><h3>{t('lbTitle')}</h3></div>
          <div className="lb-note"><span className="ms" aria-hidden="true">info</span><span>{t('lbNote')}</span></div>
          {leaderboard && leaderboard.top.length > 0 ? (
            leaderboard.top.map((e) => (
              <div key={e.rank} className={`lb-row${e.isMe ? ' me' : ''}`}>
                <span className="lb-rank">{e.rank}</span>
                <span className="lb-av">{initials(e.name)}</span>
                <div className="lb-m"><b>{e.isMe ? t('lbYou', { name: e.name }) : e.name}</b><span>{tierLabel(e.tierKey)}</span></div>
                <span className="lb-val soon">—<small>{t('soon')}</small></span>
              </div>
            ))
          ) : (
            <div className="lb-empty"><span className="ms" aria-hidden="true">leaderboard</span>{t('lbEmpty')}</div>
          )}
        </div>
      </div>

      {/* ── Kit de partage — real QR (toggle) ; visuals / captions = « bientôt » inert. ── */}
      <div className="op-card card-pad">
        <div className="card-pad__hd"><h3>{t('kitTitle')}</h3></div>
        <div className="hint">{t('kitHint')}</div>
        {baseLink && (
          <div className="asset-row">
            <span className="asset-ic"><span className="ms" aria-hidden="true">qr_code_2</span></span>
            <div className="asset-m"><b>{t('kitQrTitle')}</b><span>{t('kitQrDesc')}</span></div>
            <button type="button" className="asset-dl" onClick={() => setQrOpen((v) => !v)}>
              <span className="ms" aria-hidden="true">qr_code_2</span>{qrOpen ? t('hideQr') : t('showQr')}
            </button>
          </div>
        )}
        <div className="asset-row">
          <span className="asset-ic"><span className="ms" aria-hidden="true">image</span></span>
          <div className="asset-m"><b>{t('kitVisualsTitle')}</b><span>{t('kitVisualsDesc')}</span></div>
          <span className="asset-soon">{t('soon')}</span>
        </div>
        <div className="asset-row">
          <span className="asset-ic"><span className="ms" aria-hidden="true">description</span></span>
          <div className="asset-m"><b>{t('kitCaptionsTitle')}</b><span>{t('kitCaptionsDesc')}</span></div>
          <span className="asset-soon">{t('soon')}</span>
        </div>
      </div>
    </section>
  )
}
