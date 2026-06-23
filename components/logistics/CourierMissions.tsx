'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, ArrowRight, Truck, Check, X, Info } from 'lucide-react'
import { Card, Badge, Button, EmptyState } from '@/components/design-system'

// ── CourierMissions — the OFFERED missions a courier may freely accept/refuse (brick 3,
// Agent 124). Mounted on the logistics dashboard ONLY when LOGISTICS_MISSIONS_ENABLED is ON
// (else the "coming soon" placeholder stays). COMPLIANCE in the UI: missions are always
// labelled "proposées/offertes" (never "assignées"); Accept + Refuse are free; refusing shows
// NO penalty / score / warning; a refused mission simply leaves THIS list. priceCents is shown
// as inert info. NO money is computed client-side.

interface MissionDTO {
  id: string; type: string; pickupAddress: string; dropoffAddress: string
  zone: string | null; priceCents: number; status: string; createdAt: string
}

const MISSION_LABEL: Record<string, string> = {
  repas: 'typeRepas', produits_fournisseurs: 'typeProduits', b2b: 'typeB2b', froid: 'typeFroid',
}

export default function CourierMissions() {
  const t = useTranslations('business.logistics.missions')
  const [missions, setMissions] = useState<MissionDTO[] | null>(null)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/logistics/missions', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setError(true); setMissions([]); return }
      setMissions(data.missions as MissionDTO[])
    } catch {
      setError(true); setMissions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const remove = (id: string) => setMissions((prev) => (prev ?? []).filter((m) => m.id !== id))

  const accept = async (id: string) => {
    setBusyId(id); setNotice(null)
    try {
      const res = await fetch(`/api/logistics/missions/${id}/accept`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (data?.ok) { remove(id); setNotice(t('acceptedNotice')) }
      // Lost race / no longer eligible → GRACEFUL, never an error or penalty.
      else if (data?.reason === 'unavailable') { remove(id); setNotice(t('unavailableNotice')) }
      else { setNotice(t('genericNotice')) }
    } catch {
      setNotice(t('genericNotice'))
    } finally {
      setBusyId(null)
    }
  }

  const decline = async (id: string) => {
    setBusyId(id); setNotice(null)
    try {
      // No-op without penalty. We optimistically remove it from THIS courier's list; the
      // mission stays offered to everyone else. NO penalty wording is ever shown.
      await fetch(`/api/logistics/missions/${id}/decline`, { method: 'POST' })
      remove(id); setNotice(t('declinedNotice'))
    } catch {
      setNotice(t('genericNotice'))
    } finally {
      setBusyId(null)
    }
  }

  const price = (cents: number) => `${(cents / 100).toFixed(2)} €`
  const typeLabel = (m: string) => (m in MISSION_LABEL ? t(MISSION_LABEL[m]) : m)

  return (
    <Card elevation="sm" padding="md">
      <div className="mb-3">
        <p className="flex items-center gap-2 font-semibold text-grubano-ink">
          <Truck size={18} className="text-grubano-primary" /> {t('sectionTitle')}
        </p>
        {/* Compliance: the freedom statement is always visible. */}
        <p className="text-sm text-grubano-ink-muted">{t('freedomNote')}</p>
      </div>

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-grubano-lg bg-grubano-surface-muted px-3 py-2 text-sm text-grubano-ink-muted">
          <Info size={15} className="mt-0.5 shrink-0" /> {notice}
        </div>
      )}

      {missions === null ? (
        <p className="py-6 text-center text-sm text-grubano-ink-faint">{t('loading')}</p>
      ) : error ? (
        <div className="py-4 text-center">
          <p className="text-sm text-grubano-ink-muted">{t('loadError')}</p>
          <button onClick={() => { setMissions(null); void load() }} className="mt-2 text-sm font-semibold text-grubano-primary hover:underline">
            {t('retry')}
          </button>
        </div>
      ) : missions.length === 0 ? (
        <EmptyState emoji="📭" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {missions.map((m) => (
            <li key={m.id} className="rounded-grubano-lg border border-grubano-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge tone="neutral" size="sm">{typeLabel(m.type)}</Badge>
                <span className="text-sm font-semibold text-grubano-ink">{price(m.priceCents)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-grubano-ink">
                <MapPin size={14} className="shrink-0 text-grubano-ink-muted" />
                <span className="min-w-0 truncate">{m.pickupAddress}</span>
                <ArrowRight size={14} className="shrink-0 text-grubano-ink-faint" />
                <span className="min-w-0 truncate">{m.dropoffAddress}</span>
              </div>
              {m.zone && <p className="mt-1 text-xs text-grubano-ink-faint">{t('zoneLabel')}: {m.zone}</p>}
              <div className="mt-3 flex gap-2">
                <Button variant="primary" size="sm" disabled={busyId === m.id} onClick={() => accept(m.id)}>
                  <Check size={15} /> {t('accept')}
                </Button>
                <Button variant="ghost" size="sm" disabled={busyId === m.id} onClick={() => decline(m.id)}>
                  <X size={15} /> {t('decline')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
