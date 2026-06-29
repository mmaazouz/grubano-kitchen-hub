'use client'

import { useEffect, useState } from 'react'
import { Link, usePathname, useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { readCart, cartCount, CART_EVENT } from '@/lib/eat-cart'
import { getDefaultAddress, ADDRESS_EVENT, type EatAddress } from '@/lib/eat-addresses'
import { formatEuros } from '@/lib/format-money'
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
const IMMERSIVE = ['/eat/r/', '/eat/track', '/eat/dish/', '/eat/splash', '/eat/promos', '/eat/cart', '/eat/checkout', '/eat/reset-password']
const isImmersive = (p: string) => IMMERSIVE.some((x) => p.includes(x))

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
  const { data: session, status } = useSession()
  const authed = status === 'authenticated'

  const [count, setCount] = useState(0)
  const [subtotal, setSubtotal] = useState(0)
  const [points, setPoints] = useState<number | null>(null)
  const [activeOrders, setActiveOrders] = useState(0)
  const [query, setQuery] = useState('')
  const [defaultAddr, setDefaultAddr] = useState<EatAddress | null>(null)

  // « Livrer à » = the user's REAL default saved address (lib/eat-addresses), live.
  useEffect(() => {
    const sync = () => setDefaultAddr(getDefaultAddress())
    sync()
    window.addEventListener(ADDRESS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADDRESS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Cart (lib/eat-cart, byte-identical) — count + subtotal, live via CART_EVENT.
  useEffect(() => {
    const sync = () => {
      setCount(cartCount())
      const c = readCart()
      // item.price ALREADY includes the size premium + supplements (baked in by the
      // restaurant page: unitPrice = dish.price + sizePremium + supplementsTotal). So the
      // subtotal is price*qty — byte-identical to the canonical /eat/cart subtotal
      // (cart/page.tsx). Re-adding supplements here would DOUBLE-count them in the bar.
      const s = c ? c.items.reduce((acc, l) => acc + l.item.price * l.qty, 0) : 0
      setSubtotal(s)
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
    <div className={`gb eat-nav${bare ? ' is-bare' : ''}`} data-cart={count}>
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
      </aside>

      {/* ════ MAIN COLUMN — top bar (desktop) + app-bar (mobile) both live INSIDE
            .main, before .content, so the mobile app-bar sits at the top of the column
            (sticky); only one is visible at a time (CSS display by breakpoint). ════ */}
      <div className="main">
        {!bare && (
          <>
            <div className="topbar">
              <button type="button" className="loc" onClick={() => router.push('/eat/account/addresses')}>
                <div className="l">{t('deliverTo')}</div>
                <div className="v">{defaultAddr ? defaultAddr.label : t('deliverToValue')}<span className="ms" aria-hidden="true">expand_more</span></div>
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
          {count > 0 && (
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
    </div>
  )
}
