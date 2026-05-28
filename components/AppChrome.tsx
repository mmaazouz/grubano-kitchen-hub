'use client'

import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import MobileHeader from '@/components/MobileHeader'
import { SidebarProvider } from '@/components/SidebarContext'
import { BottomNav } from '@/components/grubano/BottomNav'

// Routes that must render WITHOUT the operator dashboard chrome
// (Sidebar + MobileHeader + operator BottomNav).
//   /eat/*       → consumer app, has its own BottomNav (app/eat/layout.tsx)
//   /login, /register → public auth pages
//   /            → redirects to /dashboard, never renders content
const BARE_PREFIXES = ['/eat', '/login', '/register']

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/'
  const isBare =
    pathname === '/' ||
    BARE_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))

  // Public / consumer routes: render bare, no operator chrome.
  if (isBare) return <>{children}</>

  // Operator app (/dashboard, /menu, /stocks, /orders, … — all flat routes):
  // wrap in the dashboard sidebar chrome.
  return (
    <SidebarProvider>
      <Sidebar />
      <MobileHeader />
      <main className="md:ml-64 pt-[52px] md:pt-0 min-h-screen pb-20 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </SidebarProvider>
  )
}
