'use client'

import { Menu } from 'lucide-react'
import { useSidebar } from '@/components/SidebarContext'

interface Props {
  title: string
  subtitle?: string
}

/**
 * Mobile-only top bar for the Franchise and Creator portal dashboards.
 * Mirrors MobileHeader.tsx but accepts a portal-specific title.
 * Only visible on screens narrower than md (Tailwind).
 */
export default function PortalMobileHeader({ title, subtitle }: Props) {
  const { toggle } = useSidebar()

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#1a1a2e] text-white flex items-center gap-3 px-4 py-3 shadow-lg">
      <button
        onClick={toggle}
        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        aria-label="Ouvrir le menu"
      >
        <Menu size={22} />
      </button>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-base tracking-tight leading-none">{title}</p>
        {subtitle && (
          <p className="text-[10px] text-white/40 leading-none mt-0.5">{subtitle}</p>
        )}
      </div>
    </header>
  )
}
