'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/design-system'

// ── SupplierStatusActions — admin activate / suspend for ONE supplier (Agent 85).
// POSTs to the EXISTING admin route /api/supplier/admin/status (which re-checks admin
// server-side and only changes the BUSINESS status — never money). "Activer" shows
// unless the supplier is already active; "Suspendre" shows only when active. On success
// the server page is refreshed so the new status + buttons reflect reality.
export default function SupplierStatusActions(
  { email, status, activateLabel, suspendLabel, errorLabel }:
  { email: string; status: string; activateLabel: string; suspendLabel: string; errorLabel: string },
) {
  const router = useRouter()
  const [busy, setBusy] = useState<'active' | 'suspended' | null>(null)
  const [error, setError] = useState(false)

  async function setStatus(next: 'active' | 'suspended') {
    setBusy(next)
    setError(false)
    try {
      const res = await fetch('/api/supplier/admin/status', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, status: next }),
      })
      if (res.ok) router.refresh()
      else setError(true)
    } catch { setError(true) } finally { setBusy(null) }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        {status !== 'active' && (
          <Button variant="primary" size="sm" loading={busy === 'active'} disabled={busy !== null} onClick={() => setStatus('active')}>
            {activateLabel}
          </Button>
        )}
        {status === 'active' && (
          <Button variant="ghost" size="sm" loading={busy === 'suspended'} disabled={busy !== null} onClick={() => setStatus('suspended')}>
            {suspendLabel}
          </Button>
        )}
      </div>
      {error && <span className="text-xs text-grubano-danger">{errorLabel}</span>}
    </div>
  )
}
