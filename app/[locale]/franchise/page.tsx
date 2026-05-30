'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Lock, ChevronRight, LayoutDashboard } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge } from '@/components/design-system'

type Brand = {
  id:          string
  name:        string
  cuisine:     string
  emoji:       string
  description: string
  avgRevenue:  number
  setupCost:   number
  royaltyRate: number
  citiesAvail: string[]
  available:   boolean
}

export default function FranchisePage() {
  const t = useTranslations('franchise')

  const [brands, setBrands] = useState<Brand[]>([])
  const [orders, setOrders] = useState(80)
  const avgTicket           = 14

  useEffect(() => {
    fetch('/api/franchise/brands')
      .then(r => r.json())
      .then(d => setBrands(d.brands ?? []))
      .catch(() => {})
  }, [])

  const monthlyRevenue = orders * 30 * avgTicket
  const royalties      = monthlyRevenue * 0.06
  const netRevenue     = monthlyRevenue - royalties

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto">

      {/* Hero */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-grubano-primary to-grubano-primary/70 p-6 mb-5 text-white">
        <h1 className="text-2xl font-display font-bold mb-2">{t('heroTitle')}</h1>
        <p className="text-sm opacity-90 mb-4">{t('heroSubtitle')}</p>

        <div className="grid grid-cols-3 gap-2 mb-5">
          {([
            { label: t('statBrands'),      value: '12'     },
            { label: t('statAvgRevenue'),  value: '7 800€' },
            { label: t('statSatisfaction'), value: '96%'   },
          ] as const).map(({ label, value }) => (
            <div key={label} className="rounded-grubano-lg bg-white/15 p-3 text-center">
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] opacity-80">{label}</p>
            </div>
          ))}
        </div>

        <Link
          href="/franchise/apply"
          className="flex items-center justify-center gap-2 w-full rounded-grubano-lg bg-white text-grubano-primary py-3 text-sm font-bold hover:bg-white/90 transition"
        >
          {t('applyNow')} <ChevronRight size={16} />
        </Link>
      </div>

      {/* Already franchisee banner */}
      <div className="mb-6 rounded-grubano-xl border border-grubano-primary/30 bg-grubano-primary/5 p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{t('alreadyFranchisee')}</p>
          <p className="text-xs text-grubano-ink-muted">{t('alreadyFranchiseeDesc')}</p>
        </div>
        <Link href="/franchise/dashboard">
          <Button variant="primary" size="sm" leftIcon={<LayoutDashboard size={13} />}>
            {t('myDashboard')}
          </Button>
        </Link>
      </div>

      {/* Brands grid */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-display font-bold">{t('brandsTitle')}</h2>
        <span className="text-xs text-grubano-ink-muted">
          {t('brandsHint', { count: brands.filter(b => b.available).length })}
        </span>
      </div>

      <div className="space-y-3 mb-8">
        {brands.map(brand => (
          <Card key={brand.id} elevation="sm" padding="md">
            <div className="flex items-start gap-3 mb-2">
              <span className="text-2xl mt-0.5">{brand.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-sm">{brand.name}</h3>
                  {!brand.available && (
                    <Badge tone="danger" size="sm" icon={<Lock size={9} />}>
                      {t('brandFull')}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-grubano-ink-muted">{brand.cuisine}</p>
              </div>
            </div>

            <p className="text-xs text-grubano-ink-muted mb-3">{brand.description}</p>

            <div className="grid grid-cols-3 gap-2 mb-3">
              {([
                { label: t('brandLabelRevenue'),   value: `${(brand.avgRevenue / 1000).toFixed(1)}k€/mois` },
                { label: t('brandLabelSetup'),     value: `${brand.setupCost.toLocaleString('fr-FR')}€` },
                { label: t('brandLabelRoyalties'), value: `${(brand.royaltyRate * 100).toFixed(0)}%` },
              ] as const).map(({ label, value }) => (
                <div key={label} className="rounded-grubano-md bg-grubano-bg px-2 py-1.5 text-center">
                  <p className="text-xs font-bold">{value}</p>
                  <p className="text-[10px] text-grubano-ink-muted">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {brand.citiesAvail.map(city => (
                <span key={city} className="rounded-grubano-pill bg-grubano-bg px-2 py-0.5 text-[10px] text-grubano-ink-muted">
                  {city}
                </span>
              ))}
            </div>

            {brand.available ? (
              <Link href="/franchise/apply" className="block w-full">
                <Button variant="primary" size="sm" fullWidth leftIcon={<CheckCircle2 size={13} />}>
                  {t('brandApply', { name: brand.name })}
                </Button>
              </Link>
            ) : (
              <Button variant="ghost" size="sm" fullWidth disabled leftIcon={<Lock size={13} />}>
                {t('brandWaitlist')}
              </Button>
            )}
          </Card>
        ))}
      </div>

      {/* Revenue calculator */}
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
            { label: t('calcGross'),    value: `${(monthlyRevenue / 1000).toFixed(1)}k€`, color: ''                        },
            { label: t('calcRoyalties'), value: `${(royalties / 1000).toFixed(1)}k€`,     color: 'text-grubano-danger'     },
            { label: t('calcNet'),      value: `${(netRevenue / 1000).toFixed(1)}k€`,     color: 'text-grubano-success'    },
          ] as const).map(({ label, value, color }) => (
            <div key={label} className="rounded-grubano-md bg-grubano-bg p-3 text-center">
              <p className={`text-sm font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-grubano-ink-muted mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-grubano-ink-muted mt-3 text-center">
          {t('calcFootnote', { ticket: avgTicket })}
        </p>
      </Card>

      {/* How it works */}
      <h2 className="text-base font-display font-bold mb-3">{t('howTitle')}</h2>
      <div className="space-y-3">
        {([
          { step: '1', title: t('step1Title'), desc: t('step1Desc') },
          { step: '2', title: t('step2Title'), desc: t('step2Desc') },
          { step: '3', title: t('step3Title'), desc: t('step3Desc') },
          { step: '4', title: t('step4Title'), desc: t('step4Desc') },
        ] as const).map(({ step, title, desc }) => (
          <div key={step} className="flex gap-3 items-start">
            <div className="h-7 w-7 rounded-grubano-pill bg-grubano-primary flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">
              {step}
            </div>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-grubano-ink-muted">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
