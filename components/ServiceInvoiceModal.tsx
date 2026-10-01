'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { X, Loader2, Download, FileText, CreditCard, CheckCircle2 } from 'lucide-react'
import { formatMoney } from '@/lib/format-money'

// ── ServiceInvoiceModal — the mission invoice viewer (P6, Agent 79) ───────────
// Shared by the resto « Mes demandes » and the prestataire « Demandes & missions » lists.
// LAZY: opening it GETs /api/prestataire-invoices/[missionId] which ensures-if-absent the
// invoice. The 5% commission split is CONFIDENTIAL to the prestataire side — the SERVER only
// returns `economics` to the issuing prestataire (or admin), never to the billed restaurant.
// This view therefore renders the split iff the server actually sent it (no client-only flag).
// The PDF is a direct link to the /pdf route (which drops the split for the resto the same way).
// NO money moves here — this is a document + a calculation; the real settlement is P7.

interface InvoiceData {
  invoice: { id: string; number: string; amountCents: number; status: string; issuedAt: string }
  // Present ONLY when the caller is the prestataire/admin (server-gated). Absent for the resto.
  economics?: { rate: number; restaurantPaysCents: number; grubanoMarginCents: number; prestataireNetCents: number }
  serviceLabel: string
}

export default function ServiceInvoiceModal({
  missionId, onClose, canPay = false,
}: { missionId: string; onClose: () => void; canPay?: boolean }) {
  const t = useTranslations('prestataire.invoice')
  const locale = useLocale()

  const [data, setData]       = useState<InvoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [paying, setPaying]   = useState(false)
  const [payErr, setPayErr]   = useState('')

  useEffect(() => {
    fetch(`/api/prestataire-invoices/${missionId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setData(d))
      .catch(() => setError(t('errLoad')))
      .finally(() => setLoading(false))
  }, [missionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = data?.economics ? Math.round(data.economics.rate * 100) : 5

  // P8 — pay this invoice (resto only, under the double flag). The amount is NEVER sent: the
  // server charges the issued invoice and routes the payout to the prestataire's account.
  async function pay() {
    if (paying) return
    setPaying(true); setPayErr('')
    try {
      const res = await fetch(`/api/prestataire-invoices/${missionId}/pay`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.url) { window.location.href = d.url; return }
      setPayErr(d?.error || t('payErr'))
    } catch {
      setPayErr(t('payErr'))
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-grubano-2xl bg-grubano-surface p-5 sm:rounded-grubano-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-grubano-ink">
            <FileText size={18} className="text-grubano-primary" /> {t('title')}
          </h2>
          <button onClick={onClose} aria-label={t('close')}><X size={18} className="text-grubano-ink-muted" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-grubano-primary" /></div>
        ) : error || !data ? (
          <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error || t('errLoad')}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-grubano-ink-muted">{t('number')}</span>
              <span className="font-mono font-semibold text-grubano-ink">{data.invoice.number}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-grubano-ink-muted">{t('issuedAt')}</span>
              <span className="text-grubano-ink">{new Date(data.invoice.issuedAt).toLocaleDateString(locale)}</span>
            </div>

            <div className="rounded-grubano-lg bg-grubano-tint/40 px-3.5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-grubano-ink-muted">{t('amount')}</span>
                <span className="text-lg font-bold text-grubano-ink">{formatMoney(data.invoice.amountCents, locale)}</span>
              </div>
              {data.economics && (
                <div className="mt-2 space-y-1 border-t border-grubano-border pt-2 text-sm">
                  <div className="flex items-center justify-between text-grubano-ink-muted">
                    <span>{t('commission', { pct })}</span>
                    <span>- {formatMoney(data.economics.grubanoMarginCents, locale)}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold text-grubano-ink">
                    <span>{t('net')}</span>
                    <span>{formatMoney(data.economics.prestataireNetCents, locale)}</span>
                  </div>
                </div>
              )}
            </div>

            {data.invoice.status === 'paid' ? (
              <p className="inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg bg-grubano-success-tint px-4 py-2.5 text-sm font-semibold text-grubano-success">
                <CheckCircle2 size={16} /> {t('paid')}
              </p>
            ) : (
              <p className="text-[12px] text-grubano-ink-faint">{t('noPaymentNote')}</p>
            )}

            {/* P8 — « Payer » (resto only, under the double flag, unpaid invoices). */}
            {canPay && data.invoice.status !== 'paid' && (
              <>
                {payErr && <p className="rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{payErr}</p>}
                <button
                  onClick={pay} disabled={paying}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-5 py-3 font-semibold text-white shadow-grubano-sm transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                  {paying ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />} {t('pay')}
                </button>
              </>
            )}

            <a
              href={`/api/prestataire-invoices/${missionId}/pdf`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg border border-grubano-border px-5 py-3 font-semibold text-grubano-ink transition-transform active:scale-[0.99]"
            >
              <Download size={16} /> {t('download')}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
