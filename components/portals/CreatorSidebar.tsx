'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  LayoutDashboard, ChefHat, Megaphone,
  TrendingUp, ArrowLeft, Sparkles, X,
} from 'lucide-react'
import { Link, usePathname } from '@/navigation'
import { useSidebar } from '@/components/SidebarContext'
import { LanguageSwitcher } from '@/components/design-system'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  labelKey: string
  icon: React.ElementType
  exact?: boolean
  /** Mission 2 — entry visible only when this role flag is active. */
  role?: 'chef' | 'influencer'
}

// Mission 2 (role split): entries carry an optional role gate — 'chef' hides
// with isChef=false, 'influencer' with isInfluencer=false. Vue d'ensemble and
// Mes revenus are ALWAYS shown.
const NAV_ITEMS: NavItem[] = [
  { href: '/creators/dashboard',            labelKey: 'overview',     icon: LayoutDashboard, exact: true },
  { href: '/creators/dashboard/promotions', labelKey: 'recipes',      icon: ChefHat,   role: 'chef' },
  { href: '/creators/dashboard/audience',   labelKey: 'affiliation',  icon: Megaphone, role: 'influencer' },
  { href: '/creators/dashboard/revenus',    labelKey: 'revenue',      icon: TrendingUp },
]

export default function CreatorSidebar() {
  const t        = useTranslations('creators.nav')
  const pathname = usePathname()
  const { open, close } = useSidebar()

  // Role flags from /api/creators/home — DEFAULT BOTH TRUE until loaded (and
  // on any failure): never a flash of disappearing entries, identical
  // behaviour pre-migration (deploy-time default).
  const [roles, setRoles] = useState<{ isChef: boolean; isInfluencer: boolean }>({ isChef: true, isInfluencer: true })
  useEffect(() => {
    let cancelled = false
    fetch('/api/creators/home', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.roles) return
        setRoles({ isChef: d.roles.isChef !== false, isInfluencer: d.roles.isInfluencer !== false })
      })
      .catch(() => { /* keep both */ })
    return () => { cancelled = true }
  }, [pathname])

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.role === 'chef' ? roles.isChef : item.role === 'influencer' ? roles.isInfluencer : true,
  )

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-64 flex flex-col z-50',
          'bg-[#1a1a2e] text-white',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-grubano-primary shrink-0">
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-lg font-display font-bold tracking-tight">Créateurs</span>
            <p className="text-[10px] text-white/40 leading-none mt-0.5">Grubano Studio</p>
          </div>
          <button
            onClick={close}
            className="md:hidden text-white/50 hover:text-white p-1 rounded-lg hover:bg-white/10"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleItems.map(item => {
            const active = isActive(item)
            const Icon   = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  active
                    ? 'bg-grubano-primary text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon size={16} />
                {t(item.labelKey)}
              </Link>
            )
          })}
        </nav>

        {/* Language switcher */}
        <div className="px-3 py-3 border-t border-white/10">
          <LanguageSwitcher variant="full" className="w-full" />
        </div>

        {/* Back link */}
        <div className="px-3 pb-4 border-t border-white/10 pt-3">
          <Link
            href="/creators"
            onClick={close}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ArrowLeft size={14} />
            {t('back')}
          </Link>
        </div>
      </aside>
    </>
  )
}
