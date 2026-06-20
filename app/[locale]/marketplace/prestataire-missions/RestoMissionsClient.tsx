'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Wrench, ChevronLeft, Loader2, ClipboardList, Calendar, Check, X } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Badge, type BadgeTone } from '@/components/design-system'
import { formatMoney } from '@/lib/format-money'

// ── /marketplace/prestataire-missions — the resto's quote requests (P3, Agent 76) ──
// CLONE of /marketplace/orders (resto order history), adapted to the DEVIS cycle. Renders
// inside the operator chrome (operator-gated). The resto ACCEPTS / DECLINES a quoted mission
// or CANCELS a still-requested one via /api/marketplace/prestataire-missions/[id] (server-
// side state machine + ownership). NO money — the quote amount is only displayed. Rendered
// by the SERVER page.tsx, which 404s when the flag is OFF.

interface Mission {
  id: string
  status: string
  requestDetails: string
  quoteAmountCents: number | null
  quoteDescription: string | null
  proposedDate: string | null
  scheduledDate: string | null
  createdAt: string
  prestataireProfile: { id: string; companyName: string; city: string | null } | null
  serviceOffering: { id: string; title: string; category: string } | null
}

const STATUS_TONE: Record<string, BadgeTone> = {
  requested: 'neutral', quoted: 'warning', accepted: 'success', done: 'success', declined: 'danger', cancelled: 'neutral',
}

export default function RestoMissionsClient() {
  const t  = useTranslations('marketplace.prestataireMissions')
  const locale = useLocale()

  const [items, setItems]     = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/marketplace/prestataire-missions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.missions) ? d.missions : []))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s: string) => t((`status_${s}`) as 'status_requested')
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : null)

  async function act(id: string, status: 'accepted' | 'declined' | 'cancelled') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/marketplace/prestataire-missions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
            <ClipboardList size={20} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
            <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
          </div>
        </div>
        <Link href="/marketplace/prestataires" className="inline-flex shrink-0 items-center gap-1 rounded-grubano-lg border border-grubano-border px-3 py-2 text-sm font-medium text-grubano-ink-muted hover:text-grubano-ink">
          <Wrench size={15} /> {t('discoverNav')}
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
      ) : error ? (
        <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{error}</p></Card>
      ) : items.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <ClipboardList size={28} className="text-grubano-ink-faint" />
            <p className="text-sm text-grubano-ink-muted">{t('empty')}</p>
            <Link href="/marketplace/prestataires" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-grubano-primary">
              <ChevronLeft size={14} /> {t('discoverNav')}
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id}>
              <Card elevation="sm" padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display font-bold text-grubano-ink truncate">{m.prestataireProfile?.companyName ?? '—'}</h2>
                      <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} size="sm">{statusLabel(m.status)}</Badge>
                      {m.serviceOffering && <span className="text-xs text-grubano-ink-faint">· {m.serviceOffering.title}</span>}
                    </div>
                    <p className="mt-1 text-sm text-grubano-ink-muted whitespace-pre-line">{m.requestDetails}</p>
                    {m.quoteAmountCents != null && (
                      <div className="mt-2 rounded-grubano-md bg-grubano-tint/40 px-3 py-2">
                        <p className="text-sm font-semibold text-grubano-ink">{t('quoteLabel')}: {formatMoney(m.quoteAmountCents, locale)}</p>
                        {m.quoteDescription && <p className="text-[13px] text-grubano-ink-muted">{m.quoteDescription}</p>}
                        {(m.scheduledDate || m.proposedDate) && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-grubano-ink-faint">
                            <Calendar size={12} /> {fmtDate(m.scheduledDate ?? m.proposedDate)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {m.status === 'requested' && (
                      <Button variant="secondary" size="sm" loading={busyId === m.id} onClick={() => act(m.id, 'cancelled')}>
                        {t('cancelCta')}
                      </Button>
                    )}
                    {m.status === 'quoted' && (
                      <>
                        <Button variant="primary" size="sm" loading={busyId === m.id} leftIcon={<Check size={14} />} onClick={() => act(m.id, 'accepted')}>
                          {t('acceptCta')}
                        </Button>
                        <Button variant="secondary" size="sm" loading={busyId === m.id} leftIcon={<X size={14} />} onClick={() => act(m.id, 'declined')}>
                          {t('declineCta')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
