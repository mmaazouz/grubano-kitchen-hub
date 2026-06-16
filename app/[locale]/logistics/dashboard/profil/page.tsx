'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Bike, ArrowLeft, CheckCircle2, Lock, Loader2 } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'

// ── /logistics/dashboard/profil — editable courier Profile & settings (P5a) ───
// Calqued on /supplier/dashboard/profil. GET /api/logistics/profile to pre-fill,
// PATCH to save OPERATIONAL fields only. Identity (SIREN / official name /
// verification / account status) shown READ-ONLY, never sent. Same sober chrome
// as /logistics/dashboard (bare: no operator sidebar).

const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const
const MISSION_LABEL: Record<string, string> = {
  repas: 'missionRepas', produits_fournisseurs: 'missionProduits', b2b: 'missionB2b', froid: 'missionFroid',
}
const VEHICLE_LABEL: Record<string, string> = {
  velo: 'vehicleVelo', scooter: 'vehicleScooter', voiture: 'vehicleVoiture', camionnette: 'vehicleCamionnette', frigorifique: 'vehicleFrigorifique',
}

type ProfileData = {
  partnerType: string; contactName: string; contactPhone: string
  missionTypes: string[]; vehicleTypes: string[]; zones: string[]
  siren: string | null; officialName: string | null
  verificationStatus: string | null; status: string
}

export default function LogisticsProfilePage() {
  const t = useTranslations('business.logistics')
  const d = (k: string) => t(`dashboard.${k}` as 'dashboard.welcome')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [partnerType, setPartnerType] = useState<'independent' | 'company'>('independent')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [missionTypes, setMissionTypes] = useState<string[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])
  const [zones, setZones] = useState('')

  const [locked, setLocked] = useState<Pick<ProfileData, 'siren' | 'officialName' | 'verificationStatus' | 'status'> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/logistics/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return
        const p = res?.profile as ProfileData | undefined
        if (!p) { setLoadError(true); return }
        setPartnerType(p.partnerType === 'company' ? 'company' : 'independent')
        setContactName(p.contactName ?? '')
        setContactPhone(p.contactPhone ?? '')
        setMissionTypes(Array.isArray(p.missionTypes) ? p.missionTypes : [])
        setVehicleTypes(Array.isArray(p.vehicleTypes) ? p.vehicleTypes : [])
        setZones((p.zones ?? []).join(', '))
        setLocked({ siren: p.siren, officialName: p.officialName, verificationStatus: p.verificationStatus, status: p.status })
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Clear the "saved" banner as soon as the user edits again (it reflected the
  // previously-saved state). No-op during the prefill (saved is false then).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [partnerType, contactName, contactPhone, missionTypes, vehicleTypes, zones])

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      const res = await fetch('/api/logistics/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerType,
          contactName,
          contactPhone: contactPhone || undefined,
          missionTypes,
          vehicleTypes,
          zones: zones.split(',').map((z) => z.trim()).filter(Boolean),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || d('errorGeneric')); return }
      setSaved(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError(d('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  const verifLabel = (v: string | null) =>
    v === 'verified' ? d('verifVerified')
    : v === 'review' ? d('verifReview')
    : v === 'rejected' ? d('verifRejected')
    : d('verifNone')
  const statusLabel = (s: string) =>
    s === 'active' ? d('statusActive')
    : s === 'suspended' ? d('statusSuspended')
    : s === 'rejected' ? d('statusRejected')
    : d('statusPending')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Bike size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="truncate font-display text-lg font-bold leading-tight">{d('editTitle')}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-6">
        <Link href="/logistics/dashboard" className="inline-flex items-center gap-1.5 text-grubano-sm font-semibold text-grubano-ink-muted hover:text-grubano-primary">
          <ArrowLeft size={15} /> {d('back')}
        </Link>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-grubano-ink-muted"><Loader2 className="animate-spin" size={22} /></div>
        ) : loadError ? (
          <Card elevation="sm" padding="lg" className="text-center text-grubano-sm text-grubano-ink-muted">{d('loadError')}</Card>
        ) : (
          <>
            {saved && (
              <Card elevation="sm" padding="md" className="border-grubano-success/40 bg-grubano-success-tint">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-grubano-success" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{d('savedTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('savedBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            <p className="text-grubano-sm text-grubano-ink-muted">{d('editSubtitle')}</p>

            <form onSubmit={save} className="space-y-5">
              <Card elevation="sm" padding="lg" className="space-y-4">
                {error && (
                  <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">{error}</p>
                )}

                {/* Partner type — segmented */}
                <fieldset>
                  <legend className="mb-1.5 text-grubano-sm font-medium text-grubano-ink">{t('fieldPartnerType')}</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['independent', 'company'] as const).map((pt) => {
                      const active = partnerType === pt
                      return (
                        <button
                          key={pt}
                          type="button"
                          onClick={() => setPartnerType(pt)}
                          aria-pressed={active}
                          className={[
                            'rounded-grubano-lg border px-3 py-2.5 text-grubano-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                            active ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                          ].join(' ')}
                        >
                          {t(pt === 'independent' ? 'partnerTypeIndependent' : 'partnerTypeCompany')}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <Input label={t('fieldContactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
                <Input label={t('fieldContactPhone')} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />

                {/* Mission types — multi-select */}
                <div>
                  <p className="mb-1.5 text-grubano-sm font-medium text-grubano-ink">{t('fieldMissionTypes')}</p>
                  <div className="flex flex-wrap gap-2">
                    {MISSION_TYPES.map((m) => {
                      const active = missionTypes.includes(m)
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggle(missionTypes, setMissionTypes, m)}
                          aria-pressed={active}
                          className={[
                            'rounded-grubano-pill border px-3 py-1.5 text-grubano-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                            active ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                          ].join(' ')}
                        >
                          {t(MISSION_LABEL[m] as 'missionRepas')}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Vehicle types — multi-select */}
                <div>
                  <p className="mb-1.5 text-grubano-sm font-medium text-grubano-ink">{t('fieldVehicleTypes')}</p>
                  <div className="flex flex-wrap gap-2">
                    {VEHICLE_TYPES.map((v) => {
                      const active = vehicleTypes.includes(v)
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => toggle(vehicleTypes, setVehicleTypes, v)}
                          aria-pressed={active}
                          className={[
                            'rounded-grubano-pill border px-3 py-1.5 text-grubano-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                            active ? 'border-grubano-primary bg-grubano-primary text-white' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                          ].join(' ')}
                        >
                          {t(VEHICLE_LABEL[v] as 'vehicleVelo')}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <Input label={t('fieldZones')} value={zones} onChange={(e) => setZones(e.target.value)} placeholder="Lyon, Villeurbanne, 69003" />
                  <p className="mt-1 text-grubano-xs text-grubano-ink-faint">{t('fieldZonesHint')}</p>
                </div>

                <Button type="submit" variant="primary" size="md" fullWidth loading={saving}>
                  {saving ? d('saving') : d('save')}
                </Button>
              </Card>

              {/* Locked identity block — read-only, never editable */}
              {locked && (
                <Card elevation="sm" padding="lg" className="bg-grubano-surface-muted">
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                    <Lock size={13} /> {d('lockedTitle')}
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <LockedRow label={d('labelSiren')} value={locked.siren || d('verifNone')} />
                    <LockedRow label={d('labelOfficialName')} value={locked.officialName || d('verifNone')} />
                    <LockedRow label={d('labelVerification')} value={verifLabel(locked.verificationStatus)} />
                    <LockedRow label={d('labelAccountStatus')} value={statusLabel(locked.status)} />
                  </dl>
                  <p className="mt-3 text-grubano-xs text-grubano-ink-faint">{d('lockedNote')}</p>
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
