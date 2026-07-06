'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { signOut } from 'next-auth/react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import type { LogisticsIdentity } from '@/lib/logistics-identity'
import RoleSwitcher from '@/components/RoleSwitcher'
import './logistics-shell.css'

// ── LogisticsShell — "Grubano LIVREUR" navy chrome, AMBER accent (CD LO0). ────────
// Mounted by the logistics dashboard LAYOUT (the /logistics space is BARE in AppChrome,
// like /affiliate & /creators). Self-contained: the --op-* tokens + an AMBER courier
// accent (--op-lo) live in logistics-shell.css. DUPLICATE of AffiliateShell — NOT an
// import (per the LO0 note). NO establishment switcher. The notification bell carries NO
// fabricated count (real-or-nothing). The identity is the REAL courier (LogisticsProfile
// 1:1 Operator, email-keyed) — never a hardcoded "Karim Diallo". The status pill is derived
// from the REAL status (waitlist / active / pending / rejected / suspended) — never hardcoded.
// The profile dropdown mounts the REAL multi-role RoleSwitcher + real sign-out. Nav points to
// the LO1→LO3 sub-routes. No Gains/Retraits tab (decision 1). RE-SKIN — 0 migration, moteur
// d'argent non touché.

type NavGroup = 'principal' | 'livraison' | 'remuneration' | 'compte'
interface NavEntry {
  key: string
  href: string
  icon: string
  group: NavGroup
  exact?: boolean
}

// P4.3 ÉTAPE 5 — the « Rémunération » group (Mes gains + Retrait) joins the rail; both mount
// REAL P4.3 money surfaces (LO6/LO7). Group order: principal · livraison · rémunération · compte.
const NAV: NavEntry[] = [
  { key: 'overview', href: '/logistics/dashboard',          icon: 'dashboard',        group: 'principal', exact: true },
  { key: 'missions', href: '/logistics/dashboard/missions', icon: 'assignment',       group: 'livraison' },
  { key: 'gains',    href: '/logistics/dashboard/gains',    icon: 'payments',         group: 'remuneration' },
  { key: 'retrait',  href: '/logistics/dashboard/retrait',  icon: 'account_balance',  group: 'remuneration' },
  { key: 'profile',  href: '/logistics/dashboard/profil',   icon: 'badge',            group: 'compte' },
]

// Mobile bottom-nav = 5 REAL destinations (Bord · Missions · Gains · Retrait · Plus). « Plus »
// leads to the account/profile page (a real destination — no-fabrication).
type MobileEntry = { key: string; href: string; icon: string; exact?: boolean }
const MOBILE_NAV: MobileEntry[] = [
  { key: 'overview', href: '/logistics/dashboard',          icon: 'dashboard',       exact: true },
  { key: 'missions', href: '/logistics/dashboard/missions', icon: 'assignment' },
  { key: 'gains',    href: '/logistics/dashboard/gains',    icon: 'payments' },
  { key: 'retrait',  href: '/logistics/dashboard/retrait',  icon: 'account_balance' },
  { key: 'more',     href: '/logistics/dashboard/profil',   icon: 'more_horiz' },
]

// Real courier status → status-pill class + i18n label key. null → no pill.
type CourierStatus = 'waitlist' | 'active' | 'pending' | 'rejected' | 'suspended'
const STATUS_CLASS: Record<CourierStatus, string> = {
  waitlist: 'wait', active: 'active', pending: 'pending', rejected: 'rejected', suspended: 'suspended',
}

export default function LogisticsShell({
  identity,
  status,
  children,
}: {
  identity: LogisticsIdentity
  status: CourierStatus | null
  children: ReactNode
}) {
  const t = useTranslations('logisticsShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const active = (n: { href: string; exact?: boolean }) =>
    n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`)

  // The « principal » group has no header (its single item leads the rail, CD LO0).
  const groupLabel = (g: NavGroup): string | null => (g === 'principal' ? null : t(`group.${g}`))
  let lastGroup: NavGroup | undefined

  return (
    <div className="gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/logistics/dashboard" className="op-side__brand" aria-label="Grubano Livreur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span className="lo-badge">{t('badge')}</span></div>
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

          <div className="op-lo-id">
            <span className="op-lo-id__logo">{identity.initials}</span>
            <div className="op-lo-id__t"><b>{t('spaceTitle')}</b><span>{identity.name}</span></div>
          </div>

          <div className="op-top__spacer" />

          {/* Status pill — derived from the REAL courier status (never hardcoded). */}
          {status && (
            <span className={`op-status-pill ${STATUS_CLASS[status]}`}>
              <i className="dot" /><span className="t">{t(`status.${status}`)}</span>
            </span>
          )}

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
                  <div className="op-menu__hd"><b>{identity.name}</b></div>
                  {/* Real multi-role switcher (a courier who also holds another space). */}
                  <RoleSwitcher tone="light" />
                  <button className="op-menu__item danger" role="menuitem" onClick={() => signOut({ callbackUrl: '/' })}>
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
