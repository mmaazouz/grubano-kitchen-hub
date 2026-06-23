'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Package, MapPin, ArrowRight } from 'lucide-react'
import { Card, Badge, Button, EmptyState, type BadgeTone } from '@/components/design-system'

// ── RequestDelivery — a business operator requests a delivery → an OFFERED mission, and
// tracks its status (brick 3, Agent 124). Hosted on the gated /deliveries page (404 when
// LOGISTICS_MISSIONS_ENABLED is OFF). The mission is OFFERED to eligible couriers (never
// "assigned"); priceCents is an OPTIONAL inert proposed amount (data only — NO money is
// charged/computed). Owner-scoped: the API only ever returns this operator's own missions.

interface MissionDTO {
  id: string; type: string; pickupAddress: string; dropoffAddress: string
  zone: string | null; priceCents: number; status: string; createdAt: string
}

const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const TYPE_LABEL: Record<string, string> = {
  repas: 'typeRepas', produits_fournisseurs: 'typeProduits', b2b: 'typeB2b', froid: 'typeFroid',
}
const STATUS_TONE: Record<string, BadgeTone> = {
  offered: 'warning', accepted: 'success', picked_up: 'success', delivered: 'success',
  declined: 'neutral', expired: 'neutral', cancelled: 'danger',
}

export default function RequestDelivery() {
  const t = useTranslations('business.logistics.request')
  const [missions, setMissions] = useState<MissionDTO[] | null>(null)
  const [type, setType] = useState<string>('repas')
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const [zone, setZone] = useState('')
  const [price, setPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/missions/request', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setMissions(res.ok && data?.ok ? (data.missions as MissionDTO[]) : [])
    } catch {
      setMissions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError(null); setCreated(false)
    try {
      const priceCents = price.trim() ? Math.round(parseFloat(price.replace(',', '.')) * 100) : undefined
      const res = await fetch('/api/logistics/missions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, pickupAddress: pickup.trim(), dropoffAddress: dropoff.trim(),
          zone: zone.trim() || undefined,
          ...(priceCents !== undefined && Number.isFinite(priceCents) ? { priceCents } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setError(data?.error || t('errorGeneric')); return }
      setCreated(true)
      setPickup(''); setDropoff(''); setZone(''); setPrice('')
      setMissions((prev) => [data.mission as MissionDTO, ...(prev ?? [])])
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  const price$ = (cents: number) => `${(cents / 100).toFixed(2)} €`
  const statusLabel = (s: string) => t(`status_${s}` as 'status_offered')
  const typeLabel = (m: string) => (m in TYPE_LABEL ? t(TYPE_LABEL[m]) : m)

  const field = 'w-full rounded-grubano-lg border border-grubano-border bg-white px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none'

  return (
    <div className="space-y-5">
      <Card elevation="sm" padding="lg">
        <p className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-grubano-ink">
          <Package size={18} className="text-grubano-primary" /> {t('formTitle')}
        </p>
        <p className="mb-4 text-sm text-grubano-ink-muted">{t('formSubtitle')}</p>

        {created && (
          <div className="mb-3 rounded-grubano-lg bg-grubano-success-tint px-3 py-2 text-sm text-grubano-ink">
            <span className="font-semibold">{t('createdTitle')}</span> {t('createdBody')}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('fieldType')}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
              {MISSION_TYPES.map((mt) => <option key={mt} value={mt}>{typeLabel(mt)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('fieldPickup')}</label>
            <input value={pickup} onChange={(e) => setPickup(e.target.value)} required minLength={3} maxLength={200} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('fieldDropoff')}</label>
            <input value={dropoff} onChange={(e) => setDropoff(e.target.value)} required minLength={3} maxLength={200} className={field} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('fieldZone')}</label>
              <input value={zone} onChange={(e) => setZone(e.target.value)} maxLength={80} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('fieldPrice')}</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={field} placeholder="0,00" />
              <p className="mt-1 text-xs text-grubano-ink-faint">{t('fieldPriceHint')}</p>
            </div>
          </div>
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </form>
      </Card>

      <Card elevation="sm" padding="md">
        <p className="mb-3 font-semibold text-grubano-ink">{t('myMissionsTitle')}</p>
        {missions === null ? (
          <p className="py-4 text-center text-sm text-grubano-ink-faint">{t('loading')}</p>
        ) : missions.length === 0 ? (
          <EmptyState emoji="📦" title={t('emptyTitle')} description={t('emptyBody')} />
        ) : (
          <ul className="space-y-2">
            {missions.map((m) => (
              <li key={m.id} className="rounded-grubano-lg border border-grubano-border p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge tone="neutral" size="sm">{typeLabel(m.type)}</Badge>
                  <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} size="sm">{statusLabel(m.status)}</Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-grubano-ink">
                  <MapPin size={14} className="shrink-0 text-grubano-ink-muted" />
                  <span className="min-w-0 truncate">{m.pickupAddress}</span>
                  <ArrowRight size={14} className="shrink-0 text-grubano-ink-faint" />
                  <span className="min-w-0 truncate">{m.dropoffAddress}</span>
                </div>
                {m.priceCents > 0 && <p className="mt-1 text-xs text-grubano-ink-faint">{price$(m.priceCents)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
