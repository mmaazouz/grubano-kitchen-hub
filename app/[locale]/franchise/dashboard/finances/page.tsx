'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreditCard, AlertCircle } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'

// ── Franchise Finances — real royalty earnings + settlement history (B6, Agent 47) ───
// READ-ONLY. Reads /api/franchise/finances (owner-scoped to the SESSION franchisor):
// authoritative accrued / settled / pending royalties (from FranchiseRoyalty) + the
// settlement history (Payout role='franchise'). No button here moves money. When the
// held-back rail is OFF (royaltyEnabled=false) the amounts stay 0 → shown with a note.

type Payout = {
  id:               string
  amountCents:      number
  currency:         string
  status:           string
  paidAt:           string | null
  stripeTransferId: string | null
  createdAt:        string
}

type FinData = {
  royaltyEnabled: boolean
  accruedCents:   number
  settledCents:   number
  pendingCents:   number
  payouts:        Payout[]
}

const STATUS_TONE: Record<string, BadgeTone> = {
  paid:    'success',
  pending: 'warning',
  failed:  'danger',
}

export default function FranchiseFinancesPage() {
  const t = useTranslations('franchise.finances')

  const [data,    setData]    = useState<FinData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/franchise/finances')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(t('loadError'))
        else setData(d)
      })
      .catch(() => setError(t('errorNetwork')))
      .finally(() => setLoading(false))
  }, [t])

  const fmtEur = (cents: number) =>
    (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const statusLabel = (s: string) =>
    s === 'paid' ? t('statusPaid') : s === 'failed' ? t('statusFailed') : t('statusPending')

  if (loading) {
    return (
      <div className="px-4 pt-5 max-w-2xl mx-auto">
        <SkeletonList count={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 pt-10 max-w-2xl mx-auto">
        <EmptyState
          emoji="⚠️"
          title={error}
          action={
            <Link href="/franchise/dashboard">
              <Button variant="ghost" size="sm">{t('backToDashboard')}</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const d        = data!
  const payouts  = d.payouts ?? []
  const hasPayouts = payouts.length > 0

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-grubano-ink-muted mt-1">{t('subtitle')}</p>
      </div>

      {/* Held-back inactive note — honest about why the figures are 0 */}
      {!d.royaltyEnabled && (
        <div className="mb-5 flex items-start gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-grubano-ink-muted" />
          <p className="text-xs text-grubano-ink-muted">{t('inactiveNote')}</p>
        </div>
      )}

      {/* Authoritative royalty totals */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card elevation="sm" padding="md">
          <p className="text-xs text-grubano-ink-muted mb-1">{t('accruedLabel')}</p>
          <p className="text-lg font-bold">{fmtEur(d.accruedCents)}</p>
        </Card>
        <Card elevation="sm" padding="md">
          <p className="text-xs text-grubano-ink-muted mb-1">{t('settledLabel')}</p>
          <p className="text-lg font-bold text-grubano-success">{fmtEur(d.settledCents)}</p>
        </Card>
        <Card elevation="sm" padding="md">
          <p className="text-xs text-grubano-ink-muted mb-1">{t('pendingLabel')}</p>
          <p className="text-lg font-bold text-grubano-primary">{fmtEur(d.pendingCents)}</p>
        </Card>
      </div>
      <p className="-mt-4 mb-6 text-xs text-grubano-ink-muted">{t('pendingHint')}</p>

      {/* Settlement history */}
      <h2 className="text-base font-display font-bold mb-3">{t('historyTitle')}</h2>

      {!hasPayouts ? (
        <EmptyState
          compact
          emoji={<CreditCard size={26} className="text-grubano-primary" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="space-y-2">
          {payouts.map(p => (
            <Card key={p.id} elevation="sm" padding="md">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{fmtEur(p.amountCents)}</p>
                  <p className="text-[11px] text-grubano-ink-muted">
                    {fmtDate(p.paidAt ?? p.createdAt)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge tone={STATUS_TONE[p.status] ?? 'neutral'} size="sm">
                    {statusLabel(p.status)}
                  </Badge>
                  {p.stripeTransferId && (
                    <span className="text-[10px] text-grubano-ink-muted font-mono truncate max-w-[140px]" dir="ltr">
                      {p.stripeTransferId}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
