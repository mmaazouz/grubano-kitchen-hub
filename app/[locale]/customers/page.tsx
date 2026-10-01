/**
 * /customers — operator CLIENTS list. VERBATIM CD (Notion « Fiche client »).
 *
 * Wrapped by AppChrome → OperatorShell (navy --op-* chrome, « Clients » active).
 *
 * 🔒 TENANT SCOPING + PII MASKING (founder hybrid model). SERVER COMPONENT: the
 * top-20 (by points) + member count are SCOPED to the authenticated operator's OWN
 * customers via lib/customer-scope — a restaurateur never sees a customer who never
 * ordered chez lui. Rows carry a MASKED identity (first name + last initial) and
 * REAL relation aggregates (orders count, average basket) — NEVER email, phone or
 * address. Admin keeps the platform-wide view; no session → empty screen (the
 * middleware already gates the route restaurant/admin). The query never leaves the
 * server; <CustomersClient/> only ever receives masked, contact-free rows.
 *
 * Vague 2 (B + C): the 4-KPI strip + per-tier filter counters are computed
 * server-side over EXACTLY the list's scope (same fence, same tenant, same
 * status exclusions). The ?tier filter re-runs the query on the server (the
 * chips navigate) — never a client-side cut of the visible 20 rows.
 */

import { callerScopedOperator } from '@/lib/operator-session'
import {
  getScopedCustomers,
  getCustomerScreenStats,
  CUSTOMER_TIERS,
  type CustomerTier,
  type CustomerScreenStats,
} from '@/lib/customer-scope'
import CustomersClient, { type CustomerRow } from './CustomersClient'
import './customers.css'

// Session-dependent data — never prerender/cache a tenant's customer list.
export const dynamic = 'force-dynamic'

const EMPTY_STATS: CustomerScreenStats = {
  totalCustomers: 0, newThisMonth: 0, loyaltyMembers: 0, avgBasketCents: 0, tierCounts: {},
}

async function getData(tier?: CustomerTier): Promise<{ customers: CustomerRow[]; total: number; stats: CustomerScreenStats }> {
  try {
    const operator = await callerScopedOperator()
    if (!operator) return { customers: [], total: 0, stats: EMPTY_STATS }
    // getScopedCustomers returns ONLY masked, contact-free rows — pass through.
    const [{ customers, total }, stats] = await Promise.all([
      getScopedCustomers(operator, { tier }),
      getCustomerScreenStats(operator),
    ])
    return { customers, total, stats }
  } catch {
    return { customers: [], total: 0, stats: EMPTY_STATS }
  }
}

export default async function CustomersPage({ searchParams }: { searchParams?: { tier?: string } }) {
  // Only the four known tiers are accepted — anything else falls back to « Tous ».
  const raw = searchParams?.tier
  const tier = (CUSTOMER_TIERS as readonly string[]).includes(raw ?? '') ? (raw as CustomerTier) : undefined
  const { customers, total, stats } = await getData(tier)
  return <CustomersClient customers={customers} total={total} stats={stats} activeTier={tier ?? null} />
}
