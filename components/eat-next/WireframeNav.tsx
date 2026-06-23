'use client'

import { Link, usePathname } from '@/navigation'

// ── Wireframe bottom nav (Phase 1, Agent 127) ─────────────────────────────────
// Low-fidelity, neutral styling (NO design system / brand tokens). 4 destinations.
// Active state via the locale-aware usePathname. Mirrors the /eat BottomNav shape
// so the flow feels familiar, but it is a separate, throwaway-style wireframe nav.
const ITEMS = [
  { href: '/eat-next',          label: 'Accueil' },
  { href: '/eat-next/search',   label: 'Recherche' },
  { href: '/eat-next/cart',     label: 'Panier' },
  { href: '/eat-next/track',    label: 'Suivi' },
]

export default function WireframeNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 border-t border-neutral-300 bg-neutral-50">
      <ul className="flex">
        {ITEMS.map((it) => {
          const active = pathname === it.href || (it.href !== '/eat-next' && pathname.startsWith(it.href))
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={`flex h-14 flex-col items-center justify-center text-xs ${active ? 'font-bold text-neutral-900' : 'text-neutral-500'}`}
              >
                <span className={`mb-0.5 h-5 w-5 rounded ${active ? 'bg-neutral-800' : 'bg-neutral-300'}`} aria-hidden />
                {it.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
