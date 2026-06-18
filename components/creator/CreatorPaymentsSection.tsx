'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Landmark, Wallet, Hourglass, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, Badge, type BadgeTone } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'
import CreatorConnectCard from '@/components/creator/CreatorConnectCard'

// ── CreatorPaymentsSection — creator "Paiements" block (P4-UI, read-only) ─────
// Shown ONLY when the creator payout rail is enabled server-side
// (CREATOR_CONNECT_ENABLED, surfaced by GET /api/partner/payouts as `enabled`) —
// no half-feature when the flag is OFF (the whole section renders null). Consumes
// the EXISTING routes in read mode: /api/creator/connect (P4.1, via the card),
// /api/partner/balance (P4.2), /api/partner/payouts (history). It NEVER moves money
// and has NO "withdraw" action — payouts are triggered admin/cron (P4.3).

interface PayoutRow {
  id: string; amountCents: number; currency: string
  status: string; paidAt: string | null; stripeTransferId: string | null; createdAt: string
}
interface Balance { role: string; earnedCents: number; paidCents: number; availableCents: number; currency: string }

const PO_TONE: Record<string, BadgeTone> = { pending: 'warning', paid: 'success', failed: 'danger' }

export default function CreatorPaymentsSection() {
  const t = useTranslations('creators.payments')
  const locale = useLocale()

  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError]     = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [poRes, balRes] = await Promise.all([
          fetch('/api/partner/payouts', { cache: 'no-store' }),
          fetch('/api/partner/balance', { cache: 'no-store' }),
        ])
        if (!alive) return
        const po = poRes.ok ? await poRes.json().catch(() => null) : null
        if (po?.enabled) {
          setEnabled(true)
          setPayouts(Array.isArray(po.payouts) ? po.payouts : [])
          const bal = balRes.ok ? await balRes.json().catch(() => null) : null
          const creatorBal = Array.isArray(bal?.balances)
            ? bal.balances.find((b: Balance) => b.role === 'creator') ?? null
            : null
          if (alive) setBalance(creatorBal)
        }
      } catch {
        if (alive) setError(t('errLoad'))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [t])

  // While loading OR when the rail is disabled → render NOTHING (no half-feature,
  // no flash of a gated section).
  if (loading || !enabled) return null

  const fmt = (cents: number) => formatMoney(cents, locale)
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Landmark size={16} className="text-grubano-primary" />
        <h2 className="font-display text-sm font-semibold text-grubano-ink">{t('sectionTitle')}</h2>
      </div>

      {error && (
        <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">
          {error}
        </p>
      )}

      {/* (a) Payout account (Stripe Connect onboarding entry). */}
      <CreatorConnectCard enabled={enabled} />

      {/* (b) Balance — earned / paid / available (read-only). */}
      {balance && (
        <Card elevation="sm" padding="md">
          <div className="mb-3 flex items-center gap-2">
            <Wallet size={14} className="text-grubano-primary" />
            <h3 className="font-display text-sm font-semibold text-grubano-ink">{t('balanceTitle')}</h3>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">
                <Hourglass size={11} />{t('earned')}
              </dt>
              <dd className="mt-1 font-display text-base font-extrabold tabular-nums text-grubano-ink">{fmt(balance.earnedCents)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">{t('paidOut')}</dt>
              <dd className="mt-1 font-display text-base font-extrabold tabular-nums text-grubano-ink">{fmt(balance.paidCents)}</dd>
            </div>
            <div>
              <dt className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-grubano-success">
                <CheckCircle2 size={11} />{t('available')}
              </dt>
              <dd className="mt-1 font-display text-base font-extrabold tabular-nums text-grubano-success">{fmt(balance.availableCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-grubano-ink-muted">{t('maturationHint')}</p>
        </Card>
      )}

      {/* (c) Payout history — read-only. */}
      <Card elevation="sm" padding="md">
        <h3 className="mb-2 font-display text-sm font-semibold text-grubano-ink">{t('historyTitle')}</h3>
        {payouts.length === 0 ? (
          <p className="rounded-grubano-lg border border-dashed border-grubano-border bg-grubano-surface px-3 py-5 text-center text-[12px] text-grubano-ink-muted">
            {t('historyEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-grubano-border">
            {payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold tabular-nums text-grubano-ink">{fmt(p.amountCents)}</p>
                  <p className="mt-0.5 text-[11px] text-grubano-ink-faint">
                    {dateFmt.format(new Date(p.paidAt ?? p.createdAt))}
                  </p>
                </div>
                <Badge tone={PO_TONE[p.status] ?? 'neutral'} size="sm">
                  {t(`poStatus${p.status.charAt(0).toUpperCase()}${p.status.slice(1)}` as 'poStatusPaid')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
