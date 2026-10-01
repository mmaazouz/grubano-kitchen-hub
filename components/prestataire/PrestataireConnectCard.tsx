'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, CheckCircle2 } from 'lucide-react'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'

// ── PrestataireConnectCard — Stripe Connect KYB onboarding entry (services P7) ─
// CLONE of SupplierConnectCard. Client island on /prestataire/dashboard. Shows the
// payout status, launches the onboarding (POST /api/prestataire/connect → Stripe-hosted
// link), and refreshes the status on mount (reflects a return from onboarding). ⚠️ NO
// money moves (= P8). It is MOUNTED ONLY when the double flag is live (server-gated on the
// page) → when OFF nothing renders, so the card has no gated branch.

const TONE: Record<string, BadgeTone> = { none: 'neutral', pending: 'warning', active: 'success', restricted: 'danger' }

export default function PrestataireConnectCard({ initialStatus }: { initialStatus: string }) {
  const t = useTranslations('prestataire.connect')
  const [status, setStatus] = useState(initialStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Refresh the live status on load (so a return from onboarding reflects at once).
  useEffect(() => {
    fetch('/api/prestataire/connect', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.status) setStatus(d.status) })
      .catch(() => {})
  }, [])

  async function connect() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/prestataire/connect', { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.url) { window.location.href = d.url; return }
      setError(d?.error || t('error'))
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  const statusLabel = t(`payout${status.charAt(0).toUpperCase()}${status.slice(1)}` as 'payoutNone')
  const ctaLabel = status === 'pending' || status === 'restricted' ? t('continue') : t('start')

  return (
    <Card elevation="sm" padding="md">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <CreditCard size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-grubano-ink">{t('title')}</p>
            <Badge tone={TONE[status] ?? 'neutral'} size="sm">{statusLabel}</Badge>
          </div>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
        {status !== 'active' && (
          <Button variant="primary" size="sm" loading={busy} onClick={connect}>{ctaLabel}</Button>
        )}
        {status === 'active' && <CheckCircle2 size={20} className="shrink-0 text-grubano-success" />}
      </div>
      {error && <p className="mt-2 text-sm text-grubano-danger">{error}</p>}
    </Card>
  )
}
