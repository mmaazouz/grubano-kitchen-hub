'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { signOut } from 'next-auth/react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import type { AffiliateIdentity } from '@/lib/affiliate-identity'
import './affiliate-shell.css'

// ── AffiliateShell — "Grubano AFFILIÉ" navy chrome (CD AF0). ──────────────────────
// Mounted by the affiliate dashboard LAYOUT (the /affiliate space is BARE in AppChrome,
// like /creators & /franchise). Self-contained: the --op-* tokens + a TEAL-CYAN affiliate
// accent (--op-af) live in affiliate-shell.css. Calque of CreatorShell — NOT an import
// (CreatorShell is coupled to the Creator model / readCreatorRoles). NO establishment
// switcher. The notification bell carries NO fabricated count (real-or-nothing). The
// identity is the REAL affiliate (Affiliate row 1:1 operatorId + operator name) — never a
// hardcoded "Thomas Renaud". Real sign-out lives in the profile dropdown. Nav points to
// the AF1→AF6 sub-routes (landed lot by lot). RE-SKIN — 0 migration, moteur d'argent non
// touché.

type NavGroup = 'studio' | 'promotion' | 'revenus' | 'systeme'
interface NavEntry {
  key: string
  href: string
  icon: string
  group: NavGroup
  exact?: boolean
}

const NAV: NavEntry[] = [
  { key: 'overview',    href: '/affiliate/dashboard',              icon: 'dashboard',        group: 'studio', exact: true },
  { key: 'links',       href: '/affiliate/dashboard/liens',        icon: 'link',             group: 'promotion' },
  { key: 'influencer',  href: '/affiliate/dashboard/influenceur',  icon: 'campaign',         group: 'promotion' },
  { key: 'earnings',    href: '/affiliate/dashboard/gains',        icon: 'payments',         group: 'revenus' },
  { key: 'withdrawals', href: '/affiliate/dashboard/retraits',     icon: 'account_balance',  group: 'revenus' },
  { key: 'settings',    href: '/affiliate/dashboard/parametres',   icon: 'settings',         group: 'systeme' },
]

type MobileEntry = { key: string; href: string; icon: string; exact?: boolean }
const MOBILE_NAV: MobileEntry[] = [
  { key: 'overview',    href: '/affiliate/dashboard',            icon: 'dashboard',       exact: true },
  { key: 'links',       href: '/affiliate/dashboard/liens',      icon: 'link' },
  { key: 'earnings',    href: '/affiliate/dashboard/gains',      icon: 'payments' },
  { key: 'withdrawals', href: '/affiliate/dashboard/retraits',   icon: 'account_balance' },
  { key: 'more',        href: '/affiliate/dashboard/parametres', icon: 'menu' },
]

export default function AffiliateShell({
  identity,
  children,
}: {
  identity: AffiliateIdentity
  children: ReactNode
}) {
  const t = useTranslations('affiliateShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const active = (n: { href: string; exact?: boolean }) =>
    n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`)

  // The « studio » group has no header (its single item leads the rail, CD AF0).
  const groupLabel = (g: NavGroup): string | null => (g === 'studio' ? null : t(`group.${g}`))
  let lastGroup: NavGroup | undefined

  return (
    <div className="gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/affiliate/dashboard" className="op-side__brand" aria-label="Grubano Affilié">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span className="af-badge">{t('badge')}</span></div>
        </Link>

        <nav className="op-side__nav">
          {NAV.map((n) => {
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

          <div className="op-af-id">
            <span className="op-af-id__logo">{identity.initials}</span>
            <div className="op-af-id__t"><b>{t('spaceTitle')}</b><span>{identity.name}</span></div>
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
                  <button className="op-menu__item danger" role="menuitem" onClick={() => signOut({ callbackUrl: '/affiliate' })}>
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
