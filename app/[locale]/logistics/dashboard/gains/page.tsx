import { setRequestLocale } from 'next-intl/server'
import LogisticsEarnings from '@/components/logistics/LogisticsEarnings'
import './logistics-earnings.css'

// ── /logistics/dashboard/gains — LO6 « Mes gains » 🔒 (P4.3 ÉTAPE 5). ──────────────
// Rendered inside the amber LogisticsShell (dashboard layout). The client fetches
// /api/logistics/earnings (owner-scoped) and renders the REAL P4.3 earnings: 3 balances
// (Disponible/En attente/Total versé) + the CourierEarning history (course gross→−20 %→net,
// tip 100 %, real Mission id refs) — all SERVER cents, never recomputed. When the accrual
// rail is OFF the table is empty → honest « aucun gain » state. NO flag-404 on the page (the
// honest data-driven state IS the gate). 0 migration, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

export default function LogisticsEarningsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  return <LogisticsEarnings />
}
