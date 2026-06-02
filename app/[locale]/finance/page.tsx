'use client'

/**
 * Finance — restaurateur P&L over a rolling 30-day window.
 *
 * Wired to GET /api/finance/summary (read-only). The navy hero shows real gross
 * revenue with a clear breakdown (− Grubano commission, − creator cost,
 * − funded welcome discounts, = net). A dedicated block frames the creator
 * spend as an investment: cost AND the measured CA those creators brought in.
 * No hardcoded figures, no PDF generation (reports stay decorative / "soon").
 */

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { PieChart, Receipt, TrendingUp, Download, Lock, Sparkles, ArrowRight } from 'lucide-react'
import { Link } from '@/navigation'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

type FinanceSummary = {
  windowDays:          number
  caBrut:              number
  commissionGrubano:   number
  verseAuxCreateurs:   number
  remisesFinancees:    number
  netResto:            number
  caAmeneParCreateurs: number
  ordersFromCreators:  number
  ordersTotal:         number
}

export default function FinancePage() {
  const t      = useTranslations('finance')
  const locale = useLocale()

  const [data,    setData]    = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/finance/summary')
      .then(r => r.json())
      .then((d: FinanceSummary) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Locale-aware EUR formatting, always 2 decimals (finance precision).
  const eur = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n ?? 0)

  const caBrut              = data?.caBrut              ?? 0
  const commissionGrubano   = data?.commissionGrubano   ?? 0
  const verseAuxCreateurs   = data?.verseAuxCreateurs   ?? 0
  const remisesFinancees    = data?.remisesFinancees    ?? 0
  const netResto            = data?.netResto            ?? 0
  const caAmeneParCreateurs = data?.caAmeneParCreateurs ?? 0
  const ordersFromCreators  = data?.ordersFromCreators  ?? 0
  const ordersTotal         = data?.ordersTotal         ?? 0

  const hasCreatorCost = verseAuxCreateurs > 0

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">{t('title')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('subtitle')}</p>

      {loading ? (
        <div className="mb-5 h-44 animate-pulse rounded-3xl bg-navy/10" />
      ) : ordersTotal === 0 ? (
        /* Empty state — no orders in the window (no crash, everything reads 0). */
        <div className="mb-5 rounded-3xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm font-bold">{t('emptyTitle')}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('emptyDesc')}</p>
        </div>
      ) : (
        <>
          {/* Rolling 30-day summary — real gross revenue + breakdown to net */}
          <div className="overflow-hidden rounded-3xl bg-navy p-5 text-navy-foreground mb-5">
            <p className="text-[11px] uppercase tracking-wider text-navy-foreground/60">
              {t('windowLabel')}
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{eur(caBrut)}</p>
            <p className="mt-1 text-[12px] text-navy-foreground/70">{t('caBrutLabel')}</p>

            <div className="mt-4 space-y-1.5 border-t border-navy-foreground/10 pt-4">
              <Row label={t('commissionLabel')}    value={`−${eur(commissionGrubano)}`} tone="minus" />
              <Row label={t('creatorsCostLabel')}  value={`−${eur(verseAuxCreateurs)}`} tone="minus" />
              <Row label={t('discountsLabel')}      value={`−${eur(remisesFinancees)}`}  tone="minus" />
              <div className="mt-1 flex items-center justify-between border-t border-navy-foreground/10 pt-2">
                <span className="text-[13px] font-semibold">{t('netLabel')}</span>
                <span className="text-base font-bold tabular-nums text-success">{eur(netResto)}</span>
              </div>
            </div>
          </div>

          {/* Creator COST + VALUE — spend framed as a measured investment */}
          {hasCreatorCost ? (
            <Card className="mb-5 border-primary/20 bg-accent">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles size={16} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">{t('valueTitle')}</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {t('valueBody', { ca: eur(caAmeneParCreateurs), cost: eur(verseAuxCreateurs) })}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-primary">
                    {t('valueOrders', { count: ordersFromCreators })}
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            /* Restaurant with no adopted dish → discreet CTA to open the channel */
            <Link
              href="/menu"
              className="mb-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-4"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles size={16} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">{t('ctaTitle')}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{t('ctaBody')}</p>
              </div>
              <ArrowRight size={16} className="shrink-0 text-primary" />
            </Link>
          )}
        </>
      )}

      <SectionTitle>{t('reportsTitle')}</SectionTitle>
      <div className="space-y-2">
        {[
          { icon: Receipt,    title: t('report1Title'), desc: t('report1Desc') },
          { icon: PieChart,   title: t('report2Title'), desc: t('report2Desc') },
          { icon: TrendingUp, title: t('report3Title'), desc: t('report3Desc') },
        ].map((r) => (
          <div key={r.title} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <r.icon size={16} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-[11px] text-muted-foreground">{r.desc}</p>
            </div>
            {/* Decorative until real export ships (out of scope) → disabled + "soon" */}
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              {t('reportsSoon')}
            </span>
            <button
              disabled
              aria-disabled="true"
              className="grid h-8 w-8 cursor-not-allowed place-items-center rounded-lg border border-border opacity-40"
            >
              <Download size={13} />
            </button>
          </div>
        ))}
      </div>

      <Link href="/premium" className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3">
        <Lock size={14} className="text-primary" />
        <div className="flex-1">
          <p className="text-xs font-bold">{t('proTitle')}</p>
          <p className="text-[11px] text-muted-foreground">{t('proDesc')}</p>
        </div>
        <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">{t('proBadge')}</span>
      </Link>
    </div>
  )
}

/* One breakdown line inside the navy hero. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'minus' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px] text-navy-foreground/70">{label}</span>
      <span className={`text-[13px] font-semibold tabular-nums ${tone === 'minus' ? 'text-destructive' : ''}`}>
        {value}
      </span>
    </div>
  )
}
