'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Wrench, ArrowLeft, X, Check, Loader2, Inbox, Calendar, FileText } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input, Badge, EmptyState, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import ServiceInvoiceModal from '@/components/ServiceInvoiceModal'
import { formatMoney } from '@/lib/format-money'

// ── /prestataire/missions — the prestataire's received missions (P3, Agent 76) ──
// CLONE of the supplier "received orders" screen, adapted to the DEVIS cycle. The
// prestataire QUOTES a requested mission (amount + description + proposed date), DECLINES a
// request, or marks an accepted mission DONE — each via /api/prestataire/missions/[id]
// (server-side state machine + ownership). NO money: the amount is data shown to the resto;
// nothing is charged. Rendered by the SERVER page.tsx, which 404s when the flag is OFF.

interface Mission {
  id: string
  status: string
  requestDetails: string
  quoteAmountCents: number | null
  quoteDescription: string | null
  proposedDate: string | null
  scheduledDate: string | null
  createdAt: string
  restaurantOperator: { id: string; name: string } | null
  serviceOffering: { id: string; title: string; category: string } | null
}

const STATUS_TONE: Record<string, BadgeTone> = {
  requested: 'warning', quoted: 'neutral', accepted: 'success', done: 'success', declined: 'danger', cancelled: 'neutral',
}

type QuoteForm = { id: string; amountEur: string; description: string; proposedDate: string; depositPctStr: string }

export default function MissionsClient() {
  const t  = useTranslations('prestataire.missions')
  const locale = useLocale()

  const [items, setItems]     = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [quote, setQuote]     = useState<QuoteForm | null>(null) // null = quote editor closed
  const [saving, setSaving]   = useState(false)
  const [formError, setFormError] = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null) // missionId | null — invoice viewer (P6)

  function load() {
    setLoading(true)
    fetch('/api/prestataire/missions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(Array.isArray(d.missions) ? d.missions : []))
      .catch(() => setLoadError(t('errLoad')))
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const statusLabel = (s: string) => t((`status_${s}`) as 'status_requested')
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(locale) : null)

  // Direct status change (decline a request, mark accepted done).
  async function advance(id: string, status: 'declined' | 'done') {
    setBusyId(id)
    try {
      const res = await fetch(`/api/prestataire/missions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (res.ok) load()
    } finally {
      setBusyId(null)
    }
  }

  async function submitQuote(e: React.FormEvent) {
    e.preventDefault()
    if (!quote || saving) return
    const cents = Math.round(Number(quote.amountEur.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents < 0) { setFormError(t('errAmount')); return }
    if (!quote.description.trim()) { setFormError(t('errDescription')); return }
    // P8c — optional deposit %: clamp 0..100; empty/invalid → 0 (no deposit).
    const depositPct = Math.min(100, Math.max(0, Math.round(Number(quote.depositPctStr.replace(',', '.')) || 0)))
    setSaving(true); setFormError('')
    try {
      const res = await fetch(`/api/prestataire/missions/${quote.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'quoted',
          quoteAmountCents: cents,
          quoteDescription: quote.description.trim(),
          proposedDate: quote.proposedDate ? new Date(quote.proposedDate).toISOString() : null,
          depositPct,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setFormError(d?.error || t('errSave'))
        return
      }
      setQuote(null); load()
    } catch {
      setFormError(t('errSave'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-4xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Inbox size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{t('title')}</h1>
          </div>
          <Link href="/prestataire/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
            <ArrowLeft size={15} /> {t('back')}
          </Link>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-4xl px-5 py-6 space-y-3">
        <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg"><p className="text-sm text-grubano-danger">{loadError}</p></Card>
        ) : items.length === 0 ? (
          <Card elevation="sm" padding="lg"><EmptyState emoji="📭" title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
        ) : (
          <ul className="space-y-2">
            {items.map((m) => (
              <li key={m.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-grubano-ink truncate">{m.restaurantOperator?.name ?? '—'}</h3>
                        <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} size="sm">{statusLabel(m.status)}</Badge>
                        {m.serviceOffering && <span className="text-xs text-grubano-ink-faint">· {m.serviceOffering.title}</span>}
                      </div>
                      <p className="mt-1 text-sm text-grubano-ink-muted whitespace-pre-line">{m.requestDetails}</p>
                      {m.quoteAmountCents != null && (
                        <p className="mt-1.5 text-sm">
                          <span className="font-semibold text-grubano-ink">{formatMoney(m.quoteAmountCents, locale)}</span>
                          {m.quoteDescription ? <span className="text-grubano-ink-muted"> — {m.quoteDescription}</span> : null}
                        </p>
                      )}
                      {(m.scheduledDate || m.proposedDate) && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-grubano-ink-faint">
                          <Calendar size={12} /> {fmtDate(m.scheduledDate ?? m.proposedDate)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {m.status === 'requested' && (
                        <>
                          <Button variant="primary" size="sm" disabled={busyId === m.id}
                            onClick={() => { setFormError(''); setQuote({ id: m.id, amountEur: '', description: '', proposedDate: '', depositPctStr: '' }) }}>
                            {t('quoteCta')}
                          </Button>
                          <Button variant="secondary" size="sm" loading={busyId === m.id} onClick={() => advance(m.id, 'declined')}>
                            {t('declineCta')}
                          </Button>
                        </>
                      )}
                      {m.status === 'accepted' && (
                        <Button variant="primary" size="sm" loading={busyId === m.id} leftIcon={<Check size={14} />} onClick={() => advance(m.id, 'done')}>
                          {t('doneCta')}
                        </Button>
                      )}
                      {m.status === 'done' && (
                        <Button variant="ghost" size="sm" leftIcon={<FileText size={14} />} onClick={() => setInvoiceFor(m.id)}>
                          {t('invoiceCta')}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* ── Quote editor ── */}
      {quote && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !saving && setQuote(null)}>
          <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-grubano-ink">{t('quoteTitle')}</h2>
              <button onClick={() => !saving && setQuote(null)} aria-label={t('cancel')}><X size={18} className="text-grubano-ink-muted" /></button>
            </div>
            <form onSubmit={submitQuote} className="space-y-3">
              {formError && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{formError}</p>}
              <Input label={t('fAmount')} type="number" inputMode="decimal" min={0} step="0.01" required
                value={quote.amountEur} onChange={(e) => setQuote({ ...quote, amountEur: e.target.value })} placeholder="150.00" />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('fDescription')}</label>
                <textarea rows={2} required value={quote.description} onChange={(e) => setQuote({ ...quote, description: e.target.value })}
                  className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20" />
              </div>
              <Input label={t('fProposedDate')} type="date" value={quote.proposedDate} onChange={(e) => setQuote({ ...quote, proposedDate: e.target.value })} />
              <div>
                <Input label={t('fDepositPct')} type="number" inputMode="numeric" min={0} max={100} step="1"
                  value={quote.depositPctStr} onChange={(e) => setQuote({ ...quote, depositPctStr: e.target.value })} placeholder="0" />
                <p className="mt-1 text-[11px] text-grubano-ink-faint">{t('fDepositPctHint')}</p>
              </div>
              <p className="text-[11px] text-grubano-ink-faint">{t('quoteHint')}</p>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" size="md" fullWidth onClick={() => setQuote(null)}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" size="md" fullWidth loading={saving} leftIcon={saving ? undefined : <Check size={16} />}>
                  {saving ? t('saving') : t('quoteSend')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Invoice viewer (P6) — prestataire view: the server returns the 5% split here + PDF ── */}
      {invoiceFor && (
        <ServiceInvoiceModal missionId={invoiceFor} onClose={() => setInvoiceFor(null)} />
      )}
    </div>
  )
}
