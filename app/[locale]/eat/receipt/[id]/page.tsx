'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatEuros, formatAmount } from '@/lib/format-money'
import { sessionCartStamp } from '@/lib/eat-cart'
import { receiptAddressLines } from '@/lib/receipt-address'
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
// détail fermée par « Total payé » · méta 5 rangées clé/valeur (mono) ·
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
  const { data: session, status: authStatus } = useSession()

  // ── OWNER + TICKET, RESOLVED DURING RENDER ───────────────────────────────────
  // A receipt is private to a PAIR: the account that paid, and the ticket. The identity
  // comes from the primitive the other consumer screens already use — no second,
  // divergent definition — and it is read in the same render as the session, because an
  // effect runs after the frame that has already painted the previous account's document.
  // `u:<id>` is the only owner a receipt can have: `guest` has none, and null means the
  // identity is unresolved or unusable. Both fail closed.
  const liveUserId = (session?.user as { id?: string } | undefined)?.id
  const liveStamp = sessionCartStamp(authStatus, liveUserId)
  const scopeOk = liveStamp !== null && liveStamp !== 'guest'

  /** RAW — read only through the derivations below. Carries the pair it was fetched for,
   *  and its own loading/error, because an error obtained under A must not be shown to B
   *  any more than a document would be. */
  const [receiptState, setReceiptState] = useState<{
    owner: string | null
    ticketId: string | null
    receipt: ReceiptData | null
    error: string
    loading: boolean
  }>({ owner: null, ticketId: null, receipt: null, error: '', loading: true })

  /** Does a stamped piece of state belong to THIS render's pair? */
  const inScope = (st: { owner: string | null; ticketId: string | null }) =>
    scopeOk && st.owner === liveStamp && st.ticketId === id

  /** THE ONLY receipt this screen may read. Every private field below goes through it. */
  const receipt = inScope(receiptState) ? receiptState.receipt : null
  /** An error belongs to the pair that obtained it. A 403 that B really got for A's ticket
   *  is B's own answer and is shown; an error inherited from A is not. */
  const error = inScope(receiptState) ? receiptState.error : ''
  /** Out of scope we have no answer for this pair YET, which is a loading state and not an
   *  empty one — showing a blank receipt or a stale error would both be false. */
  const loading = inScope(receiptState) ? receiptState.loading : true
  // « Noter ce restaurant » (référence) : l'id du restaurant n'est PAS servi par
  // la route du reçu (select étroit, intouchable). Il est retrouvé par une
  // lecture SERVEUR de MES commandes — GET /api/eat/orders, session-gatée, qui
  // ne renvoie que les cartes du porteur du jeton : celle dont l'id est CE
  // ticket porte le restaurantId. JAMAIS un paramètre d'URL (revue BC : un ?r=
  // falsifié aurait affiché « Noter » sous ce reçu et publié un VRAI avis chez
  // un autre restaurant — la destination poste réellement). Best-effort : pas
  // de correspondance ⇒ la rangée n'apparaît pas, jamais d'action dont le
  // contexte n'est pas vrai.
  /** RAW — read only through `rateRestoId` below. Scoped to the same pair: the link posts
   *  a REAL review, so a restaurant found for A must not be offered to B. */
  const [rateState, setRateState] = useState<{
    owner: string | null
    ticketId: string | null
    restoId: string | null
  }>({ owner: null, ticketId: null, restoId: null })
  /** THE ONLY restaurant id this screen may link to. */
  const rateRestoId = inScope(rateState) ? rateState.restoId : null

  useEffect(() => {
    if (!scopeOk || !id) { setRateState({ owner: null, ticketId: null, restoId: null }); return }
    // Captured BEFORE the request leaves; the response is stamped with THESE, never with
    // whatever the session or the URL has become by the time it resolves.
    const requestOwner = liveStamp
    const requestTicketId = id
    let alive = true
    setRateState({ owner: requestOwner, ticketId: requestTicketId, restoId: null })
    fetch('/api/eat/orders')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return
        const cards = [...(d.current ?? []), ...(d.past ?? [])] as Array<{ id?: string; kind?: string; restaurantId?: string }>
        const mine = cards.find((c) => c?.kind === 'dinein' && c?.id === requestTicketId)
        if (mine?.restaurantId) setRateState({ owner: requestOwner, ticketId: requestTicketId, restoId: mine.restaurantId })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [liveStamp, scopeOk, id])

  /** The retry button bumps this; it cannot carry a scope of its own. See `retry` below. */
  const [retryTick, setRetryTick] = useState(0)

  // Fetch keyed on the PAIR. `authStatus` alone could not see A -> logout -> B login (it
  // begins and ends at 'authenticated' and the ticket does not change), so nothing refetched
  // and the previous account's document simply stayed.
  useEffect(() => {
    if (!scopeOk || !id) {
      // No usable identity: hold nothing, ask nothing, and do not pretend to be loading.
      setReceiptState({ owner: null, ticketId: null, receipt: null, error: '', loading: false })
      return
    }
    // Captured BEFORE the request leaves. The response is stamped with these two values and
    // never with the identity at response time.
    const requestOwner = liveStamp
    const requestTicketId = id
    let alive = true
    // Stamped for the new pair immediately, so the previous account's document is dropped
    // rather than merely hidden, and this pair reads as loading until its own answer lands.
    setReceiptState({ owner: requestOwner, ticketId: requestTicketId, receipt: null, error: '', loading: true })
    ;(async () => {
      try {
        const res = await fetch(`/api/eat/tickets/${encodeURIComponent(requestTicketId)}/receipt`)
        const body = await res.json().catch(() => null)
        if (!alive) return
        if (!res.ok || !body?.receipt) {
          // Message SERVEUR affiché tel quel quand il existe (règle projet). It is stamped,
          // so a 403 B really received for this ticket is shown to B — and an error A
          // received is never shown to anyone else.
          setReceiptState({
            owner: requestOwner, ticketId: requestTicketId, receipt: null,
            error: (body?.error as string) || t('loadError'), loading: false,
          })
          return
        }
        setReceiptState({
          owner: requestOwner, ticketId: requestTicketId,
          receipt: body.receipt as ReceiptData, error: '', loading: false,
        })
      } catch {
        if (!alive) return
        setReceiptState({
          owner: requestOwner, ticketId: requestTicketId, receipt: null,
          error: t('loadError'), loading: false,
        })
      }
    })()
    return () => { alive = false }
    // WHAT GUARANTEES SAFETY HERE. React flushes passive effects after paint, so a response
    // for A can land between the commit of the B render and this cleanup, with `alive` still
    // true, and commit a state stamped for A. That is harmless, and it is harmless because
    // of the STAMP and the render-time gate above — never because the cleanup got there
    // first. The cleanup's narrower job is to stop a late response for A from CLOBBERING a
    // state already committed for B.
  }, [liveStamp, scopeOk, id, retryTick, t])

  /** Retry. It takes no scope from the frame that rendered it: it only bumps a counter, and
   *  the effect above re-issues the request with the CURRENT identity and ticket. So a
   *  handler captured under A, clicked after the session became B, cannot fetch as A — the
   *  worst it can do is make B's own request happen again. */
  const retry = () => setRetryTick((n) => n + 1)

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

  // ── Adresse sur DEUX lignes (référence BF) ───────────────────────────────────
  // Restaurant.address (voie) et .city sont NOT NULL au schéma : la rangée est
  // INCONDITIONNELLE — le bloc méta garde une hauteur stable, comme la référence
  // l'exige. La découpe vit dans lib/receipt-address (fonction pure, exercée
  // telle quelle par les tests). AFFICHAGE seul : la route sert les deux champs
  // tels quels (diff vide).
  const addressLines = receiptAddressLines(receipt?.address ?? null, receipt?.city ?? null)

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
          <button type="button" className="gb-btn gb-btn--ghost" onClick={retry}>{t('retry')}</button>
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

          {/* Méta (référence .meta) : CINQ rangées clé/valeur dans l'ordre de la
              référence — Restaurant · Adresse · Table · Payée le · Référence.
              L'adresse suit immédiatement le nom : nom commercial et adresse
              forment un bloc d'identité continu que « Table » ne coupe pas.
              AUCUNE rangée conditionnelle (hauteur stable) : les trois champs
              sont NOT NULL au schéma. AUCUNE raison sociale — retirée de la
              conception par décision du fondateur, aucun repli prévu. Valeurs
              mono pour la date et la référence ; la date de paiement reste en
              toutes lettres (règle non négociable — écart assumé vs la
              référence numérique). */}
          <section className="rc-meta">
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">storefront</span>
              <span className="rc-meta__k">{t('metaRestaurant')}</span>
              <span className="rc-meta__v">{receipt.restaurantName}</span>
            </div>
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">place</span>
              <span className="rc-meta__k">{t('metaAddress')}</span>
              <span className="rc-meta__v rc-meta__v--addr">
                {addressLines.map((line, i) => (
                  <span key={i} className="rc-addr__l">{line}</span>
                ))}
              </span>
            </div>
            <div className="rc-meta__row">
              <span className="ms" aria-hidden="true">table_restaurant</span>
              <span className="rc-meta__k">{t('metaTable')}</span>
              <span className="rc-meta__v">{receipt.tableName}</span>
            </div>
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
