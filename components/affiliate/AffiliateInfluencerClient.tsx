'use client'

/**
 * AF5 · Devenir influenceur (AffiliateShell --op-/--op-af teal, CD verbatim). The « become
 * an influencer » screen for the AFFILIATE. RE-SKIN — 0 migration, moteur d'argent non touché.
 * Over the REAL audience-verification state machine (owner-scoped, session-resolved):
 *   GET /api/affiliate/verify-request → { verified, request{status,…} }  (404 ⇒ INFLUENCER_ENABLED OFF)
 * Modes:
 *   · 404  → « Programme indisponible » posture: the pitch shows with an INERT « bientôt » CTA.
 *   · 200 + verified      → « Vous êtes influenceur » + the real content studio (AffiliateStudioCard).
 *   · 200 + not verified  → the pitch + a REAL CTA that reveals AffiliateVerifyCard (the real
 *                           request form, anchored #influencer-verify) + OnboardingInfluencerUpgrade.
 * inf-status reflects the REAL request status (pending/rejected). Eligibility conditions are
 * DESCRIPTIVE (assessed by the team) — never fake-checked. The comparison shows NO commission
 * rate / amount as acquired. The reintegrated cards are old-DS and self-hide when gated → a full
 * re-skin is a go-live task (SIGNAL). Identity is real (server) — never « Thomas ».
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import AffiliateVerifyCard from '@/components/affiliate/AffiliateVerifyCard'
import AffiliateStudioCard from '@/components/affiliate/AffiliateStudioCard'
import OnboardingInfluencerUpgrade from '@/components/affiliate/OnboardingInfluencerUpgrade'

type VState = { verified: boolean; request: { status: string } | null }
type Mode = 'loading' | 'error' | 'unavailable' | 'verified' | 'apply'

export default function AffiliateInfluencerClient() {
  const t = useTranslations('affiliate.influencer')
  const [mode, setMode] = useState<Mode>('loading')
  const [request, setRequest] = useState<{ status: string } | null>(null)

  const load = useCallback(async () => {
    setMode('loading')
    try {
      const res = await fetch('/api/affiliate/verify-request', { cache: 'no-store' })
      if (res.status === 404) { setMode('unavailable'); return }   // INFLUENCER_ENABLED OFF
      if (!res.ok) { setMode('error'); return }
      const data = (await res.json()) as VState
      setRequest(data.request)
      setMode(data.verified ? 'verified' : 'apply')
    } catch {
      setMode('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (mode === 'loading') {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 80, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
          <span className="op-sk" style={{ width: '100%', height: 260, borderRadius: 12 }} />
        </div>
      </section>
    )
  }

  if (mode === 'error') {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms">cloud_off</span>
          <h2>{t('errTitle')}</h2>
          <p>{t('errBody')}</p>
          <button className="op-btn-primary" onClick={load}><span className="ms">refresh</span>{t('retry')}</button>
        </div>
      </div></section>
    )
  }

  const verified = mode === 'verified'

  // Status card — reflects the REAL state.
  const status = verified
    ? { icon: 'verified', badgeCls: 'ok', title: t('statusVerifiedTitle'), body: t('statusVerifiedBody'), badge: t('badgeVerified') }
    : request?.status === 'pending'
      ? { icon: 'hourglass_top', badgeCls: 'wait', title: t('statusPendingTitle'), body: t('statusPendingBody'), badge: t('badgePending') }
      : request?.status === 'rejected'
        ? { icon: 'person', badgeCls: 'wait', title: t('statusRejectedTitle'), body: t('statusRejectedBody'), badge: t('badgeRejected') }
        : { icon: 'person', badgeCls: '', title: t('statusAffiliateTitle'), body: t('statusAffiliateBody'), badge: t('badgeAffiliate') }

  const cmpAffiliate = [
    { cls: 'yes', icon: 'check_circle', label: t('cmpPersonalLink') },
    { cls: 'yes', icon: 'check_circle', label: t('cmpCampaignLinks') },
    { cls: 'yes', icon: 'check_circle', label: t('cmpTracking') },
    { cls: 'yes', icon: 'check_circle', label: t('cmpKit') },
    { cls: 'no',  icon: 'remove',       label: t('cmpCustomVisuals') },
    { cls: 'no',  icon: 'remove',       label: t('cmpDedicatedSupport') },
  ]
  const cmpInfluencer = [
    { cls: 'yes',  icon: 'check_circle', label: t('cmpAllAffiliate') },
    { cls: 'star', icon: 'bolt',         label: t('cmpUnlimitedLinks') },
    { cls: 'star', icon: 'bolt',         label: t('cmpCustomVisualsPro') },
    { cls: 'star', icon: 'bolt',         label: t('cmpPromoCodes') },
    { cls: 'star', icon: 'bolt',         label: t('cmpSupportPro') },
    { cls: 'star', icon: 'bolt',         label: t('cmpFeatured') },
  ]
  const reqs = [
    { icon: 'ads_click',     title: t('reqActivityTitle'),  sub: t('reqActivitySub') },
    { icon: 'groups',        title: t('reqAudienceTitle'),  sub: t('reqAudienceSub') },
    { icon: 'verified_user', title: t('reqAccountTitle'),   sub: t('reqAccountSub') },
  ]

  return (
    <section>
      {/* hero */}
      <div className="op-card inf-hero">
        <div className="inf-hero__in">
          <span className="inf-hero__eyebrow"><span className="ms">auto_awesome</span>{t('eyebrow')}</span>
          <h1>{verified ? t('heroVerifiedTitle') : t('heroTitle')}</h1>
          <p>{verified ? t('heroVerifiedBody') : t('heroBody')}</p>
        </div>
      </div>

      {/* current status (real) */}
      <div className="op-card inf-status">
        <span className="inf-status__ic"><span className="ms">{status.icon}</span></span>
        <div className="inf-status__m"><b>{status.title}</b><span>{status.body}</span></div>
        <span className={`inf-status__badge ${status.badgeCls}`}>{status.badge}</span>
      </div>

      {verified ? (
        /* Already an influencer → the real content studio (self-hides if its flag is OFF). */
        <AffiliateStudioCard />
      ) : (
        <>
          {/* comparison — descriptive, NO rate/amount as acquired */}
          <div className="cmp">
            <div className="op-card cmp__col">
              <div className="cmp__h now"><span className="ms">person</span><b>{t('colAffiliate')}</b></div>
              <div className="cmp__sub">{t('colAffiliateSub')}</div>
              <div className="cmp__list">
                {cmpAffiliate.map((l, i) => (
                  <div key={i} className={`cmp__li ${l.cls}`}><span className="ms">{l.icon}</span>{l.label}</div>
                ))}
              </div>
            </div>
            <div className="op-card cmp__col pro">
              <span className="cmp__tag">{t('recommended')}</span>
              <div className="cmp__h pro"><span className="ms">campaign</span><b>{t('colInfluencer')}</b></div>
              <div className="cmp__sub">{t('colInfluencerSub')}</div>
              <div className="cmp__list">
                {cmpInfluencer.map((l, i) => (
                  <div key={i} className={`cmp__li ${l.cls}`}><span className="ms">{l.icon}</span>{l.label}</div>
                ))}
              </div>
            </div>
          </div>

          {/* eligibility — descriptive (assessed by the team), never fake-checked */}
          <div className="op-card req">
            <h3>{t('reqTitle')}</h3>
            <div className="hint">{t('reqHint')}</div>
            {reqs.map((r, i) => (
              <div key={i} className="req-row">
                <span className="req-ic"><span className="ms">{r.icon}</span></span>
                <div className="req-m"><b>{r.title}</b><span>{r.sub}</span></div>
              </div>
            ))}
            <div className="req-note"><span className="ms">info</span><span>{t('reqNote')}</span></div>
          </div>

          {/* CTA — inert « bientôt » when the program is gated, real anchor otherwise */}
          <div className="op-card inf-cta">
            <h3>{t('ctaTitle')}</h3>
            <p>{t('ctaBody')}</p>
            {mode === 'unavailable' ? (
              <button type="button" className="op-soon" disabled>
                <span className="ms">campaign</span>{t('ctaButton')}<span className="tag">{t('soon')}</span>
              </button>
            ) : (
              <button type="button" className="op-btn-primary" onClick={() => document.getElementById('influencer-verify')?.scrollIntoView({ behavior: 'smooth' })}>
                <span className="ms">campaign</span>{request?.status === 'pending' ? t('ctaButtonPending') : t('ctaButton')}
              </button>
            )}
            <div className="inf-note"><span className="ms">info</span><span>{t('ctaNote')}</span></div>
          </div>

          {/* Real audience-verification form + onboarding upgrade — mounted only when the
              program is open (flag ON); both self-hide otherwise. Anchor = #influencer-verify. */}
          {mode === 'apply' && (
            <div id="influencer-verify" style={{ scrollMarginTop: 16, marginTop: 16 }}>
              <OnboardingInfluencerUpgrade />
              <AffiliateVerifyCard />
            </div>
          )}
        </>
      )}
    </section>
  )
}
