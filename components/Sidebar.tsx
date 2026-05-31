'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Store, Star, Package, Users, Settings,
  ChefHat, X, ShoppingBag, UtensilsCrossed, CalendarDays,
  BarChart2, Truck, MessageSquare, Wallet, Zap, Bell, Receipt,
  Megaphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { LanguageSwitcher } from '@/components/design-system'

const navGroups = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard',  label: 'Dashboard',    icon: LayoutDashboard },
      { href: '/orders',     label: 'Commandes',    icon: ShoppingBag },
      { href: '/menu',       label: 'Menu',          icon: UtensilsCrossed },
      { href: '/tables',     label: 'Tables / Résas', icon: CalendarDays },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { href: '/stocks',     label: 'Stocks',        icon: Package },
      { href: '/suppliers',  label: 'Fournisseurs',  icon: Truck },
      { href: '/brands',     label: 'Mes marques',   icon: Store },
      { href: '/analytics',  label: 'Intelligence',  icon: BarChart2 },
    ],
  },
  {
    label: 'Clients',
    items: [
      { href: '/loyalty',    label: 'Fidélité',      icon: Star },
      { href: '/customers',  label: 'Clients',        icon: Users },
      { href: '/wallet',     label: 'Wallet client',  icon: Wallet },
      { href: '/reviews',    label: 'Avis',           icon: MessageSquare },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/briefing',     label: 'Briefing IA',  icon: Zap },
      { href: '/finance',      label: 'Finance',       icon: Receipt },
      { href: '/franchise',    label: 'Franchise',     icon: Users },
      { href: '/creators',     label: 'Influenceurs',  icon: Megaphone },
      { href: '/notifications',label: 'Notifications', icon: Bell },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { open, close } = useSidebar()

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
            <p className="text-[10px] text-navy-foreground/40 leading-none">Dark Kitchen OS</p>
          </div>
          <button onClick={close} className="md:hidden text-navy-foreground/50 hover:text-navy-foreground p-1 rounded-lg hover:bg-white/10" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {navGroups.map(({ label, items }) => (
            <div key={label}>
              <p className="px-3 mb-1 text-[9px] font-bold uppercase tracking-widest text-navy-foreground/30">{label}</p>
              <div className="space-y-0.5">
                {items.map(({ href, label: lbl, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(href + '/')
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={close}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-navy-foreground/60 hover:bg-white/10 hover:text-navy-foreground',
                      )}
                    >
                      <Icon size={16} />
                      {lbl}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Langue */}
        <div className="px-3 py-3 border-t border-white/10">
          <LanguageSwitcher variant="full" className="w-full" />
        </div>

        {/* Profil */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">M</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">Mohammed Maazouz</p>
              <p className="text-[10px] text-navy-foreground/40 truncate">Super Admin</p>
            </div>
            <span className="h-2 w-2 rounded-full bg-success shrink-0" title="Connecté" />
          </div>
        </div>
      </aside>
    </>
  )
}
