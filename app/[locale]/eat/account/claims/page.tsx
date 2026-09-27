'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import { ACCEPTED_REASONS } from '@/lib/claim-reasons'
import { showToast } from '@/lib/eat-cart'
// gb-foundation FIRST: gb-tokens.css opens with `@import …Material+Symbols…`, valid
// only when it is the route stylesheet's first rule — keep it before page CSS so the
// `.ms` icon ligatures don't fall back to raw text.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import './claims.css'

// /eat/account/claims — « Mes réclamations » (consumer, D′ L9 / T-45). The customer's own
// claim history: until this page existed, a claim could only be seen from the order it was
// filed on, so a customer who had filed one had nowhere to read what became of it.
//
// There is NO frozen CD ref for this screen. It is built in the idiom of its sibling account
// sub-page « Mes adresses » (same page frame, own `.page__head` back arrow — this route is NOT
// in EatShell's IMMERSIVE list, so the shell keeps its chrome and this page supplies the
// in-page header, exactly like /eat/account/addresses). Material Symbols, --gb-* tokens,
// design CSS in claims.css.
//
// REAL DATA ONLY, read-only: GET /api/claims with no query returns { enabled, claims }, where
// each card is the server's `ConsumerClaimCard` (lib/claims). Nothing here is computed from a
// number — in particular this page NEVER writes « Remboursée » itself: the only sentence that
// says money came back is `claims.status.*`, derived server-side from Stripe-proven facts
// (F03/F04). The card's amounts are what was ASKED FOR and what Grubano APPROVED, which are
// claim figures, not settlement figures, and they are labelled as such.
//
// FAIL-CLOSED, like the help page's refund view: `state` starts at 'loading' and any answer
// that is not an explicit `{ enabled: true }` (the kill-switch closed, a non-2xx, a throw, a
// body we cannot read) lands on the human-support fallback with the SAME copy the help page
// uses for that case (`eat.help.refundOffTitle` / `refundOffBody`). An empty list is only ever
// rendered when the surface answered « open » and sent zero claims — a closed or unreadable
// surface must never read as « you have never filed anything ».

/** The server's ConsumerClaimCard, as JSON (Date → ISO string). */
interface ClaimCard {
  id: string
  orderRef: string
  orderId: string
  restaurantName: string | null
  createdAt: string
  reason: string | null
  requestedAmountCents: number | null
  /** Non-null ONLY when Grubano approved a DIFFERENT amount than the one requested. */
  approvedAmountCents: number | null
  status: string
  canContest: boolean
  decidedAt: string | null
  restaurantResponseReason: string | null
  arbitrationReason: string | null
  /** null = the scope was not recorded (legacy). NEVER read as « toute la commande ». */
  selectionSummary: { mode: 'lines' | 'whole' | 'amount'; lines: number; items: number } | null
}

type LoadState = 'loading' | 'off' | 'on'

/**
 * The tone of the status pill. It may never say more than the WORDING does: `refund_unconfirmed`
 * and `financial_verification` are admissions that we cannot prove where the money is, so they get
 * the neutral grey and never the green of a settled refund.
 */
const STATUS_TONE: Record<string, 'wait' | 'go' | 'done' | 'no' | 'check'> = {
  restaurant_review:      'wait',
  arbitration:            'wait',
  approved:               'wait',
  refunding:              'go',
  refunded:               'done',
  refused:                'no',
  refused_final:          'no',
  refused_by_grubano:     'no',
  closed_by_support:      'check',
  refund_unconfirmed:     'check',
  financial_verification: 'check',
}
const STATUS_ICON: Record<string, string> = {
  wait: 'hourglass_top', go: 'sync', done: 'check_circle', no: 'do_not_disturb_on', check: 'help',
}
/**
 * `customerClaimStatus` has a closed vocabulary (CUSTOMER_STATUSES) and the copy contract pins its
 * 11 keys in all five locales, so a token outside this map means the two sides disagree. It degrades
 * to `financial_verification` — the server's OWN fail-closed value, « votre demande nécessite une
 * vérification manuelle » — rather than printing a key path on a customer's screen or, worse,
 * guessing a positive label.
 */
const statusKey = (s: string) => (STATUS_TONE[s] ? s : 'financial_verification')

/**
 * The reason KEY is rendered through the frozen claims vocabulary (`claims.reason.*`), the same one
 * ClaimSection offers at filing time — never the raw key. The renderable set is ACCEPTED_REASONS
 * (canonical + the legacy aliases, all of which have copy) plus the SYSTEM reason a cancelled paid
 * order raises, which is not customer-selectable but IS shown here because the customer owns that
 * claim. Anything else, and a null reason, read as « non enregistré ».
 */
const SYSTEM_REASON = 'system_order_cancelled'
const RENDERABLE_REASONS: readonly string[] = [...ACCEPTED_REASONS, SYSTEM_REASON]

export default function ClaimsPage() {
  const t = useTranslations('eat.claims')
  // The kill-switch copy is the help page's, verbatim — one sentence about refunds during the beta,
  // in one place. The sign-in prompt is the profile page's, likewise.
  const th = useTranslations('eat.help')
  const ta = useTranslations('eat.account')
  const locale = useLocale()
  const router = useRouter()
  const { status: sessionStatus } = useSession()

  const [state, setState] = useState<LoadState>('loading')
  const [claims, setClaims] = useState<ClaimCard[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/claims', { headers: { accept: 'application/json' } })
      const data = res.ok ? await res.json().catch(() => null) : null
      if (data?.enabled === true && Array.isArray(data.claims)) {
        setClaims(data.claims as ClaimCard[])
        setState('on')
        return
      }
    } catch { /* fall through: an unreachable surface is a CLOSED surface, never an empty history */ }
    setClaims([])
    setState('off')
  }, [])

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return
    load()
  }, [sessionStatus, load])

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(iso))

  // A claim history is personal: a guest has nothing to show and nothing to be told about.
  const loadingShell = sessionStatus === 'loading' || (sessionStatus === 'authenticated' && state === 'loading')

  return (
    <div className="gb gb-claims">
      <div className="page__head">
        <button type="button" className="back" onClick={() => router.back()} aria-label={th('back')}>
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
        <h1>{t('title')}</h1>
      </div>

      <div className="page__body">
        {loadingShell && [0, 1].map((i) => <div key={i} className="cl-skel" />)}

        {/* Signed out — the same prompt the profile page shows, same keys. */}
        {sessionStatus === 'unauthenticated' && (
          <div className="empty">
            <div className="empty__ico"><span className="ms" aria-hidden="true">person</span></div>
            <h2>{ta('signInPrompt')}</h2>
            <p>{ta('signInSubtitle')}</p>
            <button type="button" className="cl-btn cl-btn--primary" onClick={() => router.push('/eat/auth')}>
              {ta('signIn')}
            </button>
          </div>
        )}

        {/* KILL-SWITCH (and every unreadable answer) — the human-support fallback, verbatim from
            the help page's closed-refund branch. No list is rendered here, empty or otherwise. */}
        {sessionStatus === 'authenticated' && state === 'off' && (
          <>
            <p className="cl-lbl">{th('refundOffTitle')}</p>
            <div className="cl-support">{th('refundOffBody')}</div>
            <a className="cl-mail" href="mailto:contact@grubano.com">
              <span className="ms" aria-hidden="true">mail</span>
              <b>{th('contactEmail')}</b><span>contact@grubano.com</span>
            </a>
          </>
        )}

        {/* Surface open, nothing filed. */}
        {sessionStatus === 'authenticated' && state === 'on' && claims.length === 0 && (
          <div className="empty">
            <div className="empty__ico"><span className="ms" aria-hidden="true">flag</span></div>
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyBody')}</p>
            <button type="button" className="cl-btn" onClick={() => router.push('/eat/orders')}>
              <span className="ms" aria-hidden="true">receipt_long</span>{t('emptyCta')}
            </button>
          </div>
        )}

        {sessionStatus === 'authenticated' && state === 'on' && claims.length > 0 && (
          <div className="cl-list">
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} dateLabel={fmtDate(c.createdAt)} onContested={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── One claim ─────────────────────────────────────────────────────────────────
// TOP-LEVEL component on purpose: defined inside the page, its identity would change at
// every parent render and React would remount it, killing the contest textarea on each
// keystroke (the lesson of the /eat/orders reservation card).
function ClaimRow({ claim, dateLabel, onContested }: { claim: ClaimCard; dateLabel: string; onContested: () => void }) {
  const t = useTranslations('eat.claims')
  // The claim vocabulary itself — status, reason, and the contest wording — is the FROZEN
  // top-level `claims` namespace, shared with the tracking-page widget. Nothing is reworded here.
  const tc = useTranslations('claims')
  const locale = useLocale()

  const [contesting, setContesting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const s = statusKey(claim.status)
  const tone = STATUS_TONE[s]
  const reasonLabel = claim.reason && RENDERABLE_REASONS.includes(claim.reason)
    ? tc(`reason.${claim.reason}`)
    : t('reasonUnknown')

  // Contesting a refusal sends the claim to Grubano's neutral arbitration — the SAME route the
  // tracking-page widget calls, with the same body. No money decision is taken here.
  async function submitContest() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`/api/claims/${claim.id}/contest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // Project rule: a UI-facing server error is already French — surface it as-is.
        setErr(typeof data?.error === 'string' ? data.error : tc('client.errorGeneric'))
        return
      }
      showToast(tc('client.contestSuccess'))
      setContesting(false)
      setReason('')
      onContested()
    } catch {
      setErr(tc('client.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="cl-card">
      <div className="cl-top">
        <div className="cl-ico"><span className="ms" aria-hidden="true">flag</span></div>
        <div className="cl-head">
          <div className="cl-ref">
            <b className="mono">{claim.orderRef}</b>
            <span className="cl-pill" data-tone={tone}>
              <span className="ms" aria-hidden="true">{STATUS_ICON[tone]}</span>{tc(`status.${s}`)}
            </span>
          </div>
          {/* The batched name read can fail without failing the history — then it is simply unnamed. */}
          <div className="cl-resto">{claim.restaurantName ?? t('restaurantUnknown')}</div>
          <div className="cl-date">{t('filedOn', { date: dateLabel })}</div>
        </div>
      </div>

      <div className="cl-facts">
        <p className="cl-fact"><b>{tc('client.reasonLabel')}</b><span>{reasonLabel}</span></p>
        {/* `null` is « not recorded » and is NEVER rendered as a scope — least of all as the whole order. */}
        <p className="cl-fact">
          <span>
            {/* A LINE-LESS SCOPE IS RECORDED, NOT ABSENT. `whole` and `amount` carry no lines by
                construction, and rendering « non enregistrée » for them asserted a false absence on the one
                screen where a customer checks what they asked for — while the restaurant panel said « Toute
                la commande » about the same claim. The mode word is what those other surfaces render. */}
            {!claim.selectionSummary
              ? tc('client.selectionNotRecorded')
              : claim.selectionSummary.mode === 'whole'
                ? t('selectionWhole')
                : claim.selectionSummary.mode === 'amount'
                  ? t('selectionAmount')
                  : t('selectionSummary', { lines: claim.selectionSummary.lines, items: claim.selectionSummary.items })}
          </span>
        </p>
        {typeof claim.requestedAmountCents === 'number' && claim.requestedAmountCents > 0 && (
          <p className="cl-fact">
            <b>{t('requested')}</b>
            <span className="val mono">{formatEuros(claim.requestedAmountCents / 100, locale)}</span>
          </p>
        )}
        {/* Sent only when Grubano approved a DIFFERENT amount. It is an APPROVED figure, not a
            settled one: what actually left the account is the status's business, never this line. */}
        {typeof claim.approvedAmountCents === 'number' && claim.approvedAmountCents > 0 && (
          <p className="cl-fact">
            <b>{t('approved')}</b>
            <span className="val mono">{formatEuros(claim.approvedAmountCents / 100, locale)}</span>
          </p>
        )}
      </div>

      {/* Sent only when the RESTAURANT itself refused. */}
      {claim.restaurantResponseReason && (
        <div className="cl-why"><b>{tc('client.refusalReasonShown')}</b>{claim.restaurantResponseReason}</div>
      )}
      {/* Sent only for a Grubano decision, never for a declaration close. */}
      {claim.arbitrationReason && (
        <div className="cl-why"><b>{tc('client.grubanoDecisionReason')}</b>{claim.arbitrationReason}</div>
      )}

      <div className="cl-actions">
        {claim.canContest && !contesting && (
          <button type="button" className="cl-btn" onClick={() => setContesting(true)}>
            <span className="ms" aria-hidden="true">gavel</span>{tc('client.contest')}
          </button>
        )}
        <Link className="cl-help" href={`/eat/order/${claim.orderId}/help`}>
          {t('helpLink')}<span className="ms" aria-hidden="true">chevron_right</span>
        </Link>
      </div>

      {claim.canContest && contesting && (
        <div className="cl-contest">
          <h3>{tc('client.contestTitle')}</h3>
          <p>{tc('client.contestDescription')}</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={tc('client.contestReasonPlaceholder')}
            aria-label={tc('client.contestReasonLabel')}
          />
          {err && <p className="cl-err"><span className="ms" aria-hidden="true">error</span>{err}</p>}
          <div className="cl-actions">
            <button type="button" className="cl-btn cl-btn--ghost" disabled={busy} onClick={() => { setContesting(false); setReason(''); setErr('') }}>
              {tc('client.cancel')}
            </button>
            <button type="button" className="cl-btn cl-btn--primary" disabled={busy} onClick={submitContest}>
              {tc('client.contestSubmit')}
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
