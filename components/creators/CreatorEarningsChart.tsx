'use client'

/**
 * 30-day creator earnings chart with recipe / referral breakdown.
 * Premium segment toggle: "Tout" (stacked), "Recettes", "Parrainage".
 * Isolated as a client island — parent server component stays lean.
 */

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  BarChart, Bar, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import type { ChartDatum } from '@/app/api/creators/home/route'
import { formatEuros } from '@/lib/format-money'

// ── Brand palette ──────────────────────────────────────────────────────────────
// COLOR_RECIPE   = grubano-primary (#F97316) — via CSS variable
// COLOR_REFERRAL = design-tokens.info (#3B82F6) — in-charter blue, harmonious w/ orange

const COLOR_RECIPE   = 'var(--primary)'
const COLOR_REFERRAL = '#3B82F6'

type Segment = 'all' | 'recipe' | 'referral'

interface Props {
  data:                 ChartDatum[]
  recipeEarnings30d?:   number
  referralEarnings30d?: number
  /** Real adoption rate %, from AdoptionConfig — the legend hides the figure
   *  when absent (never a hardcoded 4%, point dur E). */
  recipeRatePct?:       number
}

// Shared recharts axis props to avoid duplication
const AXIS_PROPS = {
  axisLine: false as const,
  tickLine: false as const,
  tick:     { fontSize: 9, fill: 'var(--muted-foreground)' },
}

const TOOLTIP_STYLE = {
  fontSize:     11,
  borderRadius: 8,
  border:       '1px solid var(--border)',
  background:   'var(--card)',
  padding:      '8px 12px',
  lineHeight:   '1.6',
}

export function CreatorEarningsChart({
  data,
  recipeEarnings30d   = 0,
  referralEarnings30d = 0,
  recipeRatePct,
}: Props) {
  const t = useTranslations('creators.home')
  const locale = useLocale()
  const [segment, setSegment] = useState<Segment>('all')

  const hasData = data.some(d => d.amount > 0)

  if (!hasData) {
    return (
      <div className="grid h-[180px] place-items-center text-center px-4">
        <p className="text-xs text-grubano-ink-muted">{t('perfEmpty')}</p>
      </div>
    )
  }

  // Show one label every 5 days to avoid crowding
  const labeledData = data.map((d, i) => ({
    ...d,
    displayLabel: i % 5 === 0 ? d.label : '',
  }))

  const SEGMENTS: { key: Segment; label: string }[] = [
    { key: 'all',      label: t('perfSegAll')      },
    { key: 'recipe',   label: t('perfSegRecipe')   },
    { key: 'referral', label: t('perfSegReferral') },
  ]

  // Custom tooltip: shows both lines + total in "all" mode, single line otherwise
  // recharts Payload has payload? as optional — we guard with ?. before use
  type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartDatum }> }
  const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    return (
      <div style={TOOLTIP_STYLE}>
        <p style={{ marginBottom: 4, fontWeight: 600, fontSize: 10, color: 'var(--muted-foreground)' }}>
          {d.date}
        </p>
        {segment !== 'referral' && (
          <p style={{ color: COLOR_RECIPE }}>
            {t('perfSegRecipe')}: <strong>{formatEuros(d.recipeAmount ?? 0, locale)}</strong>
          </p>
        )}
        {segment !== 'recipe' && (
          <p style={{ color: COLOR_REFERRAL }}>
            {t('perfSegReferral')}: <strong>{formatEuros(d.referralAmount ?? 0, locale)}</strong>
          </p>
        )}
        {segment === 'all' && d.amount > 0 && (
          <p style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
            {t('perfTooltipTotal')}: {formatEuros(d.amount, locale)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Segment selector — top right pill tabs */}
      <div className="flex justify-end mb-2">
        <div className="flex rounded-grubano-pill bg-grubano-bg p-0.5 gap-0.5">
          {SEGMENTS.map(s => (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={[
                'px-2.5 py-1 text-[10px] rounded-grubano-pill transition-colors font-medium leading-none',
                segment === s.key
                  ? 'bg-grubano-primary/10 text-grubano-primary'
                  : 'text-grubano-ink-muted hover:text-grubano-ink',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={labeledData} barSize={14} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="displayLabel" {...AXIS_PROPS} />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={v => formatEuros(Number(v), locale, { noDecimals: true })}
            width={40}
          />
          <Tooltip content={CustomTooltip} />

          {/* Recipe bar — bottom of stack in "all" mode, standalone in "recipe" */}
          {(segment === 'recipe' || segment === 'all') && (
            <Bar
              dataKey="recipeAmount"
              stackId={segment === 'all' ? 'stack' : undefined}
              fill={COLOR_RECIPE}
              radius={segment === 'all' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            />
          )}

          {/* Referral bar — top of stack in "all" mode, standalone in "referral" */}
          {(segment === 'referral' || segment === 'all') && (
            <Bar
              dataKey="referralAmount"
              stackId={segment === 'all' ? 'stack' : undefined}
              fill={COLOR_REFERRAL}
              radius={[4, 4, 0, 0]}
            />
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* Legend with 30-day totals per source */}
      <div className="flex gap-4 mt-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: COLOR_RECIPE }} />
          <span className="text-[10px] text-grubano-ink-muted">
            {t('perfSegRecipe')}{recipeRatePct != null ? ` (${recipeRatePct}%)` : ''}
            {' — '}
            <span className="font-semibold text-grubano-ink">{formatEuros(recipeEarnings30d, locale)}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: COLOR_REFERRAL }} />
          <span className="text-[10px] text-grubano-ink-muted">
            {t('perfSegReferral')} (22%)
            {' — '}
            <span className="font-semibold text-grubano-ink">{formatEuros(referralEarnings30d, locale)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
