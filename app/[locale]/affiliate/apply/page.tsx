import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import PartnerChrome from '@/components/business/PartnerChrome'
import AffiliateApplyClient from '@/components/affiliate/AffiliateApplyClient'

export const dynamic = 'force-dynamic'

// ── /affiliate/apply — PRE-LOGIN affiliate signup (Agent 118, incr. 1/3) ──────────
// PUBLIC (middleware allow-list: a visitor with no session can reach it — they are JOINING).
// 404 when AFFILIATE_ENABLED is OFF → the surface is invisible, exactly like /affiliate/join.
// The session-only /affiliate/join (instant join for logged-in users) is untouched and coexists.
// The grant (passwordless Operator BY EMAIL + Affiliate entity/code) runs server-side in the
// public POST /api/affiliate/apply; the client then triggers the existing magic-link.

export default function AffiliateApplyPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return (
    <PartnerChrome>
      <AffiliateApplyClient />
    </PartnerChrome>
  )
}
