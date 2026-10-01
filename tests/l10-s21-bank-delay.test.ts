import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L10 — S-21, THE BANK-DELAY INVARIANT, SCANNED FOR REAL (founder §7, §8, §19).
//
// WHAT S-21 SAYS. No customer- or restaurant-facing text of the claims/refunds cycle may promise a number of
// bank days, a date, an hour, « within X », a guarantee, or a computed date. After a refund is PROVEN the copy
// may state that it was issued — but it must attribute the appearance on the account to the customer's bank.
//
// WHY A NEW TEST AND NOT A FOURTH PIN. The repository had four bank-delay assertions and each covered exactly
// ONE key. Measured against synthetic sentences, the holes were not theoretical:
//   • « Le remboursement arrive sous 48 heures. » passed ALL FOUR — no existing pin knows the word « heures »;
//   • « سيتم رد المبلغ إليك خلال 5 أيام. » passed two of them — one regex has no Arabic time word at all;
//   • « Vous serez remboursé sous 5 jours. » passed the e-mail pin.
// And a real violation was shipped in all five locales the whole time: `financeRail.modalWarnDelay` = « Le
// client sera remboursé sous 5 à 10 jours ouvrés. » — dormant only because nothing rendered its namespace.
//
// SO THIS SCANNER IS TWO-TIER, and the tiers exist because a single regex cannot be both safe and strict:
//   TIER 1 — the BUSINESS-DAY phrase (« jours ouvrés », « business days », « días hábiles », « giorni
//            lavorativi », « أيام عمل »). Nothing in a money context may say it, so it runs with NO
//            allow-list over the whole message tree, minus a NAMED exemption list of non-refund copy.
//   TIER 2 — a NUMBER (or an ICU placeholder) next to a time unit, and window markers like « sous / within /
//            entro / خلال » + a number. Scoped to the money-cycle key prefixes, because « 48 h » is a
//            legitimate claim window, « 5,00 € » a legitimate amount and « 30 jours » a legitimate retention.
//
// AND IT SCANS THE FRENCH LITERALS IN lib/ TOO. The operator's financial-verification card is not i18n: its
// sentences live in lib/claim-console-copy.ts, lib/claim-money-line.ts, lib/claim-action-rules.ts and
// lib/claim-email-toast.ts as French string constants. A gate that only read messages/*.json would pass while
// the operator screen promised a delay.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const msgs = (l: string) => JSON.parse(read(`messages/${l}.json`)) as Record<string, unknown>

/** Every leaf of a locale file as [dotted key, value]. */
function flatten(o: unknown, prefix = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof o === 'string') { out.push([prefix, o]); return out }
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

// ── THE TWO DETECTORS ════════════════════════════════════════════════════════════════════════════════
/** TIER 1 — a business/working-day phrase, in all five languages. A money text may never contain one. */
const BUSINESS_DAYS = /jours?\s+(ouvr[ée]s?|ouvrables?)|business\s+days?|working\s+days?|d[ií]as?\s+h[áa]biles?|d[ií]as?\s+laborables?|giorni?\s+lavorativi?|أيام\s*عمل|يوم\s*عمل/i

/** Time units that make a NUMBER a delay rather than a quantity, in all five languages. */
const TIME_UNIT = '(?:minutes?|mins?|heures?|hours?|hrs?|jours?|days?|semaines?|weeks?|mois|months?|d[ií]as?|horas?|minutos?|giorni?|ore|settimane|minuti|دقائق|دقيقة|ساعات|ساعة|أيام|يوم|أسابيع|أسبوع)'
/** TIER 2a — a digit, an Arabic-Indic digit, an ICU placeholder or a spelled-out number, next to a time unit. */
const NUMBER_NEAR_UNIT = new RegExp(
  `(?:\\d|[٠-٩]|\\{\\w+\\}|\\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|one|two|three|four|five|ten|dos|tres|cinco|diez|due|tre|cinque|dieci)\\b)`
  + `[\\s\\u00a0\\u202f]*(?:[àa\\-–—]|to|y|e|\\bo\\b|إلى)?[\\s\\u00a0\\u202f]*(?:\\d|[٠-٩]|\\{\\w+\\})?[\\s\\u00a0\\u202f]*${TIME_UNIT}\\b`, 'i')
/**
 * TIER 2b — a window marker followed by a COUNT: « sous 5 », « within 3 », « entro 5 », « خلال ٥ ».
 *
 * Bare `en` / `in` / `e` / `o` / `y` are NOT markers here, and that is a measured correction: with them, the
 * Spanish « Recoge tu pedido en {restaurant} » and « … para el pedido {ref} en {resto} » were reported as
 * banking promises. A preposition that common cannot carry the signal. And the count must be a DIGIT or a
 * placeholder whose NAME is a count — `{resto}` and `{ref}` are names, not numbers.
 */
// String.raw here too, and for the same reason: in a single-quoted string \d collapses to 'd' and
// \{ to '{', so the regex matched a literal letter d. Measured: the Arabic and French negative
// controls both went green-when-they-should-be-red until this line used String.raw.
const COUNT = String.raw`(?:\d|[٠-٩]|\{(?:days?|hours?|h|mins?|minutes?|n|count|nb)\})`
// String.raw is load-bearing here: inside a PLAIN template literal \b is a BACKSPACE (0x08) and
// \s collapses to 's', so the regex would silently match nothing. That exact mistake has already been
// measured once in this repository, on a callsite scan that then reported zero hits.
const WINDOW_MARKER = new RegExp(
  String.raw`\b(?:sous|d[èe]s|within|en un plazo de|entro|dentro de|fra|tra)\b[\s ]*` + COUNT
  + String.raw`|خلال[\s ]*` + COUNT, 'i')
/** TIER 2c — a GUARANTEE of timing, unnegated. */
const GUARANTEE = /\b(garanti|garantie|guaranteed|garantizado|garantito)\b/i
const NEGATED_GUARANTEE = /\b(aucun|n['’]est pas|pas de|no|ning[úu]n|nessun|non)\b[^.]{0,40}\b(garanti|guaranteed|garantizado|garantito)/i

/**
 * THE MONEY-CYCLE SCOPE for tier 2. A number next to a time unit is only suspicious where money timing could
 * be promised. `legal.confidentialite` states retention durations, `marketplace` opening days, `prestataire`
 * a calendar: all legitimate, none about a refund.
 */
const MONEY_PREFIXES = [
  'claimEmails.', 'claims.', 'eat.help.', 'eat.track.', 'eat.claims.', 'eat.orders.', 'eat.refund.',
  'legal.cgv.',
]
/**
 * S-21 is written about « texte client/resto », so the ADMIN console is out of tier 2's scope: it is French by
 * design (its copy lives as literals in lib/, scanned separately below) and its lease messages legitimately
 * speak of minutes — « la fenêtre de remboursement se referme dans moins d'une minute » is an operator fact,
 * not a promise to a customer. Tier 1 still covers it, with no exclusion at all.
 */
const ADMIN_PREFIXES = ['claims.admin.', 'operator.']
const inMoneyScope = (key: string) =>
  MONEY_PREFIXES.some((p) => key.startsWith(p)) && !ADMIN_PREFIXES.some((p) => key.startsWith(p))

/**
 * AND THE SENTENCE MUST BE ABOUT MONEY — the founder's own instruction: « Tester le CONTEXTE
 * bancaire/remboursement, pas tout nombre du repo ». Without this, a preparation time (« ~{mins} min »), a
 * delivery ETA (« ≈ {min} min ») and a finance period filter (« Last {days} days ») are all reported as
 * banking promises. Measured: all three were, on the first run. A number beside a time unit is only an S-21
 * risk when the sentence is about money arriving.
 */
const MONEY_CONTEXT = /rembours|refund|reembols|rimbors|استرداد|banqu|bank|banco|banca|مصرف|بنك|virement|paiement|payment|pago|pagamento/i
const aboutMoney = (key: string, value: string) => MONEY_CONTEXT.test(value) || /refund|rembours|claim/i.test(key)

/**
 * TIER 1's NAMED exemptions — measured, not guessed, and each one is about something other than a refund.
 * A new entry here is a decision that has to be argued in review; that is the point of naming them.
 */
const BUSINESS_DAY_EXEMPT = new Set([
  'franchise.apply.headSub',            // « réponse sous quelques jours ouvrés » — a franchise application
  'franchise.apply.successBody',        //   idem
  'franchise.mkt.heroNote',             //   idem
  'franchise.mkt.ctaSub',               //   idem
  'marketplace.prestataires.availabilityDaysLabel',
  'prestataire.calendar.weekdaysLabel',
  'logisticsWithdraw.payoutHint',       // a COURIER payout, not a customer refund; names no figure
])

// ── TIER 1 ═══════════════════════════════════════════════════════════════════════════════════════════
describe('S-21 tier 1 — no money text promises business days, in any locale', () => {
  it('the whole message tree, minus a NAMED exemption list', () => {
    const hits: string[] = []
    for (const l of LOCALES) {
      for (const [k, v] of flatten(msgs(l))) {
        if (BUSINESS_DAY_EXEMPT.has(k)) continue
        if (BUSINESS_DAYS.test(v)) hits.push(`${l}:${k} = ${v}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('NEGATIVE CONTROL — the detector catches the sentence that WAS shipped, in all five languages', () => {
    // The real values of financeRail.modalWarnDelay, deleted by this lot. If the regex missed any of them the
    // assertion above would be decoration.
    const SHIPPED = [
      'Le client sera remboursé sous 5 à 10 jours ouvrés.',
      'The customer will be refunded within 5 to 10 business days.',
      'El cliente recibirá el reembolso en un plazo de 5 a 10 días hábiles.',
      'Il cliente sarà rimborsato entro 5-10 giorni lavorativi.',
      'سيتم رد المبلغ للعميل خلال 5 إلى 10 أيام عمل.',
    ]
    for (const s of SHIPPED) expect(BUSINESS_DAYS.test(s), s).toBe(true)
    // …and it is gone from every locale
    for (const l of LOCALES) {
      expect((msgs(l) as { financeRail?: unknown }).financeRail, `${l} still has financeRail`).toBeUndefined()
    }
  })
})

// ── TIER 2 ═══════════════════════════════════════════════════════════════════════════════════════════
describe('S-21 tier 2 — no money text puts a number next to a time unit, or a window marker before one', () => {
  /**
   * The ONLY legitimate numbers-with-units in the money scope, each named with its reason. They are PRODUCT
   * windows and order ages, never a banking delay: the difference is who controls the clock.
   */
  const ALLOWED = new Map<string, RegExp>([
    // the claim submission window, stated as a product rule on the CGV and on the help screen
    ['legal.cgv.claimsWindow', /\{hours\}/],
    ['legal.cgv.claimsMaxAge', /\{days\}/],
    // (An earlier draft pre-approved `eat.help.claimWindowHint`, which exists in NO locale. An allow-list entry
    //  for a key that does not exist is a licence waiting for a key to be created under it — removed, and the
    //  assertion below proves every remaining entry is real.)
  ])

  it('every ALLOWED entry names a key that actually exists — an allow-list is not a wish list', () => {
    // Array.from, not a Map spread: the TS target here predates downlevelIteration, and a new tsc error is
    // a new tsc error — the baseline is 39 and this lot must not move it.
    for (const k of Array.from(ALLOWED.keys())) {
      const present = LOCALES.filter((l) => flatten(msgs(l)).some(([key]) => key === k))
      expect(present, `${k} is allow-listed but exists in ${present.length}/5 locales`).toHaveLength(5)
    }
  })

  it('every money-scope string, in all five locales', () => {
    const hits: string[] = []
    for (const l of LOCALES) {
      for (const [k, v] of flatten(msgs(l))) {
        if (!inMoneyScope(k)) continue
        const allow = ALLOWED.get(k)
        const suspect = NUMBER_NEAR_UNIT.test(v) || WINDOW_MARKER.test(v)
        if (!suspect) continue
        if (!aboutMoney(k, v)) continue
        if (allow && allow.test(v)) continue
        hits.push(`${l}:${k} = ${v}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('NEGATIVE CONTROL — the five sentences the founder asked for all go RED', () => {
    // §8: « introduire artificiellement une phrase type « remboursement sous 5 jours » dans chaque langue
    // testée => rouge ». Plus the HOURS variant, which every pre-existing pin missed in all five languages.
    const FORBIDDEN = [
      'Le remboursement sera effectué sous 5 jours.',
      'Your refund will arrive within 5 days.',
      'El reembolso se realizará en un plazo de 5 días.',
      'Il rimborso sarà effettuato entro 5 giorni.',
      'سيتم رد المبلغ خلال 5 أيام.',
      'Le remboursement arrive sous 48 heures.',
      'The refund arrives within 48 hours.',
      'El reembolso llega en 48 horas.',
      'Il rimborso arriva entro 48 ore.',
      'يصل المبلغ خلال 48 ساعة.',
      'Remboursement garanti en 3 à 5 jours ouvrés.',
      'Vous serez remboursé sous {days} jours.',
    ]
    for (const s of FORBIDDEN) {
      expect(NUMBER_NEAR_UNIT.test(s) || WINDOW_MARKER.test(s) || BUSINESS_DAYS.test(s), s).toBe(true)
    }
  })

  it('NEGATIVE CONTROL — the legitimate numbers do NOT go red (the scanner is usable)', () => {
    // A detector that fires on an amount, an order reference or a quantity gets switched off by the next
    // reader, which is worse than having none.
    const LEGITIMATE = [
      'Un remboursement de 5,00 € est confirmé.',
      'Commande GR-9IA5R6.',
      'Montant maximal de votre demande : 14,10 €.',
      '2 × Gnocchi 4 fromages',
      'Approuvée — remboursement en attente de traitement',
      'Le délai de contestation de cette décision est dépassé. Vous pouvez encore nous écrire.',
    ]
    for (const s of LEGITIMATE) {
      expect(NUMBER_NEAR_UNIT.test(s) || WINDOW_MARKER.test(s) || BUSINESS_DAYS.test(s), s).toBe(false)
    }
  })

  it('an unnegated GUARANTEE of timing is forbidden; the existing NEGATED one is not a violation', () => {
    const hits: string[] = []
    for (const l of LOCALES) {
      for (const [k, v] of flatten(msgs(l))) {
        if (!inMoneyScope(k)) continue
        if (GUARANTEE.test(v) && !NEGATED_GUARANTEE.test(v)) hits.push(`${l}:${k} = ${v}`)
      }
    }
    expect(hits).toEqual([])
    // the shipped negation, which a keyword ban would have called a violation
    expect(NEGATED_GUARANTEE.test('Aucun remboursement n’est garanti à ce stade.')).toBe(true)
    expect(NEGATED_GUARANTEE.test('Remboursement garanti sous 5 jours.')).toBe(false)
  })
})

// ── THE POSITIVE HALF OF S-21 ════════════════════════════════════════════════════════════════════════
describe('S-21 second half — a PROVEN refund names the bank', () => {
  /** The bank word in each locale, as the already-arbitrated copy uses it. */
  const BANK: Record<string, RegExp> = {
    fr: /banque/i, en: /bank/i, es: /banco/i, it: /banca/i, ar: /مصرف|بنك/,
  }

  it('the shared clause exists in all five locales and names the bank, with no figure', () => {
    for (const l of LOCALES) {
      const note = (msgs(l) as { claimEmails?: { bankNoteIssued?: string } }).claimEmails?.bankNoteIssued
      expect(typeof note, `${l} bankNoteIssued`).toBe('string')
      expect(note!, l).toMatch(BANK[l])
      expect(note!, `${l} puts a number in the bank clause`).not.toMatch(/\d|[٠-٩]/)
      expect(NUMBER_NEAR_UNIT.test(note!) || WINDOW_MARKER.test(note!), l).toBe(false)
    }
  })

  it('every post-money customer e-mail RENDERS it — the clause was on the not-yet-paid notice and nowhere else', () => {
    // Measured before this lot: the ONLY claim string carrying the clause was `approved.body`, a notice sent
    // when nothing had moved. The three render paths that state a refund as issued now append the shared key.
    const emails = read('lib/claim-emails.ts')
    expect(emails).toContain("p.decision === 'refunded' ? `<p style=\"font-size:13px;color:#6b7280\">${esc(t('bankNoteIssued'))}</p>` : ''")
    expect(emails).toContain("kind === 'refunded' ? `<p style=\"font-size:13px;color:#6b7280\">${esc(t('bankNoteIssued'))}</p>` : ''")
    const tx = read('lib/transactional-emails.ts')
    expect(tx).toContain("esc(t('bankNoteIssued'))")
    // …and it is NOT appended to a closure that announces no refund: that would imply money moved.
    expect(emails).not.toMatch(/bankNoteIssued'\)\}<\/p>`\s*\+/)
  })

  it('the PRE-money approval keeps its own conditional form — « once issued », not a fact', () => {
    for (const l of LOCALES) {
      const body = (msgs(l) as { claimEmails?: { approved?: { body?: string } } }).claimEmails?.approved?.body
      expect(typeof body, l).toBe('string')
      expect(body!, `${l} approved.body must name the bank`).toMatch(BANK[l])
      // and it must not have become a figure
      expect(body!, `${l} approved.body has a delay`).not.toMatch(BUSINESS_DAYS)
    }
  })
})

// ── THE FRENCH LITERALS IN lib/ ══════════════════════════════════════════════════════════════════════
describe('S-21 — the operator copy that is NOT i18n is scanned too', () => {
  const OPERATOR_COPY = [
    'lib/claim-console-copy.ts', 'lib/claim-money-line.ts', 'lib/claim-action-rules.ts',
    'lib/claim-email-toast.ts', 'lib/claim-refusal-labels.ts', 'lib/claim-eligibility.ts',
    'lib/claim-scope.ts', 'lib/claim-selection.ts',
  ]

  it('no French string constant in the claims lib promises a bank delay', () => {
    const hits: string[] = []
    for (const f of OPERATOR_COPY) {
      const src = read(f)
      // Only the STRING LITERALS, so a comment naming the rule (« il ne promet aucun délai bancaire ») is not
      // reported as a violation of it. Single quotes, double quotes and backticks.
      const literals = src.match(/'[^'\n]{12,}'|"[^"\n]{12,}"|`[^`]{12,}`/g) ?? []
      for (const lit of literals) {
        if (BUSINESS_DAYS.test(lit)) hits.push(`${f}: ${lit.slice(0, 120)}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('LANDMARK SURVIVAL — the literal scan really does see this copy', () => {
    // If the regex above found no literals at all, the assertion would pass for the wrong reason.
    const src = read('lib/claim-console-copy.ts')
    const literals = src.match(/'[^'\n]{12,}'|"[^"\n]{12,}"|`[^`]{12,}`/g) ?? []
    expect(literals.length).toBeGreaterThan(20)
    expect(literals.join(' ')).toMatch(/remboursement/i)
  })
})

// ── NO SURFACE RENDERS THE SERVER'S FRENCH ANY MORE (founder §2) ══════════════════════════════════════
describe('§2 — no claims surface displays the server sentence', () => {
  const walk = (dir: string): string[] => {
    let out: string[] = []
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`
      if (statSync(p).isDirectory()) out = out.concat(walk(p))
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
    return out
  }

  it('no client file renders `data.error` as a toast or an error state', () => {
    const files = [...walk('app'), ...walk('components')]
    const hits: string[] = []
    for (const f of files) {
      const src = read(f)
      if (!/\/api\/claims/.test(src)) continue          // only the claims surfaces
      // The ADMIN console is French-only BY DESIGN (its card's copy lives as French literals in
      // lib/claim-console-copy.ts, covered by tests/claims-exit-copy). §2 and S-21 are about the CLIENT and
      // RESTAURANT surfaces; the admin half is recorded as a finding rather than half-translated in silence.
      if (/Admin/.test(f)) continue
      const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
      // the shapes that put the server's sentence on screen
      // EVERY shape that puts a server sentence on screen, not the three I happened to write. The adversarial
      // review pointed out that the commonest echo in this repository — `data.error || t(…)` inside any setter
      // — would have passed a three-pattern gate. So the rule is stated generally: if `data.error` (or
      // `result.error`, or `json.error`) appears as an ARGUMENT to a UI-facing setter or toast, it is a hit.
      // String.raw, because a plain string collapses \( and \. and the regex fails to compile — measured.
      const SINKS = String.raw`(?:toast\.(?:error|success|warning)|setErr|setError|setSubmitError|setFormError|setMessage|alert)`
      const SERVER_TEXT = String.raw`(?:data|json|body|payload|result|res)\??\.error`
      for (const re of [
        new RegExp(SINKS + String.raw`\(([^)]{0,120})?` + SERVER_TEXT),
        new RegExp(SERVER_TEXT + String.raw`\s*\|\|`),   // the `data.error || t('generic')` idiom
      ]) {
        if (re.test(code)) hits.push(`${f} :: ${re.source}`)
      }
    }
    expect(hits).toEqual([])

    // POSITIVE CONTROL — the gate must FIRE on the shapes it exists for. Written after the adversarial review
    // found that my first version required a literal `??`, so it matched NOTHING: a gate that cannot go red is
    // a decoration, and this is the second time in this chantier that a scan silently matched zero.
    const SINKS = String.raw`(?:toast\.(?:error|success|warning)|setErr|setError|setSubmitError|setFormError|setMessage|alert)`
    const SERVER_TEXT = String.raw`(?:data|json|body|payload|result|res)\??\.error`
    const detect = (code: string) =>
      new RegExp(SINKS + String.raw`\(([^)]{0,120})?` + SERVER_TEXT).test(code)
      || new RegExp(SERVER_TEXT + String.raw`\s*\|\|`).test(code)
    for (const shape of [
      "toast.error(data.error || t('client.errorGeneric'))",
      "toast.error(data?.error ?? t('x'))",
      "setErr(typeof data?.error === 'string' ? data.error : tc('x'))",
      'setSubmitError(result.error)',
      "setMessage(json.error || 'x')",
    ]) {
      expect(detect(shape), `the gate MUST catch: ${shape}`).toBe(true)
    }
    // …and it must not fire on the shapes that are fine
    for (const ok of [
      "toast.error(t('client.errorGeneric'))",
      'const key = claimRefusalKey(data?.reason)',
      "console.error('[x]', e instanceof Error ? e.message : e)",
    ]) {
      expect(detect(ok), `the gate must NOT catch: ${ok}`).toBe(false)
    }
  })

  it('the two claims surfaces read the CODE through the shared map', () => {
    for (const f of ['components/claims/ClaimSection.tsx', 'app/[locale]/eat/order/[orderId]/help/page.tsx']) {
      expect(read(f), f).toContain("from '@/lib/claim-refusal-labels'")
    }
    expect(read('app/[locale]/eat/account/claims/page.tsx')).toContain('contestRefusalKey')
    // …and the map has an entry for every code the server can produce for these surfaces
    const labels = read('lib/claim-refusal-labels.ts')
    for (const code of ['not_owner', 'not_paid', 'not_delivered', 'window_expired', 'active_claim',
      'no_refundable_amount', 'intake_closed', 'invalid_scope', 'reason_not_selectable',
      'items_not_allowed', 'amount_not_allowed']) {
      expect(labels, `missing ${code}`).toContain(`${code}:`)
    }
    // not_delivered and window_expired stay DISTINCT — the founder forbids merging them
    const m = labels.match(/not_delivered:\s*'(\w+)'/)
    const w = labels.match(/window_expired:\s*'(\w+)'/)
    expect(m?.[1]).not.toBe(w?.[1])
  })

  it('every mapped key exists in all five locales', () => {
    const labels = read('lib/claim-refusal-labels.ts')
    const help = Array.from(labels.matchAll(/^\s{2}\w+:\s+'(claim\w+)',?$/gm)).map((x) => x[1])
    const contest = Array.from(labels.matchAll(/^\s{2}\w+:\s+'(contest\w+)',?$/gm)).map((x) => x[1])
    // The RESTAURANT map was missing from this pin — an « every mapped key exists » assertion that skips a map
    // is exactly the hole it exists to close. Found by this lot's adversarial review.
    const respond = Array.from(labels.matchAll(/^\s{2}\w+:\s+'(respond\w+)',?$/gm)).map((x) => x[1])
    expect(help.length).toBeGreaterThanOrEqual(20)
    expect(contest.length).toBe(5)
    expect(respond.length).toBe(2)
    for (const l of LOCALES) {
      const m = msgs(l) as {
        eat?: { help?: Record<string, string> }
        claims?: { client?: Record<string, string>; restaurant?: Record<string, string> }
      }
      for (const k of help) expect(typeof m.eat?.help?.[k], `${l}: eat.help.${k}`).toBe('string')
      for (const k of contest) expect(typeof m.claims?.client?.[k], `${l}: claims.client.${k}`).toBe('string')
      for (const k of respond) expect(typeof m.claims?.restaurant?.[k], `${l}: claims.restaurant.${k}`).toBe('string')
    }
  })
})
