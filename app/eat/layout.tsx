import EatSessionProvider from '@/components/EatSessionProvider'
import BottomNav from '@/components/eat/BottomNav'
import Toast from '@/components/eat/Toast'

export default function EatLayout({ children }: { children: React.ReactNode }) {
  return (
    <EatSessionProvider>
      <div className="flex min-h-screen justify-center bg-neutral-200/50">
        <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white shadow-xl">
          <main className="flex-1 pb-[64px]">{children}</main>
          <BottomNav />
          <Toast />
        </div>
      </div>
    </EatSessionProvider>
  )
}
