'use client'

/**
 * Fulfillment settings form — operator-facing. RÉCEPTION DES COMMANDES.
 *
 * Renders the delivery / pickup / reservation toggles plus prep times and pickup
 * info for a single restaurant, then posts to
 *   POST /api/restaurants/[id]/fulfillment
 * on submit.
 *
 * 🔒 PRESENTATION-ONLY RE-SKIN (CD v1 LOT 5, Notion 390fd2c9-…-04ee). This file
 * was migrated from the shadcn/lucide design-system to the operator navy shell
 * (--op-* tokens + Material Symbols). The DATA LOGIC is byte-identical: the same
 * `initial` hydration, the same `form` state, the same `dirty` / `activeChannels`
 * derivations, the same `set` / `reset` / `submit` handlers, and — critically —
 * the SAME POST payload (JSON.stringify(form)) with no field renamed. The page is
 * already wrapped by AppChrome → OperatorShell (navy chrome), so this component
 * renders ONLY the screen content (a <section> inside op-content).
 *
 * MONEY: the BARÈME (deliveryFee / minOrder = Restaurant.* Float EUROS) is READ
 * from the real config (passed by the server component) and shown read-only via
 * formatEuros — NEVER hardcoded, never recomputed, never POSTed by this form.
 *
 * HONEST « Aperçu — bientôt » (not wired in this form → inert, no fetch):
 *   · « Accepter les commandes en ligne » toggle + pause panel (illustrative)
 *   · default prep time + « coup de feu » rush chips
 *   · per-channel pickup delay select + retrieval-code note
 *   · dine-in prep time
 * These are drawn CD-faithful but disabled — illustrative values are tagged
 * « exemple », never presented as real data.
 */

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import {
  ToastProvider,
  useToast,
} from '@/components/design-system'
import { type EstablishmentOption } from '@/components/dashboard/EstablishmentSwitcher'
import '../../app/[locale]/dashboard/fulfillment/fulfillment.css'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FulfillmentSettings {
  deliveryEnabled:    boolean
  pickupEnabled:      boolean
  reservationEnabled: boolean
  deliveryRadius:     number
  pickupPrepTime:     number
  deliveryPrepTime:   number
  pickupAddress:      string | null
  pickupInstructions: string | null
}

/** Read-only barème (real config, EUROS) — display only, never POSTed. */
export interface FulfillmentBilling {
  deliveryFee: number
  minOrder:    number
}

interface Props {
  restaurantId:   string
  restaurantName: string
  // All of the operator's establishments (oldest first) for the header switcher.
  // ≤1 entry → the switcher renders nothing (mono behaviour preserved).
  establishments: EstablishmentOption[]
  initial:        FulfillmentSettings
  billing:        FulfillmentBilling
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FulfillmentForm(props: Props) {
  // Wrap the form in a local ToastProvider so toast() works on this page
  // without us having to mount one globally (per design-system README).
  return (
    <ToastProvider>
      <FulfillmentFormInner {...props} />
    </ToastProvider>
  )
}

function FulfillmentFormInner({ restaurantId, restaurantName, initial, billing }: Props) {
  const t      = useTranslations('operator')
  const locale = useLocale()
  const toast  = useToast()
  const [form,    setForm]    = useState<FulfillmentSettings>(initial)
  const [saving,  setSaving]  = useState(false)
  const [confirm, setConfirm] = useState(false)

  // Detect if the user has made any change since the initial snapshot.
  const dirty =
    form.deliveryEnabled    !== initial.deliveryEnabled    ||
    form.pickupEnabled      !== initial.pickupEnabled      ||
    form.reservationEnabled !== initial.reservationEnabled ||
    form.deliveryRadius     !== initial.deliveryRadius     ||
    form.pickupPrepTime     !== initial.pickupPrepTime     ||
    form.deliveryPrepTime   !== initial.deliveryPrepTime   ||
    (form.pickupAddress      ?? '') !== (initial.pickupAddress      ?? '') ||
    (form.pickupInstructions ?? '') !== (initial.pickupInstructions ?? '')

  const activeChannels =
    Number(form.deliveryEnabled) +
    Number(form.pickupEnabled) +
    Number(form.reservationEnabled)

  function set<K extends keyof FulfillmentSettings>(key: K, value: FulfillmentSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function reset() {
    setForm(initial)
    toast.info('Modifications annulées')
  }

  async function submit() {
    if (activeChannels === 0) {
      toast.error('Au moins un mode doit rester actif', {
        description: 'Activez la livraison, le retrait ou la réservation.',
      })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/fulfillment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Échec de l’enregistrement', {
          description: data?.error ?? `HTTP ${res.status}`,
        })
        return
      }
      toast.success('Paramètres enregistrés', {
        description: 'Les changements sont en ligne immédiatement.',
      })
      // Snap baseline so dirty becomes false until next edit.
      Object.assign(initial, form)
    } catch (err) {
      toast.error('Erreur réseau', {
        description: err instanceof Error ? err.message : 'Réessayez dans un instant.',
      })
    } finally {
      setSaving(false)
      setConfirm(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="fulfil">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('fulfillment.title')}</h1>
        <p className="op-dash__sub">
          {t('fulfillment.subtitle', { name: restaurantName })}
        </p>
      </div>

      {/* HONEST preview banner — the accept-online / pause / rush blocks below are
          illustrative and not yet wired to a backend from this form. */}
      <div className="op-soon-banner">
        <span className="ms" aria-hidden="true">visibility</span>
        <p>
          <b>{t('fulfillment.previewTitle')}</b> — {t('fulfillment.previewBody')}
        </p>
      </div>

      <div className="op-ful-stack">
        {/* ══ (A) Accepter les commandes en ligne — HONEST preview (inert) ══ */}
        <div className="op-card accept-hero" data-accepting="on">
          <div className="accept-hero__row">
            <span className="accept-hero__ic"><span className="ms" aria-hidden="true">storefront</span></span>
            <div className="accept-hero__m">
              <div className="top">
                <b>{t('fulfillment.acceptTitle')}</b>
                <span className="tag-soon">{t('soon')}</span>
              </div>
              <span>{t('fulfillment.acceptBody')}</span>
            </div>
            {/* INERT — no backend from this form; checked/illustrative, disabled. */}
            <label className="op-switch lg">
              <input type="checkbox" defaultChecked disabled aria-disabled="true" />
              <span className="track" />
            </label>
          </div>
          <div className="pause-panel">
            <div>
              <span className="lbl">{t('fulfillment.pauseFor')}</span>
              <div className="pause-opts">
                <button type="button" className="chip is-active" disabled>{t('fulfillment.pause30')}</button>
                <button type="button" className="chip" disabled>{t('fulfillment.pause1h')}</button>
                <button type="button" className="chip" disabled>{t('fulfillment.pauseTomorrow')}</button>
              </div>
            </div>
            <div className="pause-note">
              <span className="ms" aria-hidden="true">pause_circle</span>
              <span>
                {t('fulfillment.pauseNote')} <b className="mono">{t('fulfillment.exampleTime')}</b>
                {' '}<span className="tag-eg">{t('fulfillment.example')}</span>
              </span>
            </div>
            <button type="button" className="op-btn-ghost pause-resume" disabled>
              <span className="ms" aria-hidden="true">play_circle</span>{t('fulfillment.resumeNow')}
            </button>
          </div>
        </div>

        {/* ══ (B) Temps de préparation par défaut + coup de feu — HONEST preview ══ */}
        <div className="op-card prep-row">
          <div className="prep-field">
            <label>{t('fulfillment.defaultPrepLabel')} <span className="tag-soon">{t('soon')}</span></label>
            <div className="prep-input-wrap">
              <input className="prep-input mono" type="text" defaultValue="20" disabled aria-disabled="true" />
              <span>{t('fulfillment.minUnit')}</span>
            </div>
          </div>
          <div className="rush-block">
            <label><span className="ms" aria-hidden="true">local_fire_department</span>{t('fulfillment.rushLabel')}</label>
            <div className="rush-chips">
              <button type="button" className="chip is-active" disabled>{t('fulfillment.rushNone')}</button>
              <button type="button" className="chip rush-chip" disabled>+<span className="val">10</span> {t('fulfillment.minUnit')}</button>
              <button type="button" className="chip rush-chip" disabled>+<span className="val">20</span> {t('fulfillment.minUnit')}</button>
            </div>
          </div>
        </div>

        {/* ══ (C) 3 cartes de canal — REAL toggles + fields ══ */}
        <div className="channels-grid">
          {/* ── Livraison ── */}
          <div className="channel-card delivery" data-on={form.deliveryEnabled ? 'true' : 'false'}>
            <div className="channel-card__head">
              <span className="channel-card__ic"><span className="ms" aria-hidden="true">moped</span></span>
              <b>{t('fulfillment.channelDelivery')}</b>
              <label className="op-switch">
                <input
                  type="checkbox"
                  checked={form.deliveryEnabled}
                  onChange={e => set('deliveryEnabled', e.target.checked)}
                />
                <span className="track" />
              </label>
            </div>
            <div className="channel-card__body">
              {/* REAL — deliveryPrepTime (0–180 min) */}
              <div className="op-field">
                <label>{t('fulfillment.prepTimeLabel')}</label>
                <div className="prep-input-wrap">
                  <input
                    className="prep-input mono"
                    type="number"
                    min={0}
                    max={180}
                    value={form.deliveryPrepTime}
                    onChange={e => set('deliveryPrepTime', Number(e.target.value) || 0)}
                  />
                  <span>{t('fulfillment.minUnit')}</span>
                </div>
              </div>
              {/* REAL — deliveryRadius (0–50 km) */}
              <div className="op-field">
                <label>{t('fulfillment.radiusLabel')}</label>
                <div className="field-suffixed">
                  <input
                    className="op-input mono"
                    type="number"
                    min={0}
                    max={50}
                    value={form.deliveryRadius}
                    onChange={e => set('deliveryRadius', Number(e.target.value) || 0)}
                  />
                  <span className="field-suffix">{t('fulfillment.kmUnit')}</span>
                </div>
                <span className="hint">{t('fulfillment.radiusHint')}</span>
              </div>
              {/* BARÈME — read-only, REAL config (EUROS), via formatEuros. Never POSTed. */}
              <div className="op-field-row">
                <div className="op-field">
                  <label>{t('fulfillment.feeLabel')} <span className="tag-soon">{t('soon')}</span></label>
                  <div className="fee-readonly">
                    <b className="mono">{formatEuros(billing.deliveryFee, locale)}</b>
                    <span className="ms" aria-hidden="true">lock</span>
                  </div>
                </div>
                <div className="op-field">
                  <label>{t('fulfillment.minOrderLabel')} <span className="tag-soon">{t('soon')}</span></label>
                  <div className="fee-readonly">
                    <b className="mono">{formatEuros(billing.minOrder, locale)}</b>
                    <span className="ms" aria-hidden="true">lock</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── À emporter ── */}
          <div className="channel-card pickup" data-on={form.pickupEnabled ? 'true' : 'false'}>
            <div className="channel-card__head">
              <span className="channel-card__ic"><span className="ms" aria-hidden="true">shopping_bag</span></span>
              <b>{t('fulfillment.channelPickup')}</b>
              <label className="op-switch">
                <input
                  type="checkbox"
                  checked={form.pickupEnabled}
                  onChange={e => set('pickupEnabled', e.target.checked)}
                />
                <span className="track" />
              </label>
            </div>
            <div className="channel-card__body">
              {/* REAL — pickupPrepTime (0–180 min) */}
              <div className="op-field">
                <label>{t('fulfillment.prepTimeLabel')}</label>
                <div className="prep-input-wrap">
                  <input
                    className="prep-input mono"
                    type="number"
                    min={0}
                    max={180}
                    value={form.pickupPrepTime}
                    onChange={e => set('pickupPrepTime', Number(e.target.value) || 0)}
                  />
                  <span>{t('fulfillment.minUnit')}</span>
                </div>
              </div>
              {/* REAL — pickupAddress */}
              <div className="op-field">
                <label>{t('fulfillment.pickupAddressLabel')}</label>
                <input
                  className="op-input"
                  type="text"
                  placeholder={t('fulfillment.pickupAddressPlaceholder')}
                  value={form.pickupAddress ?? ''}
                  onChange={e => set('pickupAddress', e.target.value || null)}
                />
                <span className="hint">{t('fulfillment.pickupAddressHint')}</span>
              </div>
              {/* REAL — pickupInstructions */}
              <div className="op-field">
                <label>{t('fulfillment.pickupInstructionsLabel')}</label>
                <textarea
                  className="op-textarea"
                  rows={3}
                  placeholder={t('fulfillment.pickupInstructionsPlaceholder')}
                  value={form.pickupInstructions ?? ''}
                  onChange={e => set('pickupInstructions', e.target.value || null)}
                />
                <span className="hint">{t('fulfillment.pickupInstructionsHint')}</span>
              </div>
              {/* HONEST — illustrative retrieval-code note (not wired) */}
              <div className="op-callout">
                <span className="ms" aria-hidden="true">info</span>
                <p>{t('fulfillment.pickupCodeNote')}</p>
              </div>
            </div>
          </div>

          {/* ── Sur place / Réservation ── */}
          <div className="channel-card dinein" data-on={form.reservationEnabled ? 'true' : 'false'}>
            <div className="channel-card__head">
              <span className="channel-card__ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
              <b>{t('fulfillment.channelDinein')}</b>
              <label className="op-switch">
                <input
                  type="checkbox"
                  checked={form.reservationEnabled}
                  onChange={e => set('reservationEnabled', e.target.checked)}
                />
                <span className="track" />
              </label>
            </div>
            <div className="channel-card__body">
              {/* HONEST — dine-in prep time is illustrative (no real field) */}
              <div className="op-field">
                <label>{t('fulfillment.prepTimeLabel')} <span className="tag-soon">{t('soon')}</span></label>
                <div className="prep-input-wrap">
                  <input className="prep-input mono" type="text" defaultValue="18" disabled aria-disabled="true" />
                  <span>{t('fulfillment.minUnit')}</span>
                </div>
              </div>
              {/* REAL link to reservation/room management */}
              <Link href="/tables" className="channel-dinein-link">
                <span className="t">{t('fulfillment.dineinLink')}</span>
                <span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>
              </Link>
              <div className="op-callout">
                <span className="ms" aria-hidden="true">info</span>
                <p>{t('fulfillment.dineinNote')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ══ (D) Save bar — REAL reset / submit ══ */}
        <div className="save-bar">
          <span className={`save-note${activeChannels === 0 ? ' warn' : ''}`}>
            <span className="dot" />
            {t('fulfillment.channelsActive', { count: activeChannels })}
            {dirty && <> · {t('fulfillment.unsaved')}</>}
          </span>
          <button
            type="button"
            className="op-btn-ghost"
            onClick={reset}
            disabled={!dirty || saving}
          >
            {t('fulfillment.cancel')}
          </button>
          <button
            type="button"
            className="op-btn-primary"
            onClick={() => setConfirm(true)}
            disabled={!dirty || activeChannels === 0 || saving}
          >
            <span className="ms" aria-hidden="true">check</span>{t('fulfillment.save')}
          </button>
        </div>
      </div>

      {/* ══ Confirm modal — re-skin of the real confirm flow (submit unchanged) ══ */}
      {confirm && (
        <div
          className="op-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setConfirm(false) }}
        >
          <div className="op-modal" role="dialog" aria-modal="true">
            <div className="op-modal__head">
              <h3>{t('fulfillment.confirmTitle')}</h3>
              <button
                type="button"
                className="op-modal__close"
                onClick={() => !saving && setConfirm(false)}
                disabled={saving}
                aria-label={t('fulfillment.confirmBack')}
              >
                <span className="ms" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              <p>{t('fulfillment.confirmBody')}</p>
            </div>
            <div className="op-modal__foot">
              <button type="button" className="op-btn-ghost" onClick={() => setConfirm(false)} disabled={saving}>
                {t('fulfillment.confirmBack')}
              </button>
              <button type="button" className="op-btn-primary" onClick={submit} disabled={saving}>
                <span className="ms" aria-hidden="true">check</span>{t('fulfillment.confirmApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
