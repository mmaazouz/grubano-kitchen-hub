'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Search, Package, User } from 'lucide-react'
import EatSessionProvider from '@/components/EatSessionProvider'

const NAV_ITEMS = [
  { href: '/eat',         icon: Home,    label: 'Accueil' },
  { href: '/eat/search',  icon: Search,  label: 'Recherche' },
  { href: '/eat/account', icon: Package, label: 'Commandes' },
  { href: '/eat/auth',    icon: User,    label: 'Compte' },
]

export default function EatLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <EatSessionProvider>
    <div className="min-h-screen bg-gray-50 flex justify-center">
      <div className="w-full max-w-[480px] relative flex flex-col min-h-screen bg-white shadow-lg">
        {/* Main content — padded bottom for nav bar */}
        <main className="flex-1 pb-20 overflow-y-auto">
          {children}
        </main>

        {/* Bottom navigation */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-gray-200 z-50">
          <div className="flex items-center justify-around h-16">
            {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || (href !== '/eat' && pathname.startsWith(href))
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center gap-0.5 px-4 py-1"
                >
                  <Icon
                    size={22}
                    className={active ? 'text-orange-500' : 'text-gray-400'}
                  />
                  <span className={`text-[10px] font-medium ${active ? 'text-orange-500' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
    </EatSessionProvider>
  )
}
