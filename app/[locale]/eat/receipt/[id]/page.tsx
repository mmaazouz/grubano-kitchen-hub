'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatEuros, formatAmount } from '@/lib/format-money'
import './receipt.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/receipt/[id] — Mission AU : reçu post-paiement dine-in ────────────────
// SURFACE PRIVÉE (l'API re-juge propriété AVANT statut — un tiers n'apprend
// jamais si l'addition est payée). HTML mobile d'abord, pensé pour la CAPTURE
// D'ÉCRAN : tout le reçu — clause de nature comprise — tient dans une carte.
// Hiérarchie AQ : établissement · table · date-heure du PAIEMENT · détail des
// consommations · quantités · prix unitaires · montant payé · devise ·
// « Session / réservation ».
//   • amountPaid = référence (jamais recalculé) ; le total STOCKÉ des lignes est
//     affiché sous un libellé DISTINCT — toujours les deux, aucune explication.
//   • Paiement = HISTORIQUE (« Addition réglée le … », Europe/Paris, mois en
//     toutes lettres — jamais de date tout-numérique ambiguë en anglais) ;
//     coordonnées = ACTUELLES, date de consultation distincte + mention (AQ).
//   • Argent : lib/format-money (source de vérité EUR, locale validée) ; devise
//     inattendue → nombre localisé + code TEL QUEL, jamais substitué.
//   • RTL : montants isolés en <bdi> (règle 2 gb-rtl), flèche retour ms-flip
//     (règle 3). Aucune police externe, aucune icône distante.
//   • Session : fetch gaté sur l'authentification (patron /eat/orders) + purge
//     du reçu si la session tombe pendant que la page reste ouverte.

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
  const { status: authStatus } = useSession()

  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/eat/tickets/${encodeURIComponent(id)}/receipt`)
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

  // Fetch gaté sur la session (patron /eat/orders) ; si la session tombe
  // pendant que la page reste ouverte (elle est faite pour ça — capture),
  // le reçu est PURGÉ : jamais un reçu affiché sans session valide.
  useEffect(() => {
    if (authStatus === 'authenticated') load()
  }, [authStatus, load])
  useEffect(() => {
    if (authStatus === 'unauthenticated') { setReceipt(null); setLoading(false) }
  }, [authStatus])

  // Argent = lib/format-money (locale validée, jamais brute vers Intl).
  // 'eur' est la seule devise réelle (défaut schéma) ; tout autre code —
  // y compris vide — est affiché TEL QUEL après le nombre localisé.
  const money = (n: number) => {
    const cur = (receipt?.currency ?? '').trim().toLowerCase()
    if (cur === 'eur') return formatEuros(n, locale)
    return `${formatAmount(n, locale)} ${cur.toUpperCase()}`.trim()
  }
  // Paiement HISTORIQUE — fuseau des documents du projet (Europe/Paris), mois en
  // toutes lettres (une date 03/01 se lit différemment à Londres et à Lyon).
  const intlLocale = locale === 'ar' ? 'ar-MA' : locale
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, { timeZone: PARIS, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

  return (
    <div className="gb gb-receipt">
      <div className="rc-top">
        <button type="button" className="ms ms-flip rc-back" onClick={() => router.back()} aria-label={t('back')}>arrow_back</button>
        <h1>{t('title')}</h1>
      </div>

      {authStatus === 'unauthenticated' ? (
        <div className="rc-error" role="alert">
          <p>{t('signIn')}</p>
          <Link href="/eat/auth" className="gb-btn gb-btn--ghost">{t('signInCta')}</Link>
        </div>
      ) : loading || authStatus === 'loading' ? (
        <div className="rc-skel" role="status" aria-label={t('title')} />
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
            <span className="rc-paid__amount"><bdi>{money(receipt.amountPaid)}</bdi></span>
          </div>

          {/* Ponctuation dans la clé (localisée) ; code isolé LTR + gras via le
              tag <c> du message (t.rich n'accepte que des valeurs scalaires). */}
          <div className="rc-session">
            {t.rich('sessionLabel', { code: receipt.sessionCode, c: (chunks) => <b><bdi>{chunks}</bdi></b> })}
          </div>

          {/* Détail des consommations — instantané historique (lignes gelées). */}
          <div className="rc-lines">
            <span className="rc-lines__head">{t('linesLabel')}</span>
            <ul>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  <span className="rc-line__label">
                    {l.quantity} × {l.name}{' '}
                    <small>{t.rich('unitPrice', { price: money(l.unitPrice), m: (chunks) => <bdi>{chunks}</bdi> })}</small>
                  </span>
                  <span className="rc-line__amount"><bdi>{money(l.unitPrice * l.quantity)}</bdi></span>
                </li>
              ))}
            </ul>
          </div>

          {/* Les DEUX montants, libellés distincts — jamais d'explication.
              amountPaid est la référence servie par l'API, jamais recalculé. */}
          <div className="rc-totals">
            <div className="rc-total"><span>{t('linesTotal')}</span><span><bdi>{money(receipt.subtotal)}</bdi></span></div>
            <div className="rc-total rc-total--paid"><span>{t('amountPaid')}</span><b><bdi>{money(receipt.amountPaid)}</bdi></b></div>
          </div>

          <footer className="rc-foot">
            {/* Clause de NATURE (héritée du PDF — une capture doit la porter). */}
            <p className="rc-nature">{t('disclaimer')}</p>
            <p>{t('editedLine', { date: fmtDate(new Date().toISOString()) })}</p>
            <span className="rc-brand">Grubano</span>
          </footer>
        </article>
      ) : null}
    </div>
  )
}
