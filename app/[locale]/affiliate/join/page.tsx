import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import PartnerChrome from '@/components/business/PartnerChrome'
import AffiliateJoinClient from '@/components/affiliate/AffiliateJoinClient'

export const dynamic = 'force-dynamic'

// ── /affiliate/join — instant affiliate onboarding (Brique A, Agent 58) ───────────
// Reachable by ANY authenticated user (middleware: session-only, no role gate — they are
// BECOMING an affiliate). 404 when AFFILIATE_ENABLED is OFF → the surface is invisible.
// The grant itself (role + entity + minted code) is performed server-side by the
// session-scoped POST /api/affiliate/join (the client triggers it).

export default function AffiliateJoinPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return (
    <PartnerChrome>
      <AffiliateJoinClient />
    </PartnerChrome>
  )
}
