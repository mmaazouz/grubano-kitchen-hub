'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Truck, ArrowLeft, CheckCircle2, Lock, Loader2 } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

// ── /supplier/dashboard/profil — editable supplier Profile & settings (P5a) ───
// Client page: GET /api/supplier/profile to pre-fill, PATCH to save the OPERATIONAL
// fields only. Identity fields (SIREN / official name / verification / account
// status) are shown READ-ONLY and are never sent — the API ignores them anyway.
// Same sober chrome as /supplier/dashboard (bare: no operator sidebar).

const CATEGORIES = ['fresh', 'meat', 'fish', 'dairy', 'drinks', 'grocery', 'packaging'] as const

type ProfileData = {
  companyName: string; contactName: string; phone: string; city: string
  categories: string[]; deliveryZones: string[]; minimumOrderEur: number
  leadTimeDays: number; paymentTerms: string
  siren: string | null; officialName: string | null
  verificationStatus: string | null; status: string
}

export default function SupplierProfilePage() {
  const t = useTranslations('supplier')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Editable fields
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [zones, setZones] = useState('') // comma-separated text
  const [minOrder, setMinOrder] = useState('')
  const [leadTime, setLeadTime] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')

  // Locked (read-only display)
  const [locked, setLocked] = useState<Pick<ProfileData, 'siren' | 'officialName' | 'verificationStatus' | 'status'> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/supplier/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        const p = d?.profile as ProfileData | undefined
        if (!p) { setLoadError(true); return }
        setCompanyName(p.companyName ?? '')
        setContactName(p.contactName ?? '')
        setPhone(p.phone ?? '')
        setCity(p.city ?? '')
        setCategories(Array.isArray(p.categories) ? p.categories : [])
        setZones((p.deliveryZones ?? []).join(', '))
        setMinOrder(String(p.minimumOrderEur ?? 0))
        setLeadTime(String(p.leadTimeDays ?? 1))
        setPaymentTerms(p.paymentTerms ?? '')
        setLocked({ siren: p.siren, officialName: p.officialName, verificationStatus: p.verificationStatus, status: p.status })
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Clear the "saved" banner as soon as the user edits again (it reflected the
  // previously-saved state, not the now-dirty form). No-op during the prefill
  // (saved is false then).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [companyName, contactName, phone, city, categories, zones, minOrder, leadTime, paymentTerms])

  const catLabel = (c: string) => t(`cat${c.charAt(0).toUpperCase()}${c.slice(1)}` as 'catFresh')
  function toggleCategory(c: string) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      const res = await fetch('/api/supplier/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          contactName,
          phone:           phone || undefined,
          city:            city || undefined,
          categories,
          deliveryZones:   zones.split(',').map((z) => z.trim()).filter(Boolean),
          minimumOrderEur: Number(minOrder) || 0,
          leadTimeDays:    Number(leadTime) || 0,
          paymentTerms:    paymentTerms || undefined,
        }),
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

  const verifLabel = (v: string | null) =>
    v === 'verified' ? t('verifVerified')
    : v === 'review' ? t('verifReview')
    : v === 'rejected' ? t('verifRejected')
    : t('verifNone')
  const statusLabel = (s: string) =>
    s === 'active' ? t('statusActive')
    : s === 'suspended' ? t('statusSuspended')
    : s === 'rejected' ? t('statusRejected')
    : t('statusPending')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Truck size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="truncate font-display text-lg font-bold leading-tight">{t('profileTitle')}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-6">
        <Link href="/supplier/dashboard" className="inline-flex items-center gap-1.5 text-grubano-sm font-semibold text-grubano-ink-muted hover:text-grubano-primary">
          <ArrowLeft size={15} /> {t('profileBack')}
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-grubano-ink-muted"><Loader2 className="animate-spin" size={22} /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg" className="text-center text-grubano-sm text-grubano-ink-muted">{t('profileLoadError')}</Card>
        ) : (
          <>
            {saved && (
              <Card elevation="sm" padding="md" className="border-grubano-success/40 bg-grubano-success-tint">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-grubano-success" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{t('profileSavedTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{t('profileSavedBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            <p className="text-grubano-sm text-grubano-ink-muted">{t('profileSubtitle')}</p>

            <form onSubmit={save} className="space-y-5">
              <Card elevation="sm" padding="lg" className="space-y-4">
                {error && (
                  <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">{error}</p>
                )}

                <Input label={t('fieldCompanyName')} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                <Input label={t('fieldContactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label={t('fieldPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <Input label={t('fieldCity')} value={city} onChange={(e) => setCity(e.target.value)} />
                </div>

                <div>
                  <p className="mb-1.5 text-grubano-sm font-medium text-grubano-ink">{t('fieldCategories')}</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => {
                      const active = categories.includes(c)
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleCategory(c)}
                          aria-pressed={active}
                          className={[
                            'rounded-grubano-pill border px-3 py-1.5 text-grubano-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                            active ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                          ].join(' ')}
                        >
                          {catLabel(c)}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <Input label={t('fieldDeliveryZones')} value={zones} onChange={(e) => setZones(e.target.value)} placeholder="Lyon, Villeurbanne, 69003" />
                  <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('fieldDeliveryZonesHint')}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label={t('fieldMinimumOrder')} type="number" inputMode="numeric" min="0" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
                  <Input label={t('fieldLeadTime')} type="number" inputMode="numeric" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
                </div>

                <div>
                  <label className="mb-1.5 block text-grubano-sm font-medium text-grubano-ink">{t('fieldPaymentTerms')}</label>
                  <textarea
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
                  />
                  <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('fieldPaymentTermsHint')}</p>
                </div>

                <Button type="submit" variant="primary" size="md" fullWidth loading={saving}>
                  {saving ? t('saving') : t('save')}
                </Button>
              </Card>

              {/* Locked identity block — read-only, never editable */}
              {locked && (
                <Card elevation="sm" padding="lg" className="bg-grubano-surface-muted">
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                    <Lock size={13} /> {t('profileLockedTitle')}
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <LockedRow label={t('lockedSiren')} value={locked.siren || t('verifNone')} />
                    <LockedRow label={t('lockedOfficialName')} value={locked.officialName || t('verifNone')} />
                    <LockedRow label={t('lockedVerification')} value={verifLabel(locked.verificationStatus)} />
                    <LockedRow label={t('lockedAccountStatus')} value={statusLabel(locked.status)} />
                  </dl>
                  <p className="mt-3 text-grubano-xs text-grubano-ink-faint">{t('profileLockedNote')}</p>
                </Card>
              )}
            </form>
          </>
        )}
      </main>
    </div>
  )
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{label}</dt>
      <dd className="text-sm text-grubano-ink-muted">{value}</dd>
    </div>
  )
}
