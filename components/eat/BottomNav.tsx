'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Search, ClipboardList, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/eat',         icon: Home,          label: 'Accueil' },
  { href: '/eat/search',  icon: Search,        label: 'Recherche' },
  { href: '/eat/account', icon: ClipboardList, label: 'Commandes' },
  { href: '/eat/auth',    icon: User,          label: 'Compte' },
] as const

export default function BottomNav() {
  const pathname = usePathname()

  // Hide the nav on immersive flows where it would get in the way.
  const hidden =
    pathname.startsWith('/eat/cart') ||
    pathname.startsWith('/eat/track')
  if (hidden) return null

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 border-t border-black/[0.06] bg-white/90 backdrop-blur-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex h-16 items-center justify-around px-2">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active =
            pathname === href || (href !== '/eat' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className="group flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 transition-transform duration-200 active:scale-95"
            >
              <span
                className={cn(
                  'flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-200',
                  active ? 'bg-orange-50' : 'bg-transparent',
                )}
              >
                <Icon
                  size={21}
                  strokeWidth={active ? 2.4 : 2}
                  className={cn(
                    'transition-colors duration-200',
                    active ? 'text-[#E8593C]' : 'text-gray-400 group-hover:text-gray-600',
                  )}
                />
              </span>
              <span
                className={cn(
                  'text-[10px] font-semibold transition-colors duration-200',
                  active ? 'text-[#E8593C]' : 'text-gray-400 group-hover:text-gray-600',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
