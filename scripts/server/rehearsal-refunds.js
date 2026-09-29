'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   rehearsal-refunds.js — THE ONE definition of « is this Refund row a documented
   rehearsal, or an unknown refund? ». PURE: no I/O, no DB, no Stripe, no env.

   FOUNDER ARBITRATION (2026-09-29): « Si ces trois lignes sont toutes des répétitions
   volontairement exécutées et déjà documentées, corrige le preflight pour qu'il distingue
   known rehearsal refund de unexpected refund SANS AFFAIBLIR LE CONTRÔLE. Je ne veux surtout
   pas supprimer le hard stop sur un vrai remboursement inconnu. La règle doit être fondée sur
   une preuve stable (id/event/order/run documenté), pas seulement sur une date. »

   WHAT THE RULE USED TO BE, and why it was worse than "no rule":

       refundsInWindow.filter((r) => !(r.amountCents === 1450 && r.createdAt.startsWith('2026-08-29')))

   An AMOUNT plus a DATE. It permitted ANY 1450-cent refund created on 2026-08-29 — a
   real unknown refund of that shape would have been waved through — while refusing the
   three rehearsals that were actually documented, because they happened later. The
   founder asked for identity, and identity is what a Stripe refund id is: it is minted
   by Stripe, it cannot be chosen, and it appears verbatim in the rehearsal records.

   WHY THE CROSS-CHECKS MATTER MORE THAN THE LIST. An allowlist of ids alone would still
   pass a row that carried a known id with a different order or a different amount — which
   is precisely what a tampered or mis-reconciled row looks like. So a known id is accepted
   ONLY when the order and the amount also match the record, and a known id in a
   non-succeeded state is refused too.

   AND THE CASE AN ID-KEYED ALLOWLIST WOULD OTHERWISE MISS. A Refund row with NO
   `stripeRefundId` — one Stripe never accepted, or one written before the call — has
   nothing to compare, so a naive `!known.has(id)` would let `undefined` slip through some
   implementations and a strict one would simply have no basis to vouch for it. It is
   REFUSED explicitly, with that reason spelled out, because « the allowlist cannot speak
   about this row » is not the same as « this row is fine ».

   THE EVIDENCE IS RECORDED BESIDE EACH ENTRY, and it is a document or a test in this
   repository — never a date, never my memory of a session.
   ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Refunds that were executed DELIBERATELY as documented rehearsals, on Stripe TEST.
 * Keyed on the Stripe refund id. Amount and order are cross-checked, not decorative.
 * Every `evidence` string names a file in this repository.
 */
const KNOWN_REHEARSAL_REFUNDS = [
  {
    ref: 'GR-N5TSM0',
    stripeRefundId: 're_3UB9bPKuol4dGnN10IdP5bzp',
    orderId: 'cmtju919h0001h7t6bkn5tsm0',
    amountCents: 500,
    executedOn: '2026-09-09',
    evidence:
      'docs/ops/REFUND-REHEARSAL-RUNBOOK.md (title + §11: « LES DEUX RÉPÉTITIONS EXÉCUTÉES le 2026-09-09 — ' +
      'GR-N5TSM0 partiel 500 c »); the same id is pinned in tests/phase2-email-timeline-correlate.test.ts ' +
      '(ROWS_PARTIAL); the same orderId is the hard-coded rehearsal target of phase2-refund-gate.js',
  },
  {
    ref: 'GR-GBZE1X',
    stripeRefundId: 're_3UAyauKuol4dGnN125UKXa5U',
    orderId: 'cmtj52ewh000320fboagbze1x',
    amountCents: 1450,
    executedOn: '2026-09-09',
    evidence:
      'docs/ops/REFUND-REHEARSAL-RUNBOOK.md §11 « SECONDE RÉPÉTITION EXÉCUTÉE — 2026-09-09 (UN refund FULL ' +
      '1450 c GR-GBZE1X) », which also records the same orderId cmtj52ewh000320fboagbze1x; the id is pinned ' +
      'in tests/phase2-email-timeline-correlate.test.ts (ROWS_FULL)',
  },
  {
    ref: 'GR-9IA5R6',
    stripeRefundId: 're_3UI22ZKuol4dGnN129DXgp4a',
    orderId: 'cmuay7ik10001yoe0m49ia5r6',
    amountCents: 500,
    executedOn: '2026-09-22',
    evidence:
      'MODE B rehearsal, executed and reconciled 2026-09-22 (commit dab754d): 500 c refunded through an ' +
      'ARBITRATED CLAIM, ledger equality proven twice, loyalty −5 → 13, one e-mail, gates closed. The ref ' +
      'GR-9IA5R6 is pinned in tests/phase2-modeb-gate-fallback.test.ts, tests/l10-refund-confirmation-i18n.test.ts ' +
      'and tests/l10-s21-bank-delay.test.ts. The Stripe object (amount 500, orderId, succeeded) was re-measured ' +
      'read-only on 2026-09-29. NOTE: unlike the two above, no docs/ops file names this id — the evidence is ' +
      'the three tests plus the measured Stripe object. Weaker, and recorded as weaker.',
  },
]

/* ── DELIBERATELY NOT IN THE LIST ────────────────────────────────────────────────
   GR-9CYOJJ · re_3U9rrGKuol4dGnN11KEHWf7p · 1450 c · order cmterr88p00212t8pyi9cyojj ·
   2026-08-29. THE OLD RULE PERMITTED EXACTLY THIS ROW — it is the 1450-cent refund of
   2026-08-29 the amount+date filter was written for — and searching this repository for
   its order id, its ref and its refund id returns NOTHING: no runbook, no log, no test.
   So the previous control was not merely mis-keyed, it was VOUCHING FOR A REFUND NOBODY
   DOCUMENTED. Tightening the rule makes that visible instead of silent, and the honest
   consequence is that the preflight keeps failing until the founder identifies it. Adding
   it here on a guess would be inventing the evidence the founder asked me to check.
   ─────────────────────────────────────────────────────────────────────────────── */

const KNOWN_BY_ID = new Map(KNOWN_REHEARSAL_REFUNDS.map((k) => [k.stripeRefundId, k]))

/**
 * Classify ONE Refund row. PURE.
 * @param {{stripeRefundId?: string|null, orderId?: string|null, amountCents?: number|null, status?: string|null}} row
 * @returns {{kind: 'known'|'unexpected', ref: string|null, why: string}}
 */
function classifyRefundRow(row) {
  const r = row || {}
  const id = typeof r.stripeRefundId === 'string' ? r.stripeRefundId.trim() : ''

  if (!id) {
    return {
      kind: 'unexpected',
      ref: null,
      why: 'no stripeRefundId — an allowlist keyed on the Stripe id cannot vouch for a row that has none',
    }
  }
  const k = KNOWN_BY_ID.get(id)
  if (!k) return { kind: 'unexpected', ref: null, why: 'stripeRefundId is not a documented rehearsal' }

  if (r.orderId !== k.orderId) {
    return { kind: 'unexpected', ref: k.ref, why: `documented id ${k.ref} on a DIFFERENT order (row …${String(r.orderId || '').slice(-6)})` }
  }
  if (Number(r.amountCents) !== k.amountCents) {
    return { kind: 'unexpected', ref: k.ref, why: `documented id ${k.ref} with a DIFFERENT amount (row ${r.amountCents}, record ${k.amountCents})` }
  }
  if (r.status !== 'succeeded') {
    return { kind: 'unexpected', ref: k.ref, why: `documented id ${k.ref} in status "${r.status}" — every documented rehearsal ended succeeded` }
  }
  return { kind: 'known', ref: k.ref, why: `documented rehearsal ${k.ref} (${k.executedOn})` }
}

/**
 * Split a set of rows. PURE. `unexpected` is what must HARD STOP.
 * @param {Array<object>} rows
 */
function splitRefundRows(rows) {
  const known = []
  const unexpected = []
  for (const row of rows || []) {
    const v = classifyRefundRow(row)
    ;(v.kind === 'known' ? known : unexpected).push({ row, ...v })
  }
  return { known, unexpected }
}

module.exports = { KNOWN_REHEARSAL_REFUNDS, classifyRefundRow, splitRefundRows }
