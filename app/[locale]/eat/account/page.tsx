'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/navigation'
import { locales, type Locale } from '@/i18n'
import {
  favOwner, readFavsForOwner, favEventIsMine, favStorageIsMine, FAV_EVENT, showToast,
  sessionCartStamp,
} from '@/lib/eat-cart'
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

  // Points balance + order history — ALWAYS stamped. The screen used to keep them as
  // plain primitives in an effect keyed on `[status]`, which stayed 'authenticated' across
  // an A → B cross-tab switch (NextAuth's broadcast calls setSession without flipping to
  // 'unauthenticated'), so A's balance / counts were painted onto B's profil, and a late
  // GET armed under A could race B's and win. Stamping the state and matching it against
  // the live `sessionStamp` at render time closes the race in BOTH directions.
  const [pointsState, setPointsState] = useState<{ stamp: string | null; value: number }>(
    { stamp: null, value: 0 },
  )
  const [ordersState, setOrdersState] = useState<{ stamp: string | null; value: Order[] }>(
    { stamp: null, value: [] },
  )
  /** RAW — read only through the gate below. A COUNT is data too: « 7 » tells B how many
   *  restaurants A had favourited. */
  const [favCountState, setFavCountState] = useState<{ owner: string | null; n: number }>({ owner: null, n: 0 })
  // « Apparence » (P1-THEME) — real theme persistence (lib/eat-theme): light / dark / auto,
  // saved in localStorage + applied as data-theme on <html>. Default = light (unchanged).
  const [appearance, setAppearance] = useState<Theme>('light')

  const loggedIn = status === 'authenticated'

  // ── IDENTITY, RESOLVED DURING RENDER ───────────────────────────────────────────
  // The live user id is captured in the same render as the new session, so a value
  // whose stamp was taken under the previous owner fails the render-time match (see
  // `sessionStamp` + the gated bindings below) and is never painted. The variable
  // name `favLiveUserId` is the SAME primitive the favorites rail already pins across
  // every /eat surface (eat-favorites-account-isolation): keeping it means ONE source
  // of truth for « who is this component rendering for ».
  const favLiveUserId = (session?.user as { id?: string } | undefined)?.id
  const sessionStamp = sessionCartStamp(status, favLiveUserId)
  const favsOwner = favOwner(status, favLiveUserId)
  /** The only number this screen may show. */
  const favCount = favsOwner !== null && favCountState.owner === favsOwner ? favCountState.n : 0

  useEffect(() => {
    if (favsOwner === null) { setFavCountState({ owner: null, n: 0 }); return }
    const sync = () => setFavCountState({ owner: favsOwner, n: readFavsForOwner(favsOwner).length })
    sync()
    // this screen only READS, so it declares no owner — but it still filters by owner
    const onFav = (e: Event) => { if (favEventIsMine(e, favsOwner)) sync() }
    const onStore = (e: StorageEvent) => { if (favStorageIsMine(e, favsOwner)) sync() }
    window.addEventListener(FAV_EVENT, onFav)
    window.addEventListener('storage', onStore)
    return () => {
      window.removeEventListener(FAV_EVENT, onFav)
      window.removeEventListener('storage', onStore)
    }
  }, [favsOwner])

  // Load the saved theme + keep 'auto' in sync with the OS scheme.
  useEffect(() => {
    setAppearance(getTheme())
    return watchSystem()
  }, [])

  const chooseTheme = (next: Theme) => {
    setAppearance(next)
    setTheme(next)
  }

  // Loyalty balance (idcard tier + « Points » stat) + order history (« Commandes »
  // stat, « Livrées » stat, « Mes commandes » row pill). Keyed on IDENTITY, not merely
  // `status`: `status` stays 'authenticated' across an A → B cross-tab switch, so a
  // dep of `[status]` left the previous account's balance and counts on screen (and let
  // a late GET armed under A race B's). FAIL-CLOSED FIRST: the previous owner's values
  // leave the profil BEFORE any request. requestOwner + requestUserId are captured
  // together so the response can be refused unless the server echoed the SAME raw id
  // (closes the window where React still believes A but the browser cookie is already
  // B). `alive` closes the opposite window — React moved on, but a late response from
  // the previous identity is still inbound. The .catch arms are no-ops: a fabricated
  // `{ pointsBalance: 0 }` / `{ orders: [] }` would end up stamped as the live owner
  // and painted as « their » (empty) data, which is the exact failure mode this closes.
  useEffect(() => {
    setPointsState({ stamp: null, value: 0 })
    setOrdersState({ stamp: null, value: [] })
    if (status !== 'authenticated') return
    if (!favLiveUserId) return
    const requestOwner = sessionStamp
    const requestUserId = favLiveUserId
    if (requestOwner === null) return
    let alive = true
    fetch('/api/loyalty/wallet').then((r) => (r.ok ? r.json() : null)).then((w: { ownerId?: unknown; pointsBalance?: unknown } | null) => {
      if (!alive) return
      // NEVER STAMP A RESPONSE THE SERVER DID NOT ATTRIBUTE TO THE SAME RAW ID. The
      // typeof half matters: a response that OMITS the field (older server, cache,
      // proxy) must not slip through on `undefined === undefined`. A mismatch is a
      // FAILED load — the state stays unstamped, so the profil keeps the neutral view.
      if (typeof w?.ownerId !== 'string' || w.ownerId !== requestUserId) return
      const v = typeof w.pointsBalance === 'number' ? w.pointsBalance : 0
      setPointsState({ stamp: requestOwner, value: v })
    }).catch(() => {})
    fetch('/api/orders?take=50').then((r) => (r.ok ? r.json() : null)).then((d: { ownerId?: unknown; orders?: unknown } | null) => {
      if (!alive) return
      if (typeof d?.ownerId !== 'string' || d.ownerId !== requestUserId) return
      const list: Order[] = Array.isArray(d.orders)
        ? (d.orders as unknown[]).filter((o): o is Order =>
            typeof o === 'object' && o !== null
              && typeof (o as { id?: unknown }).id === 'string'
              && typeof (o as { status?: unknown }).status === 'string')
        : []
      setOrdersState({ stamp: requestOwner, value: list })
    }).catch(() => {})
    return () => { alive = false }
    // `favLiveUserId` IS A DEPENDENCY: `status` alone cannot see A → logout → B when
    // the broadcast moves the id without touching `status`. Keying on it also makes
    // `alive` load-bearing — React runs the cleanup on identity change, so an in-flight
    // request issued for A is disowned before it can resolve. `sessionStamp` is derived
    // from `status` + `favLiveUserId` already in deps, so pinning the two primitives
    // keeps `sessionStamp` current without an extra dependency that would re-fire on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, /* account-points-orders-deps */ [status, favLiveUserId])

  // RENDER-TIME GATE — a value is shown only when its stamp matches the identity the
  // SESSION implies right now, which changes in the same render as the session. On an
  // A → B switch inside this component, this is what prevents one committed frame of
  // A's balance/counts painting under B. Default: 0 points, no orders (= member tier,
  // no delivered count, no pill badge) — a signed-out-looking profil, never A's.
  const points = pointsState.stamp !== null && pointsState.stamp === sessionStamp ? pointsState.value : 0
  const orders = ordersState.stamp !== null && ordersState.stamp === sessionStamp ? ordersState.value : []

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

  // Generic partner entry → the /business landing, never one role's funnel (locale added by @/navigation).
  const becomePartnerRoute = '/business'

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
        {/* D′ L9 (T-45) — « Mes réclamations ». Sits next to « Mes commandes » because a claim is
            read against the order it was filed on. NO counter: this page fetches orders and the
            loyalty wallet and NOTHING about claims, so any badge here would be a number we do
            not have. The claims page itself states the surface's real state (incl. closed). */}
        <button type="button" className="ac-row" onClick={() => router.push('/eat/account/claims')}>
          <span className="ic blue"><span className="ms" aria-hidden="true">flag</span></span>
          <div className="main"><b>{t('rowClaims')}</b><span>{t('rowClaimsSub')}</span></div>
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
