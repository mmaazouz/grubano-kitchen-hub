'use client'

/**
 * AF6 · Paramètres (AffiliateShell --op-/--op-af teal, CD verbatim). Calque of CR7 for
 * the AFFILIATE. RE-SKIN only — 0 backend, 0 migration. There is NO affiliate profile
 * PATCH endpoint (unlike CR7's /api/creators/profile), and the Affiliate model has a single
 * channel (no IG/YT/blog columns) → per the founder's decision, EVERYTHING is READ-ONLY:
 *   · name / e-mail / affiliate link / status = READ-ONLY (server-resolved props, real);
 *   · channels editing = inert « bientôt »;
 *   · « Activer les versements » = inert « bientôt » (payout rail gated OFF, no bank details);
 *   · notifications = inert « bientôt » (no preference backing);
 *   · language = REAL i18n ×5 switch; « Se déconnecter » = REAL signOut;
 *   · « Changer le mot de passe » = inert « bientôt » (passwordless magic-link);
 *   · « Fermer le compte » = inert « bientôt » (no closure flow).
 * The editable affiliate profile (name + channels, endpoint + migration) is a go-live task.
 */

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { signOut } from 'next-auth/react'
import { usePathname, useRouter } from '@/navigation'
import type { Locale } from '@/i18n'

const LOCALE_LABELS: Record<Locale, string> = { fr: 'Français', en: 'English', es: 'Español', it: 'Italiano', ar: 'العربية' }
const LOCALE_ORDER: readonly Locale[] = ['fr', 'en', 'es', 'it', 'ar']

export default function AffiliateSettingsClient({
  name, initials, email, link, statusActive, verified, createdAtISO,
}: {
  name: string
  initials: string
  email: string
  link: string
  statusActive: boolean
  verified: boolean
  createdAtISO: string | null
}) {
  const t = useTranslations('affiliate.settings')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [copied, setCopied] = useState(false)

  const memberSince = (() => {
    if (!createdAtISO) return null
    try { return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(createdAtISO)) } catch { return null }
  })()

  function changeLocale(next: Locale) {
    if (next === locale) return
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`
    router.replace(pathname, { locale: next })
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }

  const statusLabel = statusActive ? t('statusActive') : t('statusInactive')

  return (
    <section>
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('title')}</h1>
        <p className="op-dash__sub">{t('pageSub')}</p>
      </div>

      {/* ── Profil affilié (READ-ONLY — no affiliate profile endpoint) ─────────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">account_circle</span></span>
          <div className="set-hd__t"><b>{t('profileTitle')}</b><span>{t('profileSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="prof-row">
            <span className="prof-av">{initials}</span>
            <div className="prof-row__m">
              <b>{name}</b>
              <span>{statusLabel}{memberSince ? ` · ${t('memberSince', { date: memberSince })}` : ''}</span>
            </div>
            {/* No avatar field → INERT « bientôt » (never a dead upload). */}
            <button type="button" className="op-soon" disabled>
              <span className="ms">photo_camera</span>{t('changePhoto')}<span className="tag">{t('soon')}</span>
            </button>
          </div>
          <div className="row2">
            <div className="field">
              <div className="field__label">{t('nameLabel')} <span className="ro"><span className="ms">lock</span>{t('readonlyTag')}</span></div>
              <input className="inp" type="text" value={name} readOnly disabled />
            </div>
            <div className="field">
              <div className="field__label">{t('emailLabel')} <span className="ro"><span className="ms">lock</span>{t('readonlyTag')}</span></div>
              <input className="inp mono" type="text" value={email} readOnly disabled />
            </div>
          </div>
          <div className="field">
            <div className="field__label">{t('linkLabel')} <span className="ro"><span className="ms">lock</span>{t('fixedIdTag')}</span></div>
            <div className="mylink">
              <span className="url">{link}</span>
              <button type="button" className="cp" onClick={copyLink}><span className="ms">{copied ? 'check' : 'content_copy'}</span>{copied ? t('copied') : t('copy')}</button>
            </div>
            <div className="field__hint"><span className="ms">info</span><span>{t('linkHint')}</span></div>
          </div>
        </div>
      </div>

      {/* ── Canaux de promotion (inert « bientôt » — no affiliate profile endpoint) ── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">share</span></span>
          <div className="set-hd__t"><b>{t('channelsTitle')}</b><span>{t('channelsSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="soon-card"><span className="ms">edit_off</span><div style={{ flex: 1 }}><b>{t('channelsSoonTitle')}</b><span>{t('channelsSoonBody')}</span></div><span className="soon-tag">{t('soon')}</span></div>
          <div className="soc-row" aria-hidden="true"><span className="soc-ic"><span className="ms">photo_camera</span></span><input className="inp" type="text" placeholder={t('channelInstagram')} disabled /></div>
          <div className="soc-row" aria-hidden="true"><span className="soc-ic"><span className="ms">play_circle</span></span><input className="inp" type="text" placeholder={t('channelVideo')} disabled /></div>
          <div className="soc-row" aria-hidden="true"><span className="soc-ic"><span className="ms">public</span></span><input className="inp" type="text" placeholder={t('channelBlog')} disabled /></div>
        </div>
      </div>

      {/* ── Statut (READ-ONLY) ────────────────────────────────────────────────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">verified</span></span>
          <div className="set-hd__t"><b>{t('statusCardTitle')}</b><span>{t('statusCardSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="idrow">
            <span className="k"><span className="ms">badge</span>{t('statusRow')}</span>
            <span className="v">{statusActive ? <span className="pill af"><span className="ms">check</span>{t('statusActive')}</span> : <span className="pill wait">{t('statusInactive')}</span>}</span>
          </div>
          <div className="idrow">
            <span className="k"><span className="ms">campaign</span>{t('influencerRow')}</span>
            <span className="v">{verified ? <span className="pill ok"><span className="ms">verified</span>{t('influencerVerified')}</span> : <span className="pill wait">{t('influencerNo')}</span>}</span>
          </div>
          <div className="field__hint" style={{ marginTop: 12 }}><span className="ms">info</span><span>{t('statusNote')}</span></div>
        </div>
      </div>

      {/* ── Versements (Connect gated OFF → INERT « bientôt », no bank details) ── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">account_balance</span></span>
          <div className="set-hd__t"><b>{t('payoutTitle')}</b><span>{t('payoutSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="payout-status">
            <span className="ms">pending</span>
            <div><b>{t('payoutStatus')}</b><span>{t('payoutStatusSub')}</span></div>
          </div>
          <div className="field" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="field__label">{t('payoutBankLabel')} <span className="ro"><span className="ms">lock</span>{t('viaStripe')}</span></div>
            <div className="field__hint"><span className="ms">info</span><span>{t('payoutBankHint')}</span></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="op-soon" disabled><span className="ms">verified_user</span>{t('payoutActivate')}<span className="tag">{t('soon')}</span></button>
          </div>
        </div>
      </div>

      {/* ── Notifications (no persistence backing → INERT « bientôt ») ──────────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">notifications</span></span>
          <div className="set-hd__t"><b>{t('notifTitle')}</b><span>{t('notifSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="notif-soon">
            <span className="ms">notifications_active</span>
            <div style={{ flex: 1 }}><b>{t('notifSoonTitle')}</b><span>{t('notifSoonBody')}</span></div>
            <span className="soon-tag">{t('soon')}</span>
          </div>
          <div className="tog-row" aria-hidden="true"><div className="m"><b>{t('notifEarnings')}</b><span>{t('notifEarningsSub')}</span></div><span className="tog"><i /></span></div>
          <div className="tog-row" aria-hidden="true"><div className="m"><b>{t('notifPayout')}</b><span>{t('notifPayoutSub')}</span></div><span className="tog"><i /></span></div>
          <div className="tog-row" aria-hidden="true"><div className="m"><b>{t('notifPerf')}</b><span>{t('notifPerfSub')}</span></div><span className="tog"><i /></span></div>
        </div>
      </div>

      {/* ── Compte (e-mail read-only · langue REAL i18n · déconnexion REAL) ────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">manage_accounts</span></span>
          <div className="set-hd__t"><b>{t('accountTitle')}</b><span>{t('accountSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="field">
            <div className="field__label">{t('language')}</div>
            <select className="inp" value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
              {LOCALE_ORDER.map((l) => <option key={l} value={l}>{LOCALE_LABELS[l]}</option>)}
            </select>
          </div>
          <div className="acct-actions">
            <button type="button" className="op-soon" disabled><span className="ms">lock</span>{t('changePassword')}<span className="tag">{t('soon')}</span></button>
            <button type="button" className="op-btn-ghost" onClick={() => signOut({ callbackUrl: '/affiliate' })}>
              <span className="ms flip-rtl">logout</span>{t('signOut')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Zone sensible (no real closure flow → INERT « bientôt ») ────────────── */}
      <div className="op-card set-card danger-card">
        <div className="set-hd">
          <span className="ic"><span className="ms">warning</span></span>
          <div className="set-hd__t"><b>{t('dangerTitle')}</b><span>{t('dangerSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="danger-row">
            <div className="m"><b>{t('closeTitle')}</b><span>{t('closeSub')}</span></div>
            <button type="button" className="btn-danger" disabled><span className="ms">delete</span>{t('closeCta')}<span className="soon-tag" style={{ marginInlineStart: 6 }}>{t('soon')}</span></button>
          </div>
        </div>
      </div>
    </section>
  )
}
