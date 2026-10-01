import { redirect } from 'next/navigation'

/**
 * Operator root route.
 *
 * Host-based routing now lives in `middleware.ts` (Brique 2C fix): on the partner
 * subdomain (business.grubano.com) the middleware redirects `/{locale}` →
 * `/{locale}/business/auth` BEFORE this component ever renders, so the only host
 * that reaches here is the operator app — which goes to the dashboard as before.
 */
export default function Home({ params: { locale } }: { params: { locale: string } }) {
  redirect(`/${locale}/dashboard`)
}
