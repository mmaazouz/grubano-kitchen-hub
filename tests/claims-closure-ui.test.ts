// tests/claims-closure-ui.test.ts — T-49 round 13, slice W7
//   J-C08 (F07, F06)  the help page line per customer status
//   J-C09 (F08)       the console reason label and the ClaimSection reasons (static half; the pure half is in
//                     tests/claims-closure-provenance.test.ts)
//   J-C30 (H10, E0)   the two card sections outside the red heading, the intro, « Envoyer l’avis au client » disabled iff a blocker
//   J-C34 (H14, H07)  the declaration panel copy and the customer e-mail toast after each closing action
//   AMF-1             « Revérifier les remboursements soldés (35 jours) » and its toast
//   D0 (J-M29)        the card rendered from the route payload: a control iff its flag, a refused action renders the server text
//
// The consoles are rendered with react-dom/server from the payload they receive (the `initialData` / `initial` seam): no
// effect runs, so no route is called and what the operator sees is exactly what the payload flags allow.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ToastProvider } from '@/components/design-system'
import AdminFinancialVerification, { type FinancialVerificationPayload } from '@/components/claims/AdminFinancialVerification'
import AdminClaimsArbitration from '@/components/claims/AdminClaimsArbitration'
import { CUSTOMER_STATUSES, MARKERS, isStuckResolvable, reconcileRefusal, moneyStateGuidance } from '@/lib/claim-action-rules'
import { IDENTITY_UNREAD_TEXT } from '@/lib/claim-money-line'
import {
  settledReverifyToast, CLOSURE_NOTICES_INTRO, CLOSURE_BLOCKER_LINE, REFUNDED_UNPROVEN_TEXT, SETTLED_REVERIFY_BUTTON, NO_MONEY_HERE,
  D4_PRECLICK_CAPTION, LIST_UNREADABLE_TEXT, REFUNDED_UNPROVEN_RECONCILE_CAPTION, REFUNDED_UNPROVEN_NO_ACTION, CLOSURE_NOTICE_BUTTON,
  SETTLED_REVERIFY_TRUNCATED, SETTLED_REVERIFY_CAPTION, itemsCappedText,
} from '@/lib/claim-console-copy'
import { specSection, specCopyTable, messageAt, SPEC_LOCALES } from './support/spec-copy'

/* eslint-disable @typescript-eslint/no-explicit-any -- console payload fixtures */
type Row = Record<string, any>

// vitest compiles the components with the classic JSX transform (tsconfig "jsx": "preserve"): React.createElement is looked
// up as a global at render time. Next compiles them with the automatic runtime, so nothing changes in the app.
;(globalThis as { React?: unknown }).React = React
/** createElement without its overload set: the fixtures pass payload objects the consoles type loosely. */
const h = React.createElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => ReactElement

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const FR = JSON.parse(read('messages/fr.json'))

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const render = (el: ReactElement) => decode(renderToStaticMarkup(h(NextIntlClientProvider, { locale: 'fr', messages: FR, timeZone: 'UTC' }, h(ToastProvider, null, el))))
const textOf = (html: string) => html.replace(/<[^>]+>/g, '')
const COUNTS = { financialVerification: 0, reconcileRequired: 0, otherUnsettled: 0, total: 0, unfinalizedRefundRows: 0 }
const payload = (p: Row): FinancialVerificationPayload =>
  ({ financialVerification: [], reconcileRequired: [], otherUnsettled: [], unfinalizedRefundRows: [], counts: COUNTS, ...p }) as FinancialVerificationPayload
const card = (p: Row) => render(h(AdminFinancialVerification, { initialData: payload(p) }))
/** Every rendered <button>, with its label and whether it is disabled. */
const buttons = (html: string) => Array.from(html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g))
  .map((m) => ({ label: textOf(m[2]).trim(), disabled: /\sdisabled=""/.test(m[1]) }))
const count = (html: string, label: string) => buttons(html).filter((b) => b.label === label).length
/** The outer html of the element carrying data-section="name" (balanced on its tag). */
function sectionHtml(html: string, name: string): string {
  const marker = html.indexOf(`data-section="${name}"`)
  if (marker < 0) return ''
  const start = html.lastIndexOf('<div', marker)
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  return html.slice(start)
}
/** A « » value of a spec rule line `prefix « value »…`. */
const specQuote = (id: string, prefix: string): string => {
  const line = specSection(id).find((l) => l.trimStart().startsWith(prefix))
  if (!line) throw new Error(`${id}: no line starting ${prefix}`)
  return /« (.*) »/.exec(line)![1]
}

const RECONCILE = 'Réconcilier d’après la preuve'
const CLOSE = 'Clôturer ce dossier…'
const claimRow = (id: string, o: Row = {}): Row => ({
  id, orderId: `order_${id}`, reason: 'wrong_item', requestedAmountCents: 500, refundId: null, refundError: null, createdAt: '2026-09-10T00:00:00.000Z', ...o,
})

// ══ D0 / J-M29 — the card rendered from the route payload ═════════════════════════════════════════════════════════
describe('D0 (J-M29) — the financial-verification card renders a control iff its flag, and a refused action’s server text', () => {
  const REFUSAL = 'L’heure de début de la tentative de remboursement enregistrée sur cette réclamation n’a pas pu être lue, ou est postérieure à maintenant : la réconciliation est refusée, car cette tentative n’est pas établie comme terminée. Vérifiez la commande dans Stripe.'
  const P = payload({
    reconcileRequired: [claimRow('rr_refused', { status: 'refunding', refundError: 'reconcile_required: …', reconcilable: false, reconcileRefusal: REFUSAL })],
    financialVerification: [claimRow('fv1', {
      status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x', reconcilable: true, ambiguity: 'refund_moved_unattributed',
      candidateRefunds: [
        { id: 'rf_ok', status: 'succeeded', amountCents: 300, stripeRefundId: 're_ok', createdAt: '2026-09-10T00:00:00.000Z', belongsToAnotherClaim: false, alreadyBoundToAnotherClaim: false, refusal: null },
        { id: 'rf_bound', status: 'succeeded', amountCents: 300, stripeRefundId: 're_b', createdAt: '2026-09-10T00:00:00.000Z', belongsToAnotherClaim: false, alreadyBoundToAnotherClaim: true, refusal: 'bound_to_other_claim' },
      ],
    })],
    otherUnsettled: [
      claimRow('v13', { status: 'approved', refundError: `${MARKERS.PROOF_PAYABLE_V13} …`, moneyState: 'absence_proven_payable', reconcilable: true, resolvable: false, refund: null }),
      claimRow('failed', { status: 'approved', refundAttempted: true, refundId: 'rf_f', refundError: 'stripe_failed: x', moneyState: 'refund_error_recorded', reconcilable: false, resolvable: true, refund: { id: 'rf_f', status: 'failed', stripeRefundId: 're_f', reason: null } }),
      claimRow('own_mismatch', { status: 'refunding', refundId: 'rf_own', refundError: 'resume_mismatch: x', moneyState: 'stripe_succeeded_claim_unreconciled', reconcilable: true, resolvable: false, refund: { id: 'rf_own', status: 'succeeded', stripeRefundId: 're_own', reason: 'claim:own_mismatch' } }),
      claimRow('hold_with_refund_id', { status: 'approved', refundAttempted: true, refundId: 'rf_h', refundError: 'refund_safety_hold: x', moneyState: 'refund_error_recorded', reconcilable: false, resolvable: true, refund: { id: 'rf_h', status: 'succeeded', stripeRefundId: 're_h', reason: null } }),
    ],
    unfinalizedRefundRows: [
      { rowId: 'rf_u1', refundRowId: 'rf_u1', orderId: 'order_u1', amountCents: 500, stripeRefundId: 're_u1', claimId: 'settled1', claimStatus: 'refunded', refundError: null, rowReason: 'claim:settled1', reconcilable: true, reconcileRefusal: null },
      { rowId: 'rf_u2', refundRowId: 'rf_u2', orderId: 'order_u2', amountCents: 500, stripeRefundId: null, claimId: 'fv9', claimStatus: 'approved', refundError: 'engine_failed: x', rowReason: null, reconcilable: false, reconcileRefusal: 'Cette réclamation n’est pas en attente de réconciliation.' },
    ],
    counts: { ...COUNTS, reconcileRequired: 1, financialVerification: 1, otherUnsettled: 4, total: 6, unfinalizedRefundRows: 2 },
  })
  const html = render(h(AdminFinancialVerification, { initialData: P }))

  it('« Réconcilier d’après la preuve » count === the reconcilable flags (claim rows + unfinalized rows); « Clôturer ce dossier… » === resolvable', () => {
    const claimRows = [...P.reconcileRequired, ...P.financialVerification, ...P.otherUnsettled]
    const unfinalized = P.unfinalizedRefundRows ?? []
    expect(count(html, RECONCILE)).toBe(claimRows.filter((r) => r.reconcilable === true).length + unfinalized.filter((u) => u.reconcilable === true).length)
    expect(count(html, RECONCILE)).toBe(4)
    expect(count(html, CLOSE)).toBe(P.otherUnsettled.filter((r) => r.resolvable === true).length)
  })

  it('a refused reconcile renders the server refusal text (claim row and unfinalized row), never a silent disabled control', () => {
    expect(textOf(html)).toContain(REFUSAL)
    expect(textOf(html)).toContain('Cette réclamation n’est pas en attente de réconciliation.')
    expect(buttons(html).filter((b) => b.label === RECONCILE && b.disabled)).toEqual([])
  })

  it('attribution candidates: enabled iff the server pre-check is null, a refused one shows its legend; the card never renders « Approuver »', () => {
    const attribute = buttons(html).filter((b) => b.label === 'Attribuer')
    expect(attribute.map((b) => b.disabled)).toEqual([false, true])
    expect(textOf(html)).toContain('déjà LIÉ à une autre réclamation — sera refusé')
    expect(textOf(html)).not.toContain('Approuver')
  })

  it('NEGATIVE CONTROL (J-M29) — approved + SAFETY_HOLD with refundId set: reconcilable false in the payload, and no reconcile button on its card', () => {
    const one = sectionOfClaim(html, 'hold_with_refund_id')
    expect(count(one, RECONCILE)).toBe(0)
    expect(count(one, CLOSE)).toBe(1)
  })

  it('W1 carry-over (F15): a resume_mismatch whose bound row was read and carries the claim’s stamp reads identity_unread — never INDÉTERMINÉ', () => {
    const one = textOf(sectionOfClaim(html, 'own_mismatch'))
    expect(one).toContain(IDENTITY_UNREAD_TEXT)
    expect(one).not.toContain('INDÉTERMINÉ')
  })

  it('D4 / J-M33: the caption before the click on an approved reconcilable row contains « peut placer la réclamation en vérification financière »', () => {
    expect(textOf(sectionOfClaim(html, 'v13'))).toContain(D4_PRECLICK_CAPTION)
    expect(D4_PRECLICK_CAPTION).toContain('peut placer la réclamation en vérification financière')
    expect(textOf(sectionOfClaim(html, 'own_mismatch'))).not.toContain(D4_PRECLICK_CAPTION) // refunding: not a D4 admission
  })

  it('D7 / J-M29: the unfinalized rows are keyed by the payload rowId', () => {
    expect(stripComments(read('components/claims/AdminFinancialVerification.tsx'))).toContain('<li key={u.rowId ?? u.refundRowId}>')
  })
})

/** The card html of one claim row (by its « Réclamation : <code>id</code> » line). */
function sectionOfClaim(html: string, id: string): string {
  const at = html.indexOf(`<code>${id}</code>`)
  const start = html.lastIndexOf('rounded-grubano-xl border border-red-300 bg-red-50 p-4', at)
  const next = html.indexOf('rounded-grubano-xl border border-red-300 bg-red-50 p-4', at)
  return html.slice(start, next < 0 ? html.length : next)
}

// ══ J-C30 — the two sections outside the red heading ═══════════════════════════════════════════════════════════════
describe('J-C30 (H10, E0) — « Réclamations remboursées dont la ligne liée n’est pas établie » and « Avis client non envoyés »', () => {
  const NOTICES = {
    items: [
      { claimId: 'n_ok', orderId: 'order_n_ok', kind: 'refused_confirmed', decidedAt: '2026-09-11T10:00:00.000Z', blocker: null },
      { claimId: 'n_unproven', orderId: 'order_n_unp', kind: 'refunded', decidedAt: '2026-09-11T09:00:00.000Z', blocker: 'refunded_row_unproven' },
      { claimId: 'n_ambiguous', orderId: 'order_n_amb', kind: 'refunded', decidedAt: '2026-09-11T08:00:00.000Z', blocker: 'refunded_row_ambiguous' },
    ],
    total: 3, scanTruncated: false,
  }
  const UNPROVEN = {
    items: [
      { id: 'u_reconcilable', orderId: 'order_u_r', refundId: 'rf_0', refund: { id: 'rf_0', orderId: 'order_u_r', status: 'succeeded', amountCents: 0, stripeRefundId: 're_0' }, reconcilable: true },
      { id: 'u_missing', orderId: 'order_u_m', refundId: 'rf_gone', refund: null, reconcilable: false },
    ],
    total: 2, scanTruncated: true,
  }

  it('notices only → the sections render, and no « Vérification financière requise » (NEGATIVE CONTROL: one claim row brings the red heading back)', () => {
    const html = card({ closureNotices: NOTICES, refundedUnproven: UNPROVEN, counts: { ...COUNTS, closureNoticesMissing: 3, refundedUnproven: 2 } })
    expect(textOf(html)).not.toContain('Vérification financière requise')
    expect(sectionHtml(html, 'closure-notices')).not.toBe('')
    expect(sectionHtml(html, 'refunded-unproven')).not.toBe('')
    const withRow = card({ closureNotices: NOTICES, otherUnsettled: [claimRow('x', { status: 'approved', moneyState: 'approved_not_driven', reconcilable: false, resolvable: false, refund: null })] })
    expect(textOf(withRow)).toContain('Vérification financière requise (1)')
    // the red heading never contains the sections: they are siblings, outside it
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(withRow)![1]
    expect(textOf(h2)).not.toContain('Avis client non envoyés')
    expect(withRow.indexOf('data-section="closure-notices"')).toBeGreaterThan(withRow.indexOf('</h2>'))
  })

  it('headings carry the count and the « + » of a truncated scan; the intro and section A text are H10 verbatim (ER-C18: H10’s intro)', () => {
    const html = card({ closureNotices: NOTICES, refundedUnproven: UNPROVEN })
    expect(textOf(sectionHtml(html, 'closure-notices'))).toContain('Avis client non envoyés (3)')
    expect(textOf(sectionHtml(html, 'refunded-unproven'))).toContain('Réclamations remboursées dont la ligne liée n’est pas établie (2+)')
    expect(textOf(sectionHtml(html, 'refunded-unproven'))).toContain('Liste incomplète : plus de 5000')
    expect(CLOSURE_NOTICES_INTRO).toBe(specQuote('H10', '- Intro, as Track B I3:'))
    // IMPLEMENTATION NOTE (W7 fixer) on H10 / E-13 (ER-C22, second half): the frozen text gains « a un statut inconnu, ».
    expect(REFUNDED_UNPROVEN_TEXT).toBe(specQuote('H10', '- Text:').replace('est échouée sans identifiant Stripe, ou ', 'est échouée sans identifiant Stripe, a un statut inconnu, ou '))
    expect(REFUNDED_UNPROVEN_TEXT).not.toBe(specQuote('H10', '- Text:'))
    expect(textOf(sectionHtml(html, 'closure-notices'))).toContain(CLOSURE_NOTICES_INTRO)
    expect(textOf(sectionHtml(html, 'refunded-unproven'))).toContain(REFUNDED_UNPROVEN_TEXT)
    expect(CLOSURE_NOTICES_INTRO).toContain('Les clôtures antérieures à cette version ne sont pas listées et ne recevront aucun avis.')
  })

  it('« Envoyer l’avis au client » is disabled iff a blocker is set, and each blocker renders its line (H10 texts verbatim)', () => {
    const html = sectionHtml(card({ closureNotices: NOTICES }), 'closure-notices')
    expect(buttons(html).filter((b) => b.label === CLOSURE_NOTICE_BUTTON).map((b) => b.disabled)).toEqual(NOTICES.items.map((n) => n.blocker !== null))
    expect(CLOSURE_BLOCKER_LINE.refunded_row_unproven).toBe(specQuote('H10', '- refunded_row_unproven:'))
    expect(CLOSURE_BLOCKER_LINE.refunded_row_failed).toBe(specQuote('H10', '- refunded_row_failed:'))
    expect(textOf(html)).toContain(CLOSURE_BLOCKER_LINE.refunded_row_unproven)
    expect(textOf(html)).toContain(CLOSURE_BLOCKER_LINE.refunded_row_ambiguous)
    expect(CLOSURE_BLOCKER_LINE.refunded_row_ambiguous).not.toMatch(/voir « /) // it names no section: no section lists it
    expect(textOf(html)).toContain('Refus confirmé')
  })

  it('section A: reconcile iff reconcilable, with its caption; otherwise the no-action line', () => {
    const html = sectionHtml(card({ refundedUnproven: UNPROVEN }), 'refunded-unproven')
    expect(count(html, RECONCILE)).toBe(1)
    expect(textOf(html)).toContain(REFUNDED_UNPROVEN_RECONCILE_CAPTION)
    expect(textOf(html)).toContain(REFUNDED_UNPROVEN_NO_ACTION)
    const line = specSection('H10').find((l) => l.startsWith('- When reconcilable:'))!
    expect(REFUNDED_UNPROVEN_RECONCILE_CAPTION).toBe(/with caption « (.*?) »/.exec(line)![1])
    expect(REFUNDED_UNPROVEN_NO_ACTION).toBe(/Otherwise « (.*?) »/.exec(line)![1])
  })

  // W7 fixer (H10): each list returns at most 200 items of its total; the section says which part it lists.
  it('a section whose items are fewer than its total says so (oldest / most recently closed); a complete list carries no such line', () => {
    const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, orderId: `order_${prefix}${i}`, refundId: null, refund: null, reconcilable: false }))
    const html = card({
      refundedUnproven: { items: many(200, 'u'), total: 230, scanTruncated: false },
      closureNotices: { items: [{ claimId: 'n1', orderId: 'order_n1', kind: 'refused_confirmed', decidedAt: null, blocker: null }], total: 4, scanTruncated: false },
    })
    expect(textOf(sectionHtml(html, 'refunded-unproven'))).toContain(itemsCappedText(200, 230, 'oldest'))
    expect(textOf(sectionHtml(html, 'closure-notices'))).toContain(itemsCappedText(1, 4, 'newest'))
    expect(itemsCappedText(200, 230, 'oldest')).toContain('200 premières affichées sur 230')
    // NEGATIVE CONTROL: the J-C30 fixture lists every item it counts → no capped line
    expect(textOf(card({ closureNotices: NOTICES, refundedUnproven: { ...UNPROVEN, scanTruncated: false } }))).not.toContain('premières affichées')
  })

  it('an unreadable list renders its section with « Liste illisible pour l’instant — rechargez. » and an unknown count (fail visible)', () => {
    const html = card({ closureNotices: { error: 'unreadable' }, refundedUnproven: { error: 'unreadable' } })
    expect(textOf(sectionHtml(html, 'closure-notices'))).toContain(LIST_UNREADABLE_TEXT)
    expect(textOf(sectionHtml(html, 'closure-notices'))).toContain('Avis client non envoyés (?)')
    expect(textOf(sectionHtml(html, 'refunded-unproven'))).toContain(LIST_UNREADABLE_TEXT)
  })

  it('the send button calls POST /api/admin/claims/[id]/closure-notice with an empty body; no « Appliquer l’échec de la ligne » anywhere', () => {
    const src = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    expect(src).toContain("const res = await fetch(`/api/admin/claims/${claimId}/closure-notice`, { method: 'POST' })")
    expect(src).toContain('onClick={() => sendClosureNotice(n.claimId)}')
    for (const f of ['components/claims/AdminFinancialVerification.tsx', 'components/claims/AdminClaimsArbitration.tsx', 'lib/claim-console-copy.ts']) {
      expect(read(f), f).not.toContain('Appliquer l’échec de la ligne')
    }
  })
})

// ══ AMF-1 — « Revérifier les remboursements soldés (35 jours) » ═════════════════════════════════════════════════════
describe('AMF-1 — the settled re-verification control and its toast', () => {
  it('the control renders on an empty queue and on a full one (an E-09 claim is in no list), and calls POST reconcile-refunds', () => {
    expect(count(card({}), SETTLED_REVERIFY_BUTTON)).toBe(1)
    expect(textOf(card({}))).not.toContain('Vérification financière requise')
    expect(count(card({ otherUnsettled: [claimRow('x', { status: 'approved', moneyState: 'approved_not_driven', reconcilable: false, resolvable: false, refund: null })] }), SETTLED_REVERIFY_BUTTON)).toBe(1)
    expect(SETTLED_REVERIFY_BUTTON).toBe('Revérifier les remboursements soldés (35 jours)')
    const src = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    expect(src).toContain("const res = await fetch('/api/admin/claims/reconcile-refunds', { method: 'POST' })")
    expect(src).toContain('const r = settledReverifyToast(body)')
  })

  it('the toast states the settledReverify counts and « Aucune action ici ne déplace d’argent. »; a reversal, an unreadable read or a truncated pass needs attention', () => {
    const sr = { checked: 5, reverted: 1, standing: 2, unreadable: 0, unproven: 2, truncated: false }
    const t = settledReverifyToast({ ok: true, scanned: 4, reconciled: 1, settledReverify: sr })
    for (const n of ['5 réclamation(s) examinée(s)', '1 marquée(s)', '2 toujours rapportée(s)', '2 non établie(s)', '0 illisible(s)', '1 réconciliée(s) ou marquée(s) sur 4 examinée(s)']) expect(t.text, n).toContain(n)
    // W7 fixer (AMF-1): `checked` counts a read that threw and a lost CAS; `scanned` counts pending and missing rows too.
    expect(t.text).not.toContain('relue(s) chez Stripe')
    expect(t.text).not.toContain('dont la ligne liée est terminale')
    expect(t.text.endsWith(NO_MONEY_HERE)).toBe(true)
    expect(NO_MONEY_HERE).toBe('Aucune action ici ne déplace d’argent.')
    expect(t.needsAttention).toBe(true)
    expect(settledReverifyToast({ ok: true, settledReverify: { ...sr, reverted: 0 } }).needsAttention).toBe(false)
    expect(settledReverifyToast({ ok: true, settledReverify: { ...sr, reverted: 0, truncated: true } })).toMatchObject({ needsAttention: true })
    expect(settledReverifyToast({ ok: true, settledReverify: { ...sr, reverted: 0, truncated: true } }).text).toContain('Liste incomplète')
    // W7 fixer (AMF-1): a truncated pass names no ineffective remedy — a new pass re-reads the same oldest claims first.
    const truncated = settledReverifyToast({ ok: true, settledReverify: { ...sr, reverted: 0, truncated: true } }).text
    expect(truncated).toContain(SETTLED_REVERIFY_TRUNCATED)
    expect(SETTLED_REVERIFY_TRUNCATED).toContain('un nouveau passage relit les mêmes en premier')
    expect(SETTLED_REVERIFY_TRUNCATED).toContain('vérifiez-les dans Stripe')
    expect(truncated).not.toMatch(/relancez/i)
    expect(SETTLED_REVERIFY_CAPTION).toContain('au plus les 100 réclamations remboursées les plus anciennes')
    expect(SETTLED_REVERIFY_CAPTION).not.toContain('100 au plus par passage')
    // NEGATIVE CONTROL: the round-1 truncated clause (« … : relancez. ») is caught by the same assertion
    expect(' Liste incomplète (plus de 100 réclamations, ou fenêtre non lue entièrement) : relancez.').toMatch(/relancez/i)
    // NEGATIVE CONTROL: no settledReverify in the answer → nothing is claimed, attention required
    const none = settledReverifyToast({ ok: true })
    expect(none.needsAttention).toBe(true)
    expect(none.text).toContain('rien n’est établi')
    expect(none.text).not.toMatch(/\d+ marquée/)
  })
})

// ══ J-C34 — the operator declaration panel copy ═════════════════════════════════════════════════════════════════════
describe('J-C34 (H14, H07) — the declaration panels and the customer e-mail toast after every closing action', () => {
  const H14 = specQuote('H14', 'AdminClaimsArbitration.tsx panel (~277)')
  const PLACEHOLDER = specQuote('H14', 'Placeholder in both panels:')
  const AFV = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
  const ARB = stripComments(read('components/claims/AdminClaimsArbitration.tsx'))

  it('both panels carry the H14 literal verbatim and its placeholder', () => {
    expect(H14).toContain('tentent de lui envoyer un e-mail de clôture')
    expect(H14).toContain('aucun e-mail n’est envoyé tant que les réclamations sont fermées')
    for (const [name, src] of [['AdminFinancialVerification', AFV], ['AdminClaimsArbitration', ARB]]) {
      expect(src, name).toContain(H14)
      expect(src, name).toContain(`placeholder="${PLACEHOLDER}"`)
    }
    expect(PLACEHOLDER).toBe('Ce qui s’est réellement passé (facultatif, jamais montré au client)…')
  })

  const fnBody = (src: string, head: string) => { const a = src.indexOf(head); return a < 0 ? '' : src.slice(a, src.indexOf('}, [', a)) }
  it('after decide / resolveStuck / reconcile / attribute / adopt / closure-notice, customerEmailLine(body.customerEmail) drives a toast', () => {
    for (const head of ['const reconcile = useCallback(', 'const attribute = useCallback(', 'const resolveStuck = useCallback(', 'const adoptStripe = useCallback(', 'const sendClosureNotice = useCallback(']) {
      const body = fnBody(AFV, head)
      expect(body, head).toMatch(/const e = customerEmailLine\(\((body|data) as \{ customerEmail\?: \{ status\?: string; why\?: string \} \| null \}\)\.customerEmail\)/)
      expect(body, head).toContain('if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])')
    }
    for (const head of ['const decide = useCallback(', 'const resolveStuck = useCallback(']) {
      expect(fnBody(ARB, head), head).toContain('if (e) toast[e.tone](t(`admin.customerEmail.${e.key}`))')
    }
  })

  it('NEGATIVE CONTROL — the HEAD panel text (no e-mail sentence) fails; deleting the toast after resolveStuck fails the pin (break/restore)', () => {
    const head = 'Aucune de ces actions ne rembourse ni ne relance quoi que ce soit. Elles enregistrent votre déclaration et libèrent la commande pour le client.'
    expect(head.includes(H14)).toBe(false)
    const broken = AFV.replace(/(const resolveStuck = useCallback\([\s\S]*?)\n\s*if \(e\) toast\[e\.tone\]\(CUSTOMER_EMAIL_FR\[e\.key\]\)/, '$1')
    expect(broken).not.toBe(AFV)
    expect(fnBody(broken, 'const resolveStuck = useCallback(')).not.toContain('if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])')
  })
})

// ══ J-C08 — the help page line per customer status ══════════════════════════════════════════════════════════════════
const HELP = 'app/[locale]/eat/order/[orderId]/help/page.tsx'
/** status → the eat.help key its eligibilityLabel branch returns (the existing-claim block only). */
function helpBranches(src: string): Record<string, string> {
  const code = stripComments(src)
  const a = code.indexOf('const eligibilityLabel = (): string => {')
  const block = code.slice(a, code.indexOf('switch (eligibility?.reason)', a))
  const out: Record<string, string> = {}
  for (const m of Array.from(block.matchAll(/if \(([^\n]*?)\) return t\('(\w+)'\)/g))) {
    for (const s of Array.from(m[1].matchAll(/ex\.status === '(\w+)'/g))) out[s[1]] ??= m[2]
  }
  return out
}

describe('J-C08 (F07, F06) — help page lines per customer status', () => {
  const EXPECTED: Record<string, string> = {
    restaurant_review: 'claimAlreadyFiled', financial_verification: 'claimInReview', arbitration: 'claimInReview', refunding: 'claimRefunding',
    approved: 'claimApproved', refunded: 'claimRefunded', refund_unconfirmed: 'claimRefundUnconfirmed', closed_by_support: 'claimClosedBySupport',
    refused: 'claimRefused', refused_final: 'claimRefused', refused_by_grubano: 'claimRefused',
  }

  it('the existing-claim branch maps exactly F07, and every CUSTOMER_STATUSES value has a branch', () => {
    const branches = helpBranches(read(HELP))
    expect(branches).toEqual(EXPECTED)
    expect(CUSTOMER_STATUSES.filter((s) => !(s in branches))).toEqual([])
  })

  it('eat.help.claimRefundUnconfirmed === claims.status.refund_unconfirmed in each locale', () => {
    for (const loc of SPEC_LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      expect(m.eat.help.claimRefundUnconfirmed, loc).toBe(m.claims.status.refund_unconfirmed)
    }
  })

  it('the eligibility fetch stays behind the enabled check', () => {
    const code = stripComments(read(HELP))
    expect(code).toMatch(/if \(d\?\.enabled === true\) \{\s*setClaimsEnabled\(true\)\s*setEligibility\(/)
    expect(code).toContain('{claimsEnabled && submitState !== \'done\' && eligibility && !eligibility.canClaim && (')
  })

  it('NEGATIVE CONTROL — a synthetic source without the refund_unconfirmed branch is reported (status without branch); break/restore on the real file', () => {
    const src = read(HELP)
    const broken = src.replace("      if (ex.status === 'refund_unconfirmed') return t('claimRefundUnconfirmed')\n", '')
    expect(broken).not.toBe(src)
    expect(CUSTOMER_STATUSES.filter((s) => !(s in helpBranches(broken)))).toEqual(['refund_unconfirmed'])
  })
})

// ══ J-C09 (static half) — the reasons by author ═════════════════════════════════════════════════════════════════════
describe('J-C09 (F08) — ClaimSection and the console reason label', () => {
  it('ClaimSection shows the restaurant reason only when the payload carries it, and Grubano’s reason under its own label', () => {
    const cs = stripComments(read('components/claims/ClaimSection.tsx'))
    expect(cs).toContain('const showRefusalReason = !!ec.restaurantResponseReason')
    expect(cs).toMatch(/\{ec\.arbitrationReason && \(\s*<p[^>]*>\s*<span className="font-semibold">\{t\('client\.grubanoDecisionReason'\)\}:<\/span> \{ec\.arbitrationReason\}/)
  })

  it('the arbitration console labels the note by the restaurant’s answer', () => {
    expect(stripComments(read('components/claims/AdminClaimsArbitration.tsx'))).toContain("t(c.restaurantResponse === 'accepted' ? 'admin.restaurantNote' : 'admin.refusalReason')")
  })

  it('claims.client.grubanoDecisionReason and claims.admin.restaurantNote carry the F08 values in 5 locales', () => {
    const table = specCopyTable('F08', 'claims.')
    expect(Object.keys(table).sort()).toEqual(['claims.admin.restaurantNote', 'claims.client.grubanoDecisionReason'])
    for (const loc of SPEC_LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      for (const [path, vals] of Object.entries(table)) expect(messageAt(m, path), `${loc} ${path}`).toBe(vals[loc])
    }
  })

  it('NEGATIVE CONTROL — the HEAD condition (the restaurant reason under any refusal status) fails the static pin', () => {
    const head = "const showRefusalReason = (s === 'refused' || s === 'refused_final') && !!ec.restaurantResponseReason"
    expect(head.includes('const showRefusalReason = !!ec.restaurantResponseReason')).toBe(false)
  })
})

// ══ ARB rendered — the arbitration console from its payload (J-M29 on the approve / refuse_final pair) ════════════════
describe('J-M29 (ARB) — approve and refuse_final disabled iff the server verdict refuses, the refusal text shown', () => {
  it('a refused approve is disabled with its server text; a claim both decisions accept has both enabled', () => {
    const APPROVE_REFUSAL = 'Cette réclamation n’est pas en arbitrage.'
    const html = render(h(AdminClaimsArbitration, {
      initial: {
        claims: [
          { id: 'a1', orderId: 'order_a1', reason: 'wrong_item', requestedAmountCents: 500, approveRefusal: null, refuseFinalRefusal: null },
          { id: 'a2', orderId: 'order_a2', reason: 'wrong_item', requestedAmountCents: 500, approveRefusal: APPROVE_REFUSAL, refuseFinalRefusal: null },
        ],
      },
    }))
    const approve = buttons(html).filter((b) => b.label === FR.claims.admin.approve)
    const refuse = buttons(html).filter((b) => b.label === FR.claims.admin.refuseFinal)
    expect(approve.map((b) => b.disabled)).toEqual([false, true])
    expect(refuse.map((b) => b.disabled)).toEqual([false, false])
    expect(textOf(html)).toContain(APPROVE_REFUSAL)
    expect(FR.claims.admin.refuseFinal).toBe('Refuser définitivement')
  })

  // W7 fixer (J-M29, ARB rendered half): « Remboursements à traiter » renders « Clôturer ce dossier… » iff the row's
  // resolvable flag (the server's isStuckResolvable verdict on the same facts), and the state guidance otherwise.
  // F18 (h) — customerClaimStatus ⇔ sendClaimClosureEmail refunded_row_unproven parity — is pinned by J-C25
  // (tests/claims-closure-emails.test.ts), not here.
  it('ARB « Remboursements à traiter »: « Clôturer ce dossier… » iff resolvable (server verdict), the guidance line otherwise', () => {
    const V13 = `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le 2026-09-12T13:00:00.000Z (UTC).`
    const fixtures: Array<{ facts: Row; row: Row }> = [
      { facts: { status: 'approved', refundAttempted: true, refundId: 'rf_f', refundError: 'stripe_failed: x', boundRow: { id: 'rf_f', orderId: 'order_r1', status: 'failed', stripeRefundId: 're_f', reason: null } }, row: { moneyState: 'refund_error_recorded', refund: { id: 'rf_f', status: 'failed', actualAmountCents: 0, stripeRefundId: 're_f' } } },
      { facts: { status: 'approved', refundAttempted: true, refundId: 'rf_h', refundError: 'refund_safety_hold: x', boundRow: { id: 'rf_h', orderId: 'order_r2', status: 'succeeded', stripeRefundId: 're_h', reason: null } }, row: { moneyState: 'refund_error_recorded', refund: { id: 'rf_h', status: 'succeeded', actualAmountCents: 300, stripeRefundId: 're_h' } } },
      { facts: { status: 'approved', refundAttempted: false, refundId: null, refundError: null }, row: { moneyState: 'approved_not_driven', refund: null } },
      { facts: { status: 'approved', refundAttempted: false, refundId: null, refundError: V13 }, row: { moneyState: 'absence_proven_payable', refund: null } },
      { facts: { status: 'refunding', refundAttempted: true, refundId: 'rf_p', refundError: null, boundRow: { id: 'rf_p', orderId: 'order_r5', status: 'pending', stripeRefundId: 're_p', reason: 'claim:r5' } }, row: { moneyState: 'stripe_pending', refund: { id: 'rf_p', status: 'pending', actualAmountCents: 0, stripeRefundId: 're_p' } } },
    ]
    const rows: Row[] = fixtures.map(({ facts, row }, i) => ({
      id: `r${i + 1}`, orderId: `order_r${i + 1}`, reason: 'wrong_item', requestedAmountCents: 500, status: facts.status, refundError: facts.refundError,
      resolvable: isStuckResolvable(facts as never), reconcilable: reconcileRefusal(facts as never) === null, actualRefundedCents: null, ...row,
    }))
    expect(rows.map((r) => r.resolvable)).toContain(true)
    expect(rows.map((r) => r.resolvable)).toContain(false)
    const html = render(h(AdminClaimsArbitration, { initial: { actionableRefunds: rows } }))
    expect(textOf(html)).toContain(`Remboursements à traiter (${rows.length})`)
    expect(count(html, CLOSE)).toBe(rows.filter((r) => r.resolvable).length)
    for (const r of rows.filter((x) => !x.resolvable)) expect(textOf(html), r.id).toContain(moneyStateGuidance(r.moneyState))
    // NEGATIVE CONTROL: the same rows with every flag false render no « Clôturer ce dossier… »
    expect(count(render(h(AdminClaimsArbitration, { initial: { actionableRefunds: rows.map((r) => ({ ...r, resolvable: false })) } })), CLOSE)).toBe(0)
  })
})
