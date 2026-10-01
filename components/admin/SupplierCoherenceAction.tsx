'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/design-system'

// ── SupplierCoherenceAction — admin "approve coherence / go live" for ONE supplier (Agent 111).
// Shown ONLY when a supplier is status='active' but still marketplaceCoherencePending=true
// (operational, not yet visible — e.g. the auto coherence check returned doubt/bad). POSTs to
// /api/admin/suppliers/coherence (admin re-checked server-side; clears ONLY the visibility flag —
// never status / money). On success the server page refreshes so the badge + button disappear.
export default function SupplierCoherenceAction(
  { email, label, errorLabel }: { email: string; label: string; errorLabel: string },
) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function approve() {
    setBusy(true)
    setError(false)
    try {
      const res = await fetch('/api/admin/suppliers/coherence', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) router.refresh()
      else setError(true)
    } catch { setError(true) } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" loading={busy} disabled={busy} onClick={approve}>
        {label}
      </Button>
      {error && <span className="text-xs text-grubano-danger">{errorLabel}</span>}
    </div>
  )
}
