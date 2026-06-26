'use client'

import { usePathname } from '@/navigation'
import BottomNav from '@/components/eat/BottomNav'

// ── <EatShell /> — the /eat app frame (centered 480 column on mobile + a persistent
// 240px left rail on desktop), EXCEPT on the auth screen.
//
// /eat/auth is rendered FULL-SCREEN (the Claude-Design pixel blueprint: a brand panel +
// the form filling the whole viewport, with NO app rail). Every OTHER /eat route keeps
// the existing shell byte-for-byte (same classes as before). The decision is purely on
// the pathname — no auth/data logic, no impact on other routes.
//
// `usePathname` from '@/navigation' (createSharedPathnamesNavigation) is locale-STRIPPED
// — it returns '/eat/auth' (the same convention BottomNav relies on, e.g. `pathname === '/eat'`).
// We still match with endsWith so the condition is bullet-proof either way (locale prefix or not).
const isFullscreen = (pathname: string) => pathname.endsWith('/eat/auth')

export default function EatShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (isFullscreen(pathname)) return <>{children}</>

  return (
    <div className="flex min-h-screen justify-center bg-neutral-200/50 lg:block lg:bg-gb-surface">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white shadow-xl lg:max-w-none lg:bg-transparent lg:pl-[240px] lg:shadow-none">
        <main className="flex-1 pb-[64px] lg:mx-auto lg:w-full lg:max-w-[1200px] lg:px-6 lg:pb-12">{children}</main>
        <BottomNav />
      </div>
    </div>
  )
}
