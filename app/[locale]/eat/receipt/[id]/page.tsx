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

// ── /eat/receipt/[id] — reçu post-paiement dine-in (AU ; rendu BC VERBATIM) ────
// SURFACE PRIVÉE (l'API re-juge propriété AVANT statut — un tiers n'apprend
// jamais si l'addition est payée). Rendu = REPRODUCTION VERBATIM de la
// référence archivée scripts/design-qa-refs/eat-receipt.html (écran 3 « Payée »
// de la conception AQ), mesurée par le robot design-qa (écran `eat-receipt`) :
// barre « Mon addition » + pastille de référence · bannière navy (icône orange,
// pastille PAYÉE) · héros pâle au montant NAVY et date nue · sceau · carte
// détail fermée par « Total payé » · méta 4 rangées clé/valeur (mono) ·
// 2 actions · pied « Reçu conservé dans “Mes commandes” ».
//   • amountPaid = référence (jamais recalculé) ; si le total STOCKÉ des lignes
//     diverge (comparé en centimes), les DEUX montants restent affichés sous
//     libellés distincts dans la carte détail.
//   • Décision fondateur (BC) : les mentions « preuve de paiement », « consulté
//     le » et « détail tel qu'au moment du paiement » SORTENT de la page (la
//     référence prime) — ne pas les rétablir sans conception CD mise à jour.
//   • Dates : mois en toutes lettres, Europe/Paris (règle non négociable — la
//     rangée « Payée le » de la référence est tout-numérique : écart ASSUMÉ).
//   • Écart assumé n°2 : le prix unitaire porte un MONTANT → 12,5 px minimum
//     (règle non négociable), là où la référence le rend à 10 px.
//   • RTL : montants/codes isolés en <bdi> (règle 2 gb-rtl), flèches ms-flip.
//     Aucune police ni icône distante AJOUTÉE (Material Symbols locaux ; les
//     polices Gabarito/JetBrains Mono sont déjà chargées app-wide par tokens.css).
//   • Session : fetch gaté sur l'authentification + purge du reçu si la session
//     tombe pendant que la page reste ouverte.

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
  // « Noter ce restaurant » (référence) : l'id resto n'est PAS servi par la
  // route (select étroit, intouchable) — la carte « Mes commandes » le passe en
  // ?r=. Lu post-mount (pas de useSearchParams → pas de Suspense build) et
  // validé strictement (cuid) : sans id valide, la rangée n'apparaît pas —
  // jamais d'action dont le contexte n'est pas vrai.
  const [rateRestoId, setRateRestoId] = useState<string | null>(null)
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('r')
    if (r && /^[a-z0-9]{20,32}$/i.test(r)) setRateRestoId(r)
  }, [])

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
  // pendant que la page reste ouverte, le reçu est PURGÉ.
  useEffect(() => {
    if (authStatus === 'authenticated') load()
  }, [authStatus, load])
  useEffect(() => {
    if (authStatus === 'unauthenticated') { setReceipt(null); setLoading(false) }
  }, [authStatus])

  // Argent = lib/format-money (locale validée, jamais brute vers Intl).
  // 'eur' est la seule devise réelle ; tout autre code — y compris vide — est
  // affiché TEL QUEL après le nombre localisé.
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

  const showSubtotal =
    receipt != null && Math.round(receipt.subtotal * 100) !== Math.round(receipt.amountPaid * 100)

  return (
    <div className="gb gb-receipt">
      {/* Barre de titre (référence .h2bar) : retour · « Mon addition » ·
          pastille de référence (code de session, mono, zest). */}
      <div className="rc-top">
        <button type="button" className="ms ms-flip rc-back" onClick={() => router.back()} aria-label={t('back')}>arrow_back</button>
        <h1>{t('title')}</h1>
        {receipt ? <span className="rc-tnum mono"><bdi>#{receipt.sessionCode}</bdi></span> : null}
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
        <article className="rc-blocks">
          {/* Bannière d'établissement (référence .tbanner). */}
          <header className="rc-banner">
            <span className="rc-banner__ic"><span className="ms" aria-hidden="true">table_restaurant</span></span>
            <div className="rc-banner__id">
              <b>{receipt.restaurantName}</b>
              <span>{receipt.tableName ? t('bannerTable', { name: receipt.tableName }) : t('bannerDinein')}</span>
            </div>
            <span className="rc-banner__pill">{t('paidPill')}</span>
          </header>

          {/* Héros (référence .amt.paid) : dégradé TRÈS PÂLE, label basil,
              montant NAVY (couleur de texte), date NUE en sous-titre. */}
          <div className="rc-hero">
            <span className="rc-hero__label"><span className="ms" aria-hidden="true">check_circle</span>{t('heroLabel')}</span>
            <b className="rc-hero__amount"><bdi>{money(receipt.amountPaid)}</bdi></b>
            <span className="rc-hero__when">{t('heroDate', { date: fmtDate(receipt.paidAt), time: fmtTime(receipt.paidAt) })}</span>
          </div>

          {/* Sceau (référence .stamp). */}
          <div className="rc-seal">
            <span className="rc-seal__ln" />
            <span className="ms" aria-hidden="true">verified</span>
            {t('sealLabel')}
            <span className="rc-seal__ln" />
          </div>

          {/* Carte de détail (référence .ocard) — fermée par « Total payé ».
              amountPaid jamais recalculé ; si le total STOCKÉ des lignes diverge
              (centimes), il s'affiche AUSSI, sous son libellé distinct. */}
          <section className="rc-lines">
            <header className="rc-lines__head">
              <span className="ms" aria-hidden="true">restaurant_menu</span>
              <span className="rc-lines__title">{t('linesLabel')}</span>
              <span className="rc-lines__count mono" aria-label={t('linesCount', { count: receipt.lines.length })}>{receipt.lines.length}</span>
            </header>
            <ul>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  <span className="rc-line__label">
                    <span className="rc-line__qty mono"><bdi>{l.quantity}×</bdi></span> {l.name}
                    <small>{t.rich('unitPrice', { price: money(l.unitPrice), m: (chunks) => <bdi>{chunks}</bdi> })}</small>
                  </span>
                  <span className="rc-line__amount"><bdi>{money(l.unitPrice * l.quantity)}</bdi></span>
                </li>
              ))}
            </ul>
            <div className="rc-lines__div" />
            {showSubtotal ? (
              <div className="rc-total rc-total--sub"><span>{t('linesTotal')}</span><span><bdi>{money(receipt.subtotal)}</bdi></span></div>
            ) : null}
            <div className="rc-total rc-total--paid"><span>{t('amountPaid')}</span><span><bdi>{money(receipt.amountPaid)}</bdi></span></div>
          </section>

          {/* Méta (référence .meta) : 4 rangées clé/valeur, valeurs mono pour la
              date et la référence. La date de paiement reste en toutes lettres
              (règle non négociable — écart assumé vs la référence numérique). */}
          <section className="rc-meta">
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">storefront</span>
              <span className="rc-meta__k">{t('metaRestaurant')}</span>
              <span className="rc-meta__v">{receipt.restaurantName}</span>
            </div>
            {receipt.tableName ? (
              <div className="rc-meta__row">
                <span className="ms" aria-hidden="true">table_restaurant</span>
                <span className="rc-meta__k">{t('metaTable')}</span>
                <span className="rc-meta__v">{receipt.tableName}</span>
              </div>
            ) : null}
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">event</span>
              <span className="rc-meta__k">{t('metaPaidAt')}</span>
              <span className="rc-meta__v mono"><bdi>{t('heroDate', { date: fmtDate(receipt.paidAt), time: fmtTime(receipt.paidAt) })}</bdi></span>
            </div>
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">tag</span>
              <span className="rc-meta__k">{t('metaRef')}</span>
              <span className="rc-meta__v mono"><bdi>#{receipt.sessionCode}</bdi></span>
            </div>
          </section>

          {/* Actions (référence .split-row). « Noter » n'apparaît qu'avec un id
              resto valide (contexte vrai — passé par la carte Mes commandes) ;
              « Un problème » ouvre le canal réel (email de contact) avec la
              référence de l'addition en objet. */}
          {rateRestoId ? (
            <Link href={`/eat/r/${rateRestoId}/reviews`} className="rc-act">
              <span className="ms" aria-hidden="true">star</span>
              <span>{t('rateAction')}</span>
              <span className="ms ms-flip rc-act__chev" aria-hidden="true">chevron_right</span>
            </Link>
          ) : null}
          <a href={`mailto:contact@grubano.com?subject=${encodeURIComponent(t('issueSubject', { code: receipt.sessionCode }))}`} className="rc-act">
            <span className="ms" aria-hidden="true">support_agent</span>
            <span>{t('issueAction')}</span>
            <span className="ms ms-flip rc-act__chev" aria-hidden="true">chevron_right</span>
          </a>

          {/* Pied (référence .foot). */}
          <p className="rc-foot">{t('footNote')}</p>
        </article>
      ) : null}
    </div>
  )
}
