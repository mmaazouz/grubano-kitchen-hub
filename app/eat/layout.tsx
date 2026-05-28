import EatSessionProvider from '@/components/EatSessionProvider'
import BottomNav from '@/components/eat/BottomNav'

export default function EatLayout({ children }: { children: React.ReactNode }) {
  return (
    <EatSessionProvider>
      <div className="flex min-h-screen justify-center bg-gray-200/40">
        <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-[#FAFAFA] shadow-xl">
          {/* Main content — padded bottom to clear the floating nav */}
          <main className="flex-1 pb-20">{children}</main>
          <BottomNav />
        </div>
      </div>
    </EatSessionProvider>
  )
}
