'use client'

import { useEffect, useState } from 'react'
import { Link, usePathname, useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import {
  readCart, cartCount, setCartOwner, clearCartOwner, currentCartStamp, sessionCartStamp,
  consumeGuestCartPromotionIntent, promoteGuestCartToUser, CART_EVENT,
} from '@/lib/eat-cart'
import { getDefaultAddress, syncFromServer, setAddressOwner, clearAddressOwner, currentAddressStamp, sessionAddressStamp, ADDRESS_EVENT, type EatAddress } from '@/lib/eat-addresses'
import { syncGeoCacheOwner } from '@/lib/use-geolocation'
import { formatEuros } from '@/lib/format-money'
import GeolocSheet from '@/components/eat/GeolocSheet'
import '@/app/[locale]/eat/nav-shell.css'
// gb-* design FOUNDATION (Agent 168) — the shell uses its tokens + Material `.ms` font.
// `.gb` lives on the shell root; in-shell pages don't use bare foundation class names
// (only /eat/auth + /eat/magic do, and they are full-screen / outside the shell), so
// nothing leaks. Pages set their own root font/colour, so the `.gb` inherit is overridden.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── <EatShell /> — the CONSUMER nav shell (CD 38cfd2c9-…-8182) wrapping every /eat
// page. 5 tabs (Accueil/Recherche/Commandes/Récompenses/Profil); cart = header bag
// (not a tab); Favoris = secondary rail link (not a tab). Real data: cart (lib/eat-cart),
// loyalty (/api/loyalty/wallet), active orders (/api/orders), session. ─────────────

// FULL-SCREEN (no shell at all) — the auth + magic-link pixel screens.
const isFullscreen = (p: string) => p.endsWith('/eat/auth') || p.endsWith('/eat/magic')
// IMMERSIVE (deep flows with their OWN sticky header / bottom bar) — the shell keeps the
// desktop rail but DROPS the top bar + the whole mobile chrome, so the page header governs.
const IMMERSIVE = ['/eat/track', '/eat/dish/', '/eat/splash', '/eat/promos', '/eat/cart', '/eat/checkout', '/eat/reset-password', '/eat/account/edit', '/eat/account/password', '/eat/account/email', '/eat/account/notifications', '/eat/order/', '/eat/group', '/eat/dinein', '/eat/dietary']
const isImmersive = (p: string) => IMMERSIVE.some((x) => p.includes(x))
// FRAMED — the restaurant page (/eat/r/[id]): like immersive (NO shell top bar,
// full-width content) BUT it REUSES the shell's mobile bottom-nav — the page provides
// its OWN top bar (back·name·★|share·♥) + full-height cart column + « view cart » bar.
// CD v2 (Notion 390fd2c9-…-6f64). Only the desktop shell top bar + mobile app-bar +
// fab-cart are dropped; the rail (desktop) + bottom-nav (mobile) stay.
const isFramed = (p: string) => p.includes('/eat/r/')

function tierKey(pts: number): string {
  if (pts >= 400) return 'platine'
  if (pts >= 200) return 'gold'
  if (pts >= 100) return 'silver'
  if (pts >= 50) return 'bronze'
  return 'member'
}
function tierFloorNext(pts: number): [number, number] {
  if (pts >= 400) return [400, 400]
  if (pts >= 200) return [200, 400]
  if (pts >= 100) return [100, 200]
  if (pts >= 50) return [50, 100]
  return [0, 50]
}

export default function EatShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('eat.nav')
  const ta = useTranslations('eat.account')
  // Lot 7 (legal + privacy) — discreet legal links in the desktop rail, reachable
  // WITHOUT an account. Labels reuse the existing legal.nav namespace (no new keys).
  const tl = useTranslations('legal.nav')
  const { data: session, status } = useSession()
  const authed = status === 'authenticated'

  // The cart numbers are stored WITH the stamp of the identity they were read under.
  const [cartView, setCartView] = useState<{ stamp: string | null; count: number; subtotal: number }>(
    { stamp: null, count: 0, subtotal: 0 },
  )
  const [points, setPoints] = useState<number | null>(null)
  const [activeOrders, setActiveOrders] = useState(0)
  const [query, setQuery] = useState('')
  // The « Livrer à » value is stored WITH the stamp of the identity it was read under.
  const [defaultAddr, setDefaultAddr] = useState<{ stamp: string | null; addr: EatAddress | null }>(
    { stamp: null, addr: null },
  )
  const [geoOpen, setGeoOpen] = useState(false)

  // « Livrer à » = the user's REAL default saved address (lib/eat-addresses), live.
  useEffect(() => {
    const sync = () => setDefaultAddr({ stamp: currentAddressStamp(), addr: getDefaultAddress() })
    sync()
    window.addEventListener(ADDRESS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADDRESS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // P0-DATA-1 — the address cache's IDENTITY, then the server pull.
  //
  // This is the ONLY place the address cache learns who it belongs to, and it must run on
  // every identity change (sign-in, sign-out, account switch). Until it does, the cache
  // serves nothing: that is what stops a signed-out account's cached addresses from being
  // shown — or POSTed — to the next account to sign in on this browser (the production
  // cross-account leak). setAddressOwner emits ADDRESS_EVENT when the identity changes, so
  // « Livrer à » and every open address list drop the previous owner's view at once.
  //
  // Authenticated WITHOUT a resolvable id → declare NOTHING: an identity we cannot name is
  // an identity we cannot attribute data to, and the guest bucket is not a safe fallback.
  // The server pull then MIRRORS the account's own rows (no local → account migration).
  // The cached geolocation fix is dropped alongside it: /api/geo/reverse stores the
  // REVERSE-GEOCODED POSTAL ADDRESS of the position under one global key, so the next
  // identity was shown the previous one's address line as its own « position active ».
  //
  // WHAT GUARANTEES THAT NOW IS NOT THIS CALL. syncGeoCacheOwner is erasure and hygiene;
  // the guard is the stamp check inside readCachedFor (lib/use-geolocation.ts), which
  // refuses a cache whose owner is not the one asking, plus the render-time gate on the
  // in-memory state. Disabling that check reopens the leak with this call still in place.
  // Naming the wrong mechanism here is how the right one ends up deleted as redundant.
  const addressOwnerId = (session?.user as { id?: string } | undefined)?.id

  // FIRST-FRAME GUARD. The effect below declares the identity, and effects run AFTER the
  // render that introduced a new session: on an A → B switch inside the SPA this component
  // re-renders with B's session while `defaultAddr` still holds A's address, and would
  // paint A's label for one committed frame. ADDRESS_EVENT cannot prevent it — the effect
  // that emits it has not run yet. So the render compares the stamp the value was read
  // under with the stamp the SESSION implies, which changes in the same render as the
  // session. Mismatch (or unknown identity) ⇒ the generic label, never the other account's.
  const sessionStamp = sessionAddressStamp(status, addressOwnerId)
  // FIRST-FRAME GUARD for the cart: same reasoning as the address banner below — the
  // owner is declared in an effect, so on an A → B switch this component renders once
  // with B's session while `cartView` still holds A's basket. A mismatched (or unknown)
  // identity shows an EMPTY cart: no badge, no amount, nothing of the previous account.
  const cartStampOk = cartView.stamp !== null && cartView.stamp === sessionCartStamp(status, addressOwnerId)
  const count = cartStampOk ? cartView.count : 0
  const subtotal = cartStampOk ? cartView.subtotal : 0
  const shownAddr = defaultAddr.stamp !== null && defaultAddr.stamp === sessionStamp ? defaultAddr.addr : null
  useEffect(() => {
    if (status === 'loading') return
    if (status === 'authenticated') {
      // Authenticated but unnameable (never seen in practice: the session callback in
      // lib/auth.ts always sets user.id). UNDECLARE rather than return: an early return
      // would leave the PREVIOUS owner declared and keep serving their addresses.
      if (!addressOwnerId) { clearAddressOwner(); clearCartOwner(); return }
      const me = { kind: 'user' as const, id: addressOwnerId }
      setAddressOwner(me)
      setCartOwner(me)
      syncGeoCacheOwner(me)
      void syncFromServer()
      // The cart's checkout parcours may have handed the visitor off to authenticate
      // elsewhere (« utiliser mon mot de passe » → /eat/auth, or the e-mailed magic link →
      // /eat/magic). Those paths leave the cart page, so it cannot promote its own basket;
      // it left a ONE-SHOT authorisation instead, consumed here. Everything else is
      // unchanged: no authorisation, no promotion — a plain sign-in adopts nothing.
      if (consumeGuestCartPromotionIntent()) {
        // Same rule as the in-page path: the id is the one the SERVER attributes to this
        // browser, never a React value that may lag.
        void fetch('/api/auth/session', { cache: 'no-store' })
          .then((r) => r.json())
          .then((s) => {
            const uid = (s?.user as { id?: string } | undefined)?.id
            if (uid) promoteGuestCartToUser(uid)
          })
          .catch(() => { /* the basket simply stays in the guest bucket */ })
      }
      return
    }
    setAddressOwner({ kind: 'guest' })
    setCartOwner({ kind: 'guest' })
    syncGeoCacheOwner({ kind: 'guest' })
  }, [status, addressOwnerId])

  // Cart (lib/eat-cart, byte-identical) — count + subtotal, live via CART_EVENT.
  useEffect(() => {
    const sync = () => {
      const stamp = currentCartStamp()
      const c = readCart()
      // item.price ALREADY includes the size premium + supplements (baked in by the
      // restaurant page: unitPrice = dish.price + sizePremium + supplementsTotal). So the
      // subtotal is price*qty — byte-identical to the canonical /eat/cart subtotal
      // (cart/page.tsx). Re-adding supplements here would DOUBLE-count them in the bar.
      const s = c ? c.items.reduce((acc, l) => acc + l.item.price * l.qty, 0) : 0
      setCartView({ stamp, count: cartCount(), subtotal: s })
    }
    sync()
    window.addEventListener(CART_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [pathname])

  // Loyalty (rail card + user tier) + active orders (Commandes badge) — read-only, once
  // per session (the layout persists across /eat navigations). No source → no badge.
  useEffect(() => {
    if (status !== 'authenticated') return
    fetch('/api/loyalty/wallet').then((r) => r.json()).then((w) => {
      if (typeof w?.pointsBalance === 'number') setPoints(w.pointsBalance)
    }).catch(() => {})
    fetch('/api/orders?take=50').then((r) => r.json()).then((d) => {
      const orders = Array.isArray(d?.orders) ? d.orders : []
      const active = orders.filter((o: { status?: string }) =>
        ['received', 'preparing', 'ready', 'picked_up'].includes(o.status ?? '')).length
      setActiveOrders(active)
    }).catch(() => {})
  }, [status])

  if (isFullscreen(pathname)) return <>{children}</>

  const bare = isImmersive(pathname)
  const framed = isFramed(pathname)
  const active = (hrefs: string[]) => hrefs.some((h) => pathname === h || pathname.startsWith(h + '/'))
  // Tabs — Commandes → /eat/orders (its own screen), Profil → /eat/account.
  const onAccount = pathname === '/eat/account' || pathname.startsWith('/eat/account/')
  const tabs = [
    { key: 'home', href: '/eat', icon: 'home', on: pathname === '/eat' },
    { key: 'search', href: '/eat/search', icon: 'search', on: active(['/eat/search']) },
    { key: 'orders', href: '/eat/orders', icon: 'receipt_long', on: active(['/eat/orders']), count: activeOrders },
    { key: 'rewards', href: '/eat/rewards', icon: 'redeem', on: active(['/eat/rewards']) },
    { key: 'profile', href: '/eat/account', icon: 'person', on: onAccount },
  ]

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/eat/search?q=${encodeURIComponent(q)}` : '/eat/search')
  }

  const pts = points ?? 0
  const tk = tierKey(pts)
  const [floor, next] = tierFloorNext(pts)
  const progress = tk === 'platine' ? 100 : Math.max(0, Math.min(100, ((pts - floor) / (next - floor)) * 100))
  const tierLabel = ({ platine: ta('tierPlatinum'), gold: ta('tierGold'), silver: ta('tierSilver'), bronze: ta('tierBronze'), member: ta('tierMember') } as Record<string, string>)[tk]
  const name = (session?.user?.name as string | undefined) ?? t('guest')
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '🙂'

  const cartLabel = `${t('viewCart')} · ${t('itemCount', { count })}`
  const amount = formatEuros(subtotal, locale)

  const bell = (
    <Link href="/eat/account" className="hbtn" aria-label={t('notifications')}>
      <span className="ms" aria-hidden="true">notifications</span>
    </Link>
  )
  const bag = (
    <Link href="/eat/cart" className="hbtn" aria-label={t('cart')}>
      <span className="ms" aria-hidden="true">shopping_bag</span>
      {count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
    </Link>
  )

  return (
    <div className={`gb eat-nav${bare ? ' is-bare' : ''}${framed ? ' is-framed' : ''}`} data-cart={count}>
      {/* ════ LEFT RAIL (desktop ≥900px) ════ */}
      <aside className="rail">
        <Link href="/eat" className="rail__logo" aria-label="Grubano">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <b>Grubano</b>
        </Link>
        <nav className="nav">
          {tabs.map((tb) => (
            <Link key={tb.key + tb.href} href={tb.href} className={tb.on ? 'active' : undefined}>
              <span className="ms" aria-hidden="true">{tb.icon}</span>{t(tb.key)}
              {tb.key === 'orders' && (tb.count ?? 0) > 0 && <span className="count">{tb.count}</span>}
            </Link>
          ))}
          <div className="nav__sep" />
          <Link href="/eat/favorites" className={`saved${active(['/eat/favorites']) ? ' active' : ''}`}>
            <span className="ms" aria-hidden="true">favorite</span>{t('favorites')}
          </Link>
        </nav>
        <Link href="/eat/rewards" className="rail__rewards">
          <div className="t"><span className="ms" aria-hidden="true">workspace_premium</span>{authed ? `${tierLabel} · ${t('pointsShort', { count: pts })}` : t('signInForPoints')}</div>
          <div className="pbar"><i style={{ width: `${authed ? progress : 0}%` }} /></div>
        </Link>
        <div className="rail__user">
          <span className="av">{initials}</span>
          <div className="who"><b>{name}</b><span>{authed ? tierLabel : t('guest')}</span></div>
        </div>
        {/* Lot 7 — anonymous access to the legal pages (desktop rail; the mobile
            counterpart lives in the /eat/auth footer). Sober, shell-styled row. */}
        <div className="rail__legal">
          <Link href="/legal/mentions-legales">{tl('mentions')}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/legal/confidentialite">{tl('confidentialite')}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/legal/cookies">{tl('cookies')}</Link>
          <span aria-hidden="true">·</span>
          {/* D′ L10 (D-8): the CGV must be findable by a CONSUMER, not only from inside /legal/*. */}
          <Link href="/legal/cgv">{tl('cgv')}</Link>
        </div>
      </aside>

      {/* ════ MAIN COLUMN — top bar (desktop) + app-bar (mobile) both live INSIDE
            .main, before .content, so the mobile app-bar sits at the top of the column
            (sticky); only one is visible at a time (CSS display by breakpoint). ════ */}
      <div className="main">
        {!bare && !framed && (
          <>
            <div className="topbar">
              <button type="button" className="loc" onClick={() => setGeoOpen(true)}>
                <div className="l">{t('deliverTo')}</div>
                <div className="v">{shownAddr ? shownAddr.label : t('deliverToValue')}<span className="ms" aria-hidden="true">expand_more</span></div>
              </button>
              <form className="search" onSubmit={submitSearch}>
                <span className="ms ai" aria-hidden="true">auto_awesome</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')} />
                <span className="ms mic" aria-hidden="true">mic</span>
              </form>
              <div className="topbar__sp" />
              {bell}
              {bag}
            </div>
            <div className="m-appbar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/grubano-symbol-color.svg" alt="" /><b>Grubano</b>
              <span className="sp" />
              {bell}
              {bag}
            </div>
          </>
        )}
        <div className="content">{children}</div>
      </div>

      {/* ════ MOBILE floating chrome (<900px) — position:fixed, DOM order irrelevant ════ */}
      {!bare && (
        <>
          {!framed && count > 0 && (
            <Link href="/eat/cart" className="fab-cart">
              <span className="l"><span className="ms" aria-hidden="true">shopping_bag</span>{cartLabel}</span>
              <b>{amount}</b>
            </Link>
          )}
          <nav className="botnav">
            {tabs.map((tb) => (
              <Link key={tb.key + tb.href} href={tb.href} className={tb.on ? 'active' : undefined}>
                {tb.key === 'orders' && (tb.count ?? 0) > 0 && <span className="count">{tb.count}</span>}
                <span className="ms" aria-hidden="true">{tb.icon}</span><span>{t(tb.key)}</span>
              </Link>
            ))}
          </nav>
        </>
      )}
      <GeolocSheet open={geoOpen} onClose={() => setGeoOpen(false)} sessionStamp={sessionStamp} />
    </div>
  )
}
