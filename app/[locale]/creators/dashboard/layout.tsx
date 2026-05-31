'use client'

import { SidebarProvider } from '@/components/SidebarContext'
import CreatorSidebar from '@/components/portals/CreatorSidebar'
import PortalMobileHeader from '@/components/portals/PortalMobileHeader'

/**
 * Shell for all private creator dashboard routes:
 *   /creators/dashboard
 *   /creators/dashboard/promotions
 *   /creators/dashboard/audience
 *   /creators/dashboard/revenus
 *
 * The public landing page (/creators) and application form (/creators/apply)
 * are OUTSIDE this tree and therefore never get the sidebar.
 */
export default function CreatorDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <CreatorSidebar />
      <PortalMobileHeader title="Créateurs" subtitle="Grubano Studio" />
      <main className="md:ml-64 pt-[52px] md:pt-0 min-h-screen bg-grubano-bg pb-20 md:pb-0">
        {children}
      </main>
    </SidebarProvider>
  )
}
