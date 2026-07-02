/**
 * /customers — operator CLIENTS screen. VERBATIM CD v1 (Notion 390fd2c9-…-a472bfd0).
 *
 * The page is already wrapped by AppChrome → OperatorShell (navy --op-* chrome, « Clients »
 * active in the rail). This file renders ONLY the screen content = a <section> inside op-content.
 *
 * 🔒 DATA INTEGRITY. This stays a SERVER COMPONENT that reads Prisma directly — the real query
 * (prisma.loyaltyCustomer.findMany, top 20 by pointsBalance) + the real member count are kept
 * byte-identical. The rows are REAL LoyaltyCustomer records (name, email, integer pointsBalance,
 * tier). Interactivity (tier filter, search, detail panel) is delegated to <CustomersClient/>,
 * which receives the real rows + count as props — the query never leaves the server.
 *
 * ⚠️ HONEST DE-MOCK. The legacy screen FABRICATED top stats (« note moyenne 4.8 », « LTV moyenne
 * 87 € ») and the CD mock shows per-client Commandes / Total dépensé (LTV) / Dernière visite —
 * NONE of those exist on LoyaltyCustomer and NONE are computed. They are NOT reproduced as real:
 * they render as honest « bientôt » previews. Only the member count is a real aggregate; the other
 * stat tiles are « bientôt ». Points are integer loyalty points (NOT money). See CustomersClient.
 */

import { prisma } from '@/lib/prisma'
import CustomersClient, { type CustomerRow } from './CustomersClient'
import './customers.css'

async function getCustomers(): Promise<{ customers: CustomerRow[]; total: number }> {
  try {
    const customers = await prisma.loyaltyCustomer.findMany({
      orderBy: { pointsBalance: 'desc' },
      take: 20,
    })
    const total = await prisma.loyaltyCustomer.count()
    return {
      // map ONLY the real scalar fields we display (name, email, integer points, tier, since)
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone ?? null,
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
