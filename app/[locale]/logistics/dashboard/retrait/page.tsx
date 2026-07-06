import { setRequestLocale } from 'next-intl/server'
import LogisticsWithdraw from '@/components/logistics/LogisticsWithdraw'
import './logistics-withdraw.css'

// ── /logistics/dashboard/retrait — LO7 « Retrait » 🔒 (P4.3 ÉTAPE 5). ──────────────
// Rendered inside the amber LogisticsShell (dashboard layout). The client reads
// /api/logistics/withdraw (owner-scoped) and derives 4 REAL states (nocfg / below / ready /
// pending). Retirer → payPartner('logistics') (gated LOGISTICS_PAYOUT_ENABLED); onboarding →
// /api/logistics/connect (gated LOGISTICS_CONNECT_ENABLED). Amounts are SERVER cents; the
// withdrawal amount is server-derived (never a client value). IBAN is Stripe-managed, never
// stored/fabricated. When the rails are OFF the button is inert (« bientôt »). NO flag-404 on
// the page (the honest data-driven state IS the gate). 0 migration, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

export default function LogisticsWithdrawPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  return <LogisticsWithdraw />
}
