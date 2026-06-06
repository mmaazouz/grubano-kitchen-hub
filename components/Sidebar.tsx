'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import {
  Home, Store, Star, Package, ChefHat, X, ShoppingBag,
  CalendarDays, Clock, BarChart2, Truck, MessageSquare,
  Wallet, Zap, Bell, Megaphone, Building2, UtensilsCrossed, Network,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { LanguageSwitcher } from '@/components/design-system'
import { locales } from '@/i18n'

// Maps a NextAuth role to an i18n key under dashboard.sidebar.roles.* so the
// label shown in the profile block is the REAL session role, never a hard-
// coded "Super Admin" string. Falls back to a generic "Membre" / "Member".
const ROLE_LABEL_KEY: Record<string, string> = {
  admin:      'roleAdmin',
  restaurant: 'roleRestaurateur',
  franchise:  'roleFranchise',
  creator:    'roleCreator',
  consumer:   'roleConsumer',
}

type NavItem = { href: string; label: string; icon: LucideIcon }
type NavGroup = { header?: string; items: NavItem[] }

/**
 * The operator's real "shape" (how many establishments / brands they own),
 * read from the EXISTING owner-scoped endpoints — no new API. Used only to
 * adapt the single "Mon restaurant" entry's label + target. While it loads (or
 * for non-restaurant roles) we keep the single-establishment label, so the word
 * "établissement" NEVER appears at N=1, even on the first paint.
 */
type OperatorShape = {
  establishments:  number
  brands:          number
  establishmentId: string | null // current (or first) establishment, for the hub link
}

function useOperatorShape(role: string) {
  const [shape, setShape] = useState<OperatorShape | null>(null)

  useEffect(() => {
    if (role !== 'restaurant' && role !== 'admin') return
    let alive = true
    Promise.all([
      fetch('/api/establishments').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/brands/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([est, br]) => {
      if (!alive) return
      const list      = Array.isArray(est?.establishments) ? est.establishments : []
      const currentId = typeof est?.currentId === 'string' ? est.currentId : null
      setShape({
        establishments:  list.length,
        brands:          Array.isArray(br?.brands) ? br.brands.length : 0,
        establishmentId: currentId ?? (list[0]?.id as string | undefined) ?? null,
      })
    })
    return () => { alive = false }
  }, [role])

  return shape
}

/**
 * The adaptive "Mon restaurant" nav entry — its label AND its target follow the
 * real account shape, so the hierarchy stays invisible at N=1:
 *   • ≥2 establishments        → "Mes établissements" → /dashboard/establishments
 *   • 1 establishment, 1 brand → "Ma carte"           → /menu (court-circuit C13-2)
 *   • 1 establishment, N brands → "Mon restaurant"    → the establishment HUB
 *     (/dashboard/establishments/<id>, C13-2) so the brands sit one click away;
 *     falls back to /brands while the shape is still loading (no broken link).
 */
function restaurantEntry(
  shape: OperatorShape | null,
  t: (k: string) => string,
): NavItem {
  if (shape && shape.establishments >= 2) {
    return { href: '/dashboard/establishments', label: t('navRestaurantMulti'), icon: Building2 }
  }
  if (shape && shape.establishments <= 1 && shape.brands === 1) {
    return { href: '/menu', label: t('navRestaurantCard'), icon: UtensilsCrossed }
  }
  if (shape && shape.establishments === 1 && shape.establishmentId) {
    return { href: `/dashboard/establishments/${shape.establishmentId}`, label: t('navRestaurantSingle'), icon: Store }
  }
  return { href: '/brands', label: t('navRestaurantSingle'), icon: Store }
}

export default function Sidebar() {
  const { open, close } = useSidebar()
  const t = useTranslations('dashboard.sidebar')

  // Strip the leading locale segment (e.g. /fr/dashboard → /dashboard) so the
  // active-state matching works on EVERY locale, not only the unprefixed one.
  const raw = usePathname() || '/'
  const seg = raw.split('/')
  const pathname = locales.includes(seg[1] as never) ? '/' + seg.slice(2).join('/') : raw

  // Read the live session — role is injected into session.user by lib/auth.ts.
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role ?? ''
  const userName = session?.user?.name?.trim() || t('defaultUserName')
  const initial = userName[0]?.toUpperCase() || '?'
  const subtitle = role === 'restaurant' ? t('subtitlePartner') : t('subtitleAdmin')
  const roleLabel = t(ROLE_LABEL_KEY[role] ?? 'roleDefault')

  // Adaptive establishment→brand→menu entry (real counts, existing endpoints).
  const shape = useOperatorShape(role)

  // Five intention groups. Labels are i18n; ROUTES stay the current pages
  // (page merges land in later commits — no dead links here).
  const groups: NavGroup[] = [
    {
      // Headerless: a single "Accueil" row, no group title (less visual noise).
      items: [{ href: '/dashboard', label: t('navHome'), icon: Home }],
    },
    {
      header: t('groupRestaurant'),
      items: [
        restaurantEntry(shape, t),
        { href: '/tables',                label: t('navTables'), icon: CalendarDays },
        { href: '/dashboard/fulfillment', label: t('navHours'),  icon: Clock },
      ],
    },
    {
      header: t('groupDaily'),
      items: [
        { href: '/orders',    label: t('navOrders'),    icon: ShoppingBag },
        { href: '/stocks',    label: t('navStocks'),    icon: Package },
        { href: '/suppliers', label: t('navSuppliers'), icon: Truck },
      ],
    },
    {
      header: t('groupClients'),
      items: [
        { href: '/reviews', label: t('navReviews'), icon: MessageSquare },
        { href: '/loyalty', label: t('navClients'), icon: Star },
      ],
    },
    {
      header: t('groupGrowth'),
      items: [
        { href: '/analytics', label: t('navPerformance'), icon: BarChart2 },
        { href: '/creators',  label: t('navInfluencers'), icon: Megaphone },
        { href: '/finance',   label: t('navFinance'),     icon: Wallet },
        { href: '/franchise', label: t('navFranchise'),   icon: Network },
      ],
    },
  ]

  // Low-emphasis utilities — reachable but de-emphasised (they move to the top
  // header in a later commit). Kept here so no page is orphaned in the interim.
  const utilities: NavItem[] = [
    { href: '/briefing',      label: t('navBriefing'),      icon: Zap },
    { href: '/notifications', label: t('navNotifications'), icon: Bell },
  ]

  // Active = the LONGEST matching href, so /dashboard/establishments highlights
  // "Mes établissements" (not "Accueil" at /dashboard) — most specific wins.
  const allHrefs = [
    ...groups.flatMap((g) => g.items.map((i) => i.href)),
    ...utilities.map((u) => u.href),
  ]
  function isActive(href: string) {
    const matches = pathname === href || pathname.startsWith(href + '/')
    if (!matches) return false
    return !allHrefs.some(
      (o) => o !== href && o.length > href.length &&
        (pathname === o || pathname.startsWith(o + '/')),
    )
  }

  function navLinkClass(active: boolean) {
    return cn(
      'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
      active
        ? 'bg-primary text-primary-foreground'
        : 'text-navy-foreground/60 hover:bg-white/10 hover:text-navy-foreground',
    )
  }

  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={close} aria-hidden />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-64 flex flex-col bg-navy text-navy-foreground z-50',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <ChefHat size={20} className="text-primary-foreground" />
          </div>
          <div className="flex-1">
            <span className="text-lg font-display font-bold tracking-tight">Grubano</span>
            <p className="text-[10px] text-navy-foreground/40 leading-none">{subtitle}</p>
          </div>
          <button onClick={close} className="md:hidden text-navy-foreground/50 hover:text-navy-foreground p-1 rounded-lg hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.header && (
                <p className="px-3 mb-1 text-[9px] font-bold uppercase tracking-widest text-navy-foreground/30">{group.header}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} onClick={close} className={navLinkClass(isActive(href))}>
                    <Icon size={16} />
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Utilities — low emphasis (Briefing + Notifications). */}
        <div className="px-3 py-2 border-t border-white/10 flex items-center gap-1">
          {utilities.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                title={label}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-white/10 text-navy-foreground'
                    : 'text-navy-foreground/40 hover:bg-white/5 hover:text-navy-foreground',
                )}
              >
                <Icon size={14} />
                <span className="truncate">{label}</span>
              </Link>
            )
          })}
        </div>

        {/* Langue */}
        <div className="px-3 py-3 border-t border-white/10">
          <LanguageSwitcher variant="full" className="w-full" />
        </div>

        {/* Profil */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-[10px] text-navy-foreground/40 truncate">{roleLabel}</p>
            </div>
            <span
              className="h-2 w-2 rounded-full bg-success shrink-0"
              title={t('connected')}
            />
          </div>
        </div>
      </aside>
    </>
  )
}
