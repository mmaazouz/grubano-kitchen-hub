'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck, FileCheck2, Clock3, FileText } from 'lucide-react'
import { Card, Badge, Button, type BadgeTone } from '@/components/design-system'

// ── CourierJustificatifs — the courier's compliance declaration (Agent 125) ────
// Mounted on the logistics dashboard. A STRUCTURED DECLARATION (insurance + RC Pro; SIRET was
// collected at signup) — no file upload in this brick. Submitting marks the declaration
// 'submitted'; it does NOT activate the account — an admin verifies + activates, and ONLY when
// the activation flag is ON (waitlist guardrail). NO money. Owner-scoped via the session.

interface State {
  status: string; accountStatus: string
  insuranceInsurer: string; insurancePolicyNumber: string; insuranceExpiry: string
  rcProInsurer: string; rcProPolicyNumber: string
}

const STATUS_TONE: Record<string, BadgeTone> = { none: 'neutral', submitted: 'warning', verified: 'success' }

export default function CourierJustificatifs() {
  const t = useTranslations('business.logistics.justificatifs')
  const [s, setS] = useState<State | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/justificatifs', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (data?.ok) setS(data.justificatifs as State)
      else setS(null)
    } catch { setS(null) }
  }, [])
  useEffect(() => { void load() }, [load])

  const set = (k: keyof State) => (e: { target: { value: string } }) =>
    setS((prev) => (prev ? { ...prev, [k]: e.target.value } : prev))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!s) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/logistics/justificatifs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insuranceInsurer: s.insuranceInsurer, insurancePolicyNumber: s.insurancePolicyNumber,
          insuranceExpiry: s.insuranceExpiry, rcProInsurer: s.rcProInsurer, rcProPolicyNumber: s.rcProPolicyNumber,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) { setError(data?.error || t('errorGeneric')); return }
      setSaved(true); setS((prev) => (prev ? { ...prev, status: 'submitted' } : prev))
    } catch { setError(t('errorGeneric')) } finally { setSaving(false) }
  }

  if (!s) return null

  const statusLabel = t(`status_${s.status}` as 'status_none')
  const field = 'w-full rounded-grubano-lg border border-grubano-border bg-white px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none'
  const verified = s.status === 'verified'

  return (
    <Card elevation="sm" padding="lg">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-grubano-ink">
            <ShieldCheck size={18} className="text-grubano-primary" /> {t('title')}
          </p>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
        <Badge tone={STATUS_TONE[s.status] ?? 'neutral'} size="md"
          icon={s.status === 'verified' ? <FileCheck2 size={13} /> : s.status === 'submitted' ? <Clock3 size={13} /> : <FileText size={13} />}>
          {statusLabel}
        </Badge>
      </div>

      {saved && <div className="mb-3 rounded-grubano-lg bg-grubano-success-tint px-3 py-2 text-sm text-grubano-ink"><span className="font-semibold">{t('savedTitle')}</span> {t('savedBody')}</div>}
      {error && <div className="mb-3 rounded-grubano-lg bg-grubano-danger-tint px-3 py-2 text-sm text-grubano-danger">{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-3" disabled={verified}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{t('insuranceLegend')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('insurerLabel')}</label>
              <input value={s.insuranceInsurer} onChange={set('insuranceInsurer')} required minLength={2} maxLength={120} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('policyLabel')}</label>
              <input value={s.insurancePolicyNumber} onChange={set('insurancePolicyNumber')} required minLength={2} maxLength={80} className={field} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('expiryLabel')}</label>
            <input type="date" value={s.insuranceExpiry} onChange={set('insuranceExpiry')} required className={field} />
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={verified}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{t('rcProLegend')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('rcProInsurerLabel')}</label>
              <input value={s.rcProInsurer} onChange={set('rcProInsurer')} required minLength={2} maxLength={120} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-grubano-ink">{t('rcProNumberLabel')}</label>
              <input value={s.rcProPolicyNumber} onChange={set('rcProPolicyNumber')} required minLength={2} maxLength={80} className={field} />
            </div>
          </div>
        </fieldset>

        <p className="text-xs text-grubano-ink-faint">{t('note')}</p>

        {!verified && (
          <Button type="submit" variant="primary" size="md" disabled={saving}>
            {saving ? t('submitting') : t('submit')}
          </Button>
        )}
      </form>
    </Card>
  )
}
