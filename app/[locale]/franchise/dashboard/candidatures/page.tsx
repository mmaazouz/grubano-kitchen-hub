'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Inbox, Check, X, Loader2 } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'

// ── Franchisor candidatures — review join requests to MY brands (B7, Agent 48) ───────
// READS /api/franchise/applications (owner-scoped server-side). Approve → a point of sale
// is created and the applicant's restaurant is linked (1:1, server-side, atomic). Reject →
// status only. No money moves here.

type App = {
  id:             string
  status:         string
  message:        string | null
  createdAt:      string
  brandName:      string
  brandEmoji:     string
  restaurantName: string
  restaurantCity: string
}

const TONE: Record<string, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' }

export default function FranchiseCandidaturesPage() {
  const t = useTranslations('franchise.applications')

  const [apps, setApps]       = useState<App[] | null>(null)
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState<string | null>(null)

  function load() {
    fetch('/api/franchise/applications')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setApps(d.applications ?? []))
      .catch(() => setError(t('loadError')))
  }
  useEffect(load, [t])

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id + action); setError('')
    try {
      const res = await fetch('/api/franchise/applications', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ id, action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? t('errorNetwork')); return }
      // Reflect the decision locally.
      setApps(prev => (prev ?? []).map(a => (a.id === id ? { ...a, status: action === 'approve' ? 'approved' : 'rejected' } : a)))
    } catch {
      setError(t('errorNetwork'))
    } finally {
      setBusy(null)
    }
  }

  const statusLabel = (s: string) =>
    s === 'approved' ? t('statusApproved') : s === 'rejected' ? t('statusRejected') : t('statusPending')

  if (apps === null && !error) {
    return <div className="px-4 pt-5 max-w-2xl mx-auto"><SkeletonList count={4} /></div>
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-grubano-ink-muted mt-1">{t('subtitle')}</p>
      </div>

      {error && (
        <p className="mb-4 rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">{error}</p>
      )}

      {(apps ?? []).length === 0 ? (
        <EmptyState
          emoji={<Inbox size={28} className="text-grubano-primary" />}
          title={t('empty')}
          action={
            <Link href="/franchise/dashboard">
              <Button variant="ghost" size="sm">{t('backToDashboard')}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {(apps ?? []).map(a => {
            const pending = a.status === 'pending'
            return (
              <Card key={a.id} elevation="sm" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{a.brandEmoji}</span>
                      <p className="font-bold text-sm truncate">{a.restaurantName || '—'}</p>
                    </div>
                    <p className="text-[11px] text-grubano-ink-muted mt-0.5">
                      {t('joinBrand', { brand: a.brandName })}{a.restaurantCity ? ` · ${a.restaurantCity}` : ''}
                    </p>
                  </div>
                  <Badge tone={TONE[a.status] ?? 'neutral'} size="sm">{statusLabel(a.status)}</Badge>
                </div>

                {a.message && (
                  <p className="mt-2 rounded-grubano-md bg-grubano-bg px-2.5 py-2 text-xs text-grubano-ink-muted">“{a.message}”</p>
                )}

                {pending && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="primary" size="sm" leftIcon={busy === a.id + 'approve' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      onClick={() => decide(a.id, 'approve')} disabled={busy !== null}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      variant="ghost" size="sm" leftIcon={busy === a.id + 'reject' ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      onClick={() => decide(a.id, 'reject')} disabled={busy !== null}
                    >
                      {t('reject')}
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
