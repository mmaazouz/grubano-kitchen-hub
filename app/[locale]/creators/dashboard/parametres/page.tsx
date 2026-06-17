'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Lock, Loader2, ShieldCheck, ChefHat, Megaphone } from 'lucide-react'
import { Card, Button, Input, Badge } from '@/components/design-system'

// ── /creators/dashboard/parametres — editable creator/influencer profile (P5b) ─
// Shared by the chef AND influencer (one Creator row, cumulable roles). Renders
// INSIDE the creator dashboard layout (CreatorSidebar + PortalMobileHeader provide
// the chrome) so it only outputs the form content. GET /api/creators/profile to
// pre-fill, PATCH to save the editable DISPLAY fields. The verified YouTube channel,
// verification status and roles are shown READ-ONLY (never sent). No payment surface.

type ProfileData = {
  name: string; bio: string; instagram: string; tiktok: string
  youtube: string | null; verified: boolean; isChef: boolean; isInfluencer: boolean
}

export default function CreatorSettingsPage() {
  const t = useTranslations('creators')
  const s = (k: string) => t(`settings.${k}` as 'settings.title')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')

  const [locked, setLocked] = useState<Pick<ProfileData, 'youtube' | 'verified' | 'isChef' | 'isInfluencer'> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/creators/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return
        const p = res?.profile as ProfileData | undefined
        if (!p) { setLoadError(true); return }
        setName(p.name ?? '')
        setBio(p.bio ?? '')
        setInstagram(p.instagram ?? '')
        setTiktok(p.tiktok ?? '')
        setLocked({ youtube: p.youtube, verified: p.verified, isChef: p.isChef, isInfluencer: p.isInfluencer })
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Clear the success banner once the user edits again (no-op during prefill).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (saved) setSaved(false) }, [name, bio, instagram, tiktok])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(''); setSaved(false); setSaving(true)
    try {
      const res = await fetch('/api/creators/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio, instagram: instagram || undefined, tiktok: tiktok || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(data?.error || s('errorGeneric')); return }
      setSaved(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError(s('errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{s('title')}</h1>
      <p className="mt-1 text-sm text-grubano-ink-muted">{s('subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-grubano-ink-muted"><Loader2 className="animate-spin" size={22} /></div>
      ) : loadError ? (
        <Card elevation="sm" padding="lg" className="mt-5 text-center text-sm text-grubano-ink-muted">{s('loadError')}</Card>
      ) : (
        <div className="mt-5 space-y-5">
          {saved && (
            <Card elevation="sm" padding="md" className="border-grubano-success/40 bg-grubano-success-tint">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-grubano-success" />
                <div>
                  <p className="font-semibold text-grubano-ink">{s('savedTitle')}</p>
                  <p className="text-sm text-grubano-ink-muted">{s('savedBody')}</p>
                </div>
              </div>
            </Card>
          )}

          <form onSubmit={save} className="space-y-5">
            <Card elevation="sm" padding="lg" className="space-y-4">
              {error && (
                <p className="rounded-grubano-lg border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-sm text-grubano-danger">{error}</p>
              )}

              <Input label={t('apply.labelName')} required value={name} onChange={(e) => setName(e.target.value)} />

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-grubano-ink-muted">{t('apply.labelBio')}</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder={t('apply.bioPlaceholder')}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full resize-none rounded-grubano-lg border border-grubano-border bg-grubano-surface px-3 py-2.5 text-sm text-grubano-ink focus:border-grubano-primary focus:outline-none focus:ring-4 focus:ring-grubano-primary/20"
                />
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-grubano-ink-faint">{s('socialsTitle')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('apply.labelInstagram')} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@…" />
                <Input label={t('apply.labelTiktok')} value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="@…" />
              </div>

              <Button type="submit" variant="primary" size="md" fullWidth loading={saving}>
                {saving ? s('saving') : s('save')}
              </Button>
            </Card>

            {/* Locked identity / verification / roles — read-only, never editable */}
            {locked && (
              <Card elevation="sm" padding="lg" className="bg-grubano-surface-muted">
                <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                  <Lock size={13} /> {s('lockedTitle')}
                </div>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{s('lockedYoutube')}</dt>
                    <dd className="text-sm text-grubano-ink-muted">{locked.youtube || s('none')}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{s('lockedVerification')}</dt>
                    <dd className="mt-0.5">
                      <Badge tone={locked.verified ? 'success' : 'neutral'} size="sm">
                        {locked.verified ? s('verifVerified') : s('verifPending')}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{s('lockedRoles')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {locked.isChef && (
                        <Badge tone="neutral" size="sm"><span className="inline-flex items-center gap-1"><ChefHat size={12} /> {t('apply.roleChefTitle')}</span></Badge>
                      )}
                      {locked.isInfluencer && (
                        <Badge tone="neutral" size="sm"><span className="inline-flex items-center gap-1"><Megaphone size={12} /> {t('apply.roleInfluencerTitle')}</span></Badge>
                      )}
                      {!locked.isChef && !locked.isInfluencer && <span className="text-sm text-grubano-ink-muted">{s('none')}</span>}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 flex items-center gap-1.5 text-grubano-xs text-grubano-ink-faint">
                  <ShieldCheck size={12} /> {s('lockedNote')}
                </p>
              </Card>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
