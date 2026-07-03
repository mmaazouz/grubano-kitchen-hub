'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import './supplier-shell.css'

// ── SupplierShell — "Grubano Fournisseurs" navy chrome (CD v1 Lot 1). ────────────
// Mounted by each /supplier/* page (the space is BARE in AppChrome). Reuses the
// operator --op-* design language. 1 supplier = 1 account → NO establishment
// switcher. The "Ouvert / Fermé aux commandes" control is an HONEST static pill
// derived from the real profile status (there is no persisted accepting-orders flag
// yet — a real toggle would need a schema column, deferred). The notification bell
// carries NO fabricated count.

export interface SupplierIdentity {
  companyName: string
  companyInitials: string
  profileName: string
  profileInitials: string
  /** Derived from profile.status === 'active' — honest, not a persisted toggle. */
  acceptingOrders: boolean
}

const NAV = [
  { key: 'dashboard',  href: '/supplier/dashboard',        icon: 'dashboard' },
  { key: 'catalog',    href: '/supplier/catalog',          icon: 'inventory_2' },
  { key: 'orders',     href: '/supplier/orders',           icon: 'receipt_long' },
  { key: 'clients',    href: '/supplier/clients',          icon: 'group' },
  { key: 'deliveries', href: '/supplier/livraisons',       icon: 'local_shipping' },
  { key: 'billing',    href: '/supplier/facturation',      icon: 'account_balance_wallet' },
  { key: 'settings',   href: '/supplier/dashboard/profil', icon: 'settings' },
] as const

const MOBILE_NAV = [
  { key: 'dashboard',  href: '/supplier/dashboard',        icon: 'dashboard' },
  { key: 'orders',     href: '/supplier/orders',           icon: 'receipt_long' },
  { key: 'catalog',    href: '/supplier/catalog',          icon: 'inventory_2' },
  { key: 'deliveries', href: '/supplier/livraisons',       icon: 'local_shipping' },
  { key: 'more',       href: '/supplier/dashboard/profil', icon: 'menu' },
] as const

export default function SupplierShell({
  identity,
  children,
}: {
  identity: SupplierIdentity
  children: ReactNode
}) {
  const t = useTranslations('supplierShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className="gb-op" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/supplier/dashboard" className="op-side__brand" aria-label="Grubano Fournisseurs">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span>{t('brandSuffix')}</span></div>
        </Link>

        <nav className="op-side__nav">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} className={`op-nav-item${active(n.href) ? ' is-active' : ''}`}>
              <span className="ms">{n.icon}</span><span className="t">{t(`nav.${n.key}`)}</span>
            </Link>
          ))}
        </nav>

        <Link
          href="/supplier/copilote"
          className={`op-nav-item op-nav-item--ai${active('/supplier/copilote') ? ' is-active' : ''}`}
        >
          <span className="ms">auto_awesome</span><span className="t">{t('nav.copilot')}</span>
        </Link>

        <button className="op-side__collapse" onClick={() => setCollapsed((v) => !v)} title={t('collapse')} aria-label={t('collapse')}>
          <span className="ms flip-rtl">{collapsed ? 'chevron_right' : 'chevron_left'}</span>
        </button>
      </aside>

      <div className="op-main">
        <header className="op-top">
          <button className="op-hamburger" onClick={() => setCollapsed((v) => !v)} aria-label={t('menu')}>
            <span className="ms">menu</span>
          </button>

          <div className="sup-identity">
            <span className="sup-identity__logo">{identity.companyInitials}</span>
            <div className="sup-identity__t">
              <b>{identity.companyName}</b><span>{t('accountLabel')}</span>
            </div>
          </div>

          <div className="op-top__spacer" />

          <span className={`op-openclosed${identity.acceptingOrders ? ' is-open' : ''}`}>
            <i className="dot" />
            <span>{identity.acceptingOrders ? t('open') : t('closed')}</span>
          </span>

          <button className="op-icon-btn" aria-label={t('notifications')}>
            <span className="ms">notifications</span>
          </button>

          <span className="op-profile">
            <span className="op-profile__av">{identity.profileInitials}</span>
            <span className="op-profile__name">{identity.profileName}</span>
            <span className="ms">expand_more</span>
          </span>
        </header>

        <main className="op-content">{children}</main>
      </div>

      <nav className="op-bottomnav">
        <div className="row">
          {MOBILE_NAV.map((n) => {
            const on = n.key === 'more' ? active('/supplier/dashboard/profil') : active(n.href)
            return (
              <Link key={n.key} href={n.href} className={on ? 'is-active' : undefined}>
                <span className="ms">{n.icon}</span><span>{t(`mnav.${n.key}`)}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
