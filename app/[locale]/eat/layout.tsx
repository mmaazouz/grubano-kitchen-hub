import EatSessionProvider from '@/components/EatSessionProvider'
import BottomNav from '@/components/eat/BottomNav'
import ToastBridge from '@/components/eat/ToastBridge'
import { ToastProvider } from '@/components/design-system'

// Note: the LanguageSwitcher used to be an absolute overlay at end-3/top-3
// here, but it collided with every page's own top-right buttons (most visibly
// the heart + share on the restaurant detail hero). The switcher now lives in
// the profile menu (app/[locale]/eat/account/page.tsx) where it has its own
// dedicated row and can't overlap anything.
export default function EatLayout({ children }: { children: React.ReactNode }) {
  return (
    <EatSessionProvider>
      <ToastProvider>
        {/* Mobile (<lg): centered 480 column + bottom-nav — unchanged. Desktop (≥lg):
            the BottomNav renders a persistent fixed 240px left rail, so the content
            block makes room with lg:pl-[240px] and caps its width at 1200px (CLAUDE.md
            §3). The lg:* classes are inert below lg → mobile renders byte-identically. */}
        <div className="flex min-h-screen justify-center bg-neutral-200/50 lg:block lg:bg-gb-surface">
          <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white shadow-xl lg:max-w-none lg:bg-transparent lg:pl-[240px] lg:shadow-none">
            <main className="flex-1 pb-[64px] lg:mx-auto lg:w-full lg:max-w-[1200px] lg:px-6 lg:pb-12">{children}</main>
            <BottomNav />
            <ToastBridge />
          </div>
        </div>
      </ToastProvider>
    </EatSessionProvider>
  )
}
