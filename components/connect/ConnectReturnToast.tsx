'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'

// ── <ConnectReturnToast /> — Stripe onboarding return marker (A1 contract) ────
//
// Agent 14's Account Links send the operator back to
//   /dashboard?connect=return&restaurant=<id>
// On that marker we re-GET the connect status (the webhook keeps the DB in
// sync anyway — this just refreshes NOW) and, when the account came back
// 'active', show a discreet auto-dismissing toast « Encaissements activés ✓ ».
// Anything else (pending, restricted, failed GET) → nothing: the operator
// will see the real state on the establishment card, never a false positive.
//
// MUST be mounted under <Suspense> (useSearchParams — Next 14 App Router).

export default function ConnectReturnToast() {
  const t = useTranslations('connect')
  const searchParams = useSearchParams()

  const isReturn     = searchParams.get('connect') === 'return'
  const restaurantId = searchParams.get('restaurant') ?? ''

  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isReturn || !restaurantId) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/restaurants/${restaurantId}/connect`, { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json() as { status?: string }
        if (!cancelled && d.status === 'active') setShow(true)
      } catch { /* defensive: no toast */ }
    })()
    return () => { cancelled = true }
  }, [isReturn, restaurantId])

  useEffect(() => {
    if (!show) return
    const id = setTimeout(() => setShow(false), 5000)
    return () => clearTimeout(id)
  }, [show])

  if (!show) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <p className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-grubano-success px-4 py-2 text-[13px] font-bold text-white shadow-lg">
        <Check size={14} /> {t('toastActivated')}
      </p>
    </div>
  )
}
