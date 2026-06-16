'use client'

import { useTranslations } from 'next-intl'
import { SidebarProvider } from '@/components/SidebarContext'
import FranchiseSidebar from '@/components/portals/FranchiseSidebar'
import PortalMobileHeader from '@/components/portals/PortalMobileHeader'

/**
 * Shell for all private franchise dashboard routes:
 *   /franchise/dashboard
 *   /franchise/dashboard/etablissements
 *   /franchise/dashboard/finances
 *
 * The public landing page (/franchise) and application form (/franchise/apply)
 * are OUTSIDE this tree and therefore never get the sidebar.
 */
export default function FranchiseDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations('franchise.nav')
  return (
    <SidebarProvider>
      <FranchiseSidebar />
      <PortalMobileHeader title={t('brandTitle')} subtitle={t('brandSubtitle')} />
      <main className="md:ml-64 pt-[52px] md:pt-0 min-h-screen bg-grubano-bg pb-20 md:pb-0">
        {children}
      </main>
    </SidebarProvider>
  )
}
