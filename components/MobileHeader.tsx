'use client'

import { Menu, ChefHat } from 'lucide-react'
import { useSidebar } from './SidebarContext'

/**
 * Barre de navigation fixe visible uniquement sur mobile (< md).
 * Le bouton hamburger ouvre/ferme la Sidebar via SidebarContext.
 */
export default function MobileHeader() {
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
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-[#E8593C] flex items-center justify-center">
          <ChefHat size={14} />
        </div>
        <span className="font-bold text-base tracking-tight">Grubano</span>
      </div>
    </header>
  )
}
