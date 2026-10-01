'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { signOut } from 'next-auth/react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import type { CreatorIdentity } from '@/lib/creator-identity'
import './creator-shell.css'

// ── CreatorShell — "Grubano CREATOR" navy studio chrome (CD CR0). ─────────────────
// Mounted by the creator dashboard LAYOUT (the /creators space is BARE in AppChrome,
// like /franchise & /supplier). Self-contained: the --op-* tokens + a ROSE-MAGENTA
// creator accent (--op-cr) live in creator-shell.css. NO establishment switcher. The
// notification bell carries NO fabricated count (real-or-nothing). Nav is ROLE-GATED —
// « Mes recettes » shows only with isChef, « Affiliation » only with isInfluencer
// (preserves the current CreatorSidebar behaviour; new creators are chef-only). Real
// sign-out + « Ma page publique » live in the profile dropdown.

type NavGroup = 'studio' | 'creation' | 'revenus' | 'systeme'
type Role = 'chef' | 'influencer'
interface NavEntry {
  key: string
  href: string
  icon: string
  group: NavGroup
  exact?: boolean
  role?: Role
}

export default function CreatorShell({
  identity,
  roles,
  children,
}: {
  identity: CreatorIdentity
  /** Real role flags (readCreatorRoles) — gate the recipes / affiliation nav entries. */
  roles: { isChef: boolean; isInfluencer: boolean }
  children: ReactNode
}) {
  const t = useTranslations('creatorShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const showRole = (r?: Role) => (r === 'chef' ? roles.isChef : r === 'influencer' ? roles.isInfluencer : true)

  const nav: NavEntry[] = ([
    { key: 'overview',    href: '/creators/dashboard',             icon: 'grid_view',       group: 'studio', exact: true },
    { key: 'recipes',     href: '/creators/dashboard/promotions',  icon: 'restaurant_menu', group: 'creation', role: 'chef' },
    { key: 'affiliation', href: '/creators/dashboard/affiliate',   icon: 'link',            group: 'creation', role: 'influencer' },
    { key: 'revenue',     href: '/creators/dashboard/revenus',     icon: 'payments',        group: 'revenus' },
    { key: 'settings',    href: '/creators/dashboard/parametres',  icon: 'settings',        group: 'systeme' },
  ] as NavEntry[]).filter((n) => showRole(n.role))

  const active = (n: { href: string; exact?: boolean }) =>
    n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`)

  // The « studio » group has no header (its single item leads the rail, CD CR0).
  const groupLabel = (g: NavGroup): string | null => (g === 'studio' ? null : t(`group.${g}`))

  type MobileEntry = { key: string; href: string; icon: string; exact?: boolean; role?: Role }
  const MOBILE_NAV: MobileEntry[] = ([
    { key: 'overview',    href: '/creators/dashboard',            icon: 'grid_view',       exact: true },
    { key: 'recipes',     href: '/creators/dashboard/promotions', icon: 'restaurant_menu', role: 'chef' },
    { key: 'affiliation', href: '/creators/dashboard/affiliate',  icon: 'link',            role: 'influencer' },
    { key: 'revenue',     href: '/creators/dashboard/revenus',    icon: 'payments' },
    { key: 'settings',    href: '/creators/dashboard/parametres', icon: 'menu' },
  ] as MobileEntry[]).filter((n) => showRole(n.role))

  const publicHref = identity.slug ? `/chef/${identity.slug}` : '/creators'
  let lastGroup: NavGroup | undefined

  return (
    <div className="gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/creators/dashboard" className="op-side__brand" aria-label="Grubano Creator">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span className="cr-badge">{t('badge')}</span></div>
        </Link>

        <nav className="op-side__nav">
          {nav.map((n) => {
            const label = n.group !== lastGroup ? groupLabel(n.group) : null
            const header = label ? <div key={`g-${n.group}`} className="op-nav-group">{label}</div> : null
            lastGroup = n.group
            return (
              <span key={`w-${n.key}`} style={{ display: 'contents' }}>
                {header}
                <Link href={n.href} className={`op-nav-item${active(n) ? ' is-active' : ''}`}>
                  <span className="ms">{n.icon}</span>
                  <span className="t">{t(`nav.${n.key}`)}</span>
                </Link>
              </span>
            )
          })}
        </nav>

        <button className="op-side__collapse" onClick={() => setCollapsed((v) => !v)} title={t('collapse')} aria-label={t('collapse')}>
          <span className="ms flip-rtl">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </aside>

      <div className="op-main">
        <header className="op-top">
          <button className="op-hamburger" onClick={() => setCollapsed((v) => !v)} aria-label={t('menu')}>
            <span className="ms">menu</span>
          </button>

          <div className="op-cr-id">
            <span className="op-cr-id__logo">{identity.initials}</span>
            <div className="op-cr-id__t"><b>{t('studioOf', { name: identity.name })}</b><span>{t('studioLabel')}</span></div>
          </div>

          <div className="op-top__spacer" />

          {/* Notification bell — NO fabricated count (real-or-nothing). */}
          <button className="op-icon-btn" aria-label={t('notifications')}>
            <span className="ms">notifications</span>
          </button>

          <div className="op-profile-wrap">
            <button className="op-profile" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <span className="op-profile__av">{identity.initials}</span>
              <span className="op-profile__name">{identity.name}</span>
              <span className="ms">expand_more</span>
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="op-menu" role="menu">
                  <div className="op-menu__hd">
                    <b>{identity.name}</b>
                    {identity.slug && <span>@{identity.slug}</span>}
                  </div>
                  <Link href={publicHref} className="op-menu__item" role="menuitem" onClick={() => setMenuOpen(false)}>
                    <span className="ms">public</span>{t('publicPage')}
                  </Link>
                  <button className="op-menu__item danger" role="menuitem" onClick={() => signOut({ callbackUrl: '/creators' })}>
                    <span className="ms">logout</span>{t('signOut')}
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="op-content">{children}</main>
      </div>

      <nav className="op-bottomnav">
        <div className="row">
          {MOBILE_NAV.map((n) => (
            <Link key={n.key} href={n.href} className={active(n) ? 'is-active' : undefined}>
              <span className="ms">{n.icon}</span><span>{t(`mnav.${n.key}`)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
