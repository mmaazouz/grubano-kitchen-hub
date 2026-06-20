'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Wrench, MapPin, ListChecks, ChevronRight, Loader2, Search, MonitorSmartphone } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge } from '@/components/design-system'
import { SERVICE_CATEGORIES, filterPrestataires } from '@/lib/service-offering'

// ── /marketplace/prestataires — SERVICES discovery (resto side, P2, Agent 75) ──
// A CLONE of /marketplace/suppliers, adapted to SERVICES. Renders inside the operator
// chrome (operator-gated). Lists ACTIVE prestataires with ≥1 active service; filters by
// trade (category) + zone using the SAME pure lib/service-offering helper as the API + the
// tests. Click → that prestataire's read-only profile. NO cart / order / price — services
// are « sur devis » (the quote/contact flow is a LATER brick, P3+).

interface DiscoverOffering { id: string; title: string; description: string | null; category: string; modality: string; indicativeRate: string | null }
interface DiscoverPrestataire {
  id: string
  companyName: string
  city: string | null
  serviceCategories: string[]
  coverageZones: string[]
  modality: string
  indicativeRate: string | null
  serviceOfferings: DiscoverOffering[]
}

const SVC_LABEL: Record<string, string> = {
  electricity: 'svcElectricity', plumbing: 'svcPlumbing', haccp: 'svcHaccp', cleaning: 'svcCleaning',
  pest_control: 'svcPestControl', fridge_repair: 'svcFridgeRepair', kitchen_maintenance: 'svcKitchenMaintenance',
  accounting: 'svcAccounting', training: 'svcTraining', other: 'svcOther',
}
const MOD_LABEL: Record<string, string> = { on_site: 'modalityOnSite', remote: 'modalityRemote', both: 'modalityBoth' }

export default function PrestatairesDiscoverClient() {
  const t  = useTranslations('prestataire')              // shared svc* + modality* labels
  const tm = useTranslations('marketplace.prestataires') // page-specific copy

  const [list, setList]     = useState<DiscoverPrestataire[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [category, setCategory] = useState('')
  const [zone, setZone]     = useState('')

  useEffect(() => {
    fetch('/api/marketplace/prestataires', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setList(Array.isArray(d.prestataires) ? d.prestataires : []))
      .catch(() => setError(tm('errLoad')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const svcLabel = (c: string) => (c in SVC_LABEL ? t(SVC_LABEL[c] as 'svcOther') : c)
  const modLabel = (m: string) => t((MOD_LABEL[m] ?? 'modalityOnSite') as 'modalityOnSite')

  const filtering = category.trim().length > 0 || zone.trim().length > 0
  const filtered = useMemo(
    () => filterPrestataires(list, { category, zone }),
    [list, category, zone],
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Wrench size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{tm('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{tm('subtitle')}</p>
        </div>
      </div>

      {/* Filters: trade (category) + zone */}
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none"
        >
          <option value="">{tm('allTrades')}</option>
          {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{svcLabel(c)}</option>)}
        </select>
        <div className="flex items-center gap-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 focus-within:border-grubano-primary">
          <Search size={16} className="shrink-0 text-grubano-ink-faint" />
          <input
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            placeholder={tm('zonePlaceholder')}
            className="w-full bg-transparent py-2.5 text-sm text-grubano-ink focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : filtered.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Wrench size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{filtering ? tm('noMatch') : tm('empty')}</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((p) => (
            <Link key={p.id} href={`/marketplace/prestataires/${p.id}`} className="block">
              <Card elevation="sm" padding="md" className="h-full transition-shadow hover:shadow-grubano-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-grubano-ink truncate">{p.companyName}</h2>
                    {p.city && (
                      <p className="flex items-center gap-1 text-xs text-grubano-ink-muted">
                        <MapPin size={12} /> {p.city}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </div>
                {p.serviceCategories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.serviceCategories.slice(0, 4).map((c) => (
                      <Badge key={c} tone="neutral" size="sm">{svcLabel(c)}</Badge>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-grubano-ink-muted">
                  <span className="inline-flex items-center gap-1"><ListChecks size={13} /> {tm('servicesCount', { count: p.serviceOfferings.length })}</span>
                  <span className="inline-flex items-center gap-1"><MonitorSmartphone size={13} /> {modLabel(p.modality)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
