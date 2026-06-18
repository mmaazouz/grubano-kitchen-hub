'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'

// ── /brands/[id]/franchise — brand OWNER edits their franchise terms (B4, Agent 46) ─
// Edits Brand.{openToFranchise, royaltyPct, setupFee, franchiseZones, franchiseStatus}
// via GET/PATCH /api/brands/[id] (owner-scoped server-side — a non-owner gets 403/404).
// royaltyPct is stored as a FRACTION (0.06); the form works in PERCENT (6) and converts.
// Empty rate = null → the 6% default applies (same rate the accrual + dashboard resolve).

type FranchiseBrand = {
  id: string
  name?: string
  openToFranchise: boolean
  royaltyPct: number | null
  setupFee: number | null
  franchiseZones: string[]
  franchiseStatus: string
}

const fieldClass =
  'w-full rounded-grubano-lg border border-grubano-line bg-white px-3 py-2.5 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none'

export default function BrandFranchisePage({ params }: { params: { id: string } }) {
  const t = useTranslations('brands.franchise')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [openToFranchise, setOpenToFranchise] = useState(false)
  const [royaltyInput, setRoyaltyInput] = useState('') // PERCENT string ('' = default 6%)
  const [setupFeeInput, setSetupFeeInput] = useState('')
  const [zonesInput, setZonesInput] = useState('')      // one zone per line
  const [franchiseStatus, setFranchiseStatus] = useState('none')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/brands/${params.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return
        const b = res?.brand as FranchiseBrand | undefined
        if (!b) { setLoadError(true); return }
        setOpenToFranchise(!!b.openToFranchise)
        setRoyaltyInput(b.royaltyPct == null ? '' : String(Math.round(b.royaltyPct * 1000) / 10)) // fraction → %
        setSetupFeeInput(b.setupFee == null ? '' : String(b.setupFee))
        setZonesInput(Array.isArray(b.franchiseZones) ? b.franchiseZones.join('\n') : '')
        setFranchiseStatus(b.franchiseStatus || 'none')
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [openToFranchise, royaltyInput, setupFeeInput, zonesInput, franchiseStatus])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false)

    // PERCENT → FRACTION; empty = null (default 6%). Validate 0–50%.
    let royaltyPct: number | null = null
    const rt = royaltyInput.trim()
    if (rt !== '') {
      const pct = Number(rt.replace(',', '.'))
      if (!Number.isFinite(pct) || pct < 0 || pct > 50) { setError(t('royaltyError')); return }
      royaltyPct = Math.round((pct / 100) * 1e6) / 1e6 // fraction, cent-of-a-percent precision
    }
    const sf = setupFeeInput.trim()
    const setupFee = sf === '' ? null : Number(sf.replace(',', '.'))
    if (setupFee != null && (!Number.isFinite(setupFee) || setupFee < 0)) { setError(t('errorGeneric')); return }
    const franchiseZones = zonesInput
      .split(/[\n,]/).map((z) => z.trim()).filter(Boolean).slice(0, 50)

    setSaving(true)
    try {
      const res = await fetch(`/api/brands/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openToFranchise, royaltyPct, setupFee, franchiseZones, franchiseStatus }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || t('errorGeneric')); return }
      setSaved(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link href="/dashboard/establishments" className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-grubano-ink-muted transition-colors hover:text-grubano-primary">
        <ArrowLeft size={13} className="rtl:rotate-180" /> {t('back')}
      </Link>

      <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('title')}</h1>
      <p className="mt-1 text-sm text-grubano-ink-muted">{t('subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-grubano-ink-muted"><Loader2 className="animate-spin" size={22} /></div>
      ) : loadError ? (
        <Card elevation="sm" padding="lg" className="mt-5 text-center text-sm text-grubano-ink-muted">{t('loadError')}</Card>
      ) : (
        <div className="mt-5 space-y-5">
          {saved && (
            <Card elevation="sm" padding="md" className="border-grubano-success/40 bg-grubano-success-tint">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-grubano-success" />
                <div>
                  <p className="font-semibold text-grubano-ink">{t('savedTitle')}</p>
                  <p className="text-sm text-grubano-ink-muted">{t('savedBody')}</p>
                </div>
              </div>
            </Card>
          )}

          <form onSubmit={save} className="space-y-5">
            <Card elevation="sm" padding="lg" className="space-y-4">
              {error && (
                <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">{error}</p>
              )}

              <label className="flex items-start gap-3">
                <input type="checkbox" checked={openToFranchise} onChange={(e) => setOpenToFranchise(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-grubano-primary" />
                <span>
                  <span className="block text-sm font-medium text-grubano-ink">{t('openLabel')}</span>
                  <span className="block text-grubano-xs text-grubano-ink-faint">{t('openHint')}</span>
                </span>
              </label>

              <div>
                <Input label={t('royaltyLabel')} type="number" inputMode="decimal" min={0} max={50} step="0.1"
                  value={royaltyInput} onChange={(e) => setRoyaltyInput(e.target.value)} placeholder="6" />
                <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('royaltyHint')}</p>
              </div>

              <div>
                <Input label={t('setupFeeLabel')} type="number" inputMode="decimal" min={0} step="1"
                  value={setupFeeInput} onChange={(e) => setSetupFeeInput(e.target.value)} placeholder="0" />
                <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('setupFeeHint')}</p>
              </div>

              <div>
                <label htmlFor="franchise-zones" className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('zonesLabel')}</label>
                <textarea id="franchise-zones" rows={4} className={fieldClass} value={zonesInput}
                  onChange={(e) => setZonesInput(e.target.value)} placeholder={t('zonesPlaceholder')} />
                <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('zonesHint')}</p>
              </div>

              <div>
                <label htmlFor="franchise-status" className="mb-1.5 block text-sm font-medium text-grubano-ink">{t('statusLabel')}</label>
                <select id="franchise-status" className={fieldClass} value={franchiseStatus} onChange={(e) => setFranchiseStatus(e.target.value)}>
                  <option value="none">{t('statusNone')}</option>
                  <option value="open">{t('statusOpen')}</option>
                  <option value="full">{t('statusFull')}</option>
                </select>
              </div>

              <Button type="submit" variant="primary" size="md" fullWidth loading={saving}>
                {saving ? t('saving') : t('save')}
              </Button>
            </Card>
          </form>
        </div>
      )}
    </div>
  )
}
