'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/design-system'

// ── InfluencerVerifyActions — admin approve/reject for an audience-verification request
// (INF-1, Agent 66). Distinct from the shared ApprovalActions (approve-only) so that one
// stays untouched. POSTs to /api/admin/influencer-verifications; the route re-checks admin.
export default function InfluencerVerifyActions(
  { id, approveLabel, rejectLabel }: { id: string; approveLabel: string; rejectLabel: string },
) {
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  async function decide(action: 'approve' | 'reject') {
    setBusy(action)
    try {
      const res = await fetch('/api/admin/influencer-verifications', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      if (res.ok) router.refresh()
    } catch { /* surfaced by the refreshed list */ } finally { setBusy(null) }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="primary" size="sm" loading={busy === 'approve'} disabled={busy !== null} onClick={() => decide('approve')}>
        {approveLabel}
      </Button>
      <Button variant="ghost" size="sm" loading={busy === 'reject'} disabled={busy !== null} onClick={() => decide('reject')}>
        {rejectLabel}
      </Button>
    </div>
  )
}
