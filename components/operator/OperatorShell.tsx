'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link, usePathname, useRouter } from '@/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import './operator-shell.css'

// ── <OperatorShell /> — the OPERATOR (B2B) nav shell wrapping every operator page.
// VERBATIM reproduction of the FROZEN CD v1 LOT 1 (Notion 390fd2c9-…-842e) with the
// gb-foundation adapted to a PRO identity: navy permanent chrome (light + dark), Zest
// accent, JetBrains Mono figures, violet Copilot. Material Symbols (NOT lucide).
//
// 🔒 Presentation-only re-skin of the legacy Sidebar/MobileHeader/BottomNav. Routing,
// session, the establishment switcher (cookie) + the longest-href-wins active rule are
// PRESERVED from the old shell. No money/auth/data logic. The former "Open/Closed"
// toggle was REMOVED (dead local state with no backend — it lied to operators); a real
// order-pause control is a separate post-beta ticket. The establishment badge shows the
// PUBLICATION state (isActive, admin-controlled) with honest wording: Publié/Non publié.
// Cuisine → /prep (mockup); Équipe + Copilote have no route yet → rendered inert « bientôt ».

const ESTABLISHMENT_COOKIE = 'grubano_estab'

interface NavEntry {
  key: string
  icon: string
  href: string | null // null = inert (« bientôt »)
  group?: 'ops' | 'crm' | 'insights' | 'org'
  requiresEstab?: boolean
}

// CD nav (15 entries + Copilot), mapped to the REAL operator routes.
const NAV: NavEntry[] = [
  { key: 'dashboard', icon: 'dashboard', href: '/dashboard', requiresEstab: true },
  { key: 'reservations', icon: 'event_seat', href: '/tables', group: 'ops', requiresEstab: true },
  { key: 'orders', icon: 'receipt_long', href: '/orders', group: 'ops', requiresEstab: true },
  { key: 'kitchen', icon: 'skillet', href: '/prep', group: 'ops', requiresEstab: true },
  { key: 'menus', icon: 'menu_book', href: '/menu', group: 'ops', requiresEstab: true },
  { key: 'stock', icon: 'inventory_2', href: '/stocks', group: 'ops', requiresEstab: true },
  { key: 'suppliers', icon: 'local_shipping', href: '/suppliers', group: 'ops', requiresEstab: true },
  { key: 'customers', icon: 'group', href: '/customers', group: 'crm', requiresEstab: true },
  { key: 'reviews', icon: 'reviews', href: '/reviews', group: 'crm', requiresEstab: true },
  { key: 'analytics', icon: 'monitoring', href: '/analytics', group: 'insights', requiresEstab: true },
  { key: 'finance', icon: 'account_balance_wallet', href: '/finance', group: 'insights', requiresEstab: true },
  { key: 'brands', icon: 'branding_watermark', href: '/brands', group: 'org', requiresEstab: true },
  { key: 'staff', icon: 'badge', href: null, group: 'org', requiresEstab: true },
  { key: 'settings', icon: 'settings', href: '/more', group: 'org' },
]

// mobile bottom-nav (5 tabs)
const BOTTOM = [
  { key: 'dashboard', icon: 'dashboard', href: '/dashboard' },
  { key: 'orders', icon: 'receipt_long', href: '/orders' },
  { key: 'reservations', icon: 'event_seat', href: '/tables' },
  { key: 'stock', icon: 'inventory_2', href: '/stocks' },
  { key: 'more', icon: 'menu', href: '/more' },
]

interface Establishment { id: string; name: string; city: string | null; isActive: boolean }

export default function OperatorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('operator')
  const { data: session } = useSession()

  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [estabOpen, setEstabOpen] = useState(false)
  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)

  // Establishment shape (drives the 0/1/N scale + the switcher). Owner-scoped, cached.
  useEffect(() => {
    fetch('/api/establishments', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setEstablishments(Array.isArray(d.establishments) ? d.establishments : [])
        setCurrentId(d.currentId ?? null)
      })
      .catch(() => {})
  }, [])

  // close the mobile drawer + establishment panel on navigation
  useEffect(() => { setDrawer(false); setEstabOpen(false) }, [pathname])

  const scale = establishments.length === 0 ? 'none' : establishments.length === 1 ? 'single' : 'multi'
  const current = establishments.find((e) => e.id === currentId) ?? establishments[0] ?? null

  // longest-href-wins active rule (preserved from the legacy Sidebar).
  const hrefs = useMemo(() => NAV.map((n) => n.href).filter(Boolean) as string[], [])
  const isActive = (href: string | null) => {
    if (!href) return false
    const matches = pathname === href || pathname.startsWith(href + '/')
    if (!matches) return false
    return !hrefs.some((o) => o !== href && o.length > href.length && (pathname === o || pathname.startsWith(o + '/')))
  }

  function switchEstablishment(id: string) {
    document.cookie = `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}`
    setCurrentId(id)
    setEstabOpen(false)
    router.refresh()
  }

  const name = (session?.user?.name as string | undefined)?.trim() || t('profileGuest')
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '👤'

  const dateLabel = useMemo(() => {
    try {
      // stable server-agnostic label; the CD shows the current weekday + day
      return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date())
    } catch { return '' }
  }, [locale])

  const initial = (label: string) => label.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

  const navItem = (n: NavEntry) => {
    const active = isActive(n.href)
    const cls = `op-nav-item${active ? ' is-active' : ''}${n.href ? '' : ' disabled'}`
    const inner = (
      <>
        <span className="ms" aria-hidden="true">{n.icon}</span>
        <span className="t">{t(`nav.${n.key}`)}{!n.href && <> · {t('soon')}</>}</span>
      </>
    )
    return n.href ? (
      <Link key={n.key} href={n.href} className={cls} data-requires-estab={n.requiresEstab || undefined} aria-current={active ? 'page' : undefined}>{inner}</Link>
    ) : (
      <span key={n.key} className={cls} data-requires-estab={n.requiresEstab || undefined} aria-disabled="true">{inner}</span>
    )
  }

  return (
    <div className="gb gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'} data-scale={scale} data-drawer={drawer ? 'open' : 'closed'}>
      {/* mobile drawer backdrop */}
      <div className="op-side__backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />

      {/* ══ SIDEBAR (navy, collapsible) ══ */}
      <aside className="op-side">
        <Link href="/dashboard" className="op-side__brand" aria-label="Grubano Business">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span>{t('brandSuffix')}</span></div>
        </Link>
        <nav className="op-side__nav">
          {NAV.filter((n) => !n.group).map(navItem)}
          {(['ops', 'crm', 'insights', 'org'] as const).map((g) => (
            <div key={g}>
              <div className="op-nav-group">{t(`group.${g}`)}</div>
              {NAV.filter((n) => n.group === g).map(navItem)}
            </div>
          ))}
        </nav>
        {/* Copilote IA — no route yet (phase 3) → inert « bientôt » */}
        <span className="op-nav-item op-nav-item--ai disabled" data-requires-estab aria-disabled="true">
          <span className="ms" aria-hidden="true">auto_awesome</span>
          <span className="t">{t('nav.copilot')} · {t('soon')}</span>
        </span>
        <button type="button" className="op-side__collapse" onClick={() => setCollapsed((c) => !c)} title={t('collapse')} aria-label={t('collapse')}>
          <span className="ms flip-rtl" aria-hidden="true">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </aside>

      {/* ══ MAIN ══ */}
      <div className="op-main">
        <header className="op-top">
          <button type="button" className="op-hamburger" onClick={() => setDrawer(true)} aria-label={t('menu')}>
            <span className="ms" aria-hidden="true">menu</span>
          </button>

          {/* establishment switcher (0 / 1 / N) */}
          <button type="button" className="op-estab" onClick={() => scale !== 'none' && setEstabOpen((o) => !o)} aria-haspopup={scale === 'multi'} aria-expanded={estabOpen}>
            {scale === 'none' && <span className="ms" aria-hidden="true" style={{ fontSize: 19, color: 'var(--op-chrome-text-dim)' }}>storefront</span>}
            {scale !== 'none' && current && <span className="op-estab__logo">{initial(current.name)}</span>}
            <div className="op-estab__t">
              <b>{scale === 'none' ? t('estab.none') : current?.name}</b>
              {scale !== 'none' && current && (
                <span>{current.isActive && <i className="dot" />}{[current.city, current.isActive ? t('status.published') : t('status.unpublished')].filter(Boolean).join(' · ')}</span>
              )}
            </div>
            {scale === 'multi' && <span className="ms op-estab__chev" aria-hidden="true">expand_more</span>}
          </button>
          {estabOpen && scale === 'multi' && (
            <div className="op-estab__panel open">
              {establishments.map((e) => (
                <button key={e.id} type="button" className={`op-estab__opt${e.id === current?.id ? ' sel' : ''}`} onClick={() => switchEstablishment(e.id)}>
                  <span className="op-estab__mini">{initial(e.name)}</span>
                  <div><b>{e.name}</b><span>{[e.city, e.isActive ? t('status.published') : t('status.unpublished')].filter(Boolean).join(' · ')}</span></div>
                  {e.id === current?.id && <span className="ms check" aria-hidden="true">check</span>}
                </button>
              ))}
              <Link href="/dashboard/establishments" className="op-estab__add"><span className="ms" aria-hidden="true">add</span>{t('estab.add')}</Link>
            </div>
          )}

          <div className="op-top__date"><span className="ms" aria-hidden="true">calendar_today</span>{dateLabel}</div>
          <div className="op-top__spacer" />

          <Link href="/notifications" className="op-icon-btn" aria-label={t('nav.notifications')}>
            <span className="ms" aria-hidden="true">notifications</span>
          </Link>

          <Link href="/more" className="op-profile">
            <span className="op-profile__av">{initials}</span>
            <span className="op-profile__name">{name}</span>
            <span className="ms" aria-hidden="true">expand_more</span>
          </Link>
        </header>

        <main className="op-content">{children}</main>
      </div>

      {/* ══ MOBILE bottom-nav ══ */}
      <nav className="op-bottomnav">
        <div className="row">
          {BOTTOM.map((b) => (
            <Link key={b.key} href={b.href} className={isActive(b.href) ? 'is-active' : undefined}>
              <span className="ms" aria-hidden="true">{b.icon}</span><span>{t(`nav.${b.key}`)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
