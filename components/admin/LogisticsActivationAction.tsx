'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/design-system'

// ── LogisticsActivationAction — admin "Verify & Activate" for ONE courier (Agent 125).
// POSTs to /api/admin/logistics/activation (admin re-checked server-side). The server REFUSES
// (409, reason 'activation_disabled') while the waitlist flag is OFF — we surface that message
// gracefully (NOT an error). On success the server page refreshes. NO money.
export default function LogisticsActivationAction(
  { email, label, errorLabel, disabledLabel }: { email: string; label: string; errorLabel: string; disabledLabel: string },
) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function activate() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/logistics/activation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) { router.refresh(); return }
      // Master guardrail OFF → informative, not an error.
      setMsg(data?.reason === 'activation_disabled' ? disabledLabel : errorLabel)
    } catch { setMsg(errorLabel) } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={activate}>
        {label}
      </Button>
      {msg && <span className="text-xs text-grubano-ink-muted text-right">{msg}</span>}
    </div>
  )
}
