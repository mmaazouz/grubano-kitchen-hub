'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/navigation'
import { locales, type Locale } from '@/i18n'
import { readFavs, showToast } from '@/lib/eat-cart'
import { getTheme, setTheme, watchSystem, type Theme } from '@/lib/eat-theme'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './account.css'

// /eat/account — « Profil » (racine de l'onglet Profil). VERBATIM reproduction of the
// FROZEN CD ref (Notion 38efd2c9-…-300b, file eat/profile.html). Renders INSIDE the
// EatShell nav shell (top-level tab) — page CONTENT only, never duplicates the rail/
// topbar/bottom-nav. Material Symbols (not lucide); --gb-* tokens; design CSS in
// account.css. Bound to REAL data: name/avatar/tier/points (loyalty wallet), order
// counts, real favorites count, real i18n locale switch, real signOut().

// Loyalty tiers per CLAUDE.md: Bronze 50 → Silver 100 → Gold 200 → Platine 400.
function tierFor(points: number) {
  if (points >= 400) return { key: 'platine', next: 400, floor: 400 }
  if (points >= 200) return { key: 'gold', next: 400, floor: 200 }
  if (points >= 100) return { key: 'silver', next: 200, floor: 100 }
  if (points >= 50) return { key: 'bronze', next: 100, floor: 50 }
  return { key: 'member', next: 50, floor: 0 }
}

interface Order { id: string; status: string }

// CD language chips — labels are CD-verbatim glyphs; ع (Arabic) carries dir="rtl".
const LANG_CHIPS: { loc: Locale; label: string; rtl?: boolean }[] = [
  { loc: 'fr', label: 'FR' },
  { loc: 'en', label: 'EN' },
  { loc: 'es', label: 'ES' },
  { loc: 'it', label: 'IT' },
  { loc: 'ar', label: 'ع', rtl: true },
]

export default function ProfileScreen() {
  const t = useTranslations('eat.account')
  const locale = useLocale() as Locale
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const [points, setPoints] = useState(0)
  const [orders, setOrders] = useState<Order[]>([])
  const [favCount, setFavCount] = useState(0)
  // « Apparence » (P1-THEME) — real theme persistence (lib/eat-theme): light / dark / auto,
  // saved in localStorage + applied as data-theme on <html>. Default = light (unchanged).
  const [appearance, setAppearance] = useState<Theme>('light')

  const loggedIn = status === 'authenticated'

  useEffect(() => {
    setFavCount(readFavs().length)
  }, [])

  // Load the saved theme + keep 'auto' in sync with the OS scheme.
  useEffect(() => {
    setAppearance(getTheme())
    return watchSystem()
  }, [])

  const chooseTheme = (next: Theme) => {
    setAppearance(next)
    setTheme(next)
  }

  useEffect(() => {
    if (status !== 'authenticated') return
    Promise.all([
      fetch('/api/loyalty/wallet').then((r) => r.json()).catch(() => ({ pointsBalance: 0 })),
      fetch('/api/orders?take=50').then((r) => r.json()).catch(() => ({ orders: [] })),
    ]).then(([wallet, ord]) => {
      setPoints(wallet.pointsBalance ?? 0)
      setOrders(Array.isArray(ord.orders) ? ord.orders : [])
    })
  }, [status])

  // Real i18n locale switch (mirrors LanguageSwitcher): persist the cookie so the
  // middleware honours it on future visits, then replace the route with the new locale.
  function selectLocale(next: Locale) {
    if (next === locale) return
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`
    router.replace(pathname, { locale: next })
  }

  const tierLabelFor = (key: string) =>
    ({
      platine: t('tierPlatinum'),
      gold: t('tierGold'),
      silver: t('tierSilver'),
      bronze: t('tierBronze'),
      member: t('tierMember'),
    } as Record<string, string>)[key] ?? key

  // ── Loading skeleton ─────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="gb gb-account">
        <div className="prof-top"><h1>{t('title')}</h1></div>
        <div className="ac-skel" />
        <div className="ac-skel" />
        <div className="ac-skel" />
      </div>
    )
  }

  // ── Signed-out prompt (no CD ref; minimal on-brand sign-in) ──────────────────
  if (!loggedIn) {
    return (
      <div className="gb gb-account">
        <div className="prof-top"><h1>{t('title')}</h1></div>
        <div className="signin">
          <div className="signin__ico"><span className="ms" aria-hidden="true">person</span></div>
          <h2>{t('signInPrompt')}</h2>
          <p>{t('signInSubtitle')}</p>
          <button className="cta" onClick={() => router.push('/eat/auth')}>{t('signIn')}</button>
          <button className="cta cta--line" onClick={() => router.push('/eat/auth')}>{t('createAccount')}</button>
        </div>
      </div>
    )
  }

  const tier = tierFor(points)
  const name = (session?.user?.name as string | undefined) ?? t('defaultName')
  const initials =
    name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🙂'
  const deliveredCount = orders.filter((o) => o.status === 'delivered').length
  const pointsFmt = points.toLocaleString('fr-FR')

  // « Devenir partenaire » — pre-fill the creator-application email (multi-role cumul).
  const becomePartnerRoute = session?.user?.email
    ? `/creators/apply?email=${encodeURIComponent(session.user.email)}`
    : '/creators/apply'

  return (
    <main className="gb gb-account">
      {/* top — page-internal title + settings gear (distinct from the shell topbar) */}
      <div className="prof-top">
        <h1>{t('title')}</h1>
        <button type="button" className="ico" aria-label={t('menuSettings')} onClick={() => showToast(t('comingSoon'))}>
          <span className="ms" aria-hidden="true">settings</span>
        </button>
      </div>

      {/* identity card — real name / initials / tier + points (Sunrise gradient) */}
      <div className="idcard">
        <span className="av">{initials}</span>
        <div className="who">
          <b>{name}</b>
          <span className="tier">
            <span className="ms" aria-hidden="true">workspace_premium</span>
            {t('tierWithPoints', { tier: tierLabelFor(tier.key), points: pointsFmt })}
          </span>
        </div>
        <button type="button" className="edit" aria-label={t('edit')} onClick={() => router.push('/eat/account/edit')}>
          <span className="ms" aria-hidden="true">edit</span>
        </button>
      </div>

      {/* stats — real counters (Commandes / Points / Livrées) */}
      <div className="ac-stats">
        <div className="s"><b>{orders.length}</b><span>{t('statOrders')}</span></div>
        <div className="s"><b>{pointsFmt}</b><span>{t('statPoints')}</span></div>
        <div className="s"><b>{deliveredCount}</b><span>{t('statDelivered')}</span></div>
      </div>

      {/* ─── Compte ─── */}
      <p className="glabel">{t('groupAccount')}</p>
      <div className="ac-group">
        <button type="button" className="ac-row" onClick={() => router.push('/eat/favorites')}>
          <span className="ic pink"><span className="ms" aria-hidden="true">favorite</span></span>
          <div className="main"><b>{t('rowFavorites')}</b><span>{t('rowFavoritesSub')}</span></div>
          <span className="val">{favCount}</span>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="ac-row" onClick={() => router.push('/eat/account/addresses')}>
          <span className="ic orange"><span className="ms" aria-hidden="true">location_on</span></span>
          <div className="main"><b>{t('rowAddresses')}</b><span>{t('rowAddressesSub')}</span></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="ac-row" onClick={() => router.push('/eat/account/email')}>
          <span className="ic blue"><span className="ms" aria-hidden="true">mail</span></span>
          <div className="main"><b>{t('rowEmail')}</b><span>{t('rowEmailSub')}</span></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="ac-row" onClick={() => router.push('/eat/orders')}>
          <span className="ic green"><span className="ms" aria-hidden="true">receipt_long</span></span>
          <div className="main"><b>{t('rowOrders')}</b><span>{t('rowOrdersSub')}</span></div>
          {orders.length > 0 && <span className="pill">{orders.length}</span>}
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
      </div>

      {/* ─── Préférences ─── */}
      <p className="glabel">{t('groupPreferences')}</p>
      <div className="ac-group">
        {/* Apparence (P1-THEME) — real theme: light / dark / auto, persisted + applied live. */}
        <div className="ac-row static">
          <span className="ic gray"><span className="ms" aria-hidden="true">contrast</span></span>
          <div className="main"><b>{t('rowAppearance')}</b></div>
          <span className="ac-seg">
            <button type="button" className={appearance === 'light' ? 'on' : undefined} onClick={() => chooseTheme('light')}>{t('themeLight')}</button>
            <button type="button" className={appearance === 'dark' ? 'on' : undefined} onClick={() => chooseTheme('dark')}>{t('themeDark')}</button>
            <button type="button" className={appearance === 'auto' ? 'on' : undefined} onClick={() => chooseTheme('auto')}>{t('themeAuto')}</button>
          </span>
        </div>
        {/* Langue — REAL i18n switch, 5 locales (FR/EN/ES/IT/AR). */}
        <div className="ac-row static">
          <span className="ic gray"><span className="ms" aria-hidden="true">language</span></span>
          <div className="main"><b>{t('rowLanguage')}</b></div>
          <span className="ac-langs">
            {LANG_CHIPS.map((c) => (
              <span
                key={c.loc}
                role="button"
                tabIndex={0}
                aria-pressed={c.loc === locale}
                className={c.loc === locale ? 'on' : undefined}
                dir={c.rtl ? 'rtl' : undefined}
                onClick={() => selectLocale(c.loc)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLocale(c.loc) } }}
              >
                {c.label}
              </span>
            ))}
          </span>
        </div>
        <button type="button" className="ac-row" onClick={() => router.push('/eat/account/notifications')}>
          <span className="ic gray"><span className="ms" aria-hidden="true">notifications</span></span>
          <div className="main"><b>{t('rowNotifications')}</b><span>{t('rowNotificationsSub')}</span></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="ac-row" onClick={() => showToast(t('comingSoon'))}>
          <span className="ic gray"><span className="ms" aria-hidden="true">restaurant_menu</span></span>
          <div className="main"><b>{t('rowDietary')}</b><span>{t('rowDietarySub')}</span></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
      </div>

      {/* ─── Aide & à propos ─── */}
      <p className="glabel">{t('groupHelp')}</p>
      <div className="ac-group">
        {/* LOT 4 : plus de toast « Bientôt » — le seul canal support réel est l'e-mail. */}
        <a className="ac-row" href="mailto:contact@grubano.com">
          <span className="ic gray"><span className="ms" aria-hidden="true">help</span></span>
          <div className="main"><b>{t('rowHelpCenter')}</b><span>contact@grubano.com</span></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </a>
        <button type="button" className="ac-row" onClick={() => router.push('/legal/confidentialite')}>
          <span className="ic gray"><span className="ms" aria-hidden="true">description</span></span>
          <div className="main"><b>{t('rowTerms')}</b></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
        <button type="button" className="ac-row" onClick={() => router.push(becomePartnerRoute)}>
          <span className="ic gray"><span className="ms" aria-hidden="true">storefront</span></span>
          <div className="main"><b>{t('rowBecomePartner')}</b></div>
          <span className="ms go" aria-hidden="true">chevron_right</span>
        </button>
      </div>

      {/* sign out — real NextAuth signOut() */}
      <button type="button" className="ac-signout" onClick={() => signOut({ callbackUrl: '/eat/auth' })}>
        <span className="ms" aria-hidden="true">logout</span>{t('logout')}
      </button>

      <p className="version">{t('version')}</p>
    </main>
  )
}
