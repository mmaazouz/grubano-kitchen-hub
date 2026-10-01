import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L10 §6 — THE REFUND CONFIRMATION IS LOCALIZED, AND THE OPERATIONAL TOOL STILL FINDS IT.
//
// WHAT WAS WRONG. `sendRefundConfirmation` is the e-mail a customer gets once a refund is PROVEN to have
// succeeded — and it was 100% French literals: subject, greeting, body, and the bank sentence. The parameter
// object had no `locale` field, so no caller COULD supply one, and the amount was formatted with a hardcoded
// `fr-FR` (an English recipient read « 12,50 € », an Arabic one lost the RLM). Measured in one request of the
// L9 notify route: a fully localized notice went to the RESTAURANT and a French-only one to the CUSTOMER, for
// the same refund.
//
// THE COUPLING THAT MADE THIS THE RISKIEST PART OF THE LOT. `scripts/server/phase2-email-timeline.js` is a
// real operational tool: it correlates a Stripe refund to the `EmailLog` row that announced it, and its
// content key is the SUBJECT, reconstructed byte-for-byte. Localizing the subject without telling that script
// would not error — `bySubject` would come back empty, the tool would fall back to « claim only (no exact
// subject match) » and could select a different e-mail sent after the claim. A locale-specific hole in the
// refund evidence trail, silent, with no test red. And the script CANNOT read messages/*.json: it runs on the
// server, where the deploy ships `.next/standalone`, `public/`, `prisma/schema.prisma` and
// `scripts/server/*.js` — the locale files exist only inside the compiled bundle.
//
// SO THE FIVE SUBJECTS ARE DUPLICATED IN THE SCRIPT, AND THIS FILE IS WHY THAT IS SAFE: it renders the
// subject from messages/*.json exactly as the sender does and asserts the script's template is byte-identical,
// per locale. Change the copy in one place and this goes red — which is the whole point.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
const read = (p: string) => readFileSync(p, 'utf8')
const msgs = (l: string) => JSON.parse(read(`messages/${l}.json`))
const rc = (l: string) => msgs(l).claimEmails.refundConfirmation as Record<string, string>

const { sendMail, db } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  db: { emailDispatch: { create: vi.fn(), deleteMany: vi.fn() }, emailLog: { create: vi.fn() }, operator: { findUnique: vi.fn() } },
}))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// The REAL messages, substituted like next-intl does — a key-echoing stub would let the e-mail say anything.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale?: string; namespace?: string }) => {
    const all = msgs(locale || 'fr')
    const root = namespace ? namespace.split('.').reduce((o: Record<string, unknown>, k: string) => (o?.[k] ?? {}) as Record<string, unknown>, all) : all
    return (key: string, vars?: Record<string, string | number>) => {
      const raw = key.split('.').reduce((o: unknown, k: string) => (o as Record<string, unknown>)?.[k], root)
      return typeof raw === 'string' ? raw.replace(/\{(\w+)\}/g, (_m, v) => String(vars?.[v] ?? `{${v}}`)) : key
    }
  },
}))

import { sendRefundConfirmation } from '@/lib/transactional-emails'
const TL = require('../scripts/server/phase2-email-timeline.js') as {
  expectedRefundSubject: (resto: string, partial: boolean, locale?: string) => string
  expectedRefundSubjects: (resto: string, partial: boolean) => string[]
  REFUND_SUBJECT_TEMPLATES: Record<string, { full: string; partial: string }>
}

const RESTO = 'Gnocchi Bar'
beforeEach(() => {
  sendMail.mockReset(); db.emailDispatch.create.mockReset(); db.emailLog.create.mockReset()
  db.emailDispatch.create.mockResolvedValue({})
  db.emailLog.create.mockResolvedValue({})
  sendMail.mockResolvedValue({ messageId: 'm1' })
  process.env.SMTP_HOST = 'smtp.test.invalid'
  process.env.SMTP_USER = 'u'
  process.env.SMTP_PASS = 'p'
})

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// ── THE BYTE-FOR-BYTE SUBJECT CONTRACT ═══════════════════════════════════════════════════════════════
describe('L10 §6 — the correlation script knows all five subjects, byte for byte', () => {
  it('each template equals the locale file rendered with {resto}', () => {
    for (const l of LOCALES) {
      const k = rc(l)
      expect(TL.REFUND_SUBJECT_TEMPLATES[l], `${l} missing from the script`).toBeTruthy()
      expect(TL.REFUND_SUBJECT_TEMPLATES[l].full, `${l} full`).toBe(k.subject)
      expect(TL.REFUND_SUBJECT_TEMPLATES[l].partial, `${l} partial`).toBe(k.subjectPartial)
      // …and substituting gives exactly what the sender puts on the wire
      expect(TL.expectedRefundSubject(RESTO, false, l)).toBe(k.subject.replace('{resto}', RESTO))
      expect(TL.expectedRefundSubject(RESTO, true, l)).toBe(k.subjectPartial.replace('{resto}', RESTO))
    }
  })

  it('the SENT subject is in the script\'s set, for every locale', async () => {
    for (const l of LOCALES) {
      for (const partial of [false, true]) {
        sendMail.mockClear()
        await sendRefundConfirmation({ to: 'a@b.invalid', customerName: 'Zoé', restaurantName: RESTO, refundedCents: 500, partial, locale: l })
        const subject = sendMail.mock.calls[0][0].subject as string
        expect(TL.expectedRefundSubjects(RESTO, partial), `${l} partial=${partial}`).toContain(subject)
      }
    }
  })

  it('NEGATIVE CONTROL — a drifted locale value is DETECTED (the assertion is not vacuous)', () => {
    const drifted = 'Votre remboursement est confirmé !! — {resto}'
    expect(TL.REFUND_SUBJECT_TEMPLATES.fr.full).not.toBe(drifted)
    // and the correlation really would lose it: the sent subject would not be in the set
    expect(TL.expectedRefundSubjects(RESTO, false)).not.toContain(drifted.replace('{resto}', RESTO))
  })

  it('the FR default is unchanged, so every existing caller and pin of the script still works', () => {
    expect(TL.expectedRefundSubject(RESTO, true)).toBe('Votre remboursement partiel est confirmé — Gnocchi Bar')
    expect(TL.expectedRefundSubject(RESTO, false)).toBe('Votre remboursement est confirmé — Gnocchi Bar')
  })
})

// ── THE E-MAIL ITSELF, IN EVERY LOCALE ═══════════════════════════════════════════════════════════════
describe('L10 §6 — every visible string comes from the locale, and the money is formatted for the reader', () => {
  it('body, bank clause and reference are the locale\'s own strings', async () => {
    for (const l of LOCALES) {
      sendMail.mockClear()
      await sendRefundConfirmation({
        to: 'a@b.invalid', customerName: 'Zoé', restaurantName: RESTO, refundedCents: 1250,
        partial: false, locale: l, orderRef: 'GR-9IA5R6',
      })
      const html = sendMail.mock.calls[0][0].html as string
      const text = strip(html)
      const m = msgs(l).claimEmails
      // the locale's own title, its bank clause and its reference line
      expect(text, `${l} title`).toContain(m.refundConfirmation.title)
      expect(text, `${l} bank clause`).toContain(m.bankNoteIssued)
      expect(text, `${l} reference`).toContain('GR-9IA5R6')
      // NOTHING French leaks into a non-French e-mail
      if (l !== 'fr') {
        expect(text, `${l} leaks the FR body`).not.toContain('est confirmé : ce montant est renvoyé')
        expect(text, `${l} leaks the FR bank clause`).not.toContain('dépend de votre banque')
      }
    }
  })

  it('the amount is formatted in the RECIPIENT\'s locale — the old helper hardcoded fr-FR', async () => {
    const seen: Record<string, string> = {}
    for (const l of LOCALES) {
      sendMail.mockClear()
      await sendRefundConfirmation({ to: 'a@b.invalid', customerName: '', restaurantName: RESTO, refundedCents: 1250, partial: false, locale: l })
      seen[l] = strip(sendMail.mock.calls[0][0].html as string)
    }
    expect(seen.fr).toMatch(/12,50/)      // comma
    expect(seen.en).toMatch(/12\.50/)     // point
    expect(seen.es).toMatch(/12,50/)
    expect(seen.it).toMatch(/12,50/)
    // and the English e-mail is NOT the French number
    expect(seen.en).not.toMatch(/12,50/)
    // ARABIC — and this one was a REGRESSION the adversarial review caught. A bare `'ar'` lets Intl pick a
    // region, and it picked one that formats with a decimal POINT: the e-mail said « 12.50 € » while every
    // Arabic SCREEN of the app says « 12,50 € », because lib/format-money resolves `ar` to `ar-MA`. Two
    // figures for one amount, from one refund. The e-mail helper now resolves the tag the same way.
    expect(seen.ar, 'the Arabic e-mail must use the app own tag (ar-MA), not a bare `ar`').toMatch(/12,50/)
    expect(seen.ar).not.toMatch(/12\.50/)
  })

  it('the e-mail money tag map is the SAME one the app uses — one amount cannot have two shapes', () => {
    const shell = read('lib/claim-email-shell.ts')
    const money = read('lib/format-money.ts')
    for (const pair of ["fr: 'fr-FR'", "en: 'en-US'", "es: 'es-ES'", "it: 'it-IT'", "ar: 'ar-MA'"]) {
      expect(shell, `the e-mail map must carry ${pair}`).toContain(pair)
      expect(money, `the app map must carry ${pair}`).toContain(pair)
    }
    // …and an unknown tag falls back deterministically rather than to whatever ICU the host ships
    expect(shell).toContain("?? 'fr-FR'")
  })

  it('an Arabic recipient gets an RTL document; the others do not', async () => {
    for (const l of LOCALES) {
      sendMail.mockClear()
      await sendRefundConfirmation({ to: 'a@b.invalid', customerName: 'زوي', restaurantName: RESTO, refundedCents: 500, partial: false, locale: l })
      const html = sendMail.mock.calls[0][0].html as string
      expect(html, l).toContain(l === 'ar' ? 'dir="rtl"' : 'dir="ltr"')
    }
  })

  it('an EMPTY customer name renders NO greeting — never « Bonjour , »', async () => {
    await sendRefundConfirmation({ to: 'a@b.invalid', customerName: '', restaurantName: RESTO, refundedCents: 500, partial: false, locale: 'fr' })
    const text = strip(sendMail.mock.calls[0][0].html as string)
    expect(text).not.toMatch(/Bonjour\s*,/)
    expect(text).not.toContain('Bonjour')
    // …and a name IS greeted
    sendMail.mockClear()
    await sendRefundConfirmation({ to: 'a@b.invalid', customerName: 'Zoé', restaurantName: RESTO, refundedCents: 500, partial: false, locale: 'fr' })
    expect(strip(sendMail.mock.calls[0][0].html as string)).toContain('Zoé')
  })

  it('no Stripe id, no internal id, no dedupe key ever reaches the e-mail', async () => {
    await sendRefundConfirmation({
      to: 'a@b.invalid', customerName: 'Zoé', restaurantName: RESTO, refundedCents: 500, partial: true,
      locale: 'en', orderRef: 'GR-9IA5R6', dedupeKey: 'refund:re_SECRET123',
    })
    const call = sendMail.mock.calls[0][0]
    const all = `${call.subject} ${call.html}`
    for (const secret of ['re_SECRET123', 'refund:re_', 'pi_', 'cmt']) {
      expect(all, secret).not.toContain(secret)
    }
  })

  it('an absent locale behaves exactly as before this lot: French', async () => {
    await sendRefundConfirmation({ to: 'a@b.invalid', customerName: 'Zoé', restaurantName: RESTO, refundedCents: 500, partial: false })
    const call = sendMail.mock.calls[0][0]
    expect(call.subject).toBe('Votre remboursement est confirmé — Gnocchi Bar')
    expect(strip(call.html as string)).toContain('dépend de votre banque')
  })
})

// ── THE CALLERS SUPPLY THE LOCALE ════════════════════════════════════════════════════════════════════
describe('L10 §6 — every caller can actually supply a locale', () => {
  it('the three Operator-based callers select `locale` and pass it', () => {
    const cases: Array<[string, RegExp]> = [
      ['app/api/admin/refunds/rows/[rowId]/notify/route.ts', /locale:\s+t\.recipientLocale/],
      ['app/api/admin/refunds/run/route.ts', /locale:\s+consumer\.locale/],
      ['app/api/orders/[id]/refund/route.ts', /locale:\s+consumer\.locale/],
    ]
    for (const [f, re] of cases) {
      const src = read(f)
      expect(src, `${f} passes no locale`).toMatch(re)
      expect(src, `${f} greets with the e-mail address`).not.toContain('consumer.name ?? consumer.email')
    }
    // the resolver reads it from the database
    expect(read('lib/support-refund-notices.ts')).toContain('select: { email: true, name: true, locale: true }')
  })

  it('the two reservation callers resolve it through the account, without a schema change', () => {
    for (const f of ['app/api/reservations/[id]/refund-deposit/route.ts', 'app/api/tickets/[id]/refund/route.ts']) {
      const src = read(f)
      expect(src, f).toContain('resolveReservationLocale')
      expect(src, `${f} must select userId`).toMatch(/userId:\s*true/)
    }
    // and Reservation gained NO locale column (a text lot does not migrate)
    const schema = read('prisma/schema.prisma')
    const model = schema.slice(schema.indexOf('model Reservation'), schema.indexOf('model Reservation') + 1600)
    expect(model).not.toMatch(/^\s+locale\s/m)
  })

  it('KNOWN LIMIT, recorded rather than hidden: nothing WRITES Operator.locale yet', () => {
    // So every recipient still resolves to 'fr' in production today. The localization is therefore
    // preparatory — real, tested, and not yet observable. Claiming « 5 locales delivered » on the strength of
    // the key files alone would be false, so the limit is asserted here and reported in the lot report.
    const writers = require('node:child_process')
      .execSync('grep -rlE "locale:\\s*(locale|lang|parsed\\.data\\.locale|body\\.locale)" app lib --include=*.ts | head -20', { encoding: 'utf8' })
      .split('\n').filter(Boolean)
      .filter((f: string) => /operator\.(create|update|upsert)/.test(read(f)))
    expect(writers).toEqual([])
  })
})
