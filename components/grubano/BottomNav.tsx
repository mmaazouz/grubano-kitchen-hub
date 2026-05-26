'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, UtensilsCrossed, ShoppingBag, CalendarDays, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { to: '/dashboard',  label: 'Accueil',    icon: LayoutDashboard },
  { to: '/menu',       label: 'Menu',        icon: UtensilsCrossed },
  { to: '/orders',     label: 'Commandes',   icon: ShoppingBag },
  { to: '/tables',     label: 'Tables',      icon: CalendarDays },
  { to: '/more',       label: 'Plus',        icon: LayoutGrid },
] as const

/**
 * Barre de navigation bas — mobile uniquement (md:hidden).
 * Montée dans app/layout.tsx via SidebarProvider.
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="flex items-stretch justify-between px-2 py-2">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + '/')
          return (
            <Link
              key={to}
              href={to}
              className="group flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1 text-[10px] font-medium transition-colors"
            >
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl transition-all',
                  active
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                    : 'text-muted-foreground group-hover:text-foreground',
                )}
              >
                <Icon size={18} />
              </div>
              <span className={active ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
