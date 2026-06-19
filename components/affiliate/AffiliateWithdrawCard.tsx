'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Banknote, ShieldCheck, FileText } from 'lucide-react'
import { Card, Button } from '@/components/design-system'
import Dac7FiscalForm from '@/components/fiscal/Dac7FiscalForm'

// ── AffiliateWithdrawCard — self-service payout UI (Brique D2, Agent 64) ───────────────
// Renders the withdrawal flow over /api/affiliate/withdraw. NO money is computed here —
// the server decides the amount (matured balance) and gates KYC/threshold/fiscal. When the
// rail is OFF (endpoint 404) the card renders NOTHING → the dashboard stays byte-identical.
// States: below-threshold / KYC-required (Stripe onboarding) / fiscal-required (DAC7 form)
// / in-progress / paid / failed. Owner-scoped server-side (session operator).

type Status = {
  enabled: boolean
  availableCents: number
  thresholdCents: number
  connectStatus: string
  hasAccount: boolean
  fiscalComplete: boolean
  payouts: { id: string; amountCents: number; status: string; createdAt: string }[]
}
type PostResult =
  | { status: 'below_threshold'; availableCents: number; thresholdCents: number }
  | { status: 'kyc_required'; onboardingUrl?: string; fiscalComplete?: boolean }
  | { status: 'fiscal_required' }
  | { status: 'in_progress' }
  | { status: 'paid'; amountCents: number }
  | { status: 'failed' }
  | { status: 'unavailable' }

const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export default function AffiliateWithdrawCard() {
  const t = useTranslations('affiliate')
  const [status, setStatus]   = useState<Status | null>(null)
  const [hidden, setHidden]   = useState(false)   // rail OFF / not an affiliate → render nothing
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]   = useState<PostResult | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/affiliate/withdraw')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setStatus)
      .catch(() => setHidden(true))   // 404 (gated) or 401 → hide → dashboard byte-identical
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (hidden) return null
  if (loading || !status) {
    return <Card elevation="sm" padding="md"><div className="flex justify-center py-2 text-grubano-ink-muted"><Loader2 size={18} className="animate-spin" /></div></Card>
  }

  const below = status.availableCents < status.thresholdCents

  async function submit() {
    setSubmitting(true); setResult(null)
    try {
      const res = await fetch('/api/affiliate/withdraw', { method: 'POST' })
      const data = (await res.json().catch(() => ({ status: 'failed' }))) as PostResult
      setResult(data)
      if (data.status === 'paid') load() // refresh balance + history
    } catch {
      setResult({ status: 'failed' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card elevation="sm" padding="md">
      <div className="flex items-center gap-2 mb-2">
        <Banknote size={16} className="text-grubano-primary" />
        <p className="text-sm font-bold">{t('withdrawTitle')}</p>
      </div>

      <p className="text-[13px] text-grubano-ink-muted">
        {t('balanceAvailable')} : <span className="font-bold text-grubano-primary">{eur(status.availableCents)} €</span>
      </p>

      {below ? (
        <p className="mt-2 rounded-grubano-md bg-grubano-bg px-3 py-2 text-[12px] text-grubano-ink-muted">
          {t('withdrawBelowThreshold', { missing: eur(status.thresholdCents - status.availableCents), threshold: eur(status.thresholdCents) })}
        </p>
      ) : (
        <Button variant="primary" size="sm" className="mt-3" loading={submitting} onClick={submit}>
          {t('withdrawCta')}
        </Button>
      )}

      {/* Result states */}
      {result?.status === 'kyc_required' && (
        <div className="mt-3 rounded-grubano-md border border-grubano-border bg-grubano-bg p-3">
          <div className="flex items-center gap-2 mb-1"><ShieldCheck size={15} className="text-grubano-primary" /><p className="text-[13px] font-bold">{t('withdrawKycTitle')}</p></div>
          <p className="text-[12px] text-grubano-ink-muted">{t('withdrawKycBody')}</p>
          {result.onboardingUrl && (
            <Button variant="primary" size="sm" className="mt-2" onClick={() => { window.location.href = result.onboardingUrl! }}>
              {t('withdrawKycCta')}
            </Button>
          )}
        </div>
      )}

      {result?.status === 'fiscal_required' && (
        <div className="mt-3 rounded-grubano-md border border-grubano-border bg-grubano-bg p-3">
          <div className="flex items-center gap-2 mb-1"><FileText size={15} className="text-grubano-primary" /><p className="text-[13px] font-bold">{t('withdrawFiscalTitle')}</p></div>
          <p className="mb-2 text-[12px] text-grubano-ink-muted">{t('withdrawFiscalBody')}</p>
          <Dac7FiscalForm />
        </div>
      )}

      {result?.status === 'in_progress' && <p className="mt-2 text-[12px] text-grubano-ink-muted">{t('withdrawInProgress')}</p>}
      {result?.status === 'paid'        && <p className="mt-2 text-[12px] font-semibold text-grubano-success">{t('withdrawPaid', { amount: eur(result.amountCents) })}</p>}
      {(result?.status === 'failed' || result?.status === 'unavailable') && <p className="mt-2 text-[12px] text-grubano-danger">{t('withdrawFailed')}</p>}

      {/* History */}
      {status.payouts.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-grubano-ink-muted mb-1">{t('withdrawHistoryTitle')}</p>
          <ul className="space-y-1">
            {status.payouts.map(p => (
              <li key={p.id} className="flex items-center justify-between text-[12px]">
                <span className="text-grubano-ink-muted">{new Date(p.createdAt).toLocaleDateString('fr-FR')}</span>
                <span className="font-semibold">{eur(p.amountCents)} €</span>
                <span className="text-[11px] text-grubano-ink-faint">{t(`payout_${p.status}` as 'payout_paid')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
