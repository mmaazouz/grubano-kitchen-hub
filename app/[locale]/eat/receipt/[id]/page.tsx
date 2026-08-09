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

// ── /eat/receipt/[id] — reçu post-paiement dine-in (AU ; rendu AW) ─────────────
// SURFACE PRIVÉE (l'API re-juge propriété AVANT statut — un tiers n'apprend
// jamais si l'addition est payée). HTML mobile d'abord, pensé pour la CAPTURE
// D'ÉCRAN. Rendu = la conception AQ en CINQ BLOCS SÉPARÉS (mission AW) :
// bannière d'établissement (navy, pastille verte PAYÉE) · montant en héros
// (dégradé vert — le VERT est l'état acquis, l'ORANGE l'action en cours) ·
// sceau « addition réglée » · carte de détail (compteur + lignes) · méta à
// icônes + mentions discrètes.
//   • amountPaid = référence (jamais recalculé) ; le total STOCKÉ des lignes
//     n'apparaît QUE s'il DIVERGE du montant payé (règle AQ) — alors les deux
//     montants s'affichent sous libellés distincts, aucune explication.
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

  // Adresse SANS ville dupliquée (mission AW). Constat : Restaurant.address est
  // saisi en adresse complète (« 12 Rue de la République, 84100 Orange ») et
  // Restaurant.city la répète (« Orange ») — la concaténation aveugle affichait
  // la ville deux fois. La ville n'est ajoutée QUE si l'adresse ne la porte pas
  // déjà (comparaison insensible à la casse et aux accents) — aucune information
  // n'est perdue : une adresse sans ville garde sa ville, une adresse complète
  // n'est plus doublée. AFFICHAGE seul — la route sert les deux champs tels quels.
  const addressLine = (() => {
    if (!receipt) return null
    const addr = (receipt.address ?? '').trim()
    const city = (receipt.city ?? '').trim()
    if (!addr) return city || null
    if (!city) return addr
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return norm(addr).includes(norm(city)) ? addr : `${addr}, ${city}`
  })()

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
        <article className="rc-blocks">
          {/* ── 1. BANNIÈRE D'ÉTABLISSEMENT (AQ) — navy en dégradé (token panel-ink
              existant), icône table locale, nom, « Sur place · Table X », pastille
              verte PAYÉE. L'ancrage : où on est, dans quel état. Données ACTUELLES
              (mention datée en pied, inchangée). */}
          <header className="rc-banner">
            <span className="ms rc-banner__ic" aria-hidden="true">table_restaurant</span>
            <div className="rc-banner__id">
              <b>{receipt.restaurantName}</b>
              <span>{receipt.tableName ? t('bannerTable', { name: receipt.tableName }) : t('bannerDinein')}</span>
            </div>
            <span className="rc-banner__pill">{t('paidPill')}</span>
          </header>

          {/* ── 2. MONTANT EN HÉROS (AQ) — dégradé VERT (état acquis — l'orange est
              réservé à l'addition EN COURS), label au-dessus en petites capitales,
              somme dominante, date-heure du PAIEMENT en sous-titre discret.
              amountPaid servi par l'API, jamais recalculé. */}
          <div className="rc-hero">
            <span className="rc-hero__label">{t('heroLabel')}</span>
            <b className="rc-hero__amount"><bdi>{money(receipt.amountPaid)}</bdi></b>
            <span className="rc-hero__when">{t('paidLine', { date: fmtDate(receipt.paidAt), time: fmtTime(receipt.paidAt) })}</span>
          </div>

          {/* ── 3. SCEAU (AQ) — « ─── ✓ addition réglée ─── », filets en CSS. */}
          <div className="rc-seal">
            <span className="ms" aria-hidden="true">check</span>{t('sealLabel')}
          </div>

          {/* ── 4. CARTE DE DÉTAIL (AQ) — en-tête icône + titre + COMPTEUR, puis les
              lignes : quantité en accent, nom, prix unitaire en sous-ligne, prix de
              ligne à droite. Lignes GELÉES au paiement (instantané historique). */}
          <section className="rc-lines">
            <header className="rc-lines__head">
              <span className="ms" aria-hidden="true">receipt_long</span>
              <span className="rc-lines__title">{t('linesLabel')}</span>
              <span className="rc-lines__count">{t('linesCount', { count: receipt.lines.length })}</span>
            </header>
            <ul>
              {receipt.lines.map((l, i) => (
                <li key={i}>
                  <span className="rc-line__qty">{l.quantity}×</span>
                  <span className="rc-line__label">
                    {l.name}
                    <small>{t.rich('unitPrice', { price: money(l.unitPrice), m: (chunks) => <bdi>{chunks}</bdi> })}</small>
                  </span>
                  <span className="rc-line__amount"><bdi>{money(l.unitPrice * l.quantity)}</bdi></span>
                </li>
              ))}
            </ul>
            {/* Règle AQ : « Total des consommations » n'apparaît QUE s'il DIVERGE du
                montant payé — égaux, le héros suffit et rien n'est répété. Les deux
                montants restent sous libellés distincts, jamais d'explication ;
                amountPaid reste la référence, jamais recalculé. */}
            {receipt.subtotal !== receipt.amountPaid ? (
              <div className="rc-totals">
                <div className="rc-total"><span>{t('linesTotal')}</span><span><bdi>{money(receipt.subtotal)}</bdi></span></div>
                <div className="rc-total rc-total--paid"><span>{t('amountPaid')}</span><b><bdi>{money(receipt.amountPaid)}</bdi></b></div>
              </div>
            ) : null}
          </section>

          {/* ── 5. LIGNES DE MÉTA à icônes (AQ), puis mentions de bas de carte. */}
          <footer className="rc-meta">
            {addressLine ? (
              <div className="rc-meta__row"><span className="ms" aria-hidden="true">location_on</span><span>{addressLine}</span></div>
            ) : null}
            {receipt.officialName ? (
              <div className="rc-meta__row"><span className="ms" aria-hidden="true">storefront</span><span>{t('officialName', { name: receipt.officialName })}</span></div>
            ) : null}
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">confirmation_number</span>
              {/* Ponctuation dans la clé ; code isolé LTR + gras via le tag <c>. */}
              <span>{t.rich('sessionLabel', { code: receipt.sessionCode, c: (chunks) => <b><bdi>{chunks}</bdi></b> })}</span>
            </div>
            <div className="rc-foot">
              {/* Clause de NATURE + mention de consultation — RESTAURÉES par revue
                  adversariale : elles restent, discrètes, jamais retirées. */}
              <p className="rc-nature">{t('disclaimer')}</p>
              <p>{t('editedLine', { date: fmtDate(new Date().toISOString()) })}</p>
              <span className="rc-brand">Grubano</span>
            </div>
          </footer>
        </article>
      ) : null}
    </div>
  )
}
