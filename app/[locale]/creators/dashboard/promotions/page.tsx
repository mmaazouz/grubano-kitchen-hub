'use client'

/**
 * Mes recettes — THE RECIPE EDITOR (Mission 3 Creator Studio), CR4 re-skin.
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
 *
 * CR4 RE-SKIN (visual only): CreatorShell --op-/--op-cr language + Material
 * Symbols; CD grid of recipe cards + search toolbar + status tabs (Toutes /
 * Publiées / Brouillons — counts from REAL data). Every fetch/payload/mutation
 * is byte-identical to the previous version; the campaign modal, adopters
 * accordion and verdict toasts are preserved.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import DishEditorModal, { type EditableDish } from '@/components/creators/DishEditorModal'
import type { CreatorHomeData } from '@/app/api/creators/home/route'
import type { MyDish } from '@/app/api/creators/my-dishes/route'
import '../creator-recipes.css'

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const isPublished = (s: string) => s === 'approved' || s === 'live'
type StatusTab = 'all' | 'published' | 'draft'

export default function CreatorRecipesPage() {
  const t   = useTranslations('creators.home')
  const tr  = useTranslations('creators.recipes')
  const tn  = useTranslations('creators.rolesGate')
  const te  = useTranslations('creators.editor')
  const tcam = useTranslations('creators.campaign')

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
  // CR4 — client-side search + status tabs (presentation only; no fetch change).
  const [query, setQuery] = useState('')
  const [tab,   setTab]   = useState<StatusTab>('all')
  // Promo V2 Slice 2 — chef campaign launch on an adopted recipe.
  const [campaignDish, setCampaignDish] = useState<MyDish | null>(null)
  const [campPct,   setCampPct]   = useState('20')
  const [campMsg,   setCampMsg]   = useState('')
  const [campStart, setCampStart] = useState('')
  const [campEnd,   setCampEnd]   = useState('')
  const [campSaving, setCampSaving] = useState(false)
  const [campError,  setCampError]  = useState('')

  function openCampaign(d: MyDish) {
    setCampaignDish(d); setCampPct('20'); setCampMsg(''); setCampStart(''); setCampEnd(''); setCampError('')
  }
  const campPctNum = parseFloat(campPct.replace(',', '.'))
  const campValid = !!campaignDish && Number.isFinite(campPctNum) && campPctNum >= 1 && campPctNum <= 90 &&
    campMsg.trim().length >= 2 && !!campStart && !!campEnd && new Date(campEnd) > new Date(campStart)
  async function launchCampaign() {
    if (!campValid || campSaving || !campaignDish) return
    setCampSaving(true); setCampError('')
    try {
      const r = await fetch('/api/creators/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorDishId: campaignDish.id, suggestedDiscountPct: Math.round(campPctNum),
          message: campMsg.trim(), startDate: new Date(campStart).toISOString(), endDate: new Date(campEnd).toISOString(),
        }),
      })
      const b = await r.json().catch(() => null)
      if (!r.ok) { setCampError((b?.error as string) || tcam('errGeneric')); return }
      setCampaignDish(null); setToast({ kind: 'ok', text: tcam('launchedOk') })
    } catch { setCampError(tcam('errGeneric')) } finally { setCampSaving(false) }
  }

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
  // M7 — the structured reason (label — détail) travels in `reason`; the
  // signature score shows soberly on approval (« Signature : 72/100 »); a
  // motivated review (story/quality) spells out its reason too.
  function verdictToast(verdict?: string, reason?: string, signatureScore?: number) {
    if (verdict === 'approved') {
      const sig = typeof signatureScore === 'number' ? ` · ${te('toastSignature', { score: signatureScore })}` : ''
      setToast({ kind: 'ok', text: te('toastApproved') + sig })
    }
    else if (verdict === 'rejected') setToast({ kind: 'err',  text: reason ? te('toastRejectedReason', { reason }) : te('toastRejected') })
    else if (verdict === 'pending')  setToast({ kind: 'warn', text: reason ? `${te('toastInReview')} — ${reason}` : te('toastInReview') })
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
      verdictToast(body?.verdict as string, body?.reason as string, body?.signatureScore as number | undefined)
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

  // ── Status → cover badge (5 real states) ────────────────────────────────────
  function statusBadge(status: string): { cls: string; label: string } {
    if (isPublished(status)) return { cls: 'pub',      label: t('dishStatusActive') }
    if (status === 'pending')  return { cls: 'pending',  label: te('statusInReview') }
    if (status === 'draft')    return { cls: 'draft',    label: te('statusDraft') }
    if (status === 'archived') return { cls: 'archived', label: te('statusArchived') }
    return { cls: 'rejected', label: t('dishStatusRejected') }
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
      // Mission 6 — the owner's technical sheet feeds the editor sections.
      sheet:             d.sheet,
    }
  }

  // ── Tab counts (REAL data) + filter ─────────────────────────────────────────
  const counts = useMemo(() => ({
    all:       dishes.length,
    published: dishes.filter(d => isPublished(d.status)).length,
    // « Brouillons » regroupe les états non-publiés & non-archivés en travail :
    // brouillon, soumise/en-vérification, rejetée.
    draft:     dishes.filter(d => d.status === 'draft' || d.status === 'pending' || d.status === 'rejected').length,
  }), [dishes])

  const visibleDishes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dishes.filter(d => {
      if (tab === 'published' && !isPublished(d.status)) return false
      if (tab === 'draft' && !(d.status === 'draft' || d.status === 'pending' || d.status === 'rejected')) return false
      if (q && !(d.name.toLowerCase().includes(q) || (d.cuisineType || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [dishes, tab, query])

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section aria-busy="true">
        <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
        <span className="op-sk" style={{ width: '100%', height: 44, borderRadius: 8, marginBottom: 16, display: 'block' }} />
        <div className="rc-grid">
          {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="op-sk" style={{ width: '100%', height: 250, borderRadius: 12 }} />)}
        </div>
      </section>
    )
  }

  // Mission 2 — chef role disabled → clean gate + one-tap re-enable.
  if (home?.roles && home.roles.isChef === false) {
    return (
      <section>
        <div className="op-card rc-gate">
          <span className="ms" aria-hidden="true">skillet</span>
          <b>{tn('chefOffTitle')}</b>
          <span>{tn('chefOffBody')}</span>
          <button
            type="button"
            className="op-btn-primary"
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
          >
            <span className="ms" aria-hidden="true">restaurant_menu</span>{tn('enableCta')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="op-dash__head">
        <div>
          <h1 className="op-dash__title">{tr('title')}</h1>
          <p className="op-dash__sub">{tr('subtitle', { pct: Math.round((home?.adoptionCommissionPct ?? 0.02) * 100) })}</p>
        </div>
        <button type="button" className="op-btn-primary" onClick={() => setEditing('new')}>
          <span className="ms" aria-hidden="true">add</span>{te('newRecipe')}
        </button>
      </div>

      {/* Verdict / action toast */}
      {toast && (
        <div className={`rc-toast ${toast.kind}`} role="status">
          <span className="ms" aria-hidden="true">
            {toast.kind === 'ok' ? 'check_circle' : toast.kind === 'warn' ? 'schedule' : 'error'}
          </span>
          <span>{toast.text}</span>
        </div>
      )}

      {dishes.length === 0 ? (
        /* ── Empty studio ──────────────────────────────────────────────────── */
        <div className="op-card op-empty">
          <span className="ms" aria-hidden="true">restaurant_menu</span>
          <b>{t('dishesEmpty')}</b>
          <span>{t('dishesEmptyDesc')}</span>
          <div style={{ marginTop: 18 }}>
            <button type="button" className="op-btn-primary" onClick={() => setEditing('new')}>
              <span className="ms" aria-hidden="true">add</span>{te('newRecipe')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Toolbar : search + status tabs (REAL counts) ─────────────────── */}
          <div className="rc-toolbar">
            <div className="rc-search">
              <span className="ms" aria-hidden="true">search</span>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={tr('searchPlaceholder')}
                aria-label={tr('searchPlaceholder')}
              />
            </div>
            <div className="rc-tabs" role="tablist">
              {([
                { id: 'all' as const,       label: tr('tabAll'),       cnt: counts.all },
                { id: 'published' as const, label: tr('tabPublished'), cnt: counts.published },
                { id: 'draft' as const,     label: tr('tabDrafts'),    cnt: counts.draft },
              ]).map(x => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.id}
                  className={tab === x.id ? 'is-active' : ''}
                  onClick={() => setTab(x.id)}
                >
                  {x.label} <span className="cnt">{x.cnt}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Grid ──────────────────────────────────────────────────────────── */}
          {visibleDishes.length === 0 ? (
            <div className="op-card op-empty">
              <span className="ms" aria-hidden="true">search_off</span>
              <b>{tr('noMatchTitle')}</b>
              <span>{tr('noMatchDesc')}</span>
            </div>
          ) : (
            <div className="rc-grid">
              {visibleDishes.map((d) => {
                const acting = actingId === d.id
                const b = statusBadge(d.status)
                return (
                  <article key={d.id} className="op-card rc-card">
                    {/* Cover */}
                    <div className="rc-cover">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={dishPhoto(d)} alt="" loading="lazy" />
                      <span className={`rc-cover__badge ${b.cls}`}>{b.label}</span>
                      {d.hasActiveAdoption && (
                        <span className="rc-cover__lock" title={te('lockedLine', { count: d.adoptions })}>
                          <span className="ms" aria-hidden="true">lock</span>
                        </span>
                      )}
                    </div>

                    {/* Body */}
                    <div className="rc-cbody">
                      <h3>{d.name}</h3>
                      {d.description && <p className="desc">{d.description}</p>}
                      <div className="rc-cstats">
                        <span className="st"><span className="ms" aria-hidden="true">storefront</span><b>{d.adoptionsCount}</b></span>
                        <span className="st"><span className="ms" aria-hidden="true">sell</span><b>{d.salesCount}</b></span>
                        {d.earningsNet > 0 && (
                          <span className="st"><span className="ms" aria-hidden="true">payments</span><b className="net">€{fmt(d.earningsNet)}</b></span>
                        )}
                        <button type="button" className="edit" onClick={() => setEditing(toEditable(d))}>
                          {te('completeness', { pct: d.sheetCompleteness })}
                        </button>
                      </div>
                    </div>

                    {/* Adopters analytics accordion (Mission 4 — private €) */}
                    {d.adoptersRich.length > 0 && (
                      <div className="rc-adopt">
                        <button
                          type="button"
                          className="rc-adopt__toggle"
                          onClick={() => setOpenAdopters(openAdopters === d.id ? null : d.id)}
                        >
                          <span className="ms lead" aria-hidden="true">storefront</span>
                          {te('adoptersToggle', { count: d.adoptersRich.length })}
                          <span className="ms chev" aria-hidden="true">{openAdopters === d.id ? 'expand_less' : 'expand_more'}</span>
                        </button>
                        {openAdopters === d.id && (
                          <div className="rc-adopt__list">
                            {d.adoptersRich.map((a) => (
                              <div key={a.adoptionId} className="rc-adopt__row">
                                <div className="rc-adopt__hd">
                                  <span className="brand">{a.brandEmoji} {a.brandName}</span>
                                  {a.city && (
                                    <span className="city"><span className="ms" aria-hidden="true">place</span>{a.city}</span>
                                  )}
                                  <span className="since">{te('adopterSince', { date: new Date(a.adoptedAt).toLocaleDateString('fr-FR') })}</span>
                                </div>
                                <div className="rc-adopt__fig">
                                  <span className="k"><span className="ms" aria-hidden="true">shopping_bag</span>{te('adopterSales', { count: a.salesCount })}</span>
                                  <span className="k">{te('adopterRevenue')} <b className="v">€{fmt(a.revenue)}</b></span>
                                  <span className="k">{te('adopterEarnings')} <b className="v net">€{fmt(a.earnings)}</b></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions by state */}
                    <div className="rc-cactions">
                      {d.status !== 'archived' && (
                        <button type="button" className="rc-abtn" onClick={() => setEditing(toEditable(d))}>
                          <span className="ms" aria-hidden="true">edit</span>{te('actionEdit')}
                        </button>
                      )}
                      {/* Promo V2 Slice 2 — launch a demand-driver campaign (only on
                          an approved recipe with ≥ 1 active adoption to drive). */}
                      {d.status === 'approved' && d.hasActiveAdoption && (
                        <button type="button" className="rc-abtn" onClick={() => openCampaign(d)}>
                          <span className="ms" aria-hidden="true">campaign</span>{tcam('launchCta')}
                        </button>
                      )}
                      {(d.status === 'draft' || d.status === 'rejected' || d.status === 'pending') && (
                        <button type="button" className="rc-abtn primary" disabled={acting} onClick={() => submitDish(d)}>
                          <span className={`ms${acting ? ' rc-spin' : ''}`} aria-hidden="true">{acting ? 'progress_activity' : 'send'}</span>
                          {te('actionSubmit')}
                        </button>
                      )}
                      {d.status === 'archived' ? (
                        <button type="button" className="rc-abtn" disabled={acting} onClick={() => restoreDish(d)}>
                          <span className={`ms${acting ? ' rc-spin' : ''}`} aria-hidden="true">{acting ? 'progress_activity' : 'restore'}</span>
                          {te('actionRestore')}
                        </button>
                      ) : d.hasAnyHistory ? (
                        <button type="button" className="rc-abtn" disabled={acting} onClick={() => deleteDish(d)}>
                          <span className={`ms${acting ? ' rc-spin' : ''}`} aria-hidden="true">{acting ? 'progress_activity' : 'archive'}</span>
                          {te('actionArchive')}
                        </button>
                      ) : (
                        <button type="button" className="rc-abtn danger" disabled={acting} onClick={() => setConfirmDel(d)}>
                          <span className="ms" aria-hidden="true">delete</span>{te('actionDelete')}
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Campaign launch modal (Promo V2 Slice 2) ────────────────────────── */}
      {campaignDish && (
        <div className="ed-scrim" role="dialog" aria-modal="true" onClick={() => !campSaving && setCampaignDish(null)}>
          <div className="cm-modal" onClick={e => e.stopPropagation()}>
            <div className="cm-modal__hd">
              <span className="ms" aria-hidden="true">campaign</span>
              <h2>{tcam('launchTitle')}</h2>
              <button type="button" className="ed-close" aria-label={te('close')} onClick={() => !campSaving && setCampaignDish(null)}>
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="cm-modal__bd">
              <p className="cm-intro">{tcam('launchIntro', { dish: campaignDish.name })}</p>
              <div className="fld">
                <label>{tcam('fieldPct')}</label>
                <input className="inp" inputMode="decimal" value={campPct} onChange={e => setCampPct(e.target.value)} />
              </div>
              <div className="fld">
                <label>{tcam('fieldMessage')}</label>
                <textarea className="inp" value={campMsg} onChange={e => setCampMsg(e.target.value)} rows={3} maxLength={280}
                  placeholder={tcam('fieldMessagePh')} />
              </div>
              <div className="row2">
                <div className="fld">
                  <label>{tcam('fieldStart')}</label>
                  <input className="inp" type="datetime-local" value={campStart} onChange={e => setCampStart(e.target.value)} />
                </div>
                <div className="fld">
                  <label>{tcam('fieldEnd')}</label>
                  <input className="inp" type="datetime-local" value={campEnd} onChange={e => setCampEnd(e.target.value)} />
                </div>
              </div>
              <p className="cm-note">{tcam('financeNote')}</p>
              {campError && (
                <div className="ed-error" style={{ marginTop: 12 }}>
                  <span className="ms" aria-hidden="true">error</span><span>{campError}</span>
                </div>
              )}
            </div>
            <div className="cm-modal__ft">
              <button type="button" className="op-btn-ghost" onClick={() => setCampaignDish(null)} disabled={campSaving}>{tcam('cancel')}</button>
              <button type="button" className="op-btn-primary" onClick={launchCampaign} disabled={campSaving || !campValid}>
                <span className={`ms${campSaving ? ' rc-spin' : ''}`} aria-hidden="true">{campSaving ? 'progress_activity' : 'campaign'}</span>
                {tcam('launch')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Editor modal (create + edit) ─────────────────────────────────────── */}
      {editing !== null && (
        <DishEditorModal
          dish={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={({ verdict, reason, signatureScore }) => {
            setEditing(null)
            verdictToast(verdict, reason, signatureScore)
            load()
          }}
        />
      )}

      {/* ── Delete confirm (pristine recipes only — real deletion) ───────────── */}
      {confirmDel && (
        <div className="ed-scrim" role="dialog" aria-modal="true" onClick={() => actingId !== confirmDel.id && setConfirmDel(null)}>
          <div className="cf-modal" onClick={e => e.stopPropagation()}>
            <div className="cf-modal__ic">
              <span className="box"><span className="ms" aria-hidden="true">delete</span></span>
              <b>{te('deleteTitle')}</b>
            </div>
            <p>{te('deleteBody', { name: confirmDel.name })}</p>
            <div className="cf-modal__ft">
              <button type="button" className="op-btn-ghost" onClick={() => setConfirmDel(null)} disabled={actingId === confirmDel.id}>
                {te('deleteCancel')}
              </button>
              <button type="button" className="cf-danger" disabled={actingId === confirmDel.id} onClick={() => deleteDish(confirmDel)}>
                <span className={`ms${actingId === confirmDel.id ? ' rc-spin' : ''}`} aria-hidden="true">{actingId === confirmDel.id ? 'progress_activity' : 'delete'}</span>
                {te('deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
