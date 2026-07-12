/**
 * /customers/[id] — operator FICHE CLIENT. VERBATIM CD « Fiche client » (detail).
 *
 * 🔒 TENANT-FENCED + CONTACT-FREE. getCustomerProfile returns the profile ONLY if
 * the customer is in the caller's tenant (same fence as the list) — a foreign
 * customer → notFound() (404), never a leak. The profile carries a MASKED identity,
 * REAL relation data (orders/basket/history/preferences), loyalty status — and NO
 * email, phone or address. Allergen/dietary notes surface PER ORDER (food safety),
 * never as a stored health profile. Admin keeps the platform-wide fence.
 */

import { notFound } from 'next/navigation'
import { callerScopedOperator } from '@/lib/operator-session'
import { getCustomerProfile } from '@/lib/customer-scope'
import CustomerProfileClient from './CustomerProfileClient'
import './customer-profile.css'

export const dynamic = 'force-dynamic'

export default async function CustomerProfilePage({ params }: { params: { id: string } }) {
  const operator = await callerScopedOperator()
  if (!operator) notFound()

  const profile = await getCustomerProfile(operator, params.id)
  if (!profile) notFound()

  return <CustomerProfileClient profile={profile} />
}
