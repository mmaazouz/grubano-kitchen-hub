'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bike, ArrowLeft, CheckCircle2, Info, MailCheck, LogIn, ShieldCheck } from 'lucide-react'
import { Link } from '@/navigation'
import { Card, Button, Input } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

// ── /business/logistics/register — self-serve courier / delivery onboarding ───
// (Slice 1, Agent 15). The delivery-partner analogue of /supplier/register, in the
// premium PartnerChrome. Passwordless: submits to POST /api/logistics/register,
// which verifies the SIREN against the official registry (NAME-TOLERANT) and, on
// success, provisions a passwordless Operator with the 'logistics' role. Anti-bot:
// hidden honeypot + a form-open timestamp. NO payment in this slice.

const PARTNER_TYPES = ['independent', 'company'] as const
const MISSION_TYPES = ['repas', 'produits_fournisseurs', 'b2b', 'froid'] as const
const VEHICLE_TYPES = ['velo', 'scooter', 'voiture', 'camionnette', 'frigorifique'] as const

// Map enum → i18n key suffix (camelCase) for the option labels.
const MISSION_LABEL: Record<(typeof MISSION_TYPES)[number], string> = {
  repas: 'missionRepas',
  produits_fournisseurs: 'missionProduits',
  b2b: 'missionB2b',
  froid: 'missionFroid',
}
const VEHICLE_LABEL: Record<(typeof VEHICLE_TYPES)[number], string> = {
  velo: 'vehicleVelo',
  scooter: 'vehicleScooter',
  voiture: 'vehicleVoiture',
  camionnette: 'vehicleCamionnette',
  frigorifique: 'vehicleFrigorifique',
}

export default function LogisticsRegisterPage() {
  const t = useTranslations('business.logistics')

  const [partnerType, setPartnerType]   = useState<(typeof PARTNER_TYPES)[number]>('independent')
  const [contactName, setContactName]   = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [siren, setSiren]               = useState('')
  const [missionTypes, setMissionTypes] = useState<string[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<string[]>([])
  const [zones, setZones]               = useState('')
  const [consent, setConsent]           = useState(false)
  const [website, setWebsite]           = useState('') // honeypot — must stay empty
  const [formStartedAt]                 = useState(() => Date.now())

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [done, setDone]             = useState(false)
  // Outcome from the API: 'active' (instantly usable), 'pending' (review), or
  // 'rejected'. `officialName` accompanies an 'active' outcome (greet by the
  // verified registry name).
  const [outcome, setOutcome]           = useState<'active' | 'pending' | 'rejected'>('pending')
  const [officialName, setOfficialName] = useState<string | null>(null)

  // Inline SIREN/SIRET format check (9 or 14 digits, spaces tolerated) — UX only;
  // the server re-validates and is the source of truth.
  const sirenDigits    = siren.replace(/\s+/g, '')
  const sirenValid     = /^\d{9}$/.test(sirenDigits) || /^\d{14}$/.test(sirenDigits)
  const showSirenError = siren.trim().length > 0 && !sirenValid

  function toggle(list: string[], setList: (v: string[]) => void, v: string) {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!sirenValid) { setError(t('fieldSirenError')); return }
    if (missionTypes.length === 0) { setError(t('errorMissionRequired')); return }
    if (vehicleTypes.length === 0) { setError(t('errorVehicleRequired')); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/logistics/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerType,
          contactName,
          contactEmail,
          contactPhone: contactPhone || undefined,
          siren,
          missionTypes,
          vehicleTypes,
          zones: zones.split(',').map((z) => z.trim()).filter(Boolean),
          consent,
          website,
          formStartedAt,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || t('errorGeneric'))
        return
      }
      const o = data?.outcome
      setOutcome(o === 'active' || o === 'rejected' ? o : 'pending')
      setOfficialName(typeof data?.officialName === 'string' ? data.officialName : null)
      setDone(true)
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PartnerChrome>
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-11 w-11 place-items-center rounded-grubano-lg bg-grubano-role-logistics/12 text-grubano-role-logistics">
            <Bike size={22} />
          </span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('registerTitle')}</h1>
            <p className="text-grubano-sm text-grubano-ink-muted">{t('registerSubtitle')}</p>
          </div>
        </div>

        <Card elevation="premium" padding="lg">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className={[
                'grid h-14 w-14 place-items-center rounded-grubano-pill',
                outcome === 'rejected' ? 'bg-grubano-surface-muted' : 'bg-grubano-success-tint',
              ].join(' ')}>
                {outcome === 'active'
                  ? <CheckCircle2 size={28} className="text-grubano-success" />
                  : outcome === 'rejected'
                    ? <Info size={28} className="text-grubano-ink-muted" />
                    : <MailCheck size={28} className="text-grubano-success" />}
              </span>
              <p className="font-display text-base font-bold text-grubano-ink">
                {t((outcome === 'active' ? 'successTitleActive' : outcome === 'rejected' ? 'successTitleRejected' : 'successTitle') as 'successTitle')}
              </p>
              {outcome === 'active' && officialName && (
                <span className="inline-flex items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-grubano-sm font-semibold text-grubano-primary">
                  <ShieldCheck size={14} /> {officialName}
                </span>
              )}
              <p className="max-w-xs text-grubano-sm text-grubano-ink-muted">
                {t((outcome === 'active' ? 'successBodyActive' : outcome === 'rejected' ? 'successBodyRejected' : 'successBody') as 'successBody')}
              </p>
              {outcome === 'active' && (
                <Link
                  href="/auth/magic"
                  className="mt-2 inline-flex items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-5 py-3 font-semibold text-white shadow-grubano-sm transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
                >
                  <LogIn size={16} /> {t('successCtaActive')}
                </Link>
              )}
              {outcome === 'pending' && (
                <Link href="/auth/magic" className="mt-1 inline-flex items-center gap-1 text-grubano-sm font-semibold text-grubano-primary">
                  <ArrowLeft size={14} /> {t('backToLogin')}
                </Link>
              )}
              {outcome === 'rejected' && (
                <Link href="/business/start" className="mt-1 inline-flex items-center gap-1 text-grubano-sm font-semibold text-grubano-primary">
                  <ArrowLeft size={14} /> {t('back')}
                </Link>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && (
                <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                  {error}
                </p>
              )}

              {/* Partner type — radio segmented */}
              <fieldset>
                <legend className="mb-1.5 text-grubano-sm font-medium text-grubano-ink">{t('fieldPartnerType')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {PARTNER_TYPES.map((pt) => {
                    const active = partnerType === pt
                    return (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => setPartnerType(pt)}
                        aria-pressed={active}
                        className={[
                          'rounded-grubano-lg border px-3 py-2.5 text-grubano-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20',
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
                        ].join(' ')}
                      >
                        {t(pt === 'independent' ? 'partnerTypeIndependent' : 'partnerTypeCompany')}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <Input
                label={t('fieldSiren')}
                required
                inputMode="numeric"
                value={siren}
                onChange={(e) => setSiren(e.target.value)}
                placeholder="123 456 789"
                hint={t('fieldSirenHint')}
                error={showSirenError ? t('fieldSirenError') : undefined}
              />

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
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
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
                          active
                            ? 'border-grubano-primary bg-grubano-primary text-white'
                            : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:border-grubano-primary/40',
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

              <Input label={t('fieldContactName')} required value={contactName} onChange={(e) => setContactName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('fieldContactEmail')} type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                <Input label={t('fieldContactPhone')} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </div>

              {/* Honeypot — visually hidden, must stay empty (anti-bot). */}
              <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website
                  <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </label>
              </div>

              <label className="flex items-start gap-2 text-grubano-sm text-grubano-ink-muted">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-grubano-primary"
                  required
                />
                <span>{t('consentLabel')}</span>
              </label>

              <Button type="submit" variant="primary" size="md" fullWidth loading={submitting}>
                {submitting ? t('submitting') : t('submit')}
              </Button>

              <Link href="/business/start" className="block text-center text-grubano-sm font-semibold text-grubano-ink-muted hover:text-grubano-primary">
                {t('back')}
              </Link>
            </form>
          )}
        </Card>
      </div>
    </PartnerChrome>
  )
}
