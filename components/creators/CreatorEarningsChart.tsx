'use client'

/**
 * 30-day referral-earnings bar chart for the creator dashboard home.
 * Isolated as a client island so the parent server component can stay lean.
 */

import { useTranslations } from 'next-intl'
import {
  BarChart, Bar, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ChartDatum } from '@/app/api/creators/home/route'

export function CreatorEarningsChart({ data }: { data: ChartDatum[] }) {
  const t = useTranslations('creators.home')

  const hasData = data.some(d => d.amount > 0)

  if (!hasData) {
    return (
      <div className="grid h-[160px] place-items-center text-center px-4">
        <p className="text-xs text-grubano-ink-muted">{t('perfEmpty')}</p>
      </div>
    )
  }

  // Show one label every 5 days to avoid crowding
  const labeledData = data.map((d, i) => ({
    ...d,
    displayLabel: i % 5 === 0 ? d.label : '',
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={labeledData} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="displayLabel"
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => `€${v}`}
          width={32}
        />
        <Tooltip
          formatter={v => [
            typeof v === 'number' ? `€${v.toFixed(2)}` : `€${v}`,
            t('perfTooltip'),
          ]}
          contentStyle={{
            fontSize:     11,
            borderRadius: 8,
            border:       '1px solid var(--border)',
            background:   'var(--card)',
          }}
          labelFormatter={(_label, payload) =>
            payload?.[0] ? (payload[0].payload as ChartDatum).date : ''
          }
        />
        <Bar dataKey="amount" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
