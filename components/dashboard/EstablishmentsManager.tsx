'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import {
  Plus, Store, MapPin, Check, Loader2, Image as ImageIcon, Building2,
} from 'lucide-react'
import {
  Modal, Button, Input, ToastProvider, useToast,
} from '@/components/design-system'
import {
  ESTABLISHMENT_COOKIE,
  ESTABLISHMENT_COOKIE_MAX_AGE,
} from '@/lib/establishment'

// Canonical cuisine values shared with the onboarding flow. Labels come from the
// existing `business.onboarding` namespace so we don't duplicate translations.
const CUISINE_TYPES = [
  { value: 'italien',   labelKey: 'cuisineItalien',   emoji: '🍕' },
  { value: 'asiatique', labelKey: 'cuisineAsiatique', emoji: '🍜' },
  { value: 'burger',    labelKey: 'cuisineBurger',    emoji: '🍔' },
  { value: 'healthy',   labelKey: 'cuisineHealthy',   emoji: '🥗' },
  { value: 'sushi',     labelKey: 'cuisineSushi',     emoji: '🍣' },
  { value: 'desserts',  labelKey: 'cuisineDesserts',  emoji: '🍰' },
  { value: 'wraps',     labelKey: 'cuisineWraps',     emoji: '🥙' },
  { value: 'pasta',     labelKey: 'cuisinePasta',     emoji: '🍝' },
  { value: 'autre',     labelKey: 'cuisineAutre',     emoji: '🍴' },
] as const

/** Loose http(s) URL check — mirrors the server zod `.url()` intent without
 *  blocking on an empty field (empty values are sent as undefined). */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface EstablishmentRow {
  id:       string
  name:     string
  city:     string
  address:  string
  isActive: boolean
}

export default function EstablishmentsManager(props: {
  establishments: EstablishmentRow[]
  currentId:      string
}) {
  return (
    <ToastProvider>
      <EstablishmentsManagerInner {...props} />
    </ToastProvider>
  )
}

function EstablishmentsManagerInner({
  establishments,
  currentId,
}: {
  establishments: EstablishmentRow[]
  currentId:      string
}) {
  const t  = useTranslations('establishment')
  const tc = useTranslations('business.onboarding') // cuisine labels
  const router = useRouter()
  const toast  = useToast()

  const [switching, setSwitching] = useState<string | null>(null)

  // Create-modal state.
  const [open, setOpen]       = useState(false)
  const [name, setName]       = useState('')
  const [city, setCity]       = useState('')
  const [address, setAddress] = useState('')
  const [cuisineType, setCuisineType] = useState('italien')
  const [description, setDescription] = useState('')
  const [logo, setLogo]       = useState('')
  const [cover, setCover]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  function setActive(id: string) {
    if (id === currentId) return
    document.cookie =
      `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ESTABLISHMENT_COOKIE_MAX_AGE}; samesite=lax`
    setSwitching(id)
    router.refresh()
  }

  function resetForm() {
    setName(''); setCity(''); setAddress('')
    setCuisineType('italien'); setDescription('')
    setLogo(''); setCover(''); setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim())    { setError(t('errName')); return }
    if (!city.trim())    { setError(t('errCity')); return }
    if (!address.trim()) { setError(t('errAddress')); return }

    const logoUrl  = logo.trim()
    const coverUrl = cover.trim()
    if ((logoUrl && !isHttpUrl(logoUrl)) || (coverUrl && !isHttpUrl(coverUrl))) {
      setError(t('errInvalidUrl'))
      return
    }

    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/restaurants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          additional:  true,                         // ← opt out of the duplicate guard
          name:        name.trim(),
          city:        city.trim(),
          address:     address.trim(),
          cuisine:     [cuisineType],
          description: description.trim() || undefined,
          logo:        logoUrl  || undefined,
          coverPhoto:  coverUrl || undefined,
        }),
      })
      if (res.status === 401) { window.location.href = '/business/auth'; return }
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.restaurant?.id) {
        setError((data && (data.error as string)) || t('errCreateFailed'))
        return
      }
      // Make the new establishment the active one, then refresh the server view.
      document.cookie =
        `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(data.restaurant.id)}; path=/; max-age=${ESTABLISHMENT_COOKIE_MAX_AGE}; samesite=lax`
      setOpen(false)
      resetForm()
      toast.success(t('createdNote'))
      router.refresh()
    } catch {
      setError(t('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-4 md:max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-grubano-ink">
          {t('manageTitle')}
        </h1>
        <p className="mt-0.5 text-sm text-grubano-ink-muted">
          {t('manageSubtitle', { count: establishments.length })}
        </p>
      </header>

      <div className="space-y-3">
        {establishments.map((e) => {
          const current = e.id === currentId
          return (
            <article
              key={e.id}
              className={`flex items-center gap-3 rounded-grubano-lg border bg-grubano-surface p-4 ${
                current ? 'border-grubano-primary' : 'border-grubano-border'
              }`}
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-grubano-md bg-grubano-tint text-grubano-primary">
                <Store size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-bold text-grubano-ink">{e.name}</h3>
                  {current && (
                    <span className="rounded-full bg-grubano-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      {t('activeChip')}
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    e.isActive ? 'bg-grubano-success-tint text-grubano-success' : 'bg-grubano-warning-tint text-grubano-warning'
                  }`}>
                    {e.isActive ? t('liveChip') : t('offlineChip')}
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-grubano-ink-muted">
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">{[e.city, e.address].filter(Boolean).join(' · ')}</span>
                </p>
              </div>
              {!current && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={switching === e.id}
                  onClick={() => setActive(e.id)}
                >
                  {t('switchBtn')}
                </Button>
              )}
              {current && <Check size={18} className="shrink-0 text-grubano-primary" />}
            </article>
          )
        })}
      </div>

      <button
        onClick={() => { resetForm(); setOpen(true) }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-grubano-lg border-2 border-dashed border-grubano-border bg-grubano-surface py-4 text-sm font-semibold text-grubano-ink-muted transition hover:border-grubano-primary hover:text-grubano-primary"
      >
        <Plus size={16} /> {t('add')}
      </button>

      {/* ── Add-establishment modal ─────────────────────────────────────── */}
      <Modal open={open} onClose={() => setOpen(false)} size="md" title={t('addTitle')}>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
              {error}
            </div>
          )}

          <Input
            label={t('fName')}
            value={name}
            maxLength={120}
            onChange={(ev) => setName(ev.target.value)}
            placeholder={t('fNamePlaceholder')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('fCity')}
              value={city}
              maxLength={100}
              onChange={(ev) => setCity(ev.target.value)}
              placeholder={t('fCityPlaceholder')}
            />
            <Input
              label={t('fAddress')}
              value={address}
              maxLength={300}
              onChange={(ev) => setAddress(ev.target.value)}
              placeholder={t('fAddressPlaceholder')}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('fCuisine')}</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CUISINE_TYPES.map((c) => {
                const active = cuisineType === c.value
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCuisineType(c.value)}
                    className={`flex flex-col items-center gap-1 rounded-grubano-md border px-2 py-2 text-xs font-semibold transition active:scale-95 ${
                      active ? 'border-grubano-primary bg-grubano-tint text-grubano-primary' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
                    }`}
                  >
                    <span className="text-lg">{c.emoji}</span>
                    <span>{tc(c.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{t('fDescription')}</label>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(ev) => setDescription(ev.target.value)}
              placeholder={t('fDescriptionPlaceholder')}
              rows={3}
              className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-grubano-sm text-grubano-ink outline-none transition focus:border-grubano-primary"
            />
          </div>

          <Input
            type="url"
            label={t('fLogo')}
            value={logo}
            leftIcon={<ImageIcon size={15} />}
            onChange={(ev) => setLogo(ev.target.value)}
            placeholder={t('fLogoPlaceholder')}
          />
          <Input
            type="url"
            label={t('fCover')}
            value={cover}
            leftIcon={<ImageIcon size={15} />}
            onChange={(ev) => setCover(ev.target.value)}
            placeholder={t('fCoverPlaceholder')}
            hint={t('imageHint')}
          />

          <div className="flex items-start gap-2 rounded-grubano-md border border-grubano-info/30 bg-grubano-info-tint px-3 py-2.5 text-grubano-sm text-grubano-ink-muted">
            <Building2 size={15} className="mt-0.5 shrink-0 text-grubano-info" />
            <span>{t('createdHint')}</span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="secondary" size="md" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" size="md" loading={saving} className="flex-1">
              {saving ? <Loader2 size={15} className="animate-spin" /> : t('create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
