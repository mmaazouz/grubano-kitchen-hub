// tests/claims-exit-copy.test.ts — T-49 round 13, J-M31 (D14, D3/C4 texts, F15, G2 scan)
//
// The approval refusal copy, selected in D14 order, and the no-false-exit phrase pin over an ENUMERATED
// list of texts (never a whole file). J-M31 is CLOSED in slice W7: said.*, D4, D7, D8, D11, G8, G10-G12,
// F14, the unfinalized caption, H10 and AMF-1 texts joined the list, all eight approval toasts are scanned,
// and the G2 source scan has no exemption left.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  arbitrationRefusal, reconcileRefusal, moneyStateGuidance, absenceProvenPayableLabel, deriveNoRowOutcome, proofInstantFor,
  APPROVE_INSTANT_UNREADABLE, APPROVE_LEGACY_PROOF, REFUSE_APPROVED_AM_B3, APPROVE_ALREADY_SET, approvePrematureText, approveRevisableText, approvePermanentText, approveMarkerFutureText,
  ATTEMPT_QUIESCENCE_MS, MARKERS, RECONCILE_MARKER_UNREADABLE_TEXT, acceptedExits, exitRegistry, type ClaimFacts,
} from '@/lib/claim-action-rules'
import { moneyLineFor, IDENTITY_UNREAD_TEXT, IDENTITY_UNREAD_NO_EXIT_TEXT, BOUND_REVERTED_TEXT } from '@/lib/claim-money-line'
import { attributionRefusal } from '@/lib/claim-attribution-rules'
import { approvalToast, type ApprovalRefundOutcome } from '@/lib/claim-approval-toast'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/** D14 PIN + J-M31 additions, case-insensitive. D′ L2 (R13 spec v1.1, D13 / F15 / G8): a re-approval is never the way
 *  to be paid — « approuvez-la à nouveau », « nouvelle approbation », « approuvée à nouveau » and the v1 « approbation
 *  admin (file d’arbitrage) » are forbidden promises too. */
const FORBIDDEN_PHRASES = [
  'payable à nouveau', 'à nouveau payable', 'de nouveau payable', 'peut maintenant être rembours', 'relancez le remboursement',
  'réessayez le remboursement', 'sera remboursée', 'sera payée', 'jamais déplacé', 'n’a déplacé d’argent',
  'Absence de remboursement PROUVÉE', 'relèvent d’AUTRES', 'Aucun ne paie celle-ci', 'refusera tout remboursement',
  'aucun code ne sort une ligne de l’état échoué', 'définitif',
  'approuvez-la à nouveau', 'nouvelle approbation', 'approuvée à nouveau', 'approbation admin (file d’arbitrage)',
]
const hits = (text: string) => FORBIDDEN_PHRASES.filter((p) => text.toLowerCase().includes(p.toLowerCase()))

const NOW = new Date('2026-09-12T12:00:00.000Z')
const approved = (refundError: string | null, o: Partial<ClaimFacts> = {}): ClaimFacts =>
  ({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError, ...o })
const markerAt = (at: Date) => `reconcile_required: tentative de remboursement démarrée à ${at.toISOString()} (tentative 1a2b) — identité du remboursement pas encore liée.`

describe('J-M31 — D14 (0)-(3) exact, selected in order', () => {
  it('(0) v13 → the C4 checks only (premature text v1.1 — D′ L2: the rail selects it, never a re-approval)', () => {
    const instant = new Date(NOW.getTime() + 60_000)
    const v13 = approved(`${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`)
    const premature = `Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${instant.toISOString()} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; le rail financier (« Payer les approuvées », session admin, remboursements ouverts) pourra la sélectionner ensuite.`
    expect(arbitrationRefusal(v13, 'approve', NOW)?.error).toBe(premature)
    expect(approvePrematureText(instant.toISOString())).toBe(premature)
    expect(arbitrationRefusal(approved(`${MARKERS.PROOF_PAYABLE_V13} sans instant`), 'approve', NOW)?.error).toBe(APPROVE_INSTANT_UNREADABLE)
    expect(arbitrationRefusal(v13, 'approve', instant)).toBeNull()
    // NEGATIVE CONTROL: the v1 ending « approuvez-la à nouveau ensuite » is neither shipped nor admitted by the pin.
    const v1 = premature.replace('le rail financier (« Payer les approuvées », session admin, remboursements ouverts) pourra la sélectionner ensuite.', 'approuvez-la à nouveau ensuite.')
    expect(v1).not.toBe(premature)
    expect(hits(v1)).toEqual(['approuvez-la à nouveau'])
    expect(hits(premature)).toEqual([])
  })

  it('(1) LEGACY proof', () => {
    expect(arbitrationRefusal(approved('no_refund_proven: aucun remboursement …'), 'approve', NOW)?.error)
      .toBe('Approbation suspendue : la preuve d’absence de cette réclamation a été écrite par une version antérieure de la réconciliation, qui ne vérifiait pas toutes les conditions du moteur. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise ») avant toute approbation.')
  })

  it('(2) REVISABLE when the reconcile gate admits the claim — with the declaration sentence when the close is accepted (text v1.1 — D′ L2)', () => {
    const rail = approved('no_refund_proven_rail_locked: …')
    expect(reconcileRefusal(rail, NOW.getTime())).toBeNull()
    const revisable = 'Approbation impossible dans l’état enregistré : le rail financier ne paierait pas cette réclamation, ou son paiement n’est pas établi comme sûr (la cause est dans le détail de la réclamation). Rien n’est payé tant que cet état est enregistré. « Réconcilier d’après la preuve » (section « Vérification financière requise ») relit Stripe et nos lignes et réévalue toutes les conditions. « Clôturer ce dossier… » enregistre votre déclaration.'
    expect(arbitrationRefusal(rail, 'approve', NOW)?.error).toBe(revisable)
    expect(approveRevisableText(true)).toBe(revisable)
    // NEGATIVE CONTROL: the v1 subject « une nouvelle approbation ne paierait pas … n’est pas établie comme sûre » is gone,
    // and the pin now catches it.
    const v1 = revisable.replace('le rail financier ne paierait pas cette réclamation, ou son paiement n’est pas établi comme sûr', 'une nouvelle approbation ne paierait pas cette réclamation, ou n’est pas établie comme sûre')
    expect(v1).not.toBe(revisable)
    expect(hits(v1)).toEqual(['nouvelle approbation'])
    expect(hits(revisable)).toEqual([])
  })

  it('selection pin (ER-M09): a legacy approved claim with a marker IN GRACE gets (2) WITHOUT the « Clôturer » sentence', () => {
    const inGrace = approved(markerAt(new Date(NOW.getTime() - 60_000)), { refundAttempted: true })
    expect(reconcileRefusal(inGrace, NOW.getTime())?.error).toContain('moins de 5 minutes')
    expect(arbitrationRefusal(inGrace, 'approve', NOW)?.error).toBe(approveRevisableText(false))
    expect(arbitrationRefusal(inGrace, 'approve', NOW)?.error).not.toContain('Clôturer')
  })

  // W3 round-1 fix (D14 (2)/(3), D5, F16 (7)): reconcile refuses a marker whose instant cannot be read (malformed, or in
  // the future). D14 (2) is reserved to reconcileRefusal === null or a grace-only refusal, so such a claim gets (3).
  const MALFORMED = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10Tzz:00Z (tentative 1a2b) — identité du remboursement pas encore liée.'
  it('selection pin: an approved claim whose marker instant is malformed gets (3) — never a text naming « Réconcilier »', () => {
    const malformed = approved(MALFORMED, { refundAttempted: true })
    const future = approved(markerAt(new Date(NOW.getTime() + 3_600_000)), { refundAttempted: true })
    for (const [name, c] of [['malformed', malformed], ['future', future]] as const) {
      expect(reconcileRefusal(c, NOW.getTime())?.error, name).toBe(RECONCILE_MARKER_UNREADABLE_TEXT)
      expect(acceptedExits({ claim: c, now: NOW }), name).toEqual([])
    }
    const text = arbitrationRefusal(malformed, 'approve', NOW)?.error
    expect(text).toBe(approvePermanentText(false))
    expect(text).not.toContain('Réconcilier')
    // E registry: a malformed instant never becomes readable (E-04 founder acceptance); a future one does (E-05, D5 after grace).
    expect(exitRegistry({ claim: malformed, now: NOW })).toBe('E-04:malformed_marker')
    expect(exitRegistry({ claim: future, now: NOW })).toBe('E-05')
    expect(RECONCILE_MARKER_UNREADABLE_TEXT).toContain('n’a pas pu être lue, ou est postérieure à maintenant')
    expect(hits(RECONCILE_MARKER_UNREADABLE_TEXT)).toEqual([])
  })

  // ROUND 13 (slice W7, E-05 carry-over): a READABLE instant in the future has a time-bound exit (D5 admits reconcile once it
  // has passed and the grace elapsed), so (3)'s « Aucune action de l’application ne la clôt » would be false for it.
  it('selection pin (E-05, W7): an approved claim whose marker instant is in the FUTURE gets the time-bound text, with the instant and the reconcile date', () => {
    const at = new Date(NOW.getTime() + 3_600_000)
    const future = approved(markerAt(at), { refundAttempted: true })
    const text = arbitrationRefusal(future, 'approve', NOW)?.error
    const from = new Date(at.getTime() + 5 * 60_000).toISOString()
    expect(text).toBe(approveMarkerFutureText(at.toISOString(), from))
    expect(text).toContain(`(${at.toISOString()} UTC)`)
    expect(text).toContain(`jusqu’au ${from} (UTC)`)
    expect(text).not.toContain('Aucune action de l’application ne la clôt')
    expect(hits(String(text))).toEqual([])
    // once the instant has passed and the grace elapsed, reconcile is admitted — the exit the text names exists (F16 (7))
    expect(reconcileRefusal(future, Date.parse(from))).toBeNull()
    expect(acceptedExits({ claim: future, now: new Date(Date.parse(from)) })).toEqual(['reconcile'])
    // NEGATIVE CONTROL: the malformed instant keeps (3), and the W3 text (3) would be the false « no action » sentence here
    expect(arbitrationRefusal(approved(MALFORMED, { refundAttempted: true }), 'approve', NOW)?.error).toBe(approvePermanentText(false))
    expect(approvePermanentText(false)).toContain('Aucune action de l’application ne la clôt')
  })

  it('NEGATIVE CONTROL — the same approved claim with an AGED marker (reconcile admitted) or a marker in grace still gets (2)', () => {
    const aged = approved(markerAt(new Date(NOW.getTime() - 3_600_000)), { refundAttempted: true })
    expect(reconcileRefusal(aged, NOW.getTime())).toBeNull()
    expect(arbitrationRefusal(aged, 'approve', NOW)?.error).toBe(approveRevisableText(false))
    expect(acceptedExits({ claim: aged, now: NOW })).toEqual(['reconcile'])
    const inGrace = approved(markerAt(new Date(NOW.getTime() - 60_000)), { refundAttempted: true })
    expect(arbitrationRefusal(inGrace, 'approve', NOW)?.error).toBe(approveRevisableText(false))
  })

  it('(3) PERMANENT otherwise — naming the close only when it is accepted (text v1.1 — D′ L2)', () => {
    const withClose = 'Approbation impossible : le rail financier ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle. Clôturez le dossier (« Clôturer ce dossier… »).'
    expect(arbitrationRefusal(approved('stripe_failed: …', { refundAttempted: true, refundId: 'rf1' }), 'approve', NOW)?.error).toBe(withClose)
    expect(approvePermanentText(true)).toBe(withClose)
    expect(approvePermanentText(false)).toBe('Approbation impossible : le rail financier ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle. Aucune action de l’application ne la clôt : vérifiez la commande dans Stripe.')
    // NEGATIVE CONTROL: the v1 subject « une nouvelle approbation ne paierait pas » is gone and the pin catches it.
    const v1 = withClose.replace('le rail financier ne paierait pas', 'une nouvelle approbation ne paierait pas')
    expect(v1).not.toBe(withClose)
    expect(hits(v1)).toEqual(['nouvelle approbation'])
    expect(hits(withClose)).toEqual([])
  })

  it('a v13 proof never gets (1)-(3)', () => {
    const v13 = approved(`${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${NOW.toISOString()} (UTC).`)
    for (const t of [APPROVE_LEGACY_PROOF, approveRevisableText(true), approveRevisableText(false), approvePermanentText(true), approvePermanentText(false)]) {
      expect(arbitrationRefusal(v13, 'approve', new Date(NOW.getTime() - 1))?.error).not.toBe(t)
    }
  })

  it('D14: the existing finalization-lock text is kept verbatim (approved, attempt taken, null error)', () => {
    expect(arbitrationRefusal(approved(null, { refundAttempted: true }), 'approve', NOW)?.error).toBe('Cette réclamation a déjà été arbitrée — décision définitive.')
    // « définitive » does not contain the J-M31 phrase « définitif »: the text needs no rewording.
    expect(hits('Cette réclamation a déjà été arbitrée — décision définitive.')).toEqual([])
  })

  it('AM-B3: refuse_final on every approved claim, arbitrationDecision null included (text v1.1 — D′ L2: the rail and the withdraw, never a re-approval)', () => {
    const amB3 = 'Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : elle relève du rail financier (« Payer les approuvées »), retirez l’approbation (« Retirer l’approbation »), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.'
    for (const c of [approved(null), approved(null, { arbitrationDecision: null }), approved('stripe_failed: x', { refundAttempted: true }), approved(null, { approvedAmountCents: 500 })]) {
      expect(arbitrationRefusal(c, 'refuse_final', NOW)?.error).toBe(amB3)
    }
    expect(REFUSE_APPROVED_AM_B3).toBe(amB3)
    // NEGATIVE CONTROL: the v1 text (« approuvez-la à nouveau (réclamations et remboursements ouverts) ») is not shipped,
    // and the pin now catches it.
    const v1 = 'Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.'
    expect(REFUSE_APPROVED_AM_B3).not.toBe(v1)
    expect(hits(v1)).toContain('approuvez-la à nouveau')
    expect(REFUSE_APPROVED_AM_B3).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
  })

  it('D′ L2 (D1 v1.1): approve on an approved claim whose amount is fixed → APPROVE_ALREADY_SET, before every D14 check; ratification stays admitted', () => {
    // a fixed amount refuses whatever the recorded money state says — the v13 premature shape included
    const instant = new Date(NOW.getTime() + 60_000)
    const v13 = approved(`${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`)
    for (const c of [approved(null), approved(null, { arbitrationDecision: null }), v13, approved('no_refund_proven_rail_locked: …')]) {
      expect(arbitrationRefusal({ ...c, approvedAmountCents: 500 }, 'approve', NOW)).toEqual({ status: 409, error: APPROVE_ALREADY_SET })
    }
    expect(arbitrationRefusal(approved(null), 'approve', NOW)).toBeNull()
    expect(arbitrationRefusal(approved(null, { approvedAmountCents: null }), 'approve', NOW)).toBeNull()
    expect(APPROVE_ALREADY_SET).toContain('Retirer l’approbation')
    expect(APPROVE_ALREADY_SET).not.toMatch(/approuvez-la à nouveau|nouvelle approbation/)
  })
})

describe('J-M31 — F15 texts verbatim (ER-R27: « abouti ou en attente »; text v1.1 — D′ L2: the rail pays, never a re-approval)', () => {
  const V1_GUIDANCE = {
    absence_proven_payable: 'Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement abouti ou en attente non expliqué. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt à l’instant écrit dans son détail, et seulement si la relecture avant moteur confirme encore la preuve.',
    approved_not_driven: 'Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts, et seulement si la vérification avant moteur le permet à ce moment. Aucune clôture manuelle sur cet état.',
  }
  it('GUIDANCE absence_proven_payable and approved_not_driven', () => {
    expect(moneyStateGuidance('absence_proven_payable')).toBe('Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement abouti ou en attente non expliqué. Elle ne se paie que par le rail financier (« Payer les approuvées », session admin, remboursements ouverts), sélectionnée explicitement par un admin, au plus tôt à l’instant écrit dans son détail, et seulement si la relecture avant moteur confirme encore la preuve.')
    expect(moneyStateGuidance('approved_not_driven')).toBe('Approuvée, en attente de paiement. Elle ne se paie que par le rail financier (« Payer les approuvées », session admin, remboursements ouverts), et seulement si la vérification avant moteur le permet à ce moment  ; une ré-approbation ne paie jamais. Aucune clôture manuelle sur cet état.')
    // NEGATIVE CONTROL: the v1 lines named a (re-)approval as the way to be paid — neither is shipped, both are caught.
    for (const [k, v1] of Object.entries(V1_GUIDANCE)) {
      expect(moneyStateGuidance(k), k).not.toBe(v1)
      expect(hits(v1), k).not.toEqual([])
      expect(hits(moneyStateGuidance(k)), k).toEqual([])
    }
  })

  it('MONEY label absence_proven_payable, with the instant or with the unreadable tail; the console renders it per claim', () => {
    const at = proofInstantFor(markerAt(NOW), NOW)
    const HEAD = 'Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : sélection explicite dans le rail financier (« Payer les approuvées », session admin, remboursements ouverts)'
    expect(absenceProvenPayableLabel(`${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${at.toISOString()} (UTC).`))
      .toBe(`${HEAD}, au plus tôt le ${at.toISOString()} (UTC), relue avant le moteur`)
    expect(absenceProvenPayableLabel(`${MARKERS.PROOF_PAYABLE_V13} sans instant`))
      .toBe(`${HEAD} — instant illisible : approbation refusée, relancez « Réconcilier d’après la preuve »`)
    // NEGATIVE CONTROL: the v1 head (« nouvelle approbation admin, réclamations et remboursements ouverts ») is not shipped.
    const V1_HEAD = 'Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts'
    expect(absenceProvenPayableLabel(null).startsWith(V1_HEAD)).toBe(false)
    expect(hits(V1_HEAD)).toEqual(['nouvelle approbation'])
    expect(hits(HEAD)).toEqual([])
    const arb = stripComments(read('components/claims/AdminClaimsArbitration.tsx'))
    expect(arb).toContain("r.moneyState === 'absence_proven_payable'\n                ? { text: absenceProvenPayableLabel(r.refundError), tone: 'warning' as const }")
  })

  it('the instant ATTEMPT_QUIESCENCE_MS is at least an hour, so « au plus tôt » is never « now »', () => {
    expect(ATTEMPT_QUIESCENCE_MS).toBeGreaterThanOrEqual(3_600_000)
  })
})

describe('J-M31 — the phrase pin over the enumerated W1 texts', () => {
  const GUIDED = ['reconcile_required', 'stripe_pending', 'local_pending_unconfirmed', 'stripe_failed', 'stripe_succeeded_claim_unreconciled', 'stale_refunding_no_refund_row', 'approved_not_driven', 'absence_proven_payable', 'refund_error_recorded', 'reconcile_marker_unreadable']
  const facts = { orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded', chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 300, routed: false, royaltyStatus: null, stripeListLength: 1, rows: [], truths: {}, binders: {}, stampedClaims: {}, succeededNotCounted: [], rowContradictions: [] }
  const PARK_DETAILS = [
    deriveNoRowOutcome({ readable: false, permanent: null, refundedCents: 300 }, 'cl1'),
    deriveNoRowOutcome({ readable: false, permanent: 'list_over_cap' }, 'cl1'),
    deriveNoRowOutcome({ readable: true, facts: { ...facts, L: [{ id: 're_D', status: 'pending', amount: 300, charge: 'ch_1', metadata: {} }] } }, 'cl1'),
    deriveNoRowOutcome({ readable: true, facts: { ...facts, L: [{ id: 're_X', status: 'succeeded', amount: 300, charge: 'ch_2', metadata: {} }] } }, 'cl1'),
  ].map((o) => (o.kind === 'park' ? o.detail : ''))
  const rowFor = (status: string) => ({ id: 'rf', orderId: 'o1', status, reason: null, stripeRefundId: 're_1' })
  /** The approval toasts: every key approvalToast can return, as the arbitration console renders it (fr). */
  const FR = JSON.parse(read('messages/fr.json')) as { claims: { admin: Record<string, string> } }
  // W7 fixer (J-M31): every F12 shape approvalToast maps — the four W2 toasts (approvedPending, approvedIdentityUnverified,
  // approvedSuperseded, approvedNotSentUntil) included — so all eight ApprovalToast keys are scanned.
  const TOAST_OUTCOMES: ApprovalRefundOutcome[] = [
    { state: 'refunded', amountCents: 500 }, { state: 'failed', error: 'resume_mismatch' }, { state: 'failed', error: 'engine_failed' },
    { state: 'pending' }, { state: 'already_handled' }, null,
    { state: 'pending', reason: 'stripe_pending' }, { state: 'failed', error: 'identity_unverified' },
    { state: 'failed', error: 'attempt_superseded' }, { state: 'failed', error: 'unconfirmed_within_window', until: NOW.toISOString() },
    { state: 'failed', error: 'safety_hold' }, { state: 'failed', error: 'safety_check_unreadable' },
  ]
  const TOAST_KEYS = Array.from(new Set(TOAST_OUTCOMES.map((o) => approvalToast(o).key)))
  /** fr value with every placeholder substituted ({amount}, {date}); a leftover brace fails the scan below. */
  const frToast = (k: string) => (FR.claims.admin[k] ?? '').replace('{amount}', '5,00 €').replace('{date}', NOW.toLocaleString('fr-FR'))
  const APPROVAL_TOASTS: Array<[string, string]> = TOAST_KEYS.map((k) => [`approval toast ${k}`, frToast(k)])
  const TEXTS: Array<[string, string]> = [
    ...APPROVAL_TOASTS,
    ['money line identity_unread, reconcile refused', IDENTITY_UNREAD_NO_EXIT_TEXT],
    ['C4 unreadable', APPROVE_INSTANT_UNREADABLE],
    ['C4 premature', approvePrematureText(NOW.toISOString())],
    ['D14 (1)', APPROVE_LEGACY_PROOF],
    ['D14 (2) +close', approveRevisableText(true)], ['D14 (2)', approveRevisableText(false)],
    ['D14 (3) +close', approvePermanentText(true)], ['D14 (3)', approvePermanentText(false)],
    ['AM-B3', REFUSE_APPROVED_AM_B3],
    // D′ L2 (D1 v1.1): the refusal of a re-approval on a fixed amount is an arbitration refusal text like D14's.
    ['APPROVE_ALREADY_SET (D′ L2)', APPROVE_ALREADY_SET],
    ...GUIDED.map((s) => [`GUIDANCE ${s}`, moneyStateGuidance(s)] as [string, string]),
    ['MONEY absence_proven_payable', absenceProvenPayableLabel(`${MARKERS.PROOF_PAYABLE_V13} payable au plus tôt le ${NOW.toISOString()} (UTC)`)],
    ['MONEY absence_proven_payable unreadable', absenceProvenPayableLabel(null)],
    ['money line identity_unread', IDENTITY_UNREAD_TEXT], ['money line bound_reverted', BOUND_REVERTED_TEXT],
    ['money line not ours', moneyLineFor({ kind: 'other_unsettled', refundId: 'rf', refundError: 'resume_mismatch: x', claimId: 'cl1', boundRow: { reason: null } }).text],
    ['reconcile gate', reconcileRefusal({ status: 'approved' })!.error],
    ...['succeeded', 'failed', 'canceled'].map((s) => [`attribution ${s}`, attributionRefusal({ claimId: 'cl1', row: rowFor(s), orderRows: [], boundToOtherClaimId: s === 'succeeded' ? 'cl_Z' : null })?.message ?? ''] as [string, string]),
    ['attribution other order', attributionRefusal({ claimId: 'cl1', claimOrderId: 'o1', row: { ...rowFor('succeeded'), orderId: 'o2' }, orderRows: [], boundToOtherClaimId: null })!.message],
    ...PARK_DETAILS.map((d, i) => [`G6/G7 park ${i}`, d] as [string, string]),
  ]

  it('every enumerated text is non-empty and contains none of the forbidden phrases', () => {
    for (const [name, text] of TEXTS) {
      expect(text.length, name).toBeGreaterThan(10)
      expect(hits(text), name).toEqual([])
    }
  })

  it('the eight approval toasts are all enumerated, read from messages/fr.json, placeholders substituted', () => {
    expect([...TOAST_KEYS].sort()).toEqual([
      'approvedFailed', 'approvedIdentityUnverified', 'approvedNotSent', 'approvedNotSentUntil', 'approvedPending',
      'approvedRefunded', 'approvedResumeMismatch', 'approvedSuperseded',
    ])
    for (const [name, text] of APPROVAL_TOASTS) {
      expect(text.length, name).toBeGreaterThan(10)
      expect(text, name).not.toMatch(/[{}]/)
      expect(hits(text), name).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — the W2 toasts are really scanned: approvedNotSentUntil / approvedPending rewritten to promise a payment are caught', () => {
    expect(hits(`${frToast('approvedNotSentUntil')} Elle sera payée à cette date.`)).not.toEqual([])
    expect(hits(`${frToast('approvedPending')} Elle sera remboursée.`)).not.toEqual([])
    // the pre-fix outcome list reached only four keys: approvedNotSentUntil was never in it
    const headOutcomes: ApprovalRefundOutcome[] = [{ state: 'refunded', amountCents: 500 }, { state: 'failed', error: 'resume_mismatch' }, { state: 'failed', error: 'engine_failed' }, { state: 'pending' }, { state: 'already_handled' }, null]
    expect(new Set(headOutcomes.map((o) => approvalToast(o).key)).has('approvedNotSentUntil')).toBe(false)
  })

  it('NEGATIVE CONTROL — a real toast rewritten to promise a payment is caught', () => {
    expect(hits(`${FR.claims.admin.approvedNotSent} Elle sera remboursée.`)).not.toEqual([])
  })

  it('NEGATIVE CONTROL — the synthetic copy and the HEAD guidance / label are caught', () => {
    expect(hits('elle est à nouveau payable')).not.toEqual([])
    expect(hits('Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts.')).not.toEqual([])
    expect(hits('Absence de remboursement PROUVÉE (lignes + Stripe) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin requise, réclamations et remboursements ouverts')).not.toEqual([])
    expect(hits('… — elle sera remboursée')).not.toEqual([])
    expect(hits('Approbation impossible : le moteur refusera tout remboursement sur cette commande (la cause, et si elle est définitive, sont dans le détail de la réclamation).')).not.toEqual([])
  })

  it('NEGATIVE CONTROL (D′ L2, R13 v1.1) — every v1 sentence that named a re-approval as the way to be paid is caught by the four new phrases', () => {
    const V1 = {
      'AM-B3 v1':                 'Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la',
      'C4 premature v1':          'Rien n’est payé avant cette heure ; approuvez-la à nouveau ensuite.',
      'D14 (2) v1':               'Approbation impossible dans l’état enregistré : une nouvelle approbation ne paierait pas cette réclamation, ou n’est pas établie comme sûre',
      'D14 (3) v1':               'Approbation impossible : une nouvelle approbation ne paierait pas cette réclamation',
      'GUIDANCE approved v1':     'Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts',
      'GUIDANCE absence v1':      'Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts',
      'MONEY label v1':           'Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts',
      'G8 payableTail v1':        'elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts',
      'G8 LOCKED_OPEN v1':        'MAIS une nouvelle approbation ne paierait pas cette réclamation :',
    }
    for (const [name, text] of Object.entries(V1)) expect(hits(text), name).not.toEqual([])
    // and the pin is not slack on the shipped v1.1 replacements of the same sentences
    expect(hits('Rien n’est payé avant cette heure ; le rail financier (« Payer les approuvées », session admin, remboursements ouverts) pourra la sélectionner ensuite.')).toEqual([])
    expect(hits('MAIS le rail financier ne paierait pas cette réclamation :')).toEqual([])
    // the pre-D′ list (the first sixteen phrases) let every one of these through — the four additions are load-bearing
    const preDPrime = FORBIDDEN_PHRASES.slice(0, 16)
    const oldHits = (t: string) => preDPrime.filter((p) => t.toLowerCase().includes(p.toLowerCase()))
    for (const [name, text] of Object.entries(V1)) expect(oldHits(text), name).toEqual([])
  })
})

describe('J-M31 — G2 source scan', () => {
  const G2 = ['jamais déplacé', 'n’a déplacé d’argent', 'Absence de remboursement PROUVÉE', 'relèvent d’AUTRES réclamations']
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|json)$/.test(name)) files.push(p.replace(/\\/g, '/'))
    }
  }
  walk('lib'); walk('components'); walk('messages')
  const offendersOf = (sources: Array<[string, string]>) => sources.filter(([, s]) => G2.some((p) => stripComments(s).includes(p))).map(([f]) => f)

  // W7 fixer: the two W1 exemptions (lib/claims.ts, AdminFinancialVerification.tsx) are removed — no file is exempt.
  it('none of the G2 strings exists in lib/, components/ or messages/ — no exemption', () => {
    expect(files).toContain('lib/claims.ts')
    expect(files).toContain('components/claims/AdminFinancialVerification.tsx')
    expect(offendersOf(files.map((f) => [f, read(f)]))).toEqual([])
  })

  it('NEGATIVE CONTROL — a copy of lib/claims.ts carrying « jamais déplacé » in code is an offender (no exemption swallows it)', () => {
    const tampered = read('lib/claims.ts').replace('export async function reverifySettledClaimRefunds(', "const G2_WITNESS = 'aucun remboursement n’a jamais déplacé d’argent'\nexport async function reverifySettledClaimRefunds(")
    expect(tampered).not.toBe(read('lib/claims.ts'))
    expect(offendersOf([['lib/claims.ts', tampered]])).toEqual(['lib/claims.ts'])
  })

  it('NEGATIVE CONTROL — the HEAD guidance line 176 and label line 186 would be offenders', () => {
    const head176 = "absence_proven_payable:\n    'Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent.'"
    const head186 = "{ text: 'Absence de remboursement PROUVÉE (lignes + Stripe) — approuvée, non payée.' }"
    for (const s of [head176, head186]) expect(G2.some((p) => stripComments(s).includes(p))).toBe(true)
  })
})

// ══ ROUND 13 (slice W7) — J-M31: the enumerated list completed (the W1 note's remaining texts) ═══════════════════════════
describe('J-M31 (W7) — said.*, D4 / D7 / D8 / D11, the G11 / G12 and adopt texts, STRIPE_REVERTED_TEXT, the unfinalized caption, H10 and AMF-1', () => {
  const claimsSrc = () => read('lib/claims.ts')
  const fnBody = (src: string, head: string) => { const a = src.indexOf(head); expect(a, head).toBeGreaterThan(0); return src.slice(a, src.indexOf('\n}\n', a)) }
  /** Every quoted or backtick literal longer than 20 characters in a function body (the texts it can return or write). */
  const literals = (body: string) => Array.from(stripComments(body).matchAll(/`([^`]{21,})`|'([^'\n]{21,})'/g)).map((m) => m[1] ?? m[2])
  const ISO = '2026-09-12T13:00:00.000Z'

  it('said.* — every reconcile toast, for every payload variant', async () => {
    const { reconcileSaid, settledReverifyToast } = await import('@/lib/claim-console-copy')
    const variants = [{}, { evidence: 'stripe_read', payableFrom: ISO, stripeStatus: 'succeeded' }, { stripeStatus: 'pending', boundRowId: 'rf1', detail: 'détail' }, { stripeStatus: 'not_at_stripe_yet', until: ISO }, { stripeStatus: 'requires_action' }, { stripeStatus: 'weird' }]
    for (const v of variants) for (const [k, text] of Object.entries(reconcileSaid(v))) expect(hits(text), `${k} ${JSON.stringify(v)}`).toEqual([])
    const sr = { checked: 2, reverted: 1, standing: 1, unreadable: 0, unproven: 0, truncated: true }
    for (const b of [{ settledReverify: sr, scanned: 1, reconciled: 0 }, {}]) expect(hits(settledReverifyToast(b).text)).toEqual([])
  })

  it('D4 caption, the D7 unfinalized caption, the H10 section copy and blocker lines, the AMF-1 control, the declaration panel', async () => {
    const copy = await import('@/lib/claim-console-copy')
    const card = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    const D7_CAPTION = 'La seule action proposée ici est « Réconcilier d’après la preuve » : elle relit la preuve chez Stripe et dans nos lignes, et ne déplace aucun argent.'
    expect(card).toContain(D7_CAPTION)
    const texts = [
      copy.D4_PRECLICK_CAPTION, D7_CAPTION, copy.REFUNDED_UNPROVEN_TEXT, copy.CLOSURE_NOTICES_INTRO, copy.REFUNDED_UNPROVEN_NO_ACTION, copy.REFUNDED_UNPROVEN_RECONCILE_CAPTION,
      ...Object.values(copy.CLOSURE_BLOCKER_LINE), copy.SETTLED_REVERIFY_CAPTION, copy.CHANGED_DURING_READ_TEXT, copy.UNKNOWN_RECONCILE_OUTCOME_TEXT,
      ...literals(fnBody(card.replace(/\r\n/g, '\n'), 'const resolveStuck = useCallback(').replace(/\n {2}\}, \[load[\s\S]*$/, '')),
    ]
    for (const t of texts) expect(hits(t), t.slice(0, 60)).toEqual([])
  })

  it('D8 / G12 attribution texts, the B11 / C8 adopt texts and the D11 declaration texts (every literal those functions write or return)', () => {
    const src = claimsSrc()
    const all = ['export async function attributeWithEvidence(', 'export async function attributeClaimRefund(', 'export async function adoptStripeRefundForClaim(', 'export async function resolveStuckClaim(', 'function attributionNotProvenText(']
      .flatMap((h) => literals(fnBody(src, h)))
    expect(all.some((t) => t.includes('La réclamation n’a pas été modifiée'))).toBe(true) // G12 NOT PROVEN texts are in the scan
    expect(all.some((t) => t.includes('rien n’a été écrit'))).toBe(true) // D11 count-0 and C7 texts are in the scan
    for (const t of all) expect(hits(t), t.slice(0, 80)).toEqual([])
  })

  it('the three G11 REVERTED texts and STRIPE_REVERTED_TEXT contain « Quand les réclamations sont ouvertes » and lack « Le client lit désormais »', async () => {
    const rules = await import('@/lib/claim-action-rules')
    const g11 = (['succeeded', 'failed', 'pending'] as const).map((variant) => rules.reversalMarkerText(variant, 'rf1', 're_1', 'failed', null))
    // STRIPE_REVERTED_TEXT is lib/claims' private writer: its template is rebuilt from the source with the constants it names.
    const body = fnBody(claimsSrc(), 'function stripeRevertedText(')
    const template = body.slice(body.indexOf('return `') + 'return `'.length, body.lastIndexOf('`'))
    const stripeReverted = template
      .replace('${r ? `${r} ` : \'\'}', '')
      .replace('${CUSTOMER_VISIBILITY_SENTENCE}', rules.CUSTOMER_VISIBILITY_SENTENCE)
      .replace('${MARKERS.STRIPE_REVERTED}', MARKERS.STRIPE_REVERTED)
      .replace(/\$\{[^}]*\}/g, 'X')
    expect(stripeReverted.startsWith(MARKERS.STRIPE_REVERTED)).toBe(true)
    for (const t of [...g11, stripeReverted]) {
      expect(t, t.slice(0, 60)).toContain('Quand les réclamations sont ouvertes')
      expect(t).not.toContain('Le client lit désormais')
      expect(hits(t), t.slice(0, 60)).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — a real toast replaced with « … sera remboursée » is caught; the round-12 said branch (« aucun remboursement n’a jamais déplacé d’argent ») is caught', async () => {
    const { reconcileSaid } = await import('@/lib/claim-console-copy')
    expect(hits(`${reconcileSaid({}).engine_row_dead} Elle sera remboursée.`)).not.toEqual([])
    expect(hits('Preuve d’absence : aucun remboursement n’a jamais déplacé d’argent et Stripe n’en rapporte aucun.')).not.toEqual([])
  })
})
