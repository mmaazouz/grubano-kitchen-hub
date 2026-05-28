'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Search, ClipboardList, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/eat', icon: Home, label: 'Accueil' },
  { href: '/eat/search', icon: Search, label: 'Recherche' },
  { href: '/eat/account', icon: ClipboardList, label: 'Commandes' },
  { href: '/eat/auth', icon: User, label: 'Compte' },
] as const

export default function BottomNav() {
  const pathname = usePathname()

  // Hide on immersive checkout / tracking flows (they own the bottom area).
  if (pathname.startsWith('/eat/cart') || pathname.startsWith('/eat/track')) return null

  return (
    <div
      className="pointer-events-none fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 px-5 pb-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <nav className="pointer-events-auto flex items-center justify-around rounded-[22px] border border-black/[0.04] bg-white/90 px-1.5 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/eat' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className="group flex flex-1 flex-col items-center gap-0.5 py-1 transition-transform duration-200 active:scale-90"
            >
              <span
                className={cn(
                  'flex h-9 items-center justify-center rounded-full px-4 transition-all duration-200',
                  active ? 'bg-[#E8593C] text-white shadow-[0_4px_12px_rgba(232,89,60,0.4)]' : 'text-gray-400',
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
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
      </nav>
    </div>
  )
}
