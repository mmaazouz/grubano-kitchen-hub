import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import MobileHeader from '@/components/MobileHeader'
import { SidebarProvider } from '@/components/SidebarContext'
import { BottomNav } from '@/components/grubano/BottomNav'

export const metadata: Metadata = {
  title: 'Grubano — Dark Kitchen OS',
  description: 'Gestion opérationnelle de dark kitchens multi-marques',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-background">
        <SidebarProvider>
          <Sidebar />
          <MobileHeader />
          <main className="md:ml-64 pt-[52px] md:pt-0 min-h-screen pb-20 md:pb-0">
            {children}
          </main>
          <BottomNav />
        </SidebarProvider>
      </body>
    </html>
  )
}
