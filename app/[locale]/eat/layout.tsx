import EatSessionProvider from '@/components/EatSessionProvider'
import BottomNav from '@/components/eat/BottomNav'
import ToastBridge from '@/components/eat/ToastBridge'
import { ToastProvider, LanguageSwitcher } from '@/components/design-system'

export default function EatLayout({ children }: { children: React.ReactNode }) {
  return (
    <EatSessionProvider>
      <ToastProvider>
        <div className="flex min-h-screen justify-center bg-neutral-200/50">
          <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white shadow-xl">
            <div className="pointer-events-none absolute end-3 top-3 z-40">
              <div className="pointer-events-auto">
                <LanguageSwitcher variant="compact" />
              </div>
            </div>
            <main className="flex-1 pb-[64px]">{children}</main>
            <BottomNav />
            <ToastBridge />
          </div>
        </div>
      </ToastProvider>
    </EatSessionProvider>
  )
}
