import { setRequestLocale } from 'next-intl/server'
import MesMissions from '@/components/logistics/MesMissions'
import './logistics-missions.css'

// ── /logistics/dashboard/missions — the courier's missions surface (LO2). ─────
// Rendered inside the amber LogisticsShell (dashboard layout). The interactive 3-tab
// surface is the MesMissions client (offers masked / current revealed post-claim / history).
// Owner-scoped + gated inside the API routes → when LOGISTICS_MISSIONS_ENABLED is OFF the
// fetches 404 and every tab shows an honest empty state (byte-identical). RE-SKIN 0 migration,
// flags OFF byte-identical, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

export default function LogisticsMissionsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  return <MesMissions />
}
