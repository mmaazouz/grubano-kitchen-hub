import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isPartnerHostValue } from '@/lib/partner-host'

/**
 * Root route — host-aware.
 *
 *  - business.grubano.com  → /{locale}/business/auth  (partner space)
 *  - everything else       → /{locale}/dashboard       (existing operator default)
 *
 * Host is read SERVER-SIDE from the request headers (x-forwarded-host first so
 * we honour the o2switch / Passenger reverse-proxy) — no middleware change.
 * The same env override the partner API uses (`PARTNER_REGISTER_ALLOW_HOST`)
 * opens the gate for local + staging hosts.
 */
export default function Home({ params: { locale } }: { params: { locale: string } }) {
  const h = headers()
  const hostHeader = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (isPartnerHostValue(hostHeader)) {
    redirect(`/${locale}/business/auth`)
  }
  redirect(`/${locale}/dashboard`)
}
