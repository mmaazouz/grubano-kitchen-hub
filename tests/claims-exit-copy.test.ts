// tests/claims-exit-copy.test.ts — T-49 round 13, J-M31 (D14, D3/C4 texts, F15, G2 scan)
//
// The approval refusal copy, selected in D14 order, and the no-false-exit phrase pin over an ENUMERATED
// list of texts (never a whole file). J-M31 stays OPEN: texts owned by later slices (said.*, D4, D7, D8,
// D11, G8, G10-G12, F14, the unfinalized caption) join this list when those slices land. The approval
// toasts are in it since the W1 round-1 fix.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  arbitrationRefusal, reconcileRefusal, moneyStateGuidance, absenceProvenPayableLabel, deriveNoRowOutcome, proofInstantFor,
  APPROVE_INSTANT_UNREADABLE, APPROVE_LEGACY_PROOF, REFUSE_APPROVED_AM_B3, approvePrematureText, approveRevisableText, approvePermanentText,
  ATTEMPT_QUIESCENCE_MS, MARKERS, RECONCILE_MARKER_UNREADABLE_TEXT, acceptedExits, exitRegistry, type ClaimFacts,
} from '@/lib/claim-action-rules'
import { moneyLineFor, IDENTITY_UNREAD_TEXT, IDENTITY_UNREAD_NO_EXIT_TEXT, BOUND_REVERTED_TEXT } from '@/lib/claim-money-line'
import { attributionRefusal } from '@/lib/claim-attribution-rules'
import { approvalToast, type ApprovalRefundOutcome } from '@/lib/claim-approval-toast'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/** D14 PIN + J-M31 additions, case-insensitive. */
const FORBIDDEN_PHRASES = [
  'payable à nouveau', 'à nouveau payable', 'de nouveau payable', 'peut maintenant être rembours', 'relancez le remboursement',
  'réessayez le remboursement', 'sera remboursée', 'sera payée', 'jamais déplacé', 'n’a déplacé d’argent',
  'Absence de remboursement PROUVÉE', 'relèvent d’AUTRES', 'Aucun ne paie celle-ci', 'refusera tout remboursement',
  'aucun code ne sort une ligne de l’état échoué', 'définitif',
]
const hits = (text: string) => FORBIDDEN_PHRASES.filter((p) => text.toLowerCase().includes(p.toLowerCase()))

const NOW = new Date('2026-09-12T12:00:00.000Z')
const approved = (refundError: string | null, o: Partial<ClaimFacts> = {}): ClaimFacts =>
  ({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError, ...o })
const markerAt = (at: Date) => `reconcile_required: tentative de remboursement démarrée à ${at.toISOString()} (tentative 1a2b) — identité du remboursement pas encore liée.`

describe('J-M31 — D14 (0)-(3) exact, selected in order', () => {
  it('(0) v13 → the C4 checks only', () => {
    const instant = new Date(NOW.getTime() + 60_000)
    const v13 = approved(`${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`)
    expect(arbitrationRefusal(v13, 'approve', NOW)?.error).toBe(`Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${instant.toISOString()} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; approuvez-la à nouveau ensuite.`)
    expect(arbitrationRefusal(approved(`${MARKERS.PROOF_PAYABLE_V13} sans instant`), 'approve', NOW)?.error).toBe(APPROVE_INSTANT_UNREADABLE)
    expect(arbitrationRefusal(v13, 'approve', instant)).toBeNull()
  })

  it('(1) LEGACY proof', () => {
    expect(arbitrationRefusal(approved('no_refund_proven: aucun remboursement …'), 'approve', NOW)?.error)
      .toBe('Approbation suspendue : la preuve d’absence de cette réclamation a été écrite par une version antérieure de la réconciliation, qui ne vérifiait pas toutes les conditions du moteur. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise ») avant toute approbation.')
  })

  it('(2) REVISABLE when the reconcile gate admits the claim — with the declaration sentence when the close is accepted', () => {
    const rail = approved('no_refund_proven_rail_locked: …')
    expect(reconcileRefusal(rail, NOW.getTime())).toBeNull()
    expect(arbitrationRefusal(rail, 'approve', NOW)?.error).toBe('Approbation impossible dans l’état enregistré : une nouvelle approbation ne paierait pas cette réclamation, ou n’est pas établie comme sûre (la cause est dans le détail de la réclamation). Rien n’est payé tant que cet état est enregistré. « Réconcilier d’après la preuve » (section « Vérification financière requise ») relit Stripe et nos lignes et réévalue toutes les conditions. « Clôturer ce dossier… » enregistre votre déclaration.')
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
  it('selection pin: an approved claim whose marker instant is malformed or in the future gets (3) — never a text naming « Réconcilier »', () => {
    const malformed = approved(MALFORMED, { refundAttempted: true })
    const future = approved(markerAt(new Date(NOW.getTime() + 3_600_000)), { refundAttempted: true })
    for (const [name, c] of [['malformed', malformed], ['future', future]] as const) {
      expect(reconcileRefusal(c, NOW.getTime())?.error, name).toBe(RECONCILE_MARKER_UNREADABLE_TEXT)
      const text = arbitrationRefusal(c, 'approve', NOW)?.error
      expect(text, name).toBe(approvePermanentText(false))
      expect(text, name).not.toContain('Réconcilier')
      expect(acceptedExits({ claim: c, now: NOW }), name).toEqual([])
    }
    // E registry: a malformed instant never becomes readable (E-04 founder acceptance); a future one does (E-05, D5 after grace).
    expect(exitRegistry({ claim: malformed, now: NOW })).toBe('E-04:malformed_marker')
    expect(exitRegistry({ claim: future, now: NOW })).toBe('E-05')
    expect(RECONCILE_MARKER_UNREADABLE_TEXT).toContain('n’a pas pu être lue, ou est postérieure à maintenant')
    expect(hits(RECONCILE_MARKER_UNREADABLE_TEXT)).toEqual([])
  })

  it('NEGATIVE CONTROL — the same approved claim with an AGED marker (reconcile admitted) or a marker in grace still gets (2)', () => {
    const aged = approved(markerAt(new Date(NOW.getTime() - 3_600_000)), { refundAttempted: true })
    expect(reconcileRefusal(aged, NOW.getTime())).toBeNull()
    expect(arbitrationRefusal(aged, 'approve', NOW)?.error).toBe(approveRevisableText(false))
    expect(acceptedExits({ claim: aged, now: NOW })).toEqual(['reconcile'])
    const inGrace = approved(markerAt(new Date(NOW.getTime() - 60_000)), { refundAttempted: true })
    expect(arbitrationRefusal(inGrace, 'approve', NOW)?.error).toBe(approveRevisableText(false))
  })

  it('(3) PERMANENT otherwise — naming the close only when it is accepted', () => {
    expect(arbitrationRefusal(approved('stripe_failed: …', { refundAttempted: true, refundId: 'rf1' }), 'approve', NOW)?.error)
      .toBe('Approbation impossible : une nouvelle approbation ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle. Clôturez le dossier (« Clôturer ce dossier… »).')
    expect(approvePermanentText(false)).toBe('Approbation impossible : une nouvelle approbation ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle. Aucune action de l’application ne la clôt : vérifiez la commande dans Stripe.')
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

  it('AM-B3: refuse_final on every approved claim, arbitrationDecision null included', () => {
    for (const c of [approved(null), approved(null, { arbitrationDecision: null }), approved('stripe_failed: x', { refundAttempted: true })]) {
      expect(arbitrationRefusal(c, 'refuse_final', NOW)?.error).toBe('Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.')
    }
  })
})

describe('J-M31 — F15 texts verbatim (ER-R27: « abouti ou en attente »)', () => {
  it('GUIDANCE absence_proven_payable and approved_not_driven', () => {
    expect(moneyStateGuidance('absence_proven_payable')).toBe('Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement abouti ou en attente non expliqué. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt à l’instant écrit dans son détail, et seulement si la relecture avant moteur confirme encore la preuve.')
    expect(moneyStateGuidance('approved_not_driven')).toBe('Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts, et seulement si la vérification avant moteur le permet à ce moment. Aucune clôture manuelle sur cet état.')
  })

  it('MONEY label absence_proven_payable, with the instant or with the unreadable tail; the console renders it per claim', () => {
    const at = proofInstantFor(markerAt(NOW), NOW)
    expect(absenceProvenPayableLabel(`${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${at.toISOString()} (UTC).`))
      .toBe(`Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt le ${at.toISOString()} (UTC), relue avant le moteur`)
    expect(absenceProvenPayableLabel(`${MARKERS.PROOF_PAYABLE_V13} sans instant`))
      .toBe('Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts — instant illisible : approbation refusée, relancez « Réconcilier d’après la preuve »')
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
  const TOAST_OUTCOMES: ApprovalRefundOutcome[] = [
    { state: 'refunded', amountCents: 500 }, { state: 'failed', error: 'resume_mismatch' }, { state: 'failed', error: 'engine_failed' },
    { state: 'pending' }, { state: 'already_handled' }, null,
  ]
  const TOAST_KEYS = Array.from(new Set(TOAST_OUTCOMES.map((o) => approvalToast(o).key)))
  const APPROVAL_TOASTS: Array<[string, string]> = TOAST_KEYS.map((k) => [`approval toast ${k}`, (FR.claims.admin[k] ?? '').replace('{amount}', '5,00 €')])
  const TEXTS: Array<[string, string]> = [
    ...APPROVAL_TOASTS,
    ['money line identity_unread, reconcile refused', IDENTITY_UNREAD_NO_EXIT_TEXT],
    ['C4 unreadable', APPROVE_INSTANT_UNREADABLE],
    ['C4 premature', approvePrematureText(NOW.toISOString())],
    ['D14 (1)', APPROVE_LEGACY_PROOF],
    ['D14 (2) +close', approveRevisableText(true)], ['D14 (2)', approveRevisableText(false)],
    ['D14 (3) +close', approvePermanentText(true)], ['D14 (3)', approvePermanentText(false)],
    ['AM-B3', REFUSE_APPROVED_AM_B3],
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

  it('the four approval toasts are all enumerated, read from messages/fr.json', () => {
    expect(TOAST_KEYS.sort()).toEqual(['approvedFailed', 'approvedNotSent', 'approvedRefunded', 'approvedResumeMismatch'])
    for (const [name, text] of APPROVAL_TOASTS) expect(text.length, name).toBeGreaterThan(10)
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
  /** The ladder and console texts G2 deletes are rewritten by the reconcile and console slices (spec slices after W1). */
  const PENDING_LATER_SLICE = ['lib/claims.ts', 'components/claims/AdminFinancialVerification.tsx']

  it('none of the G2 strings exists in lib/, components/ or messages/ outside the two files the later slices rewrite', () => {
    const offenders = files.filter((f) => { const s = stripComments(read(f)); return G2.some((p) => s.includes(p)) })
    expect(offenders.filter((f) => !PENDING_LATER_SLICE.includes(f))).toEqual([])
  })

  it('NEGATIVE CONTROL — the HEAD guidance line 176 and label line 186 would be offenders', () => {
    const head176 = "absence_proven_payable:\n    'Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent.'"
    const head186 = "{ text: 'Absence de remboursement PROUVÉE (lignes + Stripe) — approuvée, non payée.' }"
    for (const s of [head176, head186]) expect(G2.some((p) => stripComments(s).includes(p))).toBe(true)
  })
})
