'use client'

/**
 * Interactive revenue simulator — client island for the franchise landing page.
 * Isolated here so the parent page can remain an async server component.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/design-system'

const AVG_TICKET      = 14   // €, frozen assumption
const DEFAULT_ROYALTY = 0.06

interface Props {
  /** Royalty rate (fraction, e.g. 0.06) — passed from server so it's consistent */
  royaltyRate?: number
}

export function RevenueCalculator({ royaltyRate = DEFAULT_ROYALTY }: Props) {
  const t = useTranslations('franchise')
  const [orders, setOrders] = useState(80)

  const monthlyRevenue = orders * 30 * AVG_TICKET
  const royalties      = monthlyRevenue * royaltyRate
  const netRevenue     = monthlyRevenue - royalties

  return (
    <>
      <h2 className="text-base font-display font-bold mb-3">{t('calcTitle')}</h2>
      <Card elevation="sm" padding="md" className="mb-8">
        <p className="text-xs text-grubano-ink-muted mb-4">{t('calcSubtitle')}</p>

        <div className="mb-5">
          <div className="flex justify-between mb-2">
            <label className="text-xs font-semibold">{t('calcOrdersLabel')}</label>
            <span className="text-sm font-bold text-grubano-primary">{orders}</span>
          </div>
          <input
            type="range"
            min={20}
            max={200}
            step={5}
            value={orders}
            onChange={e => setOrders(Number(e.target.value))}
            className="w-full accent-grubano-primary h-2 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-grubano-ink-muted mt-1">
            <span>{t('calcMin')}</span>
            <span>{t('calcMax')}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            { label: t('calcGross'),     value: `${(monthlyRevenue / 1000).toFixed(1)}k€`, color: ''                     },
            { label: t('calcRoyalties'), value: `${(royalties      / 1000).toFixed(1)}k€`, color: 'text-grubano-danger'  },
            { label: t('calcNet'),       value: `${(netRevenue     / 1000).toFixed(1)}k€`, color: 'text-grubano-success' },
          ] as const).map(({ label, value, color }) => (
            <div key={label} className="rounded-grubano-md bg-grubano-bg p-3 text-center">
              <p className={`text-sm font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-grubano-ink-muted mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-grubano-ink-muted mt-3 text-center">
          {t('calcFootnote', { ticket: AVG_TICKET })}
        </p>
      </Card>
    </>
  )
}
