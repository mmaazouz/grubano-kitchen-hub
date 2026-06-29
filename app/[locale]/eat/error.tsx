'use client'

import { useEffect } from 'react'
import EatStateScreen from '@/components/eat/EatStateScreen'

// /eat/error — the /eat segment error boundary. Next renders this when a render/data error
// is thrown anywhere under /eat. We surface the CD « hors-ligne » (network-failure) state:
// most runtime failures in this app are recoverable network hiccups, and the CD brief maps
// "error boundary réseau" → the offline visual. The primary « Réessayer » button calls the
// boundary's reset() (re-renders the segment); the secondary « Voir mes commandes » link
// (inside <EatStateScreen/>) is the always-available exit. No money flow.
export default function EatError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log for diagnostics (English in logs, per project convention).
    console.error('[eat] segment error boundary:', error)
  }, [error])

  return <EatStateScreen variant="offline" onRetry={reset} />
}
