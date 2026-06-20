'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, MapPin, Wrench, Loader2, MonitorSmartphone, Info } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Badge } from '@/components/design-system'

// ── /marketplace/prestataires/[id] — read-only prestataire fiche (P2, Agent 75) ──
// A restaurateur views ONE prestataire + its active services. Reuses the discovery
// endpoint (already ACTIVE-only + restaurant/admin-gated) and finds the id — the same
// pattern as the supplier storefront, but READ-ONLY: NO cart / order / price. Services are
// « sur devis » — the quote / contact flow is a LATER brick (P3+), shown as an honest
// "coming soon" notice. Operator-gated; the parent server page 404s when the flag is OFF.

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

export default function PrestataireDetailClient({ id }: { id: string }) {
  const t  = useTranslations('prestataire')
  const tm = useTranslations('marketplace.prestataires')

  const [p, setP] = useState<DiscoverPrestataire | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    fetch('/api/marketplace/prestataires', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const found = (d.prestataires as DiscoverPrestataire[]).find((x) => x.id === id)
        if (found) setP(found)
        else setMissing(true)
      })
      .catch(() => setMissing(true))
      .finally(() => setLoading(false))
  }, [id])

  const svcLabel = (c: string) => (c in SVC_LABEL ? t(SVC_LABEL[c] as 'svcOther') : c)
  const modLabel = (m: string) => t((MOD_LABEL[m] ?? 'modalityOnSite') as 'modalityOnSite')

  const byCategory = useMemo(() => {
    const map = new Map<string, DiscoverOffering[]>()
    for (const o of p?.serviceOfferings ?? []) {
      const arr = map.get(o.category) ?? []
      arr.push(o); map.set(o.category, arr)
    }
    return Array.from(map.entries())
  }, [p])

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-grubano-primary" /></div>
  if (missing || !p) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-grubano-ink-muted">{tm('notFound')}</p>
        <Link href="/marketplace/prestataires" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
          <ArrowLeft size={14} /> {tm('backToList')}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <Link href="/marketplace/prestataires" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
        <ArrowLeft size={15} /> {tm('backToList')}
      </Link>

      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Wrench size={20} />
        </span>
        <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{p.companyName}</h1>
      </div>
      <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-grubano-ink-muted">
        {p.city && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {p.city}</span>}
        <span className="inline-flex items-center gap-1"><MonitorSmartphone size={13} /> {modLabel(p.modality)}</span>
      </p>
      {p.coverageZones.length > 0 && (
        <p className="mb-5 text-sm text-grubano-ink-muted">
          <span className="font-medium text-grubano-ink">{tm('coverageLabel')}:</span> {p.coverageZones.join(', ')}
        </p>
      )}

      {/* Quote / contact = a LATER brick (P3+). Honest notice, no dead button. */}
      <Card elevation="sm" padding="md" className="mb-5 border-grubano-primary/20 bg-grubano-tint/40">
        <div className="flex items-start gap-2.5">
          <Info size={18} className="mt-0.5 shrink-0 text-grubano-primary" />
          <div>
            <p className="font-semibold text-grubano-ink">{tm('quoteSoonTitle')}</p>
            <p className="text-sm text-grubano-ink-muted">{tm('quoteSoonBody')}</p>
          </div>
        </div>
      </Card>

      <h2 className="mb-2 font-display text-lg font-bold text-grubano-ink">{tm('servicesTitle')}</h2>
      <div className="space-y-5">
        {byCategory.map(([cat, offerings]) => (
          <div key={cat}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-grubano-ink-faint">{svcLabel(cat)}</h3>
            <ul className="space-y-2">
              {offerings.map((o) => (
                <li key={o.id}>
                  <Card elevation="sm" padding="md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-grubano-ink">{o.title}</p>
                        {o.description && <p className="mt-0.5 text-sm text-grubano-ink-muted">{o.description}</p>}
                      </div>
                      <Badge tone="neutral" size="sm">{modLabel(o.modality)}</Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-grubano-ink">{o.indicativeRate?.trim() || tm('onQuote')}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
