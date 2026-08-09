'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import './receipt.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/receipt/[id] — Mission AU : reçu post-paiement dine-in ────────────────
// SURFACE PRIVÉE (l'API re-juge propriété AVANT statut — un tiers n'apprend
// jamais si l'addition est payée). HTML mobile d'abord, pensé pour la CAPTURE
// D'ÉCRAN : une seule colonne, tout le reçu tient dans une carte contrastée.
// Hiérarchie AQ : établissement · table · date-heure du PAIEMENT · détail des
// consommations · quantités · prix unitaires · montant payé · devise ·
// « Session / réservation ».
//   • amountPaid = référence (jamais recalculé) ; le total STOCKÉ des lignes est
//     affiché sous un libellé DISTINCT — toujours les deux, aucune explication.
//   • Paiement = HISTORIQUE (« Addition réglée le … », fuseau Europe/Paris comme
//     les documents du projet) ; coordonnées = ACTUELLES, avec date de
//     consultation distincte + mention (conception AQ).
//   • Aucune police externe, aucune icône distante (Material Symbols locaux).

interface ReceiptData {
  paidAt: string
  amountPaid: number
  subtotal: number
  currency: string
  lines: Array<{ name: string; unitPrice: number; quantity: number }>
  sessionCode: string
  restaurantName: string
  officialName: string | null
  address: string | null
  city: string | null
  tableName: string | null
}

const PARIS = 'Europe/Paris'

export default function DineinReceiptScreen() {
  const t = useTranslations('eat.receipt')
  const locale = useLocale()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/eat/tickets/${id}/receipt`)
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.receipt) {
        // Message SERVEUR affiché tel quel quand il existe (règle projet).
        setError((body?.error as string) || t('loadError'))
        return
      }
      setReceipt(body.receipt as ReceiptData)
    } catch {
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  useEffect(() => { load() }, [load])

  const intlLocale = locale === 'ar' ? 'ar-MA' : locale
  const money = (n: number) => {
    try {
      return new Intl.NumberFormat(intlLocale, {
        style: 'currency', currency: (receipt?.currency || 'eur').toUpperCase(),
      }).format(n)
    } catch {
      // Devise inattendue en base : montant + code affiché tel quel, jamais inventé.
      return `${n.toFixed(2)} ${(receipt?.currency ?? '').toUpperCase()}`
    }
  }
  // Paiement HISTORIQUE — fuseau des documents du projet (Europe/Paris).
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, { timeZone: PARIS, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  return (
    <div className="gb gb-receipt">
      <div className="rc-top">
        <button type="button" className="ms rc-back" onClick={() => router.back()} aria-label={t('back')}>arrow_back</button>
        <h1>{t('title')}</h1>
      </div>

      {loading ? (
        <div className="rc-skel" aria-hidden="true" />
      ) : error ? (
        <div className="rc-error" role="alert">
          <p>{error}</p>
          <button type="button" className="gb-btn gb-btn--ghost" onClick={load}>{t('retry')}</button>
        </div>
      ) : receipt ? (
        <article className="rc-card">
          {/* Établissement + table — données ACTUELLES (mention datée en pied). */}
          <header className="rc-estab">
            <b>{receipt.restaurantName}</b>
            {receipt.officialName ? <span className="rc-muted">{t('officialName', { name: receipt.officialName })}</span> : null}
            {(receipt.address || receipt.city) ? (
              <span className="rc-muted">{[receipt.address, receipt.city].filter(Boolean).join(', ')}</span>
            ) : null}
            {receipt.tableName ? <span className="rc-muted">{t('table', { name: receipt.tableName })}</span> : null}
          </header>

          {/* Bloc dominant — date-heure du PAIEMENT (historique) + montant payé. */}
          <div className="rc-paid">
            <span className="rc-paid__when">{t('paidLine', { date: fmtDate(receipt.paidAt), time: fmtTime(receipt.paidAt) })}</span>
            <span className="rc-paid__amount">{money(receipt.amountPaid)}</span>
          </div>

          <div className="rc-session">{t('sessionLabel')} : <b>{receipt.sessionCode}</b></div>

          {/* Détail des consommations — instantané historique (lignes gelées). */}
          <div className="rc-lines">
            <span className="rc-lines__head">{t('linesLabel')}</span>
            <ul>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  <span className="rc-line__label">{l.quantity} × {l.name} <small>{t('unitPrice', { price: money(l.unitPrice) })}</small></span>
                  <span className="rc-line__amount">{money(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Les DEUX montants, libellés distincts — jamais d'explication.
              amountPaid est la référence servie par l'API, jamais recalculé. */}
          <div className="rc-totals">
            <div className="rc-total"><span>{t('linesTotal')}</span><span>{money(receipt.subtotal)}</span></div>
            <div className="rc-total rc-total--paid"><span>{t('amountPaid')}</span><b>{money(receipt.amountPaid)}</b></div>
          </div>

          <footer className="rc-foot">
            <p>{t('editedLine', { date: fmtDate(new Date().toISOString()) })}</p>
            <span className="rc-brand">Grubano</span>
          </footer>
        </article>
      ) : null}
    </div>
  )
}
