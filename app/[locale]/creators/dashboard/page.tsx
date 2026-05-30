'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChefHat, Upload, CheckCircle2, Clock, Store,
  Users, ShoppingBag, DollarSign, Instagram, Link2, Copy, Check,
} from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'
import { useCategoryLabel } from '@/lib/categories'

type Dish = {
  id:             string
  name:           string
  cuisineType:    string
  suggestedPrice: number
  status:         string
  adoptions:      number
  totalSales:     number
  earnings:       number
}

type CreatorInfo = {
  id:            string
  name:          string
  verified:      boolean
  totalEarnings: number
  instagram:     string | null
  tiktok:        string | null
  youtube:       string | null
  followers:     number
}

type DashData = {
  creator:       CreatorInfo | null
  dishes:        Dish[]
  totalEarnings: number
  totalSales:    number
  adoptions:     number
}

type NewDish = {
  name:           string
  description:    string
  ingredientsRaw: string
  cuisineType:    string
  suggestedPrice: string
}

const EMPTY_DISH: NewDish = {
  name: '', description: '', ingredientsRaw: '', cuisineType: '', suggestedPrice: '',
}

type Tab = 'dishes' | 'submit' | 'audience'

export default function CreatorsDashboard() {
  const t            = useTranslations('creators.dashboard')
  const getCatLabel  = useCategoryLabel()

  const [tab,        setTab]        = useState<Tab>('dishes')
  const [data,       setData]       = useState<DashData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [form,       setForm]       = useState<NewDish>(EMPTY_DISH)
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')
  const [copied,     setCopied]     = useState(false)

  function load() {
    fetch('/api/creators/my-dishes')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function setField(key: keyof NewDish, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmitDish(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitErr('')
    try {
      const ingredients = form.ingredientsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      const res = await fetch('/api/creators/dishes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           form.name,
          description:    form.description,
          ingredients,
          cuisineType:    form.cuisineType,
          suggestedPrice: parseFloat(form.suggestedPrice),
        }),
      })

      if (res.ok) {
        setSubmitted(true)
        setForm(EMPTY_DISH)
        setTimeout(() => {
          setSubmitted(false)
          setTab('dishes')
          setLoading(true)
          load()
        }, 2000)
      } else {
        const d = await res.json()
        setSubmitErr(d.error ?? t('submitError'))
      }
    } catch {
      setSubmitErr(t('submitNetworkError'))
    } finally {
      setSubmitting(false)
    }
  }

  function copyReferral() {
    const code = data?.creator?.id.slice(0, 8).toUpperCase() ?? '—'
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="px-4 pt-5 max-w-lg mx-auto">
        <SkeletonList count={4} />
      </div>
    )
  }

  function statusBadge(status: string) {
    switch (status) {
      case 'approved':
      case 'live':
        return <Badge tone="success" size="sm" icon={<CheckCircle2 size={9} />}>{t('dishStatusActive')}</Badge>
      case 'pending':
        return <Badge tone="warning" size="sm" icon={<Clock size={9} />}>{t('dishStatusPending')}</Badge>
      default:
        return <Badge tone="danger" size="sm">{t('dishStatusRejected')}</Badge>
    }
  }

  const referralCode = data?.creator?.id.slice(0, 8).toUpperCase() ?? '—'

  // Cuisine options using CategorySlug for consistency with creators/apply
  const CUISINE_OPTIONS = [
    { value: 'italien',   label: getCatLabel('italien')   },
    { value: 'asiatique', label: getCatLabel('asiatique') },
    { value: 'healthy',   label: getCatLabel('healthy')   },
    { value: 'bowls',     label: getCatLabel('bowls')     },
    { value: 'desserts',  label: getCatLabel('desserts')  },
    { value: 'burgers',   label: getCatLabel('burgers')   },
    { value: 'wraps',     label: getCatLabel('wraps')     },
    { value: 'sandwiches',label: getCatLabel('sandwiches')},
    { value: 'pizza',     label: getCatLabel('pizza')     },
    { value: 'sushi',     label: getCatLabel('sushi')     },
    { value: 'pates',     label: getCatLabel('pates')     },
    { value: 'boissons',  label: getCatLabel('boissons')  },
  ]

  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-12 w-12 rounded-grubano-xl bg-grubano-tint flex items-center justify-center">
          <ChefHat size={24} className="text-grubano-primary" />
        </div>
        <div>
          <h1 className="text-xl font-display font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">
            {data?.creator?.name ?? 'Mon compte'} · {t('subtitle')}
            {data?.creator?.verified && (
              <span className="ml-1 text-grubano-success">{t('verified')}</span>
            )}
          </p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {([
          { label: t('kpiEarnings'),  value: `€${(data?.totalEarnings ?? 0).toFixed(0)}`, color: 'text-grubano-success' },
          { label: t('kpiSales'),     value: String(data?.totalSales ?? 0),               color: ''                     },
          { label: t('kpiAdoptions'), value: String(data?.adoptions ?? 0),                color: 'text-grubano-primary' },
        ] as const).map(({ label, value, color }) => (
          <Card key={label} elevation="flat" padding="sm" className="text-center">
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-grubano-ink-muted">{label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-grubano-lg bg-grubano-bg p-1 mb-5">
        {([
          ['dishes',   t('tabDishes')],
          ['submit',   t('tabSubmit')],
          ['audience', t('tabAudience')],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-grubano-md py-2 text-xs font-semibold transition ${
              tab === key
                ? 'bg-grubano-surface shadow-grubano-sm text-grubano-ink'
                : 'text-grubano-ink-muted hover:text-grubano-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ────────────────────────────────────────────
          Tab A — Mes plats
      ──────────────────────────────────────────── */}
      {tab === 'dishes' && (
        <div className="space-y-2">
          {(data?.dishes.length ?? 0) === 0 ? (
            <EmptyState
              emoji={<ChefHat size={28} />}
              title={t('emptyDishesTitle')}
              description={t('emptyDishesDesc')}
              action={
                <Button variant="primary" size="sm" onClick={() => setTab('submit')}>
                  {t('submitDishCta')}
                </Button>
              }
            />
          ) : (
            data!.dishes.map(dish => (
              <Card key={dish.id} elevation="sm" padding="sm">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{dish.name}</p>
                    <p className="text-[10px] text-grubano-ink-muted mb-1">{getCatLabel(dish.cuisineType)}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {statusBadge(dish.status)}
                      {dish.adoptions > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-grubano-ink-muted">
                          <Store size={9} />
                          {t('dishAdoptions', { count: dish.adoptions })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right ml-3 shrink-0">
                    <p className="text-sm font-bold text-grubano-success">€{dish.earnings.toFixed(2)}</p>
                    <p className="text-[10px] text-grubano-ink-muted">
                      {t('dishSales', { count: dish.totalSales })}
                    </p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ────────────────────────────────────────────
          Tab B — Soumettre un plat
      ──────────────────────────────────────────── */}
      {tab === 'submit' && (
        <form onSubmit={handleSubmitDish} className="space-y-3">
          {submitted ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-bold text-grubano-success text-lg">{t('submittedTitle')}</p>
              <p className="text-sm text-grubano-ink-muted mt-1">{t('submittedDesc')}</p>
            </div>
          ) : (
            <>
              {([
                { key: 'name'           as const, label: t('formDishName'),    type: 'text',   placeholder: t('dishPlaceholder')        },
                { key: 'ingredientsRaw' as const, label: t('formIngredients'), type: 'text',   placeholder: t('ingredientsPlaceholder') },
                { key: 'suggestedPrice' as const, label: t('formPrice'),       type: 'number', placeholder: '12.90'                     },
              ]).map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                    {label}
                  </label>
                  <input
                    type={type}
                    required
                    step={type === 'number' ? '0.01' : undefined}
                    min={type === 'number' ? '0.01' : undefined}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary"
                  />
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                  {t('formCuisine')}
                </label>
                <select
                  required
                  value={form.cuisineType}
                  onChange={e => setField('cuisineType', e.target.value)}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary"
                >
                  <option value="">{t('cuisinePlaceholder')}</option>
                  {CUISINE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5 text-grubano-ink-muted uppercase tracking-wide">
                  {t('formDescription')}
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder={t('descPlaceholder')}
                  value={form.description}
                  onChange={e => setField('description', e.target.value)}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-grubano-primary resize-none"
                />
              </div>

              {submitErr && <p className="text-xs text-grubano-danger">{submitErr}</p>}

              <Button type="submit" variant="primary" size="md" fullWidth loading={submitting} leftIcon={<Upload size={15} />}>
                {submitting ? t('formSubmitting') : t('formSubmitCta')}
              </Button>
            </>
          )}
        </form>
      )}

      {/* ────────────────────────────────────────────
          Tab C — Mon audience (influencer — UI stubs)
      ──────────────────────────────────────────── */}
      {tab === 'audience' && (
        <div className="space-y-4">
          <h2 className="text-base font-display font-bold">{t('audienceTitle')}</h2>

          {/* Referral code + link */}
          <Card elevation="sm" padding="md">
            <p className="text-xs font-semibold text-grubano-ink-muted uppercase tracking-wide mb-3">
              {t('audienceReferralCode')}
            </p>
            <div className="flex items-center gap-2 mb-2">
              <code className="flex-1 rounded-grubano-lg bg-grubano-bg px-3 py-2 text-sm font-mono font-bold tracking-widest text-grubano-primary">
                {referralCode}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={copyReferral}
                leftIcon={copied ? <Check size={13} /> : <Copy size={13} />}
              >
                {copied ? t('audienceCopied') : t('audienceCopy')}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Link2 size={12} className="text-grubano-ink-faint shrink-0" />
              <p className="text-[11px] text-grubano-ink-faint truncate">
                grubano.com/ref/{referralCode.toLowerCase()}
              </p>
            </div>
          </Card>

          {/* Parrainage stats — stubs */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { icon: Users,       label: t('audienceCustomers'), value: '0' },
              { icon: ShoppingBag, label: t('audienceOrders'),    value: '0' },
              { icon: DollarSign,  label: t('audienceEarnings'),  value: '€0' },
            ] as const).map(({ icon: Icon, label, value }) => (
              <Card key={label} elevation="flat" padding="sm" className="text-center">
                <Icon size={18} className="mx-auto mb-1 text-grubano-ink-faint" />
                <p className="text-lg font-bold text-grubano-ink">{value}</p>
                <p className="text-[10px] text-grubano-ink-muted leading-tight">{label}</p>
              </Card>
            ))}
          </div>

          {/* Coming-soon note */}
          <div className="rounded-grubano-lg bg-grubano-tint border border-grubano-primary/20 px-4 py-3 text-xs text-grubano-primary text-center">
            {t('audienceComingSoon')}
          </div>

          {/* Social networks */}
          <Card elevation="sm" padding="md">
            <p className="text-xs font-semibold text-grubano-ink-muted uppercase tracking-wide mb-3">
              {t('audienceSocials')}
            </p>

            {data?.creator?.followers ? (
              <p className="text-sm font-bold text-grubano-ink mb-3">
                {t('audienceFollowers', { count: (data.creator.followers).toLocaleString('fr-FR') })}
              </p>
            ) : null}

            {[
              { key: 'instagram', label: t('audienceInstagram') ?? 'Instagram', icon: Instagram, handle: data?.creator?.instagram },
              { key: 'tiktok',    label: 'TikTok',   icon: Link2,      handle: data?.creator?.tiktok    },
              { key: 'youtube',   label: 'YouTube',   icon: Link2,      handle: data?.creator?.youtube   },
            ].filter(s => s.handle).map(({ label, icon: Icon, handle }) => (
              <div key={label} className="flex items-center gap-2 py-1.5 border-b border-grubano-border last:border-0">
                <Icon size={14} className="text-grubano-ink-muted shrink-0" />
                <span className="text-xs text-grubano-ink-muted">{label}</span>
                <span className="text-xs font-semibold ml-auto text-grubano-ink">{handle}</span>
              </div>
            ))}

            {!data?.creator?.instagram && !data?.creator?.tiktok && !data?.creator?.youtube && (
              <p className="text-xs text-grubano-ink-faint text-center py-2">{t('audienceNoSocials')}</p>
            )}
          </Card>
        </div>
      )}

      {/* Apply CTA if not yet a creator */}
      {!data?.creator && (
        <div className="mt-6 rounded-grubano-xl border border-grubano-primary/30 bg-grubano-tint p-4 text-center">
          <p className="text-sm font-bold mb-1">{t('notCreatorTitle')}</p>
          <p className="text-xs text-grubano-ink-muted mb-3">{t('notCreatorDesc')}</p>
          <Link href="/creators/apply">
            <Button variant="primary" size="sm">
              {t('notCreatorCta')}
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
