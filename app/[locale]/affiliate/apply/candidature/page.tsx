import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import AffiliateApplyClient from '@/components/affiliate/AffiliateApplyClient'
import './affiliate-apply-form.css'

export const dynamic = 'force-dynamic'

// ── AF8 · /affiliate/apply/candidature — PUBLIC affiliate signup form ────────────
// The pre-login self-serve signup (Agent 118) moved from /affiliate/apply (now the
// AF7 marketing landing) onto its own public sub-route. The middleware allow-list
// already covers the whole /affiliate/apply/* subtree (public, passwordless), so
// routing is UNCHANGED. 404 when AFFILIATE_ENABLED is OFF → the surface stays
// invisible flag-OFF, exactly like the rest of the affiliate console.
// The CSS is imported by the PAGE (never by the component — chantier build lesson);
// no PartnerChrome: the client renders the .af-mkt marketing chrome (mini-nav with
// a back link to the /affiliate/apply landing), calqued on /creators/apply.

export default function AffiliateCandidaturePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return <AffiliateApplyClient />
}
