'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { isPlausibleAddress } from '@/lib/geocode'
import {
  Store,
  MapPin,
  Bike,
  Package,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Image as ImageIcon,
} from 'lucide-react'
import { Card, Button, Input } from '@/components/design-system'
import PartnerShell from '@/components/business/PartnerShell'

type Step = 'brand' | 'restaurant' | 'done'

interface MeResponse {
  ok: boolean
  role?: string
  status?: string
  hasBrand?: boolean
  hasRestaurant?: boolean
  needsOnboarding?: boolean
  brand?: { id: string; name: string; emoji: string; cuisineType: string | null } | null
}

// Predefined cuisine types — keep stable so the search filter on /eat groups
// brands sensibly. Stored value is canonical; the label is i18n.
const CUISINE_TYPES = [
  { value: 'italien', labelKey: 'cuisineItalien', emoji: '🍕' },
  { value: 'asiatique', labelKey: 'cuisineAsiatique', emoji: '🍜' },
  { value: 'burger', labelKey: 'cuisineBurger', emoji: '🍔' },
  { value: 'healthy', labelKey: 'cuisineHealthy', emoji: '🥗' },
  { value: 'sushi', labelKey: 'cuisineSushi', emoji: '🍣' },
  { value: 'desserts', labelKey: 'cuisineDesserts', emoji: '🍰' },
  { value: 'wraps', labelKey: 'cuisineWraps', emoji: '🥙' },
  { value: 'pasta', labelKey: 'cuisinePasta', emoji: '🍝' },
  { value: 'autre', labelKey: 'cuisineAutre', emoji: '🍴' },
] as const

const BRAND_EMOJIS = ['🍕', '🍜', '🍔', '🥗', '🍣', '🍰', '🥙', '🍝', '🌮', '🍱', '🥘', '🥟', '🍴', '🥐']

/** Loose http(s) URL check — matches the server zod `.url()` intent without
 *  blocking the user on an empty field (those are sent as undefined). */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export default function PartnerOnboardingPage() {
  const t = useTranslations('business.onboarding')
  const router = useRouter()

  const [gateLoading, setGateLoading] = useState(true)
  const [step, setStep] = useState<Step>('brand')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Brand fields
  const [brandName, setBrandName] = useState('')
  const [cuisineType, setCuisineType] = useState<string>('italien')
  const [emoji, setEmoji] = useState<string>('🍕')

  // Restaurant fields
  const [restaurantName, setRestaurantName] = useState('')
  const [description, setDescription] = useState('')
  const [logo, setLogo] = useState('')
  const [coverPhoto, setCoverPhoto] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [deliveryEnabled, setDeliveryEnabled] = useState(true)
  const [pickupEnabled, setPickupEnabled] = useState(false)

  // Gate: ensure the visitor is a signed-in restaurant partner who has not
  // already finished onboarding. Resumes at the right step from real state.
  useEffect(() => {
    let cancelled = false
    fetch('/api/business/me', { cache: 'no-store' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) {
          router.replace('/auth/magic')
          return
        }
        const data: MeResponse = await r.json().catch(() => ({ ok: false }))
        if (!data.ok) {
          router.replace('/auth/magic')
          return
        }
        if (data.role === 'admin') {
          router.replace('/dashboard')
          return
        }
        if (data.role !== 'restaurant') {
          router.replace('/eat')
          return
        }
        // Fully onboarded (brand + restaurant) → dashboard.
        if (data.hasBrand && data.hasRestaurant) {
          router.replace('/dashboard')
          return
        }
        // RESUME: brand exists but restaurant doesn't → jump to step 2 and
        // pre-fill the cuisine from the existing brand. Never recreate the
        // brand (anti-doublon — the POST /api/brands would just add a second).
        if (data.hasBrand && !data.hasRestaurant) {
          if (data.brand?.cuisineType) setCuisineType(data.brand.cuisineType)
          if (data.brand?.emoji) setEmoji(data.brand.emoji)
          if (data.brand?.name) setBrandName(data.brand.name)
          setStep('restaurant')
        }
        // else: no brand → keep the default step 'brand'.
        setGateLoading(false)
      })
      .catch(() => {
        if (!cancelled) router.replace('/auth/magic')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  // Keep brand emoji in sync with cuisine pick unless the user picked one.
  useEffect(() => {
    const match = CUISINE_TYPES.find((c) => c.value === cuisineType)
    if (match && !BRAND_EMOJIS.includes(emoji)) return
    if (match) setEmoji(match.emoji)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuisineType])

  async function submitBrand(e: React.FormEvent) {
    e.preventDefault()
    if (!brandName.trim()) {
      setError(t('errBrandName'))
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        brandName.trim(),
          emoji,
          cuisineType,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 401) {
        router.replace('/auth/magic')
        return
      }
      if (!res.ok) {
        setError((data && (data.error as string)) || t('errBrandFailed'))
        return
      }
      setStep('restaurant')
      setError('')
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitRestaurant(e: React.FormEvent) {
    e.preventDefault()
    if (!restaurantName.trim() || !address.trim() || !city.trim()) {
      setError(t('errRestaurantMissing'))
      return
    }
    // Reject an implausible address ("gogo") — same gate as the establishments
    // hub; the server enforces it too. The deeper existence check is the BAN
    // geocode server-side (a miss there is reviewed by the admin, not blocked).
    if (!isPlausibleAddress(address)) {
      setError(t('errAddressInvalid'))
      return
    }
    if (!deliveryEnabled && !pickupEnabled) {
      setError(t('errAtLeastOneFulfilment'))
      return
    }
    // Logo / cover are OPTIONAL URLs. Only validate when filled — an empty field
    // is fine (the consumer app falls back to a cuisine-based placeholder).
    const logoUrl = logo.trim()
    const coverUrl = coverPhoto.trim()
    if ((logoUrl && !isHttpUrl(logoUrl)) || (coverUrl && !isHttpUrl(coverUrl))) {
      setError(t('errInvalidUrl'))
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        restaurantName.trim(),
          description: description.trim() || undefined,
          cuisine:     [cuisineType],
          logo:        logoUrl || undefined,
          coverPhoto:  coverUrl || undefined,
          city:        city.trim(),
          address:     address.trim(),
          postalCode:  postalCode.trim() || undefined,
          // Le choix des modes de retrait etait valide (voir la garde plus haut)
          // puis jete : il ne figurait pas dans ce corps. Les deux colonnes
          // existent deja sur Restaurant et gouvernent la creation de commande —
          // sans elles, un etablissement onboarde restait injoignable (retrait
          // desactive par defaut, livraison refusee par le flag pilote).
          deliveryEnabled,
          pickupEnabled,
        }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 401) {
        router.replace('/auth/magic')
        return
      }
      if (res.status === 409) {
        // Already created → consider onboarding done.
        setStep('done')
        return
      }
      if (!res.ok) {
        setError((data && (data.error as string)) || t('errRestaurantFailed'))
        return
      }
      // NOTE: Restaurant.isActive is forced to false server-side for partners
      // (POST /api/restaurants). It WILL NOT appear on /eat until an admin
      // approves it. The "done" screen below tells the partner that explicitly.
      setStep('done')
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSubmitting(false)
    }
  }

  if (gateLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-10 text-grubano-ink-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      </Layout>
    )
  }

  if (step === 'done') {
    return (
      <Layout>
        <Card elevation="premium" padding="lg" className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-grubano-success/15">
            <CheckCircle2 size={36} className="text-grubano-success" />
          </div>
          <h2 className="font-display text-2xl font-extrabold text-grubano-ink">{t('doneTitle')}</h2>
          <p className="mt-3 whitespace-pre-line text-grubano-sm leading-relaxed text-grubano-ink-muted">
            {t('doneBody')}
          </p>
          <div className="mt-6">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              rightIcon={<ArrowRight size={16} />}
              onClick={() => router.push('/dashboard')}
            >
              {t('doneCta')}
            </Button>
          </div>
        </Card>
      </Layout>
    )
  }

  return (
    <Layout>
      <Card elevation="premium" padding="lg" className="w-full max-w-xl">
        <StepHeader step={step} />

        {error && (
          <div className="mb-4 rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
            {error}
          </div>
        )}

        {step === 'brand' ? (
          <form onSubmit={submitBrand} className="space-y-4">
            <h2 className="font-display text-xl font-extrabold text-grubano-ink">{t('brandTitle')}</h2>
            <p className="-mt-3 text-grubano-sm text-grubano-ink-muted">{t('brandSubtitle')}</p>

            <Input
              label={t('brandNameLabel')}
              required
              maxLength={80}
              leftIcon={<Store size={16} />}
              placeholder={t('brandNamePlaceholder')}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
            />

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {t('cuisineTypeLabel')}
              </label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CUISINE_TYPES.map((c) => {
                  const active = cuisineType === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCuisineType(c.value)}
                      className={`flex flex-col items-center gap-1 rounded-grubano-md border px-2 py-2 text-xs font-semibold transition active:scale-95 ${
                        active
                          ? 'border-grubano-primary bg-grubano-tint text-grubano-primary'
                          : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:bg-grubano-surface-muted'
                      }`}
                    >
                      <span className="text-lg">{c.emoji}</span>
                      <span>{t(c.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {t('emojiLabel')}
              </label>
              <div className="flex flex-wrap gap-2">
                {BRAND_EMOJIS.map((e2) => {
                  const active = emoji === e2
                  return (
                    <button
                      key={e2}
                      type="button"
                      onClick={() => setEmoji(e2)}
                      aria-label={e2}
                      className={`flex h-10 w-10 items-center justify-center rounded-grubano-md border text-lg transition active:scale-95 ${
                        active ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-grubano-surface'
                      }`}
                    >
                      {e2}
                    </button>
                  )
                })}
              </div>
            </div>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} rightIcon={<ArrowRight size={16} />}>
              {t('continue')}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitRestaurant} className="space-y-4">
            <h2 className="font-display text-xl font-extrabold text-grubano-ink">{t('restoTitle')}</h2>
            <p className="-mt-3 text-grubano-sm text-grubano-ink-muted">{t('restoSubtitle')}</p>

            <Input
              label={t('restoNameLabel')}
              required
              maxLength={120}
              leftIcon={<Store size={16} />}
              placeholder={t('restoNamePlaceholder')}
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
            />

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {t('descriptionLabel')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={t('descriptionPlaceholder')}
                className="w-full resize-none rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2.5 text-grubano-sm text-grubano-ink placeholder:text-grubano-ink-faint focus:bg-white focus:outline-none focus:ring-2 focus:ring-grubano-primary/30"
              />
            </div>

            {/* Cuisine shown on /eat — pre-filled from the brand, editable here */}
            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {t('cuisineTypeLabel')}
              </label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CUISINE_TYPES.map((c) => {
                  const active = cuisineType === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCuisineType(c.value)}
                      className={`flex flex-col items-center gap-1 rounded-grubano-md border px-2 py-2 text-xs font-semibold transition active:scale-95 ${
                        active
                          ? 'border-grubano-primary bg-grubano-tint text-grubano-primary'
                          : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:bg-grubano-surface-muted'
                      }`}
                    >
                      <span className="text-lg">{c.emoji}</span>
                      <span>{t(c.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-grubano-ink-faint">{t('restoCuisineHint')}</p>
            </div>

            {/* Visual identity — optional image URLs. Empty → placeholder on /eat */}
            <Input
              label={t('logoLabel')}
              type="url"
              inputMode="url"
              maxLength={500}
              leftIcon={<ImageIcon size={16} />}
              placeholder={t('logoPlaceholder')}
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              hint={t('imageHint')}
            />
            <Input
              label={t('coverLabel')}
              type="url"
              inputMode="url"
              maxLength={500}
              leftIcon={<ImageIcon size={16} />}
              placeholder={t('coverPlaceholder')}
              value={coverPhoto}
              onChange={(e) => setCoverPhoto(e.target.value)}
            />

            <Input
              label={t('addressLabel')}
              required
              maxLength={300}
              leftIcon={<MapPin size={16} />}
              placeholder={t('addressPlaceholder')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input
                  label={t('cityLabel')}
                  required
                  maxLength={100}
                  leftIcon={<MapPin size={16} />}
                  placeholder={t('cityPlaceholder')}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  hint={t('cityHint')}
                />
              </div>
              <Input
                label={t('postalCodeLabel')}
                maxLength={12}
                placeholder={t('postalCodePlaceholder')}
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {t('fulfilmentLabel')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <FulfilmentToggle
                  active={deliveryEnabled}
                  onToggle={() => setDeliveryEnabled((v) => !v)}
                  icon={<Bike size={16} />}
                  label={t('deliveryToggle')}
                />
                <FulfilmentToggle
                  active={pickupEnabled}
                  onToggle={() => setPickupEnabled((v) => !v)}
                  icon={<Package size={16} />}
                  label={t('pickupToggle')}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-grubano-ink-faint">{t('fulfilmentHint')}</p>
            </div>

            <div className="rounded-grubano-md border border-grubano-info/30 bg-grubano-info-tint p-3 text-xs leading-relaxed text-grubano-ink-muted">
              {t('reviewNotice')}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => {
                  setStep('brand')
                  setError('')
                }}
                leftIcon={<ArrowLeft size={16} />}
              >
                {t('back')}
              </Button>
              <Button type="submit" variant="primary" size="lg" loading={submitting} rightIcon={<ArrowRight size={16} />} className="flex-1">
                {t('finish')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </Layout>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StepHeader({ step }: { step: Step }) {
  const t = useTranslations('business.onboarding')
  const labels: Array<{ key: Step; labelKey: string }> = [
    { key: 'brand',      labelKey: 'stepBrand' },
    { key: 'restaurant', labelKey: 'stepRestaurant' },
    { key: 'done',       labelKey: 'stepDone' },
  ]
  const currentIdx = labels.findIndex((l) => l.key === step)
  return (
    <div className="mb-5 flex items-center justify-between gap-2">
      {labels.map((l, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={l.key} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                done
                  ? 'bg-grubano-primary text-white'
                  : active
                    ? 'bg-grubano-tint text-grubano-primary ring-2 ring-grubano-primary'
                    : 'bg-grubano-surface-muted text-grubano-ink-faint'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span
              className={`hidden truncate text-grubano-sm font-semibold sm:inline ${
                done || active ? 'text-grubano-ink' : 'text-grubano-ink-faint'
              }`}
            >
              {t(l.labelKey)}
            </span>
            {i < labels.length - 1 && (
              <span className={`mx-1 hidden h-px flex-1 sm:block ${i < currentIdx ? 'bg-grubano-primary' : 'bg-grubano-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function FulfilmentToggle({
  active,
  onToggle,
  icon,
  label,
}: {
  active: boolean
  onToggle: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center justify-center gap-2 rounded-grubano-md border px-3 py-3 text-grubano-sm font-semibold transition active:scale-[0.98] ${
        active
          ? 'border-grubano-primary bg-grubano-tint text-grubano-primary'
          : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:bg-grubano-surface-muted'
      }`}
    >
      <span className={active ? 'text-grubano-primary' : 'text-grubano-ink-faint'}>{icon}</span>
      {label}
    </button>
  )
}

// ── Layout — PartnerShell (mode parcours), fondations communes SEULEMENT ──────
// Chrome / canvas / typographie / conteneur du PartnerShell (référence
// partner-shell.html), « Quitter » → /business. AUCUNE frise : la référence
// Design ne couvre pas cet écran (checklist 6 crans « à vous / à Grubano », R3/R8)
// et une frise d'étapes métier sans référence serait une invention — décision
// Design à obtenir. Le contenu (gate, reprise, étapes brand→restaurant, Card/
// Button/Input du DS, états, appels API) est INCHANGÉ.
function Layout({ children }: { children: React.ReactNode }) {
  return <PartnerShell mode="parcours" exitHref="/business">{children}</PartnerShell>
}
