'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/navigation'
import { useEffect, useState } from 'react'
import { Home, Compass, Heart, ShoppingBag, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cartCount, CART_EVENT } from '@/lib/eat-cart'

interface NavItem {
  href: string
  icon: typeof Home
  labelKey: string
  isCart?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/eat', icon: Home, labelKey: 'home' },
  { href: '/eat/search', icon: Compass, labelKey: 'explore' },
  { href: '/eat/favorites', icon: Heart, labelKey: 'favorites' },
  { href: '/eat/cart', icon: ShoppingBag, labelKey: 'cart', isCart: true },
  { href: '/eat/account', icon: User, labelKey: 'profile' },
]

// Deep / immersive screens that hide the tab bar (Bolt = Stack screens).
const HIDDEN_PREFIXES = ['/eat/r/', '/eat/track', '/eat/dish/', '/eat/splash', '/eat/promos']

export default function BottomNav() {
  const t = useTranslations('eat.nav')
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const sync = () => setCount(cartCount())
    sync()
    window.addEventListener(CART_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [pathname])

  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-50 flex h-[60px] w-full max-w-[480px] -translate-x-1/2 items-stretch justify-around border-t border-[#f0f0f0] bg-white"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.map(({ href, icon: Icon, labelKey, isCart }) => {
        const active = pathname === href || (href !== '/eat' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-1 flex-col items-center justify-center gap-1 transition-transform duration-150 active:scale-90"
          >
            <span className="relative">
              <Icon size={23} strokeWidth={2} className={active ? 'text-[#F97316]' : 'text-[#aaa]'} />
              {isCart && count > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F97316] px-1 text-[9px] font-bold text-white">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </span>
            <span className={cn('text-[11px] font-medium', active ? 'text-[#F97316]' : 'text-[#aaa]')}>
              {t(labelKey)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
