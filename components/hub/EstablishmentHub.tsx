'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import OpeningHoursSection from '@/components/hours/OpeningHoursSection'
import ConnectCard from '@/components/connect/ConnectCard'
import SitePrefillImport from '@/components/restaurant/SitePrefillImport'
import AddressSection from '@/components/restaurant/AddressSection'
import LogoPrefillImport from '@/components/restaurant/LogoPrefillImport'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import '../../app/[locale]/dashboard/establishments/establishments.css'

// ── Establishment HUB (C13-2) — RE-SKIN CD --op- (LOT 7) ──────────────────────
// "Quand on ouvre un établissement, on voit ses MARQUES." Visuellement reproduit
// le design CD « fiche établissement » (en-tête + Informations + Horaires +
// Rattachement + zone sensible), scoped --op-, Material Symbols (pas lucide).
//
// 🔒 PRÉSENTATION SEULE — TOUTE la logique de données est byte-identical :
//   • GET  /api/brands/summary            (liste des marques)
//   • GET/PATCH /api/brands/[id]          (édition d'une marque)
//   • DELETE /api/brands/[id]             (suppression d'une marque + reasons)
//   • ⚠️ DELETE /api/restaurants/[id]      (soft-archive / hard-delete) AVEC modale
//        de re-saisie du nom (estabDeleteTyped === name) + navigation post-suppr.
//   • ⚠️ PATCH  /api/restaurants/[id]/pause ({isActive:false} = « Fermer
//        temporairement ») — règle de publication (403 sur remise en ligne d'un
//        resto jamais approuvé) gérée serveur + affichée ici.
//
// Les composants partagés injectés (OnboardingGuide/Chat auto-gating, Site/Logo
// prefill, OpeningHoursSection, ConnectCard) sont conservés tels quels.

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

// CD detail-header logo gradient — stable per establishment id (presentation only).
const HEAD_GRADS = ['#FF8A3D,#F2570E', '#D5372A,#A8281D', '#E8A63D,#B9740A', '#3E5A7D,#1B3A5E', '#6E56CF,#4B3894', '#1E9E57,#136B3B'] as const
function gradFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return HEAD_GRADS[h % HEAD_GRADS.length]
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

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
  const to = useTranslations('operator')

  const [brands, setBrands]   = useState<BrandSummary[]>([])
  const [loading, setLoading] = useState(true)

  // ── Live isActive (pause) — seeded from the server prop, flipped on success ──
  const [isActive, setIsActive] = useState(establishment.isActive)

  // ── Live address view (B3 address edit) — seeded from the server prop and
  //    refreshed when the AddressSection saves, so the header stays honest
  //    without a full reload. ─────────────────────────────────────────────────
  const [addrView, setAddrView] = useState({
    city:    establishment.city,
    address: establishment.address,
  })

  // ── Edit modal state ────────────────────────────────────────────────────────
  const [editForm, setEditForm]         = useState<BrandEdit | null>(null)
  const [editLoading, setEditLoading]   = useState(false)
  const [saving, setSaving]             = useState(false)
  const [editError, setEditError]       = useState('')

  // ── Delete-BRAND confirm state ──────────────────────────────────────────────
  const [toDelete, setToDelete]         = useState<BrandSummary | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState('')

  // ── Fermer temporairement (PATCH /api/restaurants/[id]/pause) ───────────────
  const [pausing, setPausing]           = useState(false)
  const [pauseError, setPauseError]     = useState('')

  // ── Delete-ESTABLISHMENT confirm state ──────────────────────────────────────
  // Consommé via DELETE /api/restaurants/[id] (Agent 2 e94ca18) qui décide
  // soft (archive) vs hard (suppression). On rend l'action volontairement peu
  // accessible : modale avec re-saisie du nom.
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

  const location = [addrView.city, addrView.address].filter(Boolean).join(' · ')

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

  // ── Fermer temporairement / réactiver (PATCH /api/restaurants/[id]/pause) ────
  // isActive=false = suspend la réception de commandes en ligne. La règle de
  // publication est appliquée serveur : un owner ne peut pas remettre en ligne un
  // resto jamais approuvé → 403 affiché ici (aucune donnée fabriquée).
  async function togglePause() {
    setPauseError('')
    setPausing(true)
    try {
      const r = await fetch(`/api/restaurants/${establishment.id}/pause`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (r.status === 401) { window.location.href = '/auth/magic'; return }
      if (r.status === 403) { setPauseError(td('pauseErrorForbidden')); return }
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.restaurant) {
        setPauseError((d && (d.error as string)) || td('pauseErrorGeneric'))
        return
      }
      setIsActive(Boolean(d.restaurant.isActive))
    } catch {
      setPauseError(td('pauseErrorGeneric'))
    } finally {
      setPausing(false)
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

  const grad = `linear-gradient(135deg,${gradFor(establishment.id)})`

  return (
    <section className="op-est-detail">
      {/* AI onboarding copilot — anti-abandon guide (Agent 93). SELF-GATING: renders null
          when ONBOARDING_GUIDE_ENABLED is OFF → the hub stays byte-identical. */}
      <OnboardingGuide />
      {/* AI onboarding copilot — conversational "how-to" help chat (Agent 97). SELF-GATING. */}
      <OnboardingChat />

      {/* back link (fiche → liste) — vraie navigation Next */}
      <Link href="/dashboard/establishments" className="back-link">
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>
        {t('bcRoot')}
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="op-card est-head">
        <span className="est-head__logo" style={{ background: grad }} aria-hidden="true">
          {initials(establishment.name)}
        </span>
        <div className="est-head__m">
          <div className="name-row">
            <h1>{establishment.name}</h1>
            <span className={`estab-openclosed ${isActive ? 'open' : 'closed'}`}>
              <i className="dot" />
              {isActive ? t('online') : t('offline')}
            </span>
          </div>
          {location && <span className="addr">{location}</span>}
        </div>
        <button
          type="button"
          className="op-btn-ghost"
          onClick={() => { window.location.href = '/dashboard' }}
        >
          <span className="ms" aria-hidden="true">open_in_new</span>{to('estab.viewDashboard')}
        </button>
      </div>

      {/* AI onboarding copilot brique 2 (Agent 91) — prefill profile from the resto's website. */}
      <SitePrefillImport restaurantId={establishment.id} onConfirmed={() => window.location.reload()} />
      {/* AI onboarding copilot brique 3 (Agent 92) — prefill the LOGO from the resto's website. */}
      <LogoPrefillImport restaurantId={establishment.id} onConfirmed={() => window.location.reload()} />

      {/* ── Central section: the brands (the point of the hub) ────────────── */}
      <div className="est-brands-head">
        <h2>{t('brandsTitle')}</h2>
        {!loading && scoped.length > 0 && <span>{t('brandsHint')}</span>}
      </div>

      {loading ? (
        <div className="est-brands-loading">
          <span className="op-spin" aria-hidden="true" /> {t('loading')}
        </div>
      ) : scoped.length === 0 ? (
        /* 0 brand → this establishment has no menu container yet. The ONLY way
           forward is to create one — surfaced as a clear CTA. */
        <div className="est-brands-empty">
          <span className="tile" aria-hidden="true"><span className="ms">storefront</span></span>
          <b>{t('emptyTitle')}</b>
          <span>{t('emptyDesc')}</span>
          <Link
            href={`/brands?restaurantId=${establishment.id}`}
            className="op-btn-primary"
            style={{ marginTop: 8 }}
          >
            <span className="ms" aria-hidden="true">add</span>{t('emptyCta')}
          </Link>
        </div>
      ) : (
        <div className="est-brands">
          {scoped.map((b) => (
            <div key={b.id} className="est-brand-card">
              {/* stretched-link → primary tap = open this brand's menu. The
                  edit/delete buttons below are raised (z-index) so they stay
                  distinct clicks. */}
              <Link href={`/menu?brand=${b.id}`} aria-label={t('openMenu')} className="est-brand-card__link" />

              <div className="est-brand-card__top">
                <span className="est-brand-card__tile" aria-hidden="true">{b.emoji}</span>
                <div className="est-brand-card__m">
                  <b>{b.name}</b>
                  <span className={`est-brand-card__status ${isActiveBrand(b.status) ? 'active' : 'paused'}`}>
                    <span className="dot" />
                    {isActiveBrand(b.status) ? t('statusActive') : t('statusPaused')}
                  </span>
                </div>
                <div className="est-brand-card__acts">
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    aria-label={t('editBrandAria', { name: b.name })}
                    title={t('editBrand')}
                    className="est-icon-btn"
                  >
                    <span className="ms" aria-hidden="true">edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteError(''); setToDelete(b) }}
                    aria-label={t('deleteBrandAria', { name: b.name })}
                    title={t('deleteBrand')}
                    className="est-icon-btn est-icon-btn--danger"
                  >
                    <span className="ms" aria-hidden="true">delete</span>
                  </button>
                </div>
              </div>

              <div className="est-brand-card__foot">
                <span className="st"><span className="ms" aria-hidden="true">restaurant_menu</span><b>{b.menuCount}</b> {t('statMenu')}</span>
                <span className="st"><span className="ms" aria-hidden="true">auto_awesome</span><b>{b.adoptedDishCount}</b> {t('statCreators')}</span>
              </div>
            </div>
          ))}

          {/* Add a brand → /brands (scratch or copy, focused create page). */}
          <Link href={`/brands?restaurantId=${establishment.id}`} className="est-brand-add">
            <span className="tile" aria-hidden="true"><span className="ms">add</span></span>
            <b>{t('addBrand')}</b>
            <span>{t('addBrandHint')}</span>
          </Link>
        </div>
      )}

      {/* ── Horaires d'ouverture (chantier horaires étape 2, blocs A+B) ─────
          Owner CRUD over Agent 2's endpoints — scoped to THIS establishment. */}
      <div className="est-embedded-section">
        <OpeningHoursSection restaurantId={establishment.id} />
      </div>

      {/* ── Adresse de l'établissement (B3 — post-onboarding address edit).
          Owner PATCH over the existing /api/restaurants/[id] route: strict-FR
          validation + mandatory re-geocode are server-side; a geocode miss is
          surfaced honestly (saved without coords → out of proximity sort). */}
      <div className="est-embedded-section">
        <AddressSection
          restaurantId={establishment.id}
          initialAddress={establishment.address}
          initialCity={establishment.city}
          onSaved={(next) => setAddrView(next)}
        />
      </div>

      {/* ── Encaissements / Compte Stripe (rail financier A1). Défensif : GET en
          échec → la carte ne rend rien. */}
      <div className="est-embedded-section">
        <ConnectCard restaurantId={establishment.id} />
      </div>

      {/* ── ZONE SENSIBLE (danger-zone) — Fermer temporairement + Supprimer ──── */}
      <div className="op-card settings-block danger-zone est-embedded-section">
        <div className="settings-block__head"><h2>{to('estab.dangerZone')}</h2></div>

        {/* Fermer temporairement / réactiver — vrai PATCH pause */}
        <div className="danger-row">
          <div className="m">
            <b>{isActive ? to('estab.pauseTitle') : to('estab.resumeTitle')}</b>
            <span>{isActive ? to('estab.pauseDesc') : to('estab.resumeDesc')}</span>
            {pauseError && <span className="blocker" style={{ color: 'var(--op-danger)' }}>{pauseError}</span>}
          </div>
          <button
            type="button"
            className="op-btn-ghost"
            onClick={togglePause}
            disabled={pausing}
          >
            {pausing
              ? <><span className="op-spin" aria-hidden="true" />{to('estab.pauseWorking')}</>
              : <><span className="ms" aria-hidden="true">{isActive ? 'pause_circle' : 'play_circle'}</span>{isActive ? to('estab.pauseTitle') : to('estab.resumeTitle')}</>}
          </button>
        </div>

        {/* Supprimer cet établissement — modale re-saisie du nom */}
        <div className="danger-row">
          <div className="m">
            <b>{td('button')}</b>
            <span>{td('intro')}</span>
            {establishmentsCount <= 1 && (
              <span className="blocker">{td('lastBlocker')}</span>
            )}
          </div>
          {establishmentsCount > 1 && (
            <button
              type="button"
              className="op-btn-danger"
              onClick={() => {
                setEstabDeleteTyped('')
                setEstabDeleteError('')
                setEstabDeleteOpen(true)
              }}
              aria-label={td('buttonAria', { name: establishment.name })}
            >
              <span className="ms" aria-hidden="true">delete</span>{to('estab.deleteBtn')}
            </button>
          )}
        </div>
      </div>

      {/* ── Edit-brand modal ───────────────────────────────────────────────── */}
      {editForm !== null && (
        <div className="op-modal__scrim" role="dialog" aria-modal="true" onClick={() => setEditForm(null)}>
          <div className="op-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="op-modal__head">
              <h2>{tb('editTitle')}</h2>
              <button type="button" className="op-modal__x" onClick={() => setEditForm(null)} aria-label={tb('cancel')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <form onSubmit={saveEdit} style={{ display: 'contents' }}>
              <div className="op-modal__body">
                {editError && (
                  <div className="op-note op-note--danger">
                    <span className="ms" aria-hidden="true">error</span>
                    <span>{editError}</span>
                  </div>
                )}

                <div className="op-field">
                  <label htmlFor="brand-name">{tb('fieldName')}</label>
                  <input
                    id="brand-name"
                    className="op-input"
                    value={editForm.name}
                    maxLength={80}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder={tb('fieldNamePlaceholder')}
                  />
                </div>

                <div className="op-field">
                  <label>{tb('fieldCuisine')}</label>
                  <div className="op-chip-grid">
                    {CUISINE_TYPES.map((c) => {
                      const active = (editForm.cuisineType ?? 'autre') === c.value
                      return (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setEditForm({ ...editForm, cuisineType: c.value })}
                          className={`op-chip${active ? ' on' : ''}`}
                        >
                          <span className="emo" aria-hidden="true">{c.emoji}</span>
                          <span>{tb(`cuisine_${c.value}` as 'cuisine_italien')}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="op-field">
                  <label>{tb('fieldEmoji')}</label>
                  <div className="op-emoji-grid">
                    {BRAND_EMOJIS.map((e2) => (
                      <button
                        key={e2}
                        type="button"
                        onClick={() => setEditForm({ ...editForm, emoji: e2 })}
                        aria-label={e2}
                        className={`op-emoji-btn${editForm.emoji === e2 ? ' on' : ''}`}
                      >
                        {e2}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="op-field">
                  <label htmlFor="brand-tagline">{tb('fieldTagline')}</label>
                  <input
                    id="brand-tagline"
                    className="op-input"
                    value={editForm.tagline ?? ''}
                    maxLength={140}
                    onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value })}
                    placeholder={tb('fieldTaglinePlaceholder')}
                  />
                </div>

                {/* B4 — franchise conditions of this brand (separate owner-scoped page). */}
                <Link
                  href={`/brands/${editForm.id}/franchise`}
                  style={{ color: 'var(--op-zest-600)', fontWeight: 700, fontSize: 12.5 }}
                >
                  {tb('franchise.editLink')} →
                </Link>
              </div>
              <div className="op-modal__foot">
                <button type="button" className="op-btn-ghost" onClick={() => setEditForm(null)}>
                  {tb('cancel')}
                </button>
                <button type="submit" className="op-btn-primary" disabled={saving || editLoading}>
                  {(saving || editLoading)
                    ? <><span className="op-spin" aria-hidden="true" />{tb('save')}</>
                    : tb('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete-brand confirm ───────────────────────────────────────────── */}
      {toDelete !== null && (
        <div className="op-modal__scrim" role="dialog" aria-modal="true" onClick={() => setToDelete(null)}>
          <div className="op-modal op-modal--sm" onClick={(ev) => ev.stopPropagation()}>
            <div className="op-modal__head">
              <h2>{tb('deleteConfirmTitle')}</h2>
              <button type="button" className="op-modal__x" onClick={() => setToDelete(null)} aria-label={tb('cancel')}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--op-muted)' }}>
                {tb('deleteConfirmBody', { name: toDelete.name })}
              </p>
              {toDelete.menuCount > 0 && (
                <div className="op-note op-note--warn">
                  <span className="ms" aria-hidden="true">warning</span>
                  <span>{tb('deleteWarnMenu', { count: toDelete.menuCount })}</span>
                </div>
              )}
              {deleteError && (
                <div className="op-note op-note--danger">
                  <span className="ms" aria-hidden="true">error</span>
                  <span>{deleteError}</span>
                </div>
              )}
            </div>
            <div className="op-modal__foot">
              <button type="button" className="op-btn-ghost" onClick={() => setToDelete(null)}>
                {tb('cancel')}
              </button>
              <button type="button" className="op-btn-danger" disabled={deleting} onClick={confirmDelete}>
                {deleting
                  ? <><span className="op-spin" aria-hidden="true" />{tb('confirmDelete')}</>
                  : tb('confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modale confirm suppression établissement (re-saisie du nom) ─────── */}
      {estabDeleteOpen && (
        <div
          className="op-modal__scrim"
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!estabDeleting && !estabDeleteResult) setEstabDeleteOpen(false) }}
        >
          <div className="op-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="op-modal__head">
              <h2>{td('modalTitle')}</h2>
              {!estabDeleteResult && (
                <button
                  type="button"
                  className="op-modal__x"
                  onClick={() => setEstabDeleteOpen(false)}
                  disabled={estabDeleting}
                  aria-label={td('cancel')}
                >
                  <span className="ms" aria-hidden="true">close</span>
                </button>
              )}
            </div>

            {estabDeleteResult ? (
              /* Success panel — visible for ~1.4 s before the hard-navigate. The
                 message reflects the ACTUAL server outcome (archived vs deleted). */
              <div className="op-modal__body">
                <div className="op-result">
                  <span className="op-result__ico" aria-hidden="true"><span className="ms">check</span></span>
                  <b>
                    {estabDeleteResult === 'archived' ? td('resultArchived') : td('resultDeleted')}
                  </b>
                  <span className="redir"><span className="op-spin" aria-hidden="true" />…</span>
                </div>
              </div>
            ) : (
              <>
                <div className="op-modal__body">
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--op-muted)' }}>
                    {td('modalBody')}
                  </p>

                  <div className="op-note op-note--warn">
                    <span className="ms" aria-hidden="true">info</span>
                    <span>
                      <b>{td('modalIntroSoft')}</b><br />
                      {td('modalIntroHard')}
                    </span>
                  </div>

                  <div className="op-field">
                    <label htmlFor="estab-del-name">
                      {td('typeNameLabel', { name: establishment.name })}
                    </label>
                    <input
                      id="estab-del-name"
                      className="op-input"
                      type="text"
                      value={estabDeleteTyped}
                      onChange={(e) => setEstabDeleteTyped(e.target.value)}
                      placeholder={td('typeNameInput')}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={estabDeleting}
                    />
                  </div>

                  {estabDeleteError && (
                    <div className="op-note op-note--danger">
                      <span className="ms" aria-hidden="true">error</span>
                      <span>
                        <b>{td('errorTitle')}</b><br />
                        {estabDeleteError}
                      </span>
                    </div>
                  )}
                </div>
                <div className="op-modal__foot">
                  <button
                    type="button"
                    className="op-btn-ghost"
                    onClick={() => setEstabDeleteOpen(false)}
                    disabled={estabDeleting}
                  >
                    {td('cancel')}
                  </button>
                  <button
                    type="button"
                    className="op-btn-danger"
                    disabled={estabDeleting || estabDeleteTyped !== establishment.name}
                    onClick={confirmEstablishmentDelete}
                  >
                    {estabDeleting
                      ? <><span className="op-spin" aria-hidden="true" />{td('confirmBtn')}</>
                      : td('confirmBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
