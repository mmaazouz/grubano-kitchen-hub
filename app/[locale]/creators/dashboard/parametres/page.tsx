'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { signOut } from 'next-auth/react'
import { usePathname, useRouter } from '@/navigation'
import type { Locale } from '@/i18n'
import './creator-settings.css'

// ── CR7 · Paramètres (CreatorShell --op-/--op-cr, CD verbatim) ────────────────────
// RE-SKIN of the editable creator profile. Renders INSIDE the CreatorShell .op-content
// (already .gb-op). The REAL save wiring is byte-identical to the previous version:
//   GET  /api/creators/profile  → prefill (name/bio/instagram/tiktok + display-only
//        youtube/verified/isChef/isInfluencer + the READ-ONLY account e-mail)
//   PATCH /api/creators/profile → body { name, bio, instagram?, tiktok? } — UNCHANGED.
// GET /api/creators/home is read for the display-only @username (referralLinkSlug) and
// followers count. NO money surface: the payout rail is gated OFF, so « Activer les
// versements » is INERT « bientôt » and no bank details are ever collected here (Stripe).
// verified / roles / followers / @username / youtube / e-mail = READ-ONLY, never inputs.

type ProfileData = {
  name: string; bio: string; instagram: string; tiktok: string
  youtube: string | null; verified: boolean; isChef: boolean; isInfluencer: boolean
  email: string
}

type HomeCreator = { referralLinkSlug: string | null; followers: number } | null

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français', en: 'English', es: 'Español', it: 'Italiano', ar: 'العربية',
}
const LOCALE_ORDER: readonly Locale[] = ['fr', 'en', 'es', 'it', 'ar']

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'C'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function CreatorSettingsPage() {
  const t = useTranslations('creators')
  const s = (k: string) => t(`settings.${k}` as 'settings.title')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')

  const [locked, setLocked] = useState<Pick<ProfileData, 'youtube' | 'verified' | 'isChef' | 'isInfluencer' | 'email'> | null>(null)
  const [home, setHome] = useState<HomeCreator>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/creators/profile', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/creators/home', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([res, homeRes]) => {
        if (cancelled) return
        const p = res?.profile as ProfileData | undefined
        if (!p) { setLoadError(true); return }
        setName(p.name ?? '')
        setBio(p.bio ?? '')
        setInstagram(p.instagram ?? '')
        setTiktok(p.tiktok ?? '')
        setLocked({ youtube: p.youtube, verified: p.verified, isChef: p.isChef, isInfluencer: p.isInfluencer, email: p.email })
        const c = homeRes?.creator as { referralLinkSlug: string | null; followers: number } | undefined
        setHome(c ? { referralLinkSlug: c.referralLinkSlug, followers: c.followers } : null)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Clear the success banner once the user edits again (no-op during prefill).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [name, bio, instagram, tiktok])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      const res = await fetch('/api/creators/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio, instagram: instagram || undefined, tiktok: tiktok || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || s('errorGeneric')); return }
      setSaved(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError(s('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  // Real i18n ×5 switch (keeps the current path, swaps only the locale segment).
  function changeLocale(next: Locale) {
    if (next === locale) return
    // Persist preference so middleware honours it on future visits.
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`
    router.replace(pathname, { locale: next })
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 200, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12, marginBottom: 16, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 150, borderRadius: 12, display: 'block' }} />
      </section>
    )
  }

  // ── Error / no profile ─────────────────────────────────────────────────────────
  if (loadError || !locked) {
    return (
      <section><div className="op-center">
        <div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{s('errorTitle')}</h2>
          <p>{s('errorBody')}</p>
          <button className="op-btn-primary" onClick={() => location.reload()}>
            <span className="ms" aria-hidden="true">refresh</span>{t('home.retry')}
          </button>
        </div>
      </div></section>
    )
  }

  const slug = home?.referralLinkSlug ?? null
  const followers = home?.followers ?? 0
  const hasRoleBadge = locked.isChef || locked.isInfluencer

  return (
    <section>
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{s('title')}</h1>
          <p className="op-dash__sub">{s('pageSub')}</p>
        </div>
      </div>

      {/* ── Profil public (éditable — REAL PATCH) ───────────────────────────── */}
      <form onSubmit={save} className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">account_circle</span></span>
          <div className="set-hd__t"><b>{s('profileTitle')}</b><span>{s('profileSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="prof-row">
            <span className="prof-av">{initials(name)}</span>
            <div className="prof-row__m">
              <b>{name || s('none')}</b>
              <span>
                {locked.verified ? `${s('verifVerified')} · ` : ''}
                {slug ? `@${slug}` : ''}
              </span>
            </div>
            {/* No avatar field exists → INERT « bientôt » (never a dead upload). */}
            <button type="button" className="op-soon" disabled>
              <span className="ms" aria-hidden="true">photo_camera</span>{s('changePhoto')}<span className="tag">{t('home.soon')}</span>
            </button>
          </div>

          {saved && (
            <div className="set-banner ok">
              <span className="ms" aria-hidden="true">check_circle</span>
              <div className="m"><b>{s('savedTitle')}</b><span>{s('savedBody')}</span></div>
            </div>
          )}
          {error && (
            <div className="set-banner err">
              <span className="ms" aria-hidden="true">error</span>
              <div className="m"><b>{error}</b></div>
            </div>
          )}

          <div className="field">
            <div className="field__label">{t('apply.labelName')}</div>
            <input className="inp" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          {/* @username — READ-ONLY (drives referralLinkSlug + /chef/[slug]). */}
          <div className="field">
            <div className="field__label">
              {s('usernameLabel')}
              <span className="ro"><span className="ms" aria-hidden="true">lock</span>{s('readonlyTag')}</span>
            </div>
            <div className="pfx">
              <span className="sym">@</span>
              <input className="inp" type="text" value={slug ?? ''} placeholder={s('usernamePending')} readOnly disabled />
            </div>
          </div>

          <div className="field">
            <div className="field__label">{t('apply.labelBio')}</div>
            <textarea
              className="inp"
              rows={3}
              maxLength={2000}
              placeholder={t('apply.bioPlaceholder')}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>
        </div>
        <div className="set-foot">
          {saved && (
            <span className="set-foot__ok"><span className="ms" aria-hidden="true">check</span>{s('savedShort')}</span>
          )}
          <button type="submit" className="op-btn-primary" disabled={saving}>
            <span className="ms" aria-hidden="true">save</span>{saving ? s('saving') : s('save')}
          </button>
        </div>
      </form>

      {/* ── Réseaux sociaux (Instagram / TikTok éditables ; YouTube read-only) ── */}
      <form onSubmit={save} className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">share</span></span>
          <div className="set-hd__t"><b>{s('socialsTitle')}</b><span>{s('socialsSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="soc-row">
            <span className="soc-ic"><span className="ms" aria-hidden="true">photo_camera</span></span>
            <input className="inp" type="text" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder={t('apply.labelInstagram')} />
          </div>
          <div className="soc-row">
            <span className="soc-ic"><span className="ms" aria-hidden="true">music_note</span></span>
            <input className="inp" type="text" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder={t('apply.labelTiktok')} />
          </div>
          {/* YouTube = the VERIFIED channel → READ-ONLY (changing it needs re-verification). */}
          <div className="soc-row">
            <span className="soc-ic"><span className="ms" aria-hidden="true">play_circle</span></span>
            <input className="inp" type="text" value={locked.youtube ?? ''} placeholder={s('youtubeNone')} readOnly disabled />
            <span className="ro"><span className="ms" aria-hidden="true">lock</span>{s('verifiedTag')}</span>
          </div>
        </div>
        <div className="set-foot">
          <button type="submit" className="op-btn-primary" disabled={saving}>
            <span className="ms" aria-hidden="true">save</span>{saving ? s('saving') : s('save')}
          </button>
        </div>
      </form>

      {/* ── Identité vérifiée (READ-ONLY — verified / rôles / abonnés) ─────────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">verified</span></span>
          <div className="set-hd__t"><b>{s('lockedTitle')}</b><span>{s('lockedSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="idrow">
            <span className="k"><span className="ms" aria-hidden="true">verified_user</span>{s('lockedVerification')}</span>
            <span className="v">
              {locked.verified
                ? <span className="pill ok"><span className="ms" aria-hidden="true">verified</span>{s('verifVerified')}</span>
                : <span className="pill wait">{s('verifPending')}</span>}
            </span>
          </div>
          <div className="idrow">
            <span className="k"><span className="ms" aria-hidden="true">badge</span>{s('lockedRoles')}</span>
            <span className="v">
              <span className="pills">
                {locked.isChef && <span className="pill role"><span className="ms" aria-hidden="true">restaurant</span>{t('apply.roleChefTitle')}</span>}
                {locked.isInfluencer && <span className="pill role"><span className="ms" aria-hidden="true">campaign</span>{t('apply.roleInfluencerTitle')}</span>}
                {!hasRoleBadge && <span>{s('none')}</span>}
              </span>
            </span>
          </div>
          <div className="idrow">
            <span className="k"><span className="ms" aria-hidden="true">group</span>{t('apply.labelFollowers')}</span>
            <span className="v mono">{followers > 0 ? followers.toLocaleString(locale) : s('none')}</span>
          </div>
          <div className="field__hint" style={{ marginTop: 12 }}>
            <span className="ms" aria-hidden="true">info</span><span>{s('lockedNote')}</span>
          </div>
        </div>
      </div>

      {/* ── Versements (Connect gated OFF → INERT « bientôt », no bank details) ── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">account_balance</span></span>
          <div className="set-hd__t"><b>{s('payoutTitle')}</b><span>{s('payoutSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="payout-status">
            <span className="ms" aria-hidden="true">pending</span>
            <div><b>{s('payoutStatus')}</b><span>{s('payoutStatusSub')}</span></div>
          </div>
          <div className="field" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="field__label">
              {s('payoutBankLabel')}
              <span className="ro"><span className="ms" aria-hidden="true">lock</span>{s('viaStripe')}</span>
            </div>
            <div className="field__hint"><span className="ms" aria-hidden="true">info</span><span>{s('payoutBankHint')}</span></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="op-soon" disabled>
              <span className="ms" aria-hidden="true">verified_user</span>{s('payoutActivate')}<span className="tag">{t('home.soon')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Notifications (no persistence backing → INERT « bientôt ») ──────────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">notifications</span></span>
          <div className="set-hd__t"><b>{s('notifTitle')}</b><span>{s('notifSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="notif-soon">
            <span className="ms" aria-hidden="true">notifications_active</span>
            <div style={{ flex: 1 }}><b>{s('notifSoonTitle')}</b><span>{s('notifSoonBody')}</span></div>
            <span className="soon-tag">{t('home.soon')}</span>
          </div>
          <div className="tog-row" aria-hidden="true">
            <div className="m"><b>{s('notifEarnings')}</b><span>{s('notifEarningsSub')}</span></div>
            <span className="tog"><i /></span>
          </div>
          <div className="tog-row" aria-hidden="true">
            <div className="m"><b>{s('notifPayout')}</b><span>{s('notifPayoutSub')}</span></div>
            <span className="tog"><i /></span>
          </div>
          <div className="tog-row" aria-hidden="true">
            <div className="m"><b>{s('notifTrending')}</b><span>{s('notifTrendingSub')}</span></div>
            <span className="tog"><i /></span>
          </div>
        </div>
      </div>

      {/* ── Compte (e-mail read-only · langue REAL i18n · déconnexion REAL) ────── */}
      <div className="op-card set-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">manage_accounts</span></span>
          <div className="set-hd__t"><b>{s('accountTitle')}</b><span>{s('accountSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="row2">
            <div className="field">
              <div className="field__label">
                {t('apply.labelEmail')}
                <span className="ro"><span className="ms" aria-hidden="true">lock</span>{s('readonlyTag')}</span>
              </div>
              <input className="inp mono" type="text" value={locked.email} readOnly disabled />
            </div>
            <div className="field">
              <div className="field__label">{s('language')}</div>
              <select className="inp" value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
                {LOCALE_ORDER.map((l) => (
                  <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="acct-actions">
            {/* Creators are passwordless (magic-link) → password change is INERT « bientôt ». */}
            <button type="button" className="op-soon" disabled>
              <span className="ms" aria-hidden="true">lock</span>{s('changePassword')}<span className="tag">{t('home.soon')}</span>
            </button>
            <button type="button" className="op-btn-ghost" onClick={() => signOut({ callbackUrl: '/creators' })}>
              <span className="ms flip-rtl" aria-hidden="true">logout</span>{s('signOut')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Zone sensible (no real account-closure flow → INERT « bientôt ») ───── */}
      <div className="op-card set-card danger-card">
        <div className="set-hd">
          <span className="ic"><span className="ms" aria-hidden="true">warning</span></span>
          <div className="set-hd__t"><b>{s('dangerTitle')}</b><span>{s('dangerSub')}</span></div>
        </div>
        <div className="set-body">
          <div className="danger-row">
            <div className="m"><b>{s('closeTitle')}</b><span>{s('closeSub')}</span></div>
            <button type="button" className="btn-danger" disabled>
              <span className="ms" aria-hidden="true">delete</span>{s('closeCta')}<span className="soon-tag" style={{ marginInlineStart: 6 }}>{t('home.soon')}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
