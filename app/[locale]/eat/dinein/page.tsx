'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import './dinein.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/* ─────────────────────────────────────────────────────────────────────────────
 * /eat/dinein — « Order at table / dine-in » — VERBATIM reproduction of the FROZEN
 * CD ref (Notion 38efd2c9-…-cd8b, file eat/order-at-table.html). A NEW FUTURE-FEATURE
 * INERT demo flow of 3 in-context screens (A · menu à table · light, B · commande →
 * cuisine · light, C · statut « envoyé » · DARK). The 4th CD screen — the cumulative
 * « addition » bill — is ALREADY built at the REAL /t/[tableId] money page and is NOT
 * rebuilt here (that page is left BYTE-IDENTICAL).
 *
 * ⚠️⚠️ FULLY VISUAL / INERT — there is NO dine-in order model, NO QR/table session, NO
 * kitchen routing/KDS, NO « Service 10 % » / commission / split / pay-later backend
 * (per the App-conso index: « build futur, hors scope migration actuelle »). Every
 * amount (32 €, 35,20 €, Service 10 %), the table (« Table 12 / Marco »), the live
 * status and the AI/allergen blocks are CD DEMO PLACEHOLDERS framed as a PREVIEW — they
 * are NEVER wired to real data, NEVER charge, NEVER create an order. All controls are
 * inert: the «add», «cart bar», «send to kitchen», «split», «pay» targets only step
 * between the demo screens (or are plain inert buttons). A `.di-preview` banner makes
 * the demo nature explicit on screen.
 *
 * The 3 screens are selected by a `?step=` query param (menu | send | sent) so the demo
 * is one self-contained route that never collides with the real /t/[tableId]. gb-* tokens
 * + Material Symbols (NOT lucide). CSS scoped under `.gb-dinein` (dinein.css).
 * ───────────────────────────────────────────────────────────────────────────── */

type Step = 'menu' | 'send' | 'sent'

function DineInDemo() {
  const t = useTranslations('eat.dineIn')
  const params = useSearchParams()
  const raw = params.get('step')
  const step: Step = raw === 'send' ? 'send' : raw === 'sent' ? 'sent' : 'menu'

  // Inert demo placeholders — CD verbatim values, framed as a preview (never real money).
  const tableBanner = (
    <div className="tbanner">
      <span className="ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
      <div className="m">
        <b>Mama Trattoria</b>
        <span>{t('tableMeta')}</span>
      </div>
      <span className="live">{t('live')}</span>
    </div>
  )

  const previewBanner = (
    <div className="di-preview" role="note">
      <span className="ms" aria-hidden="true">science</span>
      {t('previewNote')}
    </div>
  )

  // ── A) MENU À TABLE (light) ───────────────────────────────────────────────
  if (step === 'menu') {
    return (
      <div className="gb gb-dinein" data-theme="light">
        {tableBanner}
        {previewBanner}
        <div className="di-body">
          <div className="chips" role="group" aria-label={t('filtersLabel')}>
            <button type="button" className="di-chip on">{t('chipPopular')}</button>
            <button type="button" className="di-chip off">{t('chipPasta')}</button>
            <button type="button" className="di-chip off">{t('chipPizza')}</button>
            <button type="button" className="di-chip diet"><span className="ms" aria-hidden="true">eco</span>{t('chipNoNuts')}</button>
          </div>

          <div className="di-ai">
            <div className="di-ai__in">
              <span className="ms" aria-hidden="true">auto_awesome</span>
              <p><b>{t('aiLabel')}</b> {t('aiBody')}<span className="soon">{t('soon')}</span></p>
            </div>
          </div>

          <div className="di-mi">
            <div className="t">
              <b>{t('dish1Name')}</b>
              <p>{t('dish1Desc')}</p>
              <div className="pr"><span className="price"><bdi>18 €</bdi></span><span className="nf">{t('noNutsTag')}</span></div>
            </div>
            <div className="img o">
              <button type="button" className="di-add" aria-label={t('addToTable')}><span className="ms" aria-hidden="true">add</span></button>
            </div>
          </div>

          <div className="di-mi">
            <div className="t">
              <b>{t('dish2Name')}</b>
              <p>{t('dish2Desc')}</p>
              <div className="pr"><span className="price"><bdi>14 €</bdi></span></div>
            </div>
            <div className="img y">
              <button type="button" className="di-add" aria-label={t('addToTable')}><span className="ms" aria-hidden="true">add</span></button>
            </div>
          </div>
        </div>

        <div className="di-foot">
          <Link href="/eat/dinein?step=send" className="di-cartbar">
            <span>{t('viewOrder')} · 2</span>
            <b><bdi>32 €</bdi></b>
          </Link>
        </div>
      </div>
    )
  }

  // ── B) COMMANDE → CUISINE (light) ─────────────────────────────────────────
  if (step === 'send') {
    return (
      <div className="gb gb-dinein" data-theme="light">
        <div className="h2bar">
          <Link href="/eat/dinein?step=menu" className="back" aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </Link>
          <h2>{t('yourOrder')}</h2>
          <span className="tnum">{t('tableShort')}</span>
        </div>
        {previewBanner}
        <div className="di-body">
          <div className="di-ocard">
            <div className="di-oline"><span>{t('dish1Name')}</span><span><bdi>18 €</bdi></span></div>
            <div className="di-oline"><span>{t('dish2Name')}</span><span><bdi>14 €</bdi></span></div>
          </div>

          <div className="note-g">
            <span className="ms" aria-hidden="true">soup_kitchen</span>
            <p>{t('kitchenNote')}</p>
          </div>

          <button type="button" className="split-row">
            <span className="ms" aria-hidden="true">group</span>
            <span>{t('shareBill')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>

          <div className="totrow"><span>{t('subtotal')}</span><span><bdi>32,00 €</bdi></span></div>
          <div className="totrow"><span>{t('service')}</span><span><bdi>3,20 €</bdi></span></div>
        </div>

        <div className="di-foot">
          <Link href="/eat/dinein?step=sent" className="send-btn">
            <span className="ms" aria-hidden="true">soup_kitchen</span>
            <b>{t('sendToKitchenAmount')}</b>
          </Link>
          <small>{t('payNowOrLater')}</small>
        </div>
      </div>
    )
  }

  // ── C) STATUT « ENVOYÉ » (DARK) ───────────────────────────────────────────
  return (
    <div className="gb gb-dinein" data-theme="dark">
      {previewBanner}
      <div className="sent">
        <div className="sent__ic"><span className="ms" aria-hidden="true">soup_kitchen</span></div>
        <h2>{t('sentTitle')}</h2>
        <p>{t.rich('sentBody', { b: (c) => <b>{c}</b> })}</p>

        <div className="di-track" role="img" aria-label={t('statusPreparing')}>
          <div className="row">
            <span className="d done"><span className="ms" aria-hidden="true">check</span></span>
            <span className="s done" />
            <span className="d cur" />
            <span className="s off" />
            <span className="d off" />
          </div>
          <div className="lab">
            <span>{t('stepSent')}</span>
            <span className="on">{t('stepPreparing')}</span>
            <span>{t('stepServed')}</span>
          </div>
        </div>

        <div className="di-acts">
          <Link href="/eat/dinein?step=menu" className="w">{t('addMoreDishes')}</Link>
          <button type="button" className="o">{t('payAmount')}</button>
        </div>
      </div>
    </div>
  )
}

export default function DineInPage() {
  return (
    <Suspense fallback={<div className="gb gb-dinein"><div className="di-body"><div className="sk di-skel" /><div className="sk di-skel" /></div></div>}>
      <DineInDemo />
    </Suspense>
  )
}
