'use client'

// ── Admin approval action button (B2.4 / SEC2, Agent 33) ──────────────────────
// One reusable "approve" button for the admin console. POSTs to an admin-gated
// endpoint, then router.refresh() so the server re-reads the pending lists and the
// just-approved row drops out. Self-contained loading / error states (no global
// ToastProvider on the operator chrome) — the row's spinner + an inline role=alert
// error keep the feedback local and accessible.
//
// Authorization lives ENTIRELY server-side (the endpoint re-checks the session is
// admin). This button never carries authority — it only triggers the call.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { Button } from '@/components/design-system'

export default function ApprovalActions({
  endpoint,
  body,
  label,
}: {
  /** Admin-gated POST endpoint. */
  endpoint: string
  /** Optional JSON body (e.g. { applicationId } for franchise approval). */
  body?: Record<string, unknown>
  /** Translated button label. */
  label: string
}) {
  const t = useTranslations('admin.approvals')
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : t('actionError'))
        return
      }
      // Server re-reads the pending lists → the approved item drops out.
      router.refresh()
    } catch {
      setError(t('networkError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <Button
        variant="primary"
        size="sm"
        loading={pending}
        leftIcon={<Check size={14} />}
        onClick={approve}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-xs font-medium text-grubano-danger">
          {error}
        </p>
      )}
    </div>
  )
}
