import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import PrestataireRegisterForm from './RegisterForm'

// ── /business/prestataire/register — SERVER flag gate (P1, Agent 74) ──
// The /business/* tree is PUBLIC (middleware allow-list), so the role's EXISTENCE must
// not leak when PRESTATAIRE_ENABLED is OFF. This server page 404s (notFound) BEFORE
// rendering anything — byte-identical to the route not existing — and only mounts the
// client form when the flag is ON. Defence in depth: POST /api/prestataire/register is
// independently 404-gated, so even a hand-crafted submission has no effect when OFF.
export const dynamic = 'force-dynamic'

export default function PrestataireRegisterPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <PrestataireRegisterForm />
}
