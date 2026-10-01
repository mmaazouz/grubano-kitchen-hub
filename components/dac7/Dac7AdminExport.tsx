'use client'

// P4.4-C — admin-only DAC7 export controls. Year selector + CSV/JSON download links to
// /api/admin/dac7/export (itself re-checks the admin session, so this is purely UI).
// Money-neutral; the report is read-only aggregation of the ledger.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/design-system'

export default function Dac7AdminExport({ years }: { years: number[] }) {
  const t = useTranslations('dac7.admin')
  const [year, setYear] = useState(years[0])

  const href = (format: 'csv' | 'json') => `/api/admin/dac7/export?year=${year}&format=${format}`

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <label className="mb-1 block text-[13px] font-semibold text-foreground">{t('yearLabel')}</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
        >
          {years.map((y) => (<option key={y} value={y}>{y}</option>))}
        </select>
      </div>

      <div className="flex flex-wrap gap-3">
        <a href={href('csv')} download>
          <Button size="sm" variant="primary">{t('exportCsv')}</Button>
        </a>
        <a href={href('json')} download>
          <Button size="sm" variant="secondary">{t('exportJson')}</Button>
        </a>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">{t('note')}</p>
    </div>
  )
}
