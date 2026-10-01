'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, BadgeCheck, Clock, ShieldQuestion } from 'lucide-react'
import { Card, Button, Badge } from '@/components/design-system'

// ── AffiliateVerifyCard — "become an influencer" (audience verification, INF-1, Agent 66) ─
// An affiliate applies to have their AUDIENCE verified; an admin approves. NO money: being
// verified does NOT change commissions yet (that's INF-3). Renders NOTHING when the endpoint
// 404s (INFLUENCER_ENABLED OFF / not an affiliate) → the dashboard stays byte-identical.

const PLATFORMS = ['youtube', 'instagram', 'tiktok', 'other'] as const

type State = {
  verified: boolean
  request: { status: string; platform: string; handle: string; declaredFollowers: number; proofUrl: string | null } | null
}

export default function AffiliateVerifyCard() {
  const t = useTranslations('affiliate')
  const [state, setState]     = useState<State | null>(null)
  const [hidden, setHidden]   = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]         = useState('')

  const [platform, setPlatform]   = useState<typeof PLATFORMS[number]>('instagram')
  const [handle, setHandle]       = useState('')
  const [followers, setFollowers] = useState('')
  const [proofUrl, setProofUrl]   = useState('')

  const load = () => {
    setLoading(true)
    fetch('/api/affiliate/verify-request')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setState)
      .catch(() => setHidden(true))   // 404 (flag OFF) / 401 → hide → byte-identical
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (hidden) return null
  if (loading || !state) {
    return <Card elevation="sm" padding="md"><div className="flex justify-center py-2 text-grubano-ink-muted"><Loader2 size={18} className="animate-spin" /></div></Card>
  }

  async function submit() {
    setSubmitting(true); setErr('')
    try {
      const res = await fetch('/api/affiliate/verify-request', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, handle: handle.trim(), declaredFollowers: Math.max(0, parseInt(followers, 10) || 0), proofUrl: proofUrl.trim() || undefined }),
      })
      if (res.ok) { load(); return }
      const d = await res.json().catch(() => ({}))
      setErr(d.reason === 'already_pending' ? t('verifyAlreadyPending') : d.reason === 'already_verified' ? t('verifyAlreadyVerified') : t('verifyError'))
    } catch { setErr(t('verifyError')) } finally { setSubmitting(false) }
  }

  // ── Verified → influencer badge ──────────────────────────────────────────────
  if (state.verified) {
    return (
      <Card elevation="sm" padding="md" className="border-grubano-primary/30 bg-grubano-tint/40">
        <div className="flex items-center gap-2">
          <BadgeCheck size={18} className="text-grubano-primary" />
          <p className="text-sm font-bold text-grubano-primary">{t('verifyApprovedTitle')}</p>
          <Badge tone="primary" size="sm">{t('verifiedBadge')}</Badge>
        </div>
        <p className="mt-1 text-[12px] text-grubano-ink-muted">{t('verifyApprovedBody')}</p>
      </Card>
    )
  }

  const pending = state.request?.status === 'pending'
  const rejected = state.request?.status === 'rejected'

  return (
    <Card elevation="sm" padding="md">
      <div className="flex items-center gap-2 mb-1">
        <ShieldQuestion size={16} className="text-grubano-primary" />
        <p className="text-sm font-bold">{t('verifyTitle')}</p>
      </div>
      <p className="text-[12px] text-grubano-ink-muted">{t('verifyBody')}</p>

      {pending ? (
        <div className="mt-3 flex items-center gap-2 rounded-grubano-md bg-grubano-bg px-3 py-2 text-[12px] text-grubano-ink-muted">
          <Clock size={14} className="text-grubano-warning shrink-0" />
          <span>{t('verifyPending')}</span>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {rejected && <p className="text-[12px] text-grubano-danger">{t('verifyRejected')}</p>}
          <div>
            <label className="mb-1 block text-[12px] font-semibold">{t('verifyPlatform')}</label>
            <select value={platform} onChange={e => setPlatform(e.target.value as typeof PLATFORMS[number])}
              className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-[13px]">
              {PLATFORMS.map(p => <option key={p} value={p}>{t(`platform_${p}` as 'platform_youtube')}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold">{t('verifyHandle')}</label>
            <input value={handle} onChange={e => setHandle(e.target.value)} maxLength={120}
              className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-[13px]" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold">{t('verifyFollowers')}</label>
            <input value={followers} onChange={e => setFollowers(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
              className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-[13px]" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold">{t('verifyProofUrl')}</label>
            <input value={proofUrl} onChange={e => setProofUrl(e.target.value)} maxLength={500} placeholder="https://"
              className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-[13px]" />
          </div>
          {err && <p className="text-[12px] text-grubano-danger">{err}</p>}
          <Button variant="primary" size="sm" loading={submitting} disabled={!handle.trim()} onClick={submit}>
            {rejected ? t('verifyReapply') : t('verifySubmit')}
          </Button>
        </div>
      )}
    </Card>
  )
}
