// tests/claims-closure-copy.test.ts — T-49 round 13, slice W6: J-C12 (F10 (1)(a)(b), H12, R-B0-1), J-C13 (F10 (2)-(5), H04,
// R-D4), J-C18 (F11, E-08, E-09), J-C32 (H04, H12), the F08 / F09 values and payload pins, and the ER-C14 guard.
//
// Expected values are read from the frozen specification's own tables (tests/support/spec-copy). HEAD values come from
// tests/fixtures/claims-copy-head-1829aeb.json, extracted byte-for-byte from `git show 1829aeb:messages/<locale>.json`.
//
// IMPLEMENTATION NOTE (W6) on ER-C14: the customer strings that promised a follow-up the code cannot establish are reworded
// in 5 locales — claims.client.contestSuccess / contestDescription (a decision only the CLAIMS-gated arbitrate route can
// make), eat.help.refundEstimate (« sera examinée »), eat.help.refundOffBody (« nous vous répondrons personnellement »),
// claimEmails.orderCancelledPaid.bodyExisting (« elle suit son circuit normal ») — and pinned by FOLLOW_UP_BY_LOCALE below.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { specCopyTable, messageAt, SPEC_LOCALES, type SpecLocale } from './support/spec-copy'

const { db, sendMock } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn() } }, sendMock: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/transactional-emails', () => ({ sendTransactional: sendMock, logEmailSkipped: vi.fn() }))
vi.mock('@/lib/onboarding-nudge', () => ({ resolveNudgeLocale: (l: string | null | undefined) => l ?? 'fr' }))
const MSG: Record<string, unknown> = Object.fromEntries(['fr', 'en', 'es', 'it', 'ar'].map((l) => [l, JSON.parse(readFileSync(`messages/${l}.json`, 'utf8'))]))
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = MSG[locale]
      for (const p of `${namespace}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[p]
      if (typeof cur !== 'string') throw new Error(`missing i18n key ${locale}:${namespace}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m))
    },
}))

import { sendClaimAckEmail, sendClaimDecisionEmail } from '@/lib/claim-emails'
import { orderRef } from '@/lib/order-ref'
import { claimClosureKind, customerClaimStatus, refusalEmailKind, customerClaimReasons, MARKERS, type ClaimFacts } from '@/lib/claim-action-rules'

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed message catalogs */
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const M = MSG as Record<SpecLocale, any>
const HEAD = JSON.parse(read('tests/fixtures/claims-copy-head-1829aeb.json')) as Record<SpecLocale, Record<string, string>>
const flatten = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(flatten) : [])
const customerStrings = (l: SpecLocale) => [...flatten(M[l].claimEmails), ...flatten(M[l].eat?.help), ...flatten(M[l].claims.client)]

// ══ J-C12 ══════════════════════════════════════════════════════════════════════════════════════════
const NOTIFY_BY_LOCALE: Record<SpecLocale, RegExp> = {
  fr: /vous serez informé|dès qu’une décision|s’affichera ici|suivez sa réponse|Grubano arbitrera/i,
  en: /(you('|’)ll|will) be (notified|informed)|will appear here|check this page|will arbitrate/i,
  es: /(le|te) (informaremos|avisaremos)|aparecerá aquí|consulte su respuesta|arbitrará/i,
  it: /sarà informato|la informeremo|apparirà|arbitrerà/i,
  ar: new RegExp('سيتم إبلاغك|سنُعلمك|سيظهر|تابع رده|ستتولى Grubano', 'u'),
}
const ARBITRATE_CLASS: Record<SpecLocale, RegExp> = {
  fr: /Grubano arbitrera/gi, en: /will arbitrate/gi, es: /arbitrará/gi, it: /arbitrerà/gi, ar: new RegExp('ستتولى Grubano', 'gu'),
}
const CONDITIONAL: Record<SpecLocale, string> = {
  fr: 'Si la contestation vous est proposée', en: 'If contesting is offered', es: 'Si en el seguimiento', it: 'Se nella pagina', ar: 'إذا عُرض عليك الاعتراض',
}
/** F10 (b): the arbitration class is allowed only in a string that carries the conditional. */
function notifyHit(l: SpecLocale, s: string): boolean {
  const scrubbed = s.includes(CONDITIONAL[l]) ? s.replace(ARBITRATE_CLASS[l], '') : s
  return NOTIFY_BY_LOCALE[l].test(scrubbed)
}
const F10A = /vous serez informé|dès qu’une décision|s’affichera ici|suivez sa réponse|will be notified|will appear here|check this page|le informaremos|le avisaremos|aparecerá aquí|sarà informato|la informeremo|apparirà|سيتم إبلاغك|سنُعلمك|سيظهر|تابع رده/i

describe('J-C12 — no customer string promises a notification, an in-app display or a follow-up', () => {
  for (const l of SPEC_LOCALES) {
    it(`${l}: claimEmails.*, eat.help.*, claims.client.* — no hit of its own pattern, nor of F10 (a)`, () => {
      expect(customerStrings(l).filter((s) => notifyHit(l, s))).toEqual([])
      expect(customerStrings(l).filter((s) => F10A.test(s))).toEqual([])
    })
  }

  it('NEGATIVE CONTROL — the HEAD strings are caught by their own locale\'s pattern; the H12 ack.next and refused.contest are not', () => {
    const synthetic: Array<[SpecLocale, string]> = [
      ['en', 'Your claim is under review. You\'ll be notified of the outcome.'],
      ['es', 'Tu reclamación está en revisión. Te avisaremos del resultado.'],
      ['es', 'Reclamación enviada. El restaurante la está revisando — consulte su respuesta en esta página.'],
      ['en', 'You can contest it from your order tracking page — Grubano will arbitrate.'],
      ['ar', 'يمكنك الاعتراض عليها من صفحة متابعة طلبك — وستتولى Grubano التحكيم.'],
    ]
    for (const [l, s] of synthetic) expect(notifyHit(l, s), `${l} « ${s} »`).toBe(true)
    for (const l of SPEC_LOCALES) {
      for (const k of ['claimEmails.ack.next', 'claimEmails.orderCancelledPaid.next', 'claims.client.description', 'claims.client.success', 'eat.help.claimFiledSub', 'claimEmails.refused.contest']) {
        expect(notifyHit(l, HEAD[l][k]), `${l} HEAD ${k} « ${HEAD[l][k]} »`).toBe(true)
      }
    }
    const h12 = specCopyTable('H12', 'claimEmails.')
    for (const l of SPEC_LOCALES) {
      expect(notifyHit(l, h12['claimEmails.ack.next'][l]), l).toBe(false)
      expect(notifyHit(l, h12['claimEmails.refused.contest'][l]), l).toBe(false)
    }
  })

  it('tests/claims-t49-round12.test.ts PROMISES_BY_LOCALE flattens m.claimEmails too', () => {
    expect(read('tests/claims-t49-round12.test.ts')).toContain('...flatten(m.claimEmails)')
  })
})

// ══ ER-C14 ═════════════════════════════════════════════════════════════════════════════════════════
const FOLLOW_UP_BY_LOCALE: Record<SpecLocale, RegExp> = {
  fr: /va trancher|examinera votre|sera examinée|suit son circuit|nous vous répondrons/i,
  en: /will decide|will review your claim|will be reviewed|follows its normal process|will reply personally/i,
  es: /decidirá|revisará su reclamación|será examinada|sigue su circuito|te responderemos/i,
  it: /deciderà|esaminerà il suo reclamo|sarà esaminata|segue il suo iter|Le risponderemo/i,
  ar: new RegExp('ستبتّ|ستراجع Grubano|وسنرد عليك|تتبع مسارها|سيتم فحص طلبك', 'u'),
}
describe('ER-C14 — no customer string promises a decision, a review or a reply the code cannot establish', () => {
  for (const l of SPEC_LOCALES) {
    it(`${l}: no hit`, () => {
      expect(customerStrings(l).filter((s) => FOLLOW_UP_BY_LOCALE[l].test(s))).toEqual([])
    })
  }
  it('NEGATIVE CONTROL — the five HEAD strings of each locale are caught', () => {
    for (const l of SPEC_LOCALES) {
      for (const k of ['claims.client.contestSuccess', 'claims.client.contestDescription', 'eat.help.refundEstimate', 'eat.help.refundOffBody', 'claimEmails.orderCancelledPaid.bodyExisting']) {
        expect(FOLLOW_UP_BY_LOCALE[l].test(HEAD[l][k]), `${l} HEAD ${k} « ${HEAD[l][k]} »`).toBe(true)
      }
    }
  })
})

// ══ J-C13 ══════════════════════════════════════════════════════════════════════════════════════════
const NEW_GROUPS = ['closedBySupport', 'refusedByGrubano', 'refundRecorded', 'refundedLinked'] as const
const NO_MONEY_WORDS = /rembours|refund|reembols|rimbors|استرداد|réglé|settled|resuelt|risolt|سُوّي|faveur|favour|favor|لصالح|paiement|payment|pago|pagamento/i
const NO_CONFIRMATION = /confirm|confirmad|confermat|تأكيد|restaurant|restaurante|ristorante|المطعم/i
const NO_COMPLETION = /abouti|completed|completad|completat|مكتمل|moyen de paiement|payment method|método de pago|metodo di pagamento|وسيلة الدفع|€|\{euros\}/i
const NO_YOUR_CLAIM = /votre réclamation|your claim|su reclamación|il Suo reclamo|شكواك/i

describe('J-C13 — provenance and money-truth guards on the new templates and statuses', () => {
  for (const l of SPEC_LOCALES) {
    it(`${l}: the four new groups and the two statuses`, () => {
      const g = (name: string) => flatten(M[l].claimEmails[name])
      expect(g('closedBySupport').filter((s) => NO_MONEY_WORDS.test(s))).toEqual([])
      expect([...g('refusedByGrubano'), M[l].claims.status.refused_by_grubano].filter((s: string) => NO_CONFIRMATION.test(s))).toEqual([])
      expect(g('refundRecorded').filter((s) => NO_COMPLETION.test(s))).toEqual([])
      expect([...g('refundRecorded'), ...g('refundedLinked'), ...g('refusedByGrubano')].filter((s) => NO_YOUR_CLAIM.test(s))).toEqual([])
      // {euros} only in refundedLinked.body among the new groups
      const withEuros = NEW_GROUPS.flatMap((name) => Object.entries(M[l].claimEmails[name] as Record<string, string>).filter(([, v]) => v.includes('{euros}')).map(([k]) => `${name}.${k}`))
      expect(withEuros).toEqual(['refundedLinked.body'])
      // {ref} in every new body / next, and in the three reworded strings
      const refKeys = [...NEW_GROUPS.flatMap((name) => ['body', 'next'].filter((k) => k in M[l].claimEmails[name]).map((k) => `claimEmails.${name}.${k}`)),
        'claimEmails.ack.next', 'claimEmails.orderCancelledPaid.next', 'claimEmails.refused.contest']
      expect(refKeys.filter((k) => !String(messageAt(M[l], k)).includes('{ref}'))).toEqual([])
      // contact@grubano.com in a locale iff in fr, key by key
      for (const name of NEW_GROUPS) for (const [k, v] of Object.entries(M.fr.claimEmails[name] as Record<string, string>)) {
        expect(String(M[l].claimEmails[name][k]).includes('contact@grubano.com'), `${l} ${name}.${k}`).toBe(v.includes('contact@grubano.com'))
      }
      // the refund_unconfirmed status never contains the « Remboursée » value of its locale
      expect(String(M[l].claims.status.refund_unconfirmed)).not.toContain(String(M[l].claims.status.refunded))
    })
  }

  it('« Refus confirmé » / « a confirmé le refus » are reachable only for kind refused_confirmed', () => {
    const fr: string[] = []
    const walkKeys = (o: Record<string, unknown>, p: string): void => {
      for (const [k, v] of Object.entries(o)) {
        const q = p ? `${p}.${k}` : k
        if (typeof v === 'string') { if (/Refus confirmé|a confirmé le refus/.test(v)) fr.push(q) } else if (v && typeof v === 'object') walkKeys(v as Record<string, unknown>, q)
      }
    }
    walkKeys(M.fr, '')
    // the customer status refused_final, the refusedFinal e-mail (decision refused_final), and the operator's own toast
    expect(fr.sort()).toEqual(['claimEmails.refusedFinal.body', 'claimEmails.refusedFinal.title', 'claims.admin.refusedFinalDone', 'claims.status.refused_final'])
    const grid: ClaimFacts[] = []
    for (const status of ['refused_final', 'refunded', 'approved', 'arbitration']) for (const arbitrationDecision of ['refused_final', 'approved', null]) for (const restaurantResponse of ['refused', 'accepted', null]) {
      for (const refundError of [null, 'engine_failed: x', `${MARKERS.REVERTED_AFTER_REFUND} x`]) grid.push({ status, arbitrationDecision, restaurantResponse, refundError })
    }
    for (const c of grid) {
      const confirmed = claimClosureKind(c) === 'refused_confirmed'
      expect(customerClaimStatus(c, null, true) === 'refused_final', JSON.stringify(c)).toBe(confirmed)
      expect(refusalEmailKind(c) === 'refused_final', JSON.stringify(c)).toBe(confirmed)
    }
  })

  it('NEGATIVE CONTROL — the three historical failures are caught', () => {
    expect(NO_MONEY_WORDS.test('Notre équipe a clôturé la réclamation, sans remboursement.')).toBe(true)
    expect(NO_CONFIRMATION.test('Refus confirmé par Grubano')).toBe(true)
    expect(NO_COMPLETION.test('La réclamation est rattachée à un remboursement abouti.')).toBe(true)
  })
})

// ══ J-C32 ══════════════════════════════════════════════════════════════════════════════════════════
describe('J-C32 — the H04 templates and the H12 rewordings, 5 locales', () => {
  const EXPECTED = { ...specCopyTable('H04', 'claimEmails.'), ...specCopyTable('H12', 'claimEmails.') }

  it('values equal the frozen tables verbatim (15 keys); ack.next === orderCancelledPaid.next', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(15)
    for (const l of SPEC_LOCALES) {
      for (const [path, vals] of Object.entries(EXPECTED)) expect(messageAt(M[l], path), `${l} ${path}`).toBe(vals[l])
      expect(M[l].claimEmails.ack.next, l).toBe(M[l].claimEmails.orderCancelledPaid.next)
    }
  })

  it('rendered through the senders, ack.next and refused.contest carry the order reference and never a literal {ref}', async () => {
    sendMock.mockResolvedValue({ status: 'sent' })
    const ref = orderRef('ord123abc')
    for (const l of SPEC_LOCALES) {
      db.operator.findUnique.mockResolvedValue({ email: 'x@y.z', name: 'X', locale: l })
      sendMock.mockClear()
      await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250, claimsOpen: true })
      await sendClaimDecisionEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', decision: 'refused', claimsOpen: true })
      const [ack, refused] = sendMock.mock.calls.map((c) => String(c[0].html))
      expect(ack, l).toContain(String(M[l].claimEmails.ack.next).replace('{ref}', ref))
      expect(refused, l).toContain(String(M[l].claimEmails.refused.contest).replace('{ref}', ref))
      expect(ack + refused, l).not.toContain('{ref}')
    }
  })

  it('the kept values are byte-identical to HEAD: approved.body, refunded.body, refusedFinal.body, accepted.body', () => {
    for (const l of SPEC_LOCALES) {
      for (const k of ['claimEmails.approved.body', 'claimEmails.refunded.body', 'claimEmails.refusedFinal.body', 'claimEmails.accepted.body']) {
        expect(messageAt(M[l], k), `${l} ${k}`).toBe(HEAD[l][k])
      }
    }
  })

  it('NEGATIVE CONTROL — the HEAD refused.contest of each locale fails equality and is caught by J-C12', () => {
    for (const l of SPEC_LOCALES) {
      expect(HEAD[l]['claimEmails.refused.contest'], l).not.toBe(EXPECTED['claimEmails.refused.contest'][l])
      expect(notifyHit(l, HEAD[l]['claimEmails.refused.contest']), l).toBe(true)
    }
  })
})

// ══ J-C18 ══════════════════════════════════════════════════════════════════════════════════════════
describe('J-C18 — the customer copy that stays wrong is disclosed, never claimed compliant', () => {
  const doc = read('docs/ops/REFUND-FINANCIAL-CONTRACT.md')
  const lineWith = (id: string) => doc.split('\n').filter((l) => l.includes(id))
  const ADJACENT = /only true copy|n’affiche que des phrases vraies|n'affiche que des phrases vraies|conforme C6/i
  const IDS = /E-08|E-09|A-S31e|A-S31f/
  /** Lines naming E-08 / E-09 / A-S31e / A-S31f that call them compliant. IMPLEMENTATION NOTE (W6): the frozen spec states the rule itself and is not scanned. */
  const adjacency = (files: Record<string, string>) => Object.entries(files).flatMap(([f, s]) => s.split('\n').filter((l) => IDS.test(l) && ADJACENT.test(l)).map((l) => `${f}: ${l.trim().slice(0, 80)}`))

  it('the contract doc states REG-7 as NOT fail-visible needing founder acceptance, and E-08 as a C6 breach bounded by Stripe redelivery', () => {
    expect(lineWith('A-S31e-1').some((l) => l.includes('A-S31e-2') && l.includes('NOT fail-visible') && l.includes('founder acceptance'))).toBe(true)
    expect(lineWith('A-S31f-2').some((l) => l.includes('A-S31f-3') && l.includes('C6') && l.includes('bounded by Stripe redelivery'))).toBe(true)
  })

  it('no message, lib/claims.ts, console or docs/ops line calls these states compliant', () => {
    const docs = readdirSync('docs/ops').filter((f) => f.endsWith('.md') && f !== 'CLAIMS-T49-ROUND13-SPEC-v1.md').map((f) => `docs/ops/${f}`)
    const files = ['messages/fr.json', 'messages/en.json', 'messages/es.json', 'messages/it.json', 'messages/ar.json', 'lib/claims.ts',
      'components/claims/AdminFinancialVerification.tsx', 'components/claims/AdminClaimsArbitration.tsx', ...docs]
    expect(adjacency(Object.fromEntries(files.map((f) => [f, read(f)])))).toEqual([])
  })

  it('NEGATIVE CONTROL — a synthetic doc line « E-09 … shows only true copy » is caught; the doc without its REG-7 line fails the disclosure pin', () => {
    expect(adjacency({ 'docs/ops/x.md': '- E-09 (stale « Remboursée »): the customer view shows only true copy.' })).toEqual(['docs/ops/x.md: - E-09 (stale « Remboursée »): the customer view shows only true copy.'])
    const without = doc.split('\n').filter((l) => !l.includes('A-S31e-1')).join('\n')
    expect(without.split('\n').some((l) => l.includes('NOT fail-visible') && l.includes('founder acceptance') && l.includes('A-S31e-1'))).toBe(false)
  })
})

// ══ F08 / F09 ══════════════════════════════════════════════════════════════════════════════════════
describe('F08 — the reasons a customer is shown, and who wrote them', () => {
  it('customerClaimReasons: no Grubano reason on a declaration; the restaurant reason only for its refusal', () => {
    const base = { restaurantResponseReason: 'Plat conforme', arbitrationReason: 'note ou motif' }
    expect(customerClaimReasons({ ...base, status: 'refunded', refundError: 'engine_failed: x', arbitrationDecision: null, restaurantResponse: 'accepted' }))
      .toEqual({ restaurantResponseReason: null, arbitrationReason: null })
    expect(customerClaimReasons({ ...base, status: 'refused_final', refundError: 'engine_failed: x', arbitrationDecision: 'approved', restaurantResponse: 'refused' }))
      .toEqual({ restaurantResponseReason: 'Plat conforme', arbitrationReason: null })
    expect(customerClaimReasons({ ...base, status: 'refused_final', refundError: null, arbitrationDecision: 'refused_final', restaurantResponse: null }))
      .toEqual({ restaurantResponseReason: null, arbitrationReason: 'note ou motif' })
    expect(customerClaimReasons({ ...base, status: 'arbitration', refundError: null, arbitrationDecision: null, restaurantResponse: 'refused' }))
      .toEqual({ restaurantResponseReason: 'Plat conforme', arbitrationReason: null })
  })

  it('both consumer payloads spread it; ClaimSection renders what it receives; the admin label follows the restaurant response', () => {
    const claims = stripComments(read('lib/claims.ts'))
    expect(claims).toContain('...customerClaimReasons(c) }')
    expect(claims).toContain('...customerClaimReasons(existing) }')
    const section = stripComments(read('components/claims/ClaimSection.tsx'))
    expect(section).toContain('const showRefusalReason = !!ec.restaurantResponseReason')
    expect(section).toContain("t('client.grubanoDecisionReason')")
    expect(stripComments(read('components/claims/AdminClaimsArbitration.tsx'))).toContain("t(c.restaurantResponse === 'accepted' ? 'admin.restaurantNote' : 'admin.refusalReason')")
  })

  it('the two new keys carry the F08 values in 5 locales', () => {
    const table = specCopyTable('F08', 'claims.')
    expect(Object.keys(table).sort()).toEqual(['claims.admin.restaurantNote', 'claims.client.grubanoDecisionReason'])
    for (const l of SPEC_LOCALES) for (const [path, vals] of Object.entries(table)) expect(messageAt(M[l], path), `${l} ${path}`).toBe(vals[l])
  })
})

describe('F09 — the provenance-neutral client copy', () => {
  it('the six keys carry the F09 values in 5 locales, and differ from HEAD', () => {
    const table = specCopyTable('F09', 'claims.')
    expect(Object.keys(table).sort()).toEqual(['claims.client.arbitrationInfo', 'claims.client.description', 'claims.client.refusalReasonShown', 'claims.client.statusTitle', 'claims.client.success', 'eat.help.claimFiledSub'])
    for (const l of SPEC_LOCALES) for (const [path, vals] of Object.entries(table)) {
      expect(messageAt(M[l], path), `${l} ${path}`).toBe(vals[l])
      expect(HEAD[l][path], `${l} ${path} HEAD`).not.toBe(vals[l])
    }
  })

  it('F10 (5): the status title never says « votre réclamation » (a system claim is not the customer\'s)', () => {
    for (const l of SPEC_LOCALES) expect(NO_YOUR_CLAIM.test(M[l].claims.client.statusTitle), l).toBe(false)
    expect(NO_YOUR_CLAIM.test(HEAD.fr['claims.client.statusTitle'])).toBe(true)
  })
})
