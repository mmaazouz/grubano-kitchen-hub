'use client'

/**
 * Mes recettes — THE RECIPE EDITOR (Mission 3 Creator Studio).
 *
 * Full lifecycle in one place: draft → (submit) → pending → auto-vetting →
 * approved | rejected ; archived = retrait réversible. Data source:
 *   /api/creators/home      → roles gate (M2) + real adoption rate + KPIs
 *   /api/creators/my-dishes → ALL statuses + per-dish R1-R4 flags
 *     { hasActiveAdoption, hasAnyHistory, adoptionsCount, salesCount }
 *   → the UI decides what to allow WITHOUT guessing (the server re-enforces).
 *
 * Actions per state:
 *   Modifier (drawer/modal, same form as creation) — content disabled when an
 *   adoption is active (R3, photo always editable) · Soumettre (draft/
 *   rejected/legacy-pending) · Archiver (history) / Supprimer (pristine,
 *   confirm) · Restaurer (archived).
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChefHat, Plus, CheckCircle2, Clock, Store, Pencil, Send, Archive,
  Trash2, RotateCcw, Loader2, Lock, FileEdit, ChevronDown, ChevronUp,
  MapPin, ShoppingBag,
} from 'lucide-react'
import { Card, Button, Badge, EmptyState, SkeletonList } from '@/components/design-system'
import FoodImage from '@/components/eat/FoodImage'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import DishEditorModal, { type EditableDish } from '@/components/creators/DishEditorModal'
import type { CreatorHomeData } from '@/app/api/creators/home/route'
import type { MyDish } from '@/app/api/creators/my-dishes/route'

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CreatorRecipesPage() {
  const t  = useTranslations('creators.home')
  const tr = useTranslations('creators.recipes')
  const tn = useTranslations('creators.rolesGate')
  const te = useTranslations('creators.editor')

  const [home,    setHome]    = useState<CreatorHomeData | null>(null)
  const [dishes,  setDishes]  = useState<MyDish[]>([])
  const [loading, setLoading] = useState(true)
  // Editor + per-dish action state.
  const [editing,   setEditing]   = useState<EditableDish | null | 'new'>(null)
  const [confirmDel, setConfirmDel] = useState<MyDish | null>(null)
  const [actingId,  setActingId]  = useState<string | null>(null)
  const [toast,     setToast]     = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  // Mission 4 (1.2) — per-dish adopters analytics accordion (private studio).
  const [openAdopters, setOpenAdopters] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [homeRes, dishesRes] = await Promise.all([
        fetch('/api/creators/home',      { cache: 'no-store' }),
        fetch('/api/creators/my-dishes', { cache: 'no-store' }),
      ])
      if (homeRes.ok)   setHome(await homeRes.json())
      if (dishesRes.ok) {
        const d = await dishesRes.json()
        setDishes(Array.isArray(d?.dishes) ? d.dishes : [])
      }
    } catch { /* shells below */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  // ── Verdict → toast (after a submission ran) ────────────────────────────────
  function verdictToast(verdict?: string, reason?: string) {
    if (verdict === 'approved')      setToast({ kind: 'ok',   text: te('toastApproved') })
    else if (verdict === 'rejected') setToast({ kind: 'err',  text: reason ? te('toastRejectedReason', { reason }) : te('toastRejected') })
    else if (verdict === 'pending')  setToast({ kind: 'warn', text: te('toastInReview') })
    else                             setToast({ kind: 'ok',   text: te('toastSaved') })
  }

  // ── Per-dish actions ─────────────────────────────────────────────────────────
  async function submitDish(d: MyDish) {
    if (actingId) return
    setActingId(d.id)
    try {
      const r = await fetch(`/api/creators/dishes/${d.id}/submit`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (!r.ok) { setToast({ kind: 'err', text: (body?.error as string) || te('errGeneric') }); return }
      verdictToast(body?.verdict as string, body?.reason as string)
      await load()
    } catch { setToast({ kind: 'err', text: te('errGeneric') }) } finally { setActingId(null) }
  }

  async function deleteDish(d: MyDish) {
    if (actingId) return
    setActingId(d.id)
    try {
      const r = await fetch(`/api/creators/dishes/${d.id}`, { method: 'DELETE' })
      const body = await r.json().catch(() => null)
      if (!r.ok) { setToast({ kind: 'err', text: (body?.error as string) || te('errGeneric') }); return }
      setToast({ kind: 'ok', text: body?.deleted ? te('toastDeleted') : te('toastArchived') })
      setConfirmDel(null)
      await load()
    } catch { setToast({ kind: 'err', text: te('errGeneric') }) } finally { setActingId(null) }
  }

  async function restoreDish(d: MyDish) {
    if (actingId) return
    setActingId(d.id)
    try {
      const r = await fetch(`/api/creators/dishes/${d.id}/restore`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (!r.ok) { setToast({ kind: 'err', text: (body?.error as string) || te('errGeneric') }); return }
      setToast({ kind: 'ok', text: te('toastRestored') })
      await load()
    } catch { setToast({ kind: 'err', text: te('errGeneric') }) } finally { setActingId(null) }
  }

  // ── Status badge (5 states) ─────────────────────────────────────────────────
  function StatusBadge({ status }: { status: string }) {
    if (status === 'approved' || status === 'live')
      return <Badge tone="success" size="sm" icon={<CheckCircle2 size={9} />}>{t('dishStatusActive')}</Badge>
    if (status === 'pending')
      return <Badge tone="warning" size="sm" icon={<Clock size={9} />}>{te('statusInReview')}</Badge>
    if (status === 'draft')
      return <Badge size="sm" icon={<FileEdit size={9} />}>{te('statusDraft')}</Badge>
    if (status === 'archived')
      return <Badge size="sm" icon={<Archive size={9} />}>{te('statusArchived')}</Badge>
    return <Badge tone="danger" size="sm">{t('dishStatusRejected')}</Badge>
  }

  function dishPhoto(d: MyDish): string {
    return d.photo || getFoodImage(inferCategory(d.cuisineType || d.name), d.id)
  }

  function toEditable(d: MyDish): EditableDish {
    return {
      id:                d.id,
      name:              d.name,
      description:       d.description ?? '',
      ingredients:       d.ingredients,
      cuisineType:       d.cuisineType,
      suggestedPrice:    d.suggestedPrice,
      photo:             d.photo,
      status:            d.status,
      hasActiveAdoption: d.hasActiveAdoption,
      adoptionsCount:    d.adoptionsCount,
    }
  }

  if (loading) {
    return (
      <div className="px-4 pt-6 max-w-2xl mx-auto space-y-4">
        <SkeletonList count={4} />
      </div>
    )
  }

  // Mission 2 - chef role disabled -> clean gate + one-tap re-enable.
  if (home?.roles && home.roles.isChef === false) {
    return (
      <div className="px-4 pt-12 max-w-2xl mx-auto">
        <EmptyState
          emoji="🍳"
          title={tn('chefOffTitle')}
          description={tn('chefOffBody')}
          action={
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch('/api/creators/me/roles', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isChef: true }),
                  })
                  if (r.ok) window.location.reload()
                } catch { /* retryable */ }
              }}
              className="inline-flex items-center rounded-grubano-lg bg-grubano-primary px-4 py-2 text-sm font-medium text-white"
            >
              {tn('enableCta')}
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="px-4 pb-10 pt-5 max-w-2xl mx-auto space-y-5">

      {/* Verdict / action toast */}
      {toast && (
        <p className={`rounded-grubano-lg px-3 py-2.5 text-[12px] font-semibold ${
          toast.kind === 'ok' ? 'bg-grubano-success-tint text-grubano-success'
          : toast.kind === 'warn' ? 'bg-grubano-warning-tint text-grubano-warning'
          : 'bg-grubano-danger-tint text-grubano-danger'
        }`}>
          {toast.text}
        </p>
      )}

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="rounded-grubano-xl bg-gradient-to-br from-grubano-primary to-grubano-primary/70 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <ChefHat size={20} />
          <h1 className="text-lg font-display font-bold leading-tight">{tr('title')}</h1>
          <span className="ml-auto rounded-grubano-pill bg-white/20 px-2.5 py-0.5 text-xs font-bold shrink-0">
            {tr('badge', { pct: Math.round((home?.adoptionCommissionPct ?? 0.02) * 100) })}
          </span>
        </div>
        <p className="text-sm opacity-90 leading-relaxed">{tr('subtitle')}</p>
      </div>

      {/* ── KPI strip (kept) ─────────────────────────────────────────────── */}
      {home && (
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: tr('kpiEarnings'),  value: `€${(home.dishEarningsTotal  ?? 0).toFixed(2)}` },
            { label: tr('kpiAdoptions'), value: String(home.dishAdoptionsTotal ?? 0) },
            { label: tr('kpiSales'),     value: String(home.dishSalesTotal     ?? 0) },
          ] as const).map(({ label, value }) => (
            <Card key={label} elevation="sm" padding="sm">
              <p className="text-sm font-bold text-grubano-primary">{value}</p>
              <p className="text-[10px] text-grubano-ink-muted mt-0.5 leading-tight">{label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* ── The editor list ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <ChefHat size={14} className="text-grubano-primary" />
          {t('dishesTitle')}
        </h2>
        <Button variant="primary" size="sm" leftIcon={<Plus size={12} />} onClick={() => setEditing('new')}>
          {te('newRecipe')}
        </Button>
      </div>

      {dishes.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <EmptyState
            compact
            emoji={<ChefHat size={24} />}
            title={t('dishesEmpty')}
            description={t('dishesEmptyDesc')}
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus size={12} />} onClick={() => setEditing('new')}>
                {te('newRecipe')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {dishes.map((d) => {
            const acting = actingId === d.id
            return (
              <Card key={d.id} elevation="sm" padding="md">
                <div className="flex items-start gap-3">
                  <FoodImage name={d.name} src={dishPhoto(d)} className="h-16 w-16 shrink-0 rounded-grubano-lg" glyphClassName="text-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-bold text-grubano-ink">{d.name}</p>
                      <StatusBadge status={d.status} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-grubano-ink-muted">
                      €{fmt(d.suggestedPrice)} · {te('counters', { restos: d.adoptionsCount, sales: d.salesCount })}
                    </p>
                    {/* R3 — explanatory line when the content is locked. */}
                    {d.hasActiveAdoption && (
                      <p className="mt-1 flex items-start gap-1 text-[10px] text-grubano-warning">
                        <Lock size={10} className="mt-0.5 shrink-0" />
                        {te('lockedLine', { count: d.adoptions })}
                      </p>
                    )}
                    {d.earningsNet > 0 && (
                      <p className="mt-0.5 text-[11px] font-bold text-grubano-success">
                        {t('dishNetLabel')} €{fmt(d.earningsNet)}
                      </p>
                    )}
                  </div>
                </div>

                {/* ── Adopters analytics accordion (Mission 4 — private €) ─ */}
                {d.adoptersRich.length > 0 && (
                  <div className="mt-3 border-t border-grubano-border pt-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenAdopters(openAdopters === d.id ? null : d.id)}
                      className="flex w-full items-center gap-1.5 text-[11px] font-bold text-grubano-ink-muted"
                    >
                      <Store size={12} className="text-grubano-primary" />
                      {te('adoptersToggle', { count: d.adoptersRich.length })}
                      {openAdopters === d.id ? <ChevronUp size={13} className="ml-auto" /> : <ChevronDown size={13} className="ml-auto" />}
                    </button>
                    {openAdopters === d.id && (
                      <div className="mt-2 space-y-2">
                        {d.adoptersRich.map((a) => (
                          <div key={a.adoptionId} className="rounded-grubano-lg bg-grubano-surface px-3 py-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                              <span className="font-bold text-grubano-ink">{a.brandEmoji} {a.brandName}</span>
                              {a.city && (
                                <span className="inline-flex items-center gap-0.5 text-grubano-ink-muted">
                                  <MapPin size={10} /> {a.city}
                                </span>
                              )}
                              <span className="ml-auto text-grubano-ink-faint">
                                {te('adopterSince', { date: new Date(a.adoptedAt).toLocaleDateString('fr-FR') })}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                              <span className="inline-flex items-center gap-1 text-grubano-ink-muted">
                                <ShoppingBag size={10} /> {te('adopterSales', { count: a.salesCount })}
                              </span>
                              <span className="text-grubano-ink-muted">{te('adopterRevenue')} <b className="text-grubano-ink">€{fmt(a.revenue)}</b></span>
                              <span className="text-grubano-success">{te('adopterEarnings')} <b>€{fmt(a.earnings)}</b></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Actions by state ─────────────────────────────────── */}
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-grubano-border pt-2.5">
                  {d.status !== 'archived' && (
                    <Button variant="secondary" size="sm" leftIcon={<Pencil size={11} />}
                      onClick={() => setEditing(toEditable(d))}>
                      {te('actionEdit')}
                    </Button>
                  )}
                  {(d.status === 'draft' || d.status === 'rejected' || d.status === 'pending') && (
                    <Button variant="primary" size="sm" leftIcon={acting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                      disabled={acting} onClick={() => submitDish(d)}>
                      {te('actionSubmit')}
                    </Button>
                  )}
                  {d.status === 'archived' ? (
                    <Button variant="secondary" size="sm" leftIcon={acting ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                      disabled={acting} onClick={() => restoreDish(d)}>
                      {te('actionRestore')}
                    </Button>
                  ) : d.hasAnyHistory ? (
                    <Button variant="ghost" size="sm" leftIcon={acting ? <Loader2 size={11} className="animate-spin" /> : <Archive size={11} />}
                      disabled={acting} onClick={() => deleteDish(d)}>
                      {te('actionArchive')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                      disabled={acting} onClick={() => setConfirmDel(d)}>
                      {te('actionDelete')}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Editor modal (create + edit) ─────────────────────────────────── */}
      {editing !== null && (
        <DishEditorModal
          dish={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={({ verdict, reason }) => {
            setEditing(null)
            verdictToast(verdict, reason)
            load()
          }}
        />
      )}

      {/* ── Delete confirm (pristine recipes only — real deletion) ───────── */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-2xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-grubano-danger-tint text-grubano-danger">
                <Trash2 size={15} />
              </span>
              <p className="text-base font-bold text-grubano-ink">{te('deleteTitle')}</p>
            </div>
            <p className="text-sm text-grubano-ink-muted">
              {te('deleteBody', { name: confirmDel.name })}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="md" onClick={() => setConfirmDel(null)}>
                {te('deleteCancel')}
              </Button>
              <Button variant="danger" size="md" className="flex-1"
                loading={actingId === confirmDel.id} onClick={() => deleteDish(confirmDel)}>
                {te('deleteConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
