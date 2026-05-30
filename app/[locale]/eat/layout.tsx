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
        <div className="flex min-h-screen justify-center bg-neutral-200/50">
          <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white shadow-xl">
            <main className="flex-1 pb-[64px]">{children}</main>
            <BottomNav />
            <ToastBridge />
          </div>
        </div>
      </ToastProvider>
    </EatSessionProvider>
  )
}
