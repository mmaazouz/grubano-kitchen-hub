'use client'

/**
 * 14-day revenue bar chart for the operator home page.
 *
 * Lives in its own client component so the parent page (server) can stay
 * server-rendered and only ship recharts JS on the routes that need it.
 */

import { useTranslations } from 'next-intl'
import {
  BarChart, Bar, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

export interface RevenueChartDatum {
  /** ISO date — used as a stable key */
  date:  string
  /** Short human label shown on the X axis (e.g. "Lun", "12/05"). */
  label: string
  /** Revenue total in EUR for that day. */
  amount: number
}

export function DashboardRevenueChart({ data }: { data: RevenueChartDatum[] }) {
  const t = useTranslations('dashboard.home.perf')

  if (data.every(d => d.amount === 0)) {
    return (
      <div className="grid h-[160px] place-items-center text-center">
        <p className="text-xs text-grubano-ink-muted">{t('empty')}</p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} barSize={18}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          interval={1}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => `€${v}`}
          width={36}
        />
        <Tooltip
          formatter={v => [
            typeof v === 'number' ? `€${v.toFixed(2)}` : `€${v}`,
            t('tooltip'),
          ]}
          contentStyle={{
            fontSize:     11,
            borderRadius: 8,
            border:       '1px solid var(--border)',
            background:   'var(--card)',
          }}
        />
        <Bar dataKey="amount" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
