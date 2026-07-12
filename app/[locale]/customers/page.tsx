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
 */

import { callerScopedOperator } from '@/lib/operator-session'
import { getScopedCustomers } from '@/lib/customer-scope'
import CustomersClient, { type CustomerRow } from './CustomersClient'
import './customers.css'

// Session-dependent data — never prerender/cache a tenant's customer list.
export const dynamic = 'force-dynamic'

async function getCustomers(): Promise<{ customers: CustomerRow[]; total: number }> {
  try {
    const operator = await callerScopedOperator()
    if (!operator) return { customers: [], total: 0 }
    // getScopedCustomers returns ONLY masked, contact-free rows — pass through.
    return await getScopedCustomers(operator)
  } catch {
    return { customers: [], total: 0 }
  }
}

export default async function CustomersPage() {
  const { customers, total } = await getCustomers()
  return <CustomersClient customers={customers} total={total} />
}
