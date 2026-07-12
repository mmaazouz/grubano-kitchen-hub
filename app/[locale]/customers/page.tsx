/**
 * /customers — operator CLIENTS screen. VERBATIM CD v1 (Notion 390fd2c9-…-a472bfd0).
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome, « Clients »
 * active in the rail). This file renders ONLY the screen content = a <section> inside op-content.
 *
 * 🔒 DATA INTEGRITY + TENANT SCOPING (SEC fix — cross-resto PII). This stays a SERVER
 * COMPONENT: the real query (top 20 by pointsBalance) + the real member count are kept, but
 * they are now SCOPED to the authenticated operator's OWN customers via lib/customer-scope —
 * a restaurateur can never see a customer who never ordered at his establishment. Before this
 * fix the findMany was unscoped: any restaurateur saw the whole platform's top-20 loyalty
 * customers (name+email+phone). Admin keeps the platform-wide view; no/unknown session renders
 * an empty screen (defence in depth — the middleware already gates the route restaurant/admin).
 * Interactivity (tier filter, search, detail panel) is delegated to <CustomersClient/>, which
 * receives the scoped rows + count as props — the query never leaves the server.
 *
 * ⚠️ HONEST DE-MOCK. The legacy screen FABRICATED top stats (« note moyenne 4.8 », « LTV moyenne
 * 87 € ») and the CD mock shows per-client Commandes / Total dépensé (LTV) / Dernière visite —
 * NONE of those exist on LoyaltyCustomer and NONE are computed. They are NOT reproduced as real:
 * they render as honest « bientôt » previews. Only the member count is a real aggregate; the other
 * stat tiles are « bientôt ». Points are integer loyalty points (NOT money). See CustomersClient.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getScopedCustomers } from '@/lib/customer-scope'
import CustomersClient, { type CustomerRow } from './CustomersClient'
import './customers.css'

// Session-dependent data — never prerender/cache a tenant's customer list.
export const dynamic = 'force-dynamic'

async function getCustomers(): Promise<{ customers: CustomerRow[]; total: number }> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return { customers: [], total: 0 }

    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true, operatorRoles: { select: { role: true } } },
    })
    if (!operator) return { customers: [], total: 0 }

    const roles = Array.from(
      new Set([operator.role, ...operator.operatorRoles.map((r) => r.role)]),
    )
    const { customers, total } = await getScopedCustomers({ id: operator.id, roles })

    return {
      // map ONLY the real scalar fields we display (name, email, integer points, tier, since)
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        pointsBalance: c.pointsBalance,
        tier: c.tier,
        createdAt: c.createdAt.toISOString(),
      })),
      total,
    }
  } catch {
    return { customers: [], total: 0 }
  }
}

export default async function CustomersPage() {
  const { customers, total } = await getCustomers()
  return <CustomersClient customers={customers} total={total} />
}
