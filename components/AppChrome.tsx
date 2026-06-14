'use client'

import { usePathname } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import Sidebar from '@/components/Sidebar'
import MobileHeader from '@/components/MobileHeader'
import { SidebarProvider } from '@/components/SidebarContext'
import { BottomNav } from '@/components/grubano/BottomNav'
import { locales } from '@/i18n'

// Routes that must render WITHOUT the operator dashboard chrome
// (Sidebar + MobileHeader + operator BottomNav).
//
//   /eat/*          → consumer app, has its own BottomNav (app/eat/layout.tsx)
//   /franchise/*    → franchise portal (Agent 4 mounts its own sidebar here)
//   /creators/*     → creator portal  (Agent 4 mounts its own sidebar here)
//   /supplier/*     → B2B supplier space (Slice 0 — its own sober shell)
//   /business/*     → partner space served on business.grubano.com (Agent 3 / 2C)
//   /t/*            → public "table bill" QR landing (consumer, sober, no chrome)
//   /login, /register → public auth pages
//   /               → redirects to /dashboard, never renders content
//
// Note: the locale prefix is stripped BEFORE matching below, so these
// patterns work across /fr/franchise, /en/creators, /es/eat, etc.
const BARE_PREFIXES = ['/eat', '/franchise', '/creators', '/supplier', '/business', '/t', '/login', '/register']

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const raw = usePathname() || '/'
  // Strip the leading locale segment (e.g. /fr/eat → /eat) so chrome rules
  // stay locale-agnostic.
  const segments = raw.split('/')
  const pathname =
    locales.includes(segments[1] as never)
      ? '/' + segments.slice(2).join('/') || '/'
      : raw
  const normalized = pathname === '' ? '/' : pathname
  const isBare =
    normalized === '/' ||
    BARE_PREFIXES.some(p => normalized === p || normalized.startsWith(`${p}/`))

  // Public / consumer routes: render bare, no operator chrome.
  if (isBare) return <>{children}</>

  // Operator app (/dashboard, /menu, /stocks, /orders, … — all flat routes):
  // wrap in the dashboard sidebar chrome. SessionProvider is mounted here so
  // the Sidebar (and any client child) can read the user's role/name via
  // useSession() — the /eat consumer app has its own provider, bare auth
  // pages don't need one.
  return (
    <SessionProvider>
      <SidebarProvider>
        <Sidebar />
        <MobileHeader />
        <main className="md:ml-64 pt-[52px] md:pt-0 min-h-screen pb-20 md:pb-0">
          {children}
        </main>
        <BottomNav />
      </SidebarProvider>
    </SessionProvider>
  )
}
