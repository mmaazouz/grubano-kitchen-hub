'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import type { FranchiseIdentity } from '@/lib/franchise-identity'
import './franchise-shell.css'

// ── FranchiseShell — "Grubano FRANCHISE" navy console chrome (CD FR1). ────────────
// Mounted by the franchise dashboard LAYOUT (the /franchise space is BARE in AppChrome,
// like /supplier & /admin). Self-contained: the --op-* tokens + an ÉMERAUDE franchise
// accent (--op-fr) live in franchise-shell.css. 1 franchisor → NO establishment switcher.
// The notification bell carries NO fabricated count (real-or-nothing). The « Candidatures »
// nav badge shows the REAL pending FranchiseeApplication count, or nothing when 0. The
// « Marque » entry points to the EXISTING (already-modern) brand editor /brands/[id]/franchise
// — shown only when the franchisor owns a brand, never a dead link.

type NavGroup = 'reseau' | 'finances' | 'systeme'
interface NavEntry {
  key: string
  href: string
  icon: string
  group: NavGroup
  exact?: boolean
  badge?: number
  external?: boolean // leaves the /franchise/dashboard tree (Marque → /brands/[id]/franchise)
}

export default function FranchiseShell({
  identity,
  pendingCount,
  brandId,
  children,
}: {
  identity: FranchiseIdentity
  /** REAL count of pending FranchiseeApplication to this franchisor's brands. */
  pendingCount: number
  /** The franchisor's primary brand id for the « Marque » link, or null (omit the entry). */
  brandId: string | null
  children: ReactNode
}) {
  const t = useTranslations('franchiseShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)

  const nav: NavEntry[] = [
    { key: 'overview',     href: '/franchise/dashboard',                icon: 'insights',                group: 'reseau', exact: true },
    { key: 'locations',    href: '/franchise/dashboard/etablissements', icon: 'storefront',              group: 'reseau' },
    { key: 'applications', href: '/franchise/dashboard/candidatures',   icon: 'how_to_reg',              group: 'reseau', badge: pendingCount },
    ...(brandId ? [{ key: 'brand', href: `/brands/${brandId}/franchise`, icon: 'sell', group: 'reseau' as NavGroup, external: true }] : []),
    { key: 'royalties',    href: '/franchise/dashboard/finances',       icon: 'account_balance_wallet',  group: 'finances' },
    { key: 'settings',     href: '/franchise/dashboard/parametres',     icon: 'settings',                group: 'systeme' },
  ]

  const active = (n: { href: string; exact?: boolean; external?: boolean }) => {
    if (n.external) return false
    return n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`)
  }

  const MOBILE_NAV = [
    { key: 'overview',     href: '/franchise/dashboard',                icon: 'insights',               exact: true },
    { key: 'locations',    href: '/franchise/dashboard/etablissements', icon: 'storefront' },
    { key: 'applications', href: '/franchise/dashboard/candidatures',   icon: 'how_to_reg' },
    { key: 'royalties',    href: '/franchise/dashboard/finances',       icon: 'account_balance_wallet' },
    { key: 'settings',     href: '/franchise/dashboard/parametres',     icon: 'menu' },
  ] as const

  let lastGroup: NavGroup | undefined

  return (
    <div className="gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/franchise/dashboard" className="op-side__brand" aria-label="Grubano Franchise">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span className="fr-badge">{t('badge')}</span></div>
        </Link>

        <nav className="op-side__nav">
          {nav.map((n) => {
            const groupHeader = n.group !== lastGroup ? (
              <div key={`g-${n.group}`} className="op-nav-group">{t(`group.${n.group}`)}</div>
            ) : null
            lastGroup = n.group
            return (
              <span key={`w-${n.key}`} style={{ display: 'contents' }}>
                {groupHeader}
                <Link href={n.href} className={`op-nav-item${active(n) ? ' is-active' : ''}`}>
                  <span className="ms">{n.icon}</span>
                  <span className="t">{t(`nav.${n.key}`)}</span>
                  {n.badge != null && n.badge > 0 && <span className="tag">{n.badge}</span>}
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

          <div className="op-fr-id">
            <span className="op-fr-id__logo"><span className="ms">hub</span></span>
            <div className="op-fr-id__t"><b>{identity.name}</b><span>{t('networkLabel')}</span></div>
          </div>

          <div className="op-top__spacer" />

          {/* Notification bell — NO fabricated count (real-or-nothing). */}
          <button className="op-icon-btn" aria-label={t('notifications')}>
            <span className="ms">notifications</span>
          </button>

          <span className="op-profile">
            <span className="op-profile__av">{identity.initials}</span>
            <span className="op-profile__name">{identity.name}</span>
            <span className="ms">expand_more</span>
          </span>
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
