'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import {
  MapPin, Clock, CalendarDays, Truck, Plus, ChevronRight, UtensilsCrossed,
  Sparkles, Store, Loader2, Pencil, Trash2, AlertTriangle, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Modal, Button, Input,
} from '@/components/design-system'
import OpeningHoursSection from '@/components/hours/OpeningHoursSection'
import ConnectCard from '@/components/connect/ConnectCard'
import { Breadcrumb, type Crumb } from './Breadcrumb'

// ── Establishment HUB (C13-2) ─────────────────────────────────────────────────
// "Quand on ouvre un établissement, on voit ses MARQUES." The central section is
// the clickable brand cards (→ that brand's menu); a sober header + a discreet
// access strip sit above. Server props carry the establishment identity (read
// from Prisma in the route); brands are fetched client-side from the EXISTING
// /api/brands/summary (no new API).
//
// REFONTE UX MARQUES (Agent 13) — the brand list lived on a SECOND page
// (/brands) too, which was redundant: filters + "Performance globale" already
// covered by the accueil consolidé endpoint, edit/delete duplicated here, etc.
// So edit + delete actions are MIGRATED here as discrete icon buttons on each
// brand card (raised above the stretched-link to the menu so the primary tap
// stays "open this brand's menu"). /brands becomes a focused create-only page.
//
// ZÉRO COMPLEXITÉ À N=1 : at a single establishment the breadcrumb root and the
// establishment chrome are trimmed — the operator lands straight on their brands.

type HubEstablishment = {
  id:       string
  name:     string
  city:     string
  address:  string
  isActive: boolean
}

// /api/brands/summary item. `restaurantId` is exposed since Agent 2's
// commit b5a850f, so multi-establishment scoping works as expected.
type BrandSummary = {
  id:               string
  name:             string
  emoji:            string
  status:           string
  menuCount:        number
  adoptedDishCount: number
  restaurantId?:    string | null
}

// /api/brands/[id] GET shape — the editable fields the hub modal mutates.
type BrandEdit = {
  id:          string
  name:        string
  emoji:       string
  cuisineType: string | null
  tagline:     string | null
}

const isActiveBrand = (s: string) => s === 'active'

// Soft tile tints, cycled by index so brands stay visually distinct.
const TILE_BG = ['bg-orange-50', 'bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50', 'bg-pink-50'] as const

// Canonical cuisine values shared with the onboarding flow — labels are i18n.
const CUISINE_TYPES = [
  { value: 'italien',   emoji: '🍕' },
  { value: 'asiatique', emoji: '🍜' },
  { value: 'burger',    emoji: '🍔' },
  { value: 'healthy',   emoji: '🥗' },
  { value: 'sushi',     emoji: '🍣' },
  { value: 'desserts',  emoji: '🍰' },
  { value: 'wraps',     emoji: '🥙' },
  { value: 'pasta',     emoji: '🍝' },
  { value: 'autre',     emoji: '🍴' },
] as const
const BRAND_EMOJIS = ['🍕', '🍜', '🍔', '🥗', '🍣', '🍰', '🥙', '🍝', '🌮', '🍱', '🥘', '🥟', '🍴', '🥐']

export default function EstablishmentHub({
  establishment,
  establishmentsCount,
}: {
  establishment:       HubEstablishment
  establishmentsCount: number
}) {
  const t  = useTranslations('dashboard.hub')
  const tb = useTranslations('brands')
  const td = useTranslations('dashboard.hub.danger')

  const [brands, setBrands]   = useState<BrandSummary[]>([])
  const [loading, setLoading] = useState(true)

  // ── Edit modal state ────────────────────────────────────────────────────────
  const [editForm, setEditForm]         = useState<BrandEdit | null>(null)
  const [editLoading, setEditLoading]   = useState(false)
  const [saving, setSaving]             = useState(false)
  const [editError, setEditError]       = useState('')

  // ── Delete-BRAND confirm state ──────────────────────────────────────────────
  const [toDelete, setToDelete]         = useState<BrandSummary | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState('')

  // ── Delete-ESTABLISHMENT confirm state ──────────────────────────────────────
  // Consommé via DELETE /api/restaurants/[id] (Agent 2 e94ca18) qui décide
  // soft (archive) vs hard (suppression). On rend l'action volontairement peu
  // accessible : section sobre en bas, modale avec re-saisie du nom.
  const [estabDeleteOpen,   setEstabDeleteOpen]   = useState(false)
  const [estabDeleteTyped,  setEstabDeleteTyped]  = useState('')
  const [estabDeleting,     setEstabDeleting]     = useState(false)
  const [estabDeleteError,  setEstabDeleteError]  = useState('')
  // After DELETE returns, we replace the form with a brief success panel
  // showing the actual mode ("archived" vs "deleted"), then hard-navigate to
  // /dashboard/establishments so the operator visually confirms before the
  // page reloads. null = form still showing.
  const [estabDeleteResult, setEstabDeleteResult] = useState<'archived' | 'deleted' | null>(null)

  async function loadBrands() {
    try {
      const r = await fetch('/api/brands/summary', { cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      const list: BrandSummary[] = Array.isArray(d?.brands) ? d.brands : []
      setBrands(list)
    } catch {
      setBrands([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/brands/summary', { cache: 'no-store' })
        const d = r.ok ? await r.json() : null
        if (!alive) return
        setBrands(Array.isArray(d?.brands) ? d.brands : [])
      } catch {
        if (alive) setBrands([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // Forward-compatible scoping: only filter by establishment when we have a real
  // brand→establishment link AND more than one establishment exists. At N=1 (the
  // priority path) every brand belongs to the single establishment → show all.
  const multi  = establishmentsCount > 1
  const scoped = multi && brands.some((b) => b.restaurantId != null)
    ? brands.filter((b) => b.restaurantId === establishment.id)
    : brands

  // Breadcrumb: full trail only when the hierarchy is real (N≥2). At N=1 it would
  // just expose complexity for no navigational value, so we drop it.
  const crumbs: Crumb[] = multi
    ? [{ label: t('bcRoot'), href: '/dashboard/establishments' }, { label: establishment.name }]
    : []

  const location = [establishment.city, establishment.address].filter(Boolean).join(' · ')

  // ── Edit-brand modal handlers ───────────────────────────────────────────────
  async function openEdit(b: BrandSummary) {
    setEditError('')
    // Seed defaults from the summary so the modal shows SOMETHING while we fetch.
    setEditForm({ id: b.id, name: b.name, emoji: b.emoji, cuisineType: 'autre', tagline: '' })
    setEditLoading(true)
    try {
      const r = await fetch(`/api/brands/${b.id}`, { cache: 'no-store' })
      const d = r.ok ? await r.json() : null
      if (d?.brand) {
        setEditForm({
          id:          d.brand.id,
          name:        d.brand.name ?? b.name,
          emoji:       d.brand.emoji ?? b.emoji,
          cuisineType: d.brand.cuisineType ?? 'autre',
          tagline:     d.brand.tagline ?? '',
        })
      }
    } catch {
      /* keep the summary-derived defaults */
    } finally {
      setEditLoading(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editForm) return
    if (!editForm.name.trim()) {
      setEditError(tb('errName'))
      return
    }
    setEditError('')
    setSaving(true)
    try {
      const r = await fetch(`/api/brands/${editForm.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        editForm.name.trim(),
          emoji:       editForm.emoji,
          cuisineType: editForm.cuisineType,
          tagline:     editForm.tagline?.trim() || null,
        }),
      })
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setEditError((d && (d.error as string)) || tb('errSaveFailed'))
        return
      }
      setEditForm(null)
      await loadBrands()
    } catch {
      setEditError(tb('errNetwork'))
    } finally {
      setSaving(false)
    }
  }

  // ── Delete THIS establishment (Agent 2's DELETE /api/restaurants/[id]) ─────
  async function confirmEstablishmentDelete() {
    if (estabDeleteTyped !== establishment.name) return  // typed-name guard
    setEstabDeleteError('')
    setEstabDeleting(true)
    try {
      const r = await fetch(`/api/restaurants/${establishment.id}`, { method: 'DELETE' })
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      if (r.status === 403) { setEstabDeleteError(td('errorForbidden')); return }
      if (r.status === 404) { setEstabDeleteError(td('errorNotFound'));  return }
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setEstabDeleteError((d && (d.error as string)) || td('errorGeneric'))
        return
      }
      // Agent 2 returns { mode: "archived" | "deleted", id, name }. Show the
      // matching success panel in the modal for ~1.4 s so the operator gets a
      // visual confirmation BEFORE the navigate, then hard-navigate so every
      // cache (Router, fetch, browser, the hub itself) is bypassed and the
      // list reflects reality.
      const mode: 'archived' | 'deleted' =
        d?.mode === 'archived' || d?.mode === 'deleted' ? d.mode : 'deleted'
      setEstabDeleteResult(mode)
      setTimeout(() => {
        window.location.href = '/dashboard/establishments'
      }, 1400)
    } catch {
      setEstabDeleteError(td('errorGeneric'))
    } finally {
      setEstabDeleting(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleteError('')
    setDeleting(true)
    try {
      const r = await fetch(`/api/brands/${toDelete.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => null)
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      if (!r.ok) {
        const reason = d?.reason as string | undefined
        setDeleteError(
          reason === 'has_menu_items'              ? tb('errDeleteMenu')
          : reason === 'last_brand_active_restaurant' ? tb('errDeleteLastBrand')
          : reason === 'has_related_data'          ? tb('errDeleteRelated')
          : (d?.error as string) || tb('errDeleteFailed'),
        )
        return
      }
      setToDelete(null)
      await loadBrands()
    } catch {
      setDeleteError(tb('errNetwork'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-4 md:max-w-3xl">
      {crumbs.length > 0 && <Breadcrumb items={crumbs} className="mb-3" />}

      {/* ── Sober header ──────────────────────────────────────────────────── */}
      <header className="mb-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary">
            <Store size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                {establishment.name}
              </h1>
              {/* Discreet online/offline — a dot + label, not a loud chip. */}
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', establishment.isActive ? 'bg-success' : 'bg-muted-foreground/40')} />
                {establishment.isActive ? t('online') : t('offline')}
              </span>
            </div>
            {location && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                <MapPin size={12} className="shrink-0" />
                <span className="break-words">{location}</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Discreet access strip (maquette: Horaires partagés / Livraison · Retrait / Tables & résas)
            The hours chip jumps to the in-page Horaires section (chantier
            horaires étape 2) instead of the fulfillment page. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href="#horaires"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <Clock size={12} className="shrink-0" />
            {t('accessHours')}
          </a>
          <AccessChip href="/dashboard/fulfillment" icon={Truck}        label={t('accessDelivery')} />
          <AccessChip href="/tables"                icon={CalendarDays} label={t('accessTables')} />
        </div>
      </header>

      {/* ── Central section: the brands (the point of the hub) ────────────── */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight text-foreground">{t('brandsTitle')}</h2>
        {!loading && scoped.length > 0 && (
          <p className="text-[11px] text-muted-foreground">{t('brandsHint')}</p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-12 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> {t('loading')}
        </div>
      ) : scoped.length === 0 ? (
        /* 0 brand → this establishment has no menu container yet. A menu belongs
           to a brand, so the ONLY way forward is to create one — surfaced as a
           clear, actionable CTA (never a dead-end message). */
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary">
            <Store size={22} />
          </span>
          <p className="text-sm font-bold text-foreground">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t('emptyDesc')}</p>
          <Link
            href={`/brands?restaurantId=${establishment.id}`}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={16} /> {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {scoped.map((b, i) => (
            <article
              key={b.id}
              className="group relative flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary"
            >
              {/* The stretched-link covers the whole card → primary tap = open
                  this brand's menu. The edit/delete icon buttons below are
                  raised (relative z-10) so they remain distinct clicks. */}
              <Link
                href={`/menu?brand=${b.id}`}
                aria-label={t('openMenu')}
                className="absolute inset-0 z-0 rounded-2xl"
              />

              <div className="relative z-10 flex items-center gap-3">
                <div className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl', TILE_BG[i % TILE_BG.length])}>
                  {b.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-base font-bold leading-tight text-foreground">{b.name}</h3>
                  <span className={cn(
                    'mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium',
                    isActiveBrand(b.status) ? 'text-success' : 'text-warning',
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', isActiveBrand(b.status) ? 'bg-success' : 'bg-warning')} />
                    {isActiveBrand(b.status) ? t('statusActive') : t('statusPaused')}
                  </span>
                </div>

                {/* Discrete edit/delete actions — z-10 so they stay clickable on
                    top of the stretched-link, sober styling so they don't fight
                    the brand tile for attention. */}
                <div className="relative z-10 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    aria-label={t('editBrandAria', { name: b.name })}
                    title={t('editBrand')}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteError(''); setToDelete(b) }}
                    aria-label={t('deleteBrandAria', { name: b.name })}
                    title={t('deleteBrand')}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="relative z-0 flex items-center gap-4 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <UtensilsCrossed size={12} /> <strong className="font-bold text-foreground">{b.menuCount}</strong> {t('statMenu')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={12} /> <strong className="font-bold text-foreground">{b.adoptedDishCount}</strong> {t('statCreators')}
                </span>
                <span className="ms-auto inline-flex items-center gap-1 font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t('openMenu')}
                  <ChevronRight size={12} className="rtl:rotate-180" />
                </span>
              </div>
            </article>
          ))}

          {/* Add a brand → /brands (scratch or copy, focused create page). */}
          <Link
            href={`/brands?restaurantId=${establishment.id}`}
            className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-card p-4 text-center transition-colors hover:border-primary"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
              <Plus size={18} />
            </span>
            <span className="text-sm font-semibold text-foreground">{t('addBrand')}</span>
            <span className="text-[11px] text-muted-foreground">{t('addBrandHint')}</span>
          </Link>
        </div>
      )}

      {/* ── Horaires d'ouverture (chantier horaires étape 2, blocs A+B) ─────
          Owner CRUD over Agent 2's endpoints — weekly grid + exceptional
          closures + conflicts modal. Scoped to THIS establishment. */}
      <div className="mt-8">
        <OpeningHoursSection restaurantId={establishment.id} />
      </div>

      {/* ── Encaissements / Compte Stripe (rail financier A1, contrat section
          6) — invitation / onboarding à terminer / actif / action requise.
          Défensif : GET en échec → la carte ne rend rien. */}
      <div className="mt-4">
        <ConnectCard restaurantId={establishment.id} />
      </div>

      {/* ── Edit-brand modal (was on /brands) ──────────────────────────────── */}
      <Modal
        open={editForm !== null}
        onClose={() => setEditForm(null)}
        size="md"
        title={tb('editTitle')}
      >
        {editForm && (
          <form onSubmit={saveEdit} className="space-y-4">
            {editError && (
              <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                {editError}
              </div>
            )}

            <Input
              label={tb('fieldName')}
              value={editForm.name}
              maxLength={80}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder={tb('fieldNamePlaceholder')}
            />

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{tb('fieldCuisine')}</label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {CUISINE_TYPES.map((c) => {
                  const active = (editForm.cuisineType ?? 'autre') === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setEditForm({ ...editForm, cuisineType: c.value })}
                      className={`flex flex-col items-center gap-1 rounded-grubano-md border px-2 py-2 text-xs font-semibold transition active:scale-95 ${
                        active ? 'border-grubano-primary bg-grubano-tint text-grubano-primary' : 'border-grubano-border bg-grubano-surface text-grubano-ink-muted'
                      }`}
                    >
                      <span className="text-lg">{c.emoji}</span>
                      <span>{tb(`cuisine_${c.value}` as 'cuisine_italien')}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">{tb('fieldEmoji')}</label>
              <div className="flex flex-wrap gap-2">
                {BRAND_EMOJIS.map((e2) => (
                  <button
                    key={e2}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, emoji: e2 })}
                    aria-label={e2}
                    className={`flex h-10 w-10 items-center justify-center rounded-grubano-md border text-lg transition active:scale-95 ${
                      editForm.emoji === e2 ? 'border-grubano-primary bg-grubano-tint' : 'border-grubano-border bg-grubano-surface'
                    }`}
                  >
                    {e2}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label={tb('fieldTagline')}
              value={editForm.tagline ?? ''}
              maxLength={140}
              onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value })}
              placeholder={tb('fieldTaglinePlaceholder')}
            />

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" size="md" onClick={() => setEditForm(null)}>
                {tb('cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={saving || editLoading}
                className="flex-1"
              >
                {tb('save')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete-brand confirm (was on /brands) ──────────────────────────── */}
      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        size="sm"
        title={tb('deleteConfirmTitle')}
      >
        {toDelete && (
          <div className="space-y-4">
            <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">
              {tb('deleteConfirmBody', { name: toDelete.name })}
            </p>
            {toDelete.menuCount > 0 && (
              <div className="rounded-grubano-md border border-grubano-warning/30 bg-grubano-warning-tint px-3 py-2.5 text-grubano-sm text-grubano-ink-muted">
                {tb('deleteWarnMenu', { count: toDelete.menuCount })}
              </div>
            )}
            {deleteError && (
              <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                {deleteError}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="md" onClick={() => setToDelete(null)}>
                {tb('cancel')}
              </Button>
              <Button type="button" variant="danger" size="md" loading={deleting} className="flex-1" onClick={confirmDelete}>
                {tb('confirmDelete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── DANGER ZONE — supprimer cet établissement ─────────────────────────
          Action destructive volontairement difficile d'accès : section sobre
          en BAS du hub, bouton rouge size sm (jamais en cible de clic
          accidentel), modale avec re-saisie du nom. Pour le dernier
          établissement, le bouton est désactivé + message expliquant pourquoi
          — on n'autorise pas un compte à se retrouver sans établissement
          via cette UI. */}
      <section className="mt-10 border-t border-border pt-5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-semibold text-foreground">
              {td('title')}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {td('intro')}
            </p>
            {establishmentsCount <= 1 ? (
              <p className="mt-3 rounded-grubano-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                {td('lastBlocker')}
              </p>
            ) : (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 size={13} />}
                  onClick={() => {
                    setEstabDeleteTyped('')
                    setEstabDeleteError('')
                    setEstabDeleteOpen(true)
                  }}
                  aria-label={td('buttonAria', { name: establishment.name })}
                >
                  {td('button')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Modale confirm suppression établissement ───────────────────────── */}
      <Modal
        open={estabDeleteOpen}
        onClose={() => { if (!estabDeleting && !estabDeleteResult) setEstabDeleteOpen(false) }}
        size="md"
        title={td('modalTitle')}
      >
        {estabDeleteResult ? (
          /* Success panel — visible for ~1.4 s before the hard-navigate. The
             message reflects the ACTUAL server outcome (archived vs deleted)
             rather than a generic confirmation. */
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-grubano-success-tint text-grubano-success">
              <Check size={22} />
            </span>
            <p className="text-grubano-base font-semibold text-grubano-ink">
              {estabDeleteResult === 'archived'
                ? td('resultArchived')
                : td('resultDeleted')}
            </p>
            <p className="text-[11px] text-grubano-ink-muted">
              <Loader2 size={11} className="me-1 inline animate-spin" />
              …
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">
              {td('modalBody')}
            </p>

            <ul className="space-y-1.5 rounded-grubano-md border border-grubano-warning/30 bg-grubano-warning-tint px-3 py-2.5 text-[11px] text-grubano-ink">
              <li className="flex items-start gap-2">
                <Check size={11} className="mt-0.5 shrink-0 text-grubano-warning" />
                <span>{td('modalIntroSoft')}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={11} className="mt-0.5 shrink-0 text-grubano-warning" />
                <span>{td('modalIntroHard')}</span>
              </li>
            </ul>

            <div>
              <label className="mb-1.5 block text-grubano-sm font-semibold text-grubano-ink">
                {td('typeNameLabel', { name: establishment.name })}
              </label>
              <input
                type="text"
                value={estabDeleteTyped}
                onChange={(e) => setEstabDeleteTyped(e.target.value)}
                placeholder={td('typeNameInput')}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={estabDeleting}
                className="w-full rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-grubano-sm text-grubano-ink outline-none transition focus:border-grubano-danger disabled:opacity-60"
              />
            </div>

            {estabDeleteError && (
              <div className="rounded-grubano-md border border-grubano-danger/30 bg-grubano-danger-tint px-3 py-2.5 text-grubano-sm text-grubano-danger">
                <p className="font-semibold">{td('errorTitle')}</p>
                <p className="mt-0.5">{estabDeleteError}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setEstabDeleteOpen(false)}
                disabled={estabDeleting}
              >
                {td('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                className="flex-1"
                loading={estabDeleting}
                disabled={estabDeleteTyped !== establishment.name}
                onClick={confirmEstablishmentDelete}
              >
                {td('confirmBtn')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function AccessChip({ href, icon: Icon, label }: { href: string; icon: typeof Clock; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <Icon size={12} className="shrink-0" />
      {label}
    </Link>
  )
}
