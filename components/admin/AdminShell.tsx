'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, usePathname } from '@/navigation'
import { useTranslations } from 'next-intl'
import type { AdminIdentity } from '@/lib/admin-identity'
import './admin-shell.css'

// ── AdminShell — "Grubano ADMIN" navy console chrome (CD ADM1). ──────────────────
// Mounted by each /admin/* page (the space is BARE in AppChrome, like /supplier).
// Self-contained: the --op-* tokens + an INDIGO admin accent (--op-admin) live in
// admin-shell.css, so /admin never loads operator-shell.css. 1 admin role → NO
// establishment switcher. The notification bell carries NO fabricated count, and nav
// items show NO fabricated badge (real queue counts live on the overview « À
// superviser » card). Flag-gated entries (influencer/prestataire/logistics) are hidden
// when their flag is OFF; not-yet-built screens render as an honest « bientôt » item.

export interface AdminFlags {
  influencer: boolean
  prestataire: boolean
  logistics: boolean
}

type NavGroup = 'ops' | 'fin' | 'partners'
interface NavEntry {
  key: string
  href: string
  icon: string
  group: NavGroup | null // null = top (ungrouped)
  ready: boolean         // false → « bientôt » (screen lands in a later ADM lot)
  flag?: keyof AdminFlags
}

const NAV: NavEntry[] = [
  { key: 'overview',       href: '/admin',                        icon: 'monitoring',      group: null,       ready: true },
  { key: 'establishments', href: '/admin/establishments',         icon: 'storefront',      group: 'ops',      ready: false },
  { key: 'users',          href: '/admin/users',                  icon: 'group',           group: 'ops',      ready: false },
  { key: 'approvals',      href: '/admin/approvals',              icon: 'verified_user',   group: 'ops',      ready: true },
  { key: 'claims',         href: '/admin/claims',                 icon: 'flag',            group: 'ops',      ready: true },
  { key: 'payments',       href: '/admin/payments',               icon: 'payments',        group: 'fin',      ready: false },
  { key: 'reconciliation', href: '/admin/reconciliation',         icon: 'account_balance', group: 'fin',      ready: true },
  { key: 'dac7',           href: '/admin/dac7',                   icon: 'description',     group: 'fin',      ready: true },
  { key: 'suppliers',      href: '/admin/suppliers',              icon: 'local_shipping',  group: 'partners', ready: true },
  { key: 'influencer',     href: '/admin/influencer-verifications', icon: 'verified',      group: 'partners', ready: true, flag: 'influencer' },
  { key: 'prestataire',    href: '/admin/prestataires',           icon: 'handyman',        group: 'partners', ready: true, flag: 'prestataire' },
  { key: 'logistics',      href: '/admin/logistics',              icon: 'two_wheeler',     group: 'partners', ready: true, flag: 'logistics' },
]

const MOBILE_NAV = [
  { key: 'overview',  href: '/admin',           icon: 'monitoring' },
  { key: 'approvals', href: '/admin/approvals', icon: 'verified_user' },
  { key: 'claims',    href: '/admin/claims',    icon: 'flag' },
  { key: 'suppliers', href: '/admin/suppliers', icon: 'local_shipping' },
  { key: 'dac7',      href: '/admin/dac7',      icon: 'description' },
] as const

export default function AdminShell({
  identity,
  flags,
  children,
}: {
  identity: AdminIdentity
  flags: AdminFlags
  children: ReactNode
}) {
  const t = useTranslations('adminShell')
  const pathname = usePathname() // locale-stripped (next-intl shared navigation)
  const [collapsed, setCollapsed] = useState(false)

  // Exact-match /admin so it isn't highlighted on every /admin/* sub-route.
  const active = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`)

  const visible = NAV.filter((n) => !n.flag || flags[n.flag])
  let lastGroup: NavGroup | null | undefined = undefined

  return (
    <div className="gb-op gb-op--admin" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <aside className="op-side">
        <Link href="/admin" className="op-side__brand" aria-label="Grubano Admin">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
          <div className="op-side__word"><b>Grubano</b><span className="admin-badge">{t('badge')}</span></div>
        </Link>

        <nav className="op-side__nav">
          {visible.map((n) => {
            const groupHeader =
              n.group && n.group !== lastGroup ? (
                <div key={`g-${n.group}`} className="op-nav-group">{t(`group.${n.group}`)}</div>
              ) : null
            lastGroup = n.group

            const item = n.ready ? (
              <Link key={n.key} href={n.href} className={`op-nav-item${active(n.href) ? ' is-active' : ''}`}>
                <span className="ms">{n.icon}</span><span className="t">{t(`nav.${n.key}`)}</span>
              </Link>
            ) : (
              <span key={n.key} className="op-nav-item is-soon" aria-disabled="true">
                <span className="ms">{n.icon}</span><span className="t">{t(`nav.${n.key}`)}</span>
                <span className="soon">{t('soon')}</span>
              </span>
            )
            return <span key={`w-${n.key}`} style={{ display: 'contents' }}>{groupHeader}{item}</span>
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

          <div className="op-admin-id">
            <span className="op-admin-id__logo"><span className="ms">shield_person</span></span>
            <div className="op-admin-id__t"><b>{t('consoleTitle')}</b><span>{t('consoleSub')}</span></div>
          </div>

          <div className="op-top__spacer" />

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
            <Link key={n.key} href={n.href} className={active(n.href) ? 'is-active' : undefined}>
              <span className="ms">{n.icon}</span><span>{t(`mnav.${n.key}`)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
