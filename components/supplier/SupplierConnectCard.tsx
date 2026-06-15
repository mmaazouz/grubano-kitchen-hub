'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'

// ── SupplierConnectCard — Stripe Connect KYB onboarding entry (B2B Slice 5b) ──
// Client island on /supplier/dashboard. Shows the payout status, launches the
// onboarding (POST /api/supplier/connect → Stripe-hosted link), and refreshes the
// status on mount (reflects a return from onboarding). No money moves (= 5c).
// `enabled` is the immatriculation gate, evaluated server-side.

const TONE: Record<string, BadgeTone> = { none: 'neutral', pending: 'warning', active: 'success', restricted: 'danger' }

export default function SupplierConnectCard({ enabled, initialStatus }: { enabled: boolean; initialStatus: string }) {
  const t = useTranslations('supplier')
  const [status, setStatus] = useState(initialStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Refresh the live status on load (so a return from onboarding reflects at once).
  useEffect(() => {
    fetch('/api/supplier/connect', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.status) setStatus(d.status) })
      .catch(() => {})
  }, [])

  async function connect() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/supplier/connect', { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.url) { window.location.href = d.url; return }
      setError(d?.error || t('connectError'))
    } catch {
      setError(t('connectError'))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = t(`payout${status.charAt(0).toUpperCase()}${status.slice(1)}` as 'payoutNone')
  const ctaLabel = status === 'pending' || status === 'restricted' ? t('connectContinue') : t('connectStart')

  return (
    <Card elevation="sm" padding="md">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <CreditCard size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-grubano-ink">{t('connectTitle')}</p>
            <Badge tone={TONE[status] ?? 'neutral'} size="sm">{statusLabel}</Badge>
          </div>
          <p className="text-sm text-grubano-ink-muted">{t('connectSubtitle')}</p>
        </div>
        {enabled && status !== 'active' && (
          <Button variant="primary" size="sm" loading={busy} onClick={connect}>{ctaLabel}</Button>
        )}
        {status === 'active' && <CheckCircle2 size={20} className="shrink-0 text-grubano-success" />}
      </div>
      {!enabled && (
        <p className="mt-2 flex items-start gap-1.5 rounded-grubano-md bg-grubano-surface-muted px-3 py-2 text-[13px] text-grubano-ink-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-grubano-warning" /> {t('connectGated')}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-grubano-danger">{error}</p>}
    </Card>
  )
}
