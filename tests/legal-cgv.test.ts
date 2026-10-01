import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L10 — /legal/cgv IN FIVE LOCALES (founder decision D-8, sections 11 to 17).
//
// WHAT THIS PAGE MUST NOT DO, and what these tests are really for. A terms page is the easiest place in a
// codebase to invent a fact: a SIREN, a legal form, an address, a statutory delay, a waiver of a consumer
// right. The founder's instruction is explicit — if a mandatory legal identity is missing, DOCUMENT the
// blocker instead of filling it in. So the page states no company fact at all: it links to
// /legal/mentions-legales, where every fact already comes from lib/legal-info.ts and shows as a visible
// placeholder until Mohammed fills it. These tests pin that discipline, because prose is exactly what drifts.
//
// AND IT MUST NOT CONTRADICT THE PRODUCT. The two numbers it states — the submission window and the order-age
// ceiling — are READ FROM THE CODE that enforces them. A « 48 h » typed into five locales becomes false the
// day CLAIM_WINDOW_HOURS changes, and a legal page that disagrees with the product is worse than a silent one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const msgs = (l: string) => JSON.parse(read(`messages/${l}.json`))
const cgv = (l: string) => msgs(l).legal?.cgv ?? {}
const PAGE = 'app/[locale]/legal/cgv/page.tsx'
const LAYOUT = 'app/[locale]/legal/layout.tsx'
const page = () => read(PAGE)

/** Every key the page actually renders, in render order. The copy contract is this list. */
const RENDERED = [
  'draftBanner', 'title', 'intro',
  'scopeTitle', 'scopeBody',
  'editorTitle', 'editorBody', 'editorLink',
  'serviceTitle', 'serviceBody',
  'orderTitle', 'orderBody',
  'paymentTitle', 'paymentBody',
  'claimsTitle', 'claimsIntro', 'claimsSelfService', 'claimsWindow', 'claimsMaxAge', 'claimsSupport',
  'claimsReview', 'claimsAmount', 'claimsApprovedNotPaid', 'claimsBank', 'claimsPartial', 'claimsHistory',
  'claimsCancelled', 'claimsLoyalty',
  'rightsTitle', 'rightsBody',
  'disputesTitle', 'disputesBody',
  'dataTitle', 'dataBody', 'dataLink',
  'changesTitle', 'changesBody',
  // PRE-L11 (T-79): the version block. `notInForce` is rendered WHERE A DATE WOULD GO — that is the point.
  'versionLabel', 'lastUpdatedLabel', 'effectiveDateLabel', 'notInForce',
] as const

// ── PARITY AND CONTENT ═══════════════════════════════════════════════════════════════════════════════
describe('L10 — the CGV copy exists, complete, in all five locales', () => {
  it('every rendered key exists in every locale, non-empty, with no placeholder marker', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      for (const k of RENDERED) {
        expect(typeof c[k], `${l}.legal.cgv.${k} missing`).toBe('string')
        expect(c[k].trim().length, `${l}.legal.cgv.${k} empty`).toBeGreaterThan(0)
        expect(c[k], `${l}.legal.cgv.${k} still a placeholder`).not.toContain('[[À COMPLÉTER')
        // CASE-SENSITIVE on purpose: the marker convention is uppercase, and /\bTODO\b/i matches the
        // ordinary Spanish word « todo » — it fired on es.paymentBody (« … todos los impuestos … ») the
        // first time this ran. A ban that does not know the language it scans reports the language itself
        // as a defect, which is the same mistake as banning the root « renonc » in the rights section.
        expect(c[k], `${l}.legal.cgv.${k} carries a TODO`).not.toMatch(/\b(TODO|FIXME|XXX)\b|\bLorem ipsum\b/)
      }
    }
  })

  it('the key SET is identical across locales — no locale carries an extra or a missing key', () => {
    const fr = Object.keys(cgv('fr')).sort()
    expect(fr).toEqual([...RENDERED].sort())
    for (const l of LOCALES) expect(Object.keys(cgv(l)).sort(), l).toEqual(fr)
  })

  it('the page renders EVERY key it defines — no orphan copy that nobody can read', () => {
    const src = page()
    for (const k of RENDERED) expect(src, `cgv.${k} is never rendered`).toContain(`t('cgv.${k}'`)
  })

  it('the only interpolations are the two product numbers, in the two keys that take them', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      expect(c.claimsWindow, l).toContain('{hours}')
      expect(c.claimsMaxAge, l).toContain('{days}')
      for (const k of RENDERED) {
        const vars = (c[k].match(/\{[a-zA-Z]+\}/g) ?? []).sort()
        const expected = k === 'claimsWindow' ? ['{hours}'] : k === 'claimsMaxAge' ? ['{days}'] : []
        expect(vars, `${l}.legal.cgv.${k} has unexpected interpolations`).toEqual(expected)
      }
    }
  })
})

// ── THE TWO NUMBERS COME FROM THE CODE ═══════════════════════════════════════════════════════════════
describe('L10 — the product numbers are read from the code that enforces them', () => {
  it('the page reads claimWindowHours() and CLAIM_MAX_ORDER_AGE_DAYS, and passes them as variables', () => {
    const src = page()
    expect(src).toContain("from '@/lib/claim-flags'")
    expect(src).toContain('claimWindowHours()')
    expect(src).toContain("from '@/lib/claim-eligibility'")
    expect(src).toContain('CLAIM_MAX_ORDER_AGE_DAYS')
    expect(src).toContain("t('cgv.claimsWindow', { hours })")
    expect(src).toContain("t('cgv.claimsMaxAge', { days })")
  })

  it('NO locale hardcodes the window or the ceiling — the copy would go stale silently', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      // Latin AND Arabic-Indic digits: an Arabic translation writing ٤٨ would be just as stale.
      expect(c.claimsWindow, `${l} hardcodes the window`).not.toMatch(/48|٤٨/)
      expect(c.claimsMaxAge, `${l} hardcodes the ceiling`).not.toMatch(/\b30\b|٣٠/)
    }
  })

  it('ONE definition of the window: lib/claim-flags owns it, lib/claims re-exports it', async () => {
    // lib/claims is asserted BY SOURCE, never imported: importing it pulls Prisma, Stripe and the refund
    // engine, which took this file past vitest's 5 s default on a cold run — an intermittently red test is
    // worse than no test. The source assertion proves the same thing: one definition, re-exported.
    const claimsSrc = read('lib/claims.ts')
    expect(claimsSrc).toContain("import { claimWindowHours } from '@/lib/claim-flags'")
    expect(claimsSrc).toContain('export { claimWindowHours }')
    expect(claimsSrc).not.toMatch(/export function claimWindowHours/)
    const flags = await import('@/lib/claim-flags')
    // …behaviour parity across the cases the env can be in
    const saved = process.env.CLAIM_WINDOW_HOURS
    try {
      for (const [env, expected] of [[undefined, 48], ['', 48], ['0', 48], ['-3', 48], ['abc', 48], ['72', 72]] as const) {
        if (env === undefined) delete process.env.CLAIM_WINDOW_HOURS
        else process.env.CLAIM_WINDOW_HOURS = env
        expect(flags.claimWindowHours(), `env=${String(env)}`).toBe(expected)
      }
    } finally {
      if (saved === undefined) delete process.env.CLAIM_WINDOW_HOURS
      else process.env.CLAIM_WINDOW_HOURS = saved
    }
  })

  it('lib/claim-flags stays a LEAF — a public legal route must not pull Prisma or Stripe', () => {
    const src = read('lib/claim-flags.ts')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(page()).not.toMatch(/@\/lib\/(claims|prisma|stripe|refund)['"]/)
  })
})

// ── NO FABRICATED LEGAL DATA ═════════════════════════════════════════════════════════════════════════
describe('L10 — nothing legal is invented (founder section 12)', () => {
  it('the page states NO company fact: it only asks whether the identity is complete, and links out', () => {
    const src = page()
    expect(src).toContain('isLegalInfoComplete')
    // it reads no individual fact — LEGAL_INFO's fields belong to /legal/mentions-legales
    expect(src).not.toMatch(/LEGAL_INFO\s*\./)
    expect(src).not.toContain('LEGAL_SUBPROCESSORS')
    expect(src).toContain('/legal/mentions-legales')
  })

  it('no locale invents a SIREN, SIRET, RCS, VAT number, share capital or postal address', () => {
    for (const l of LOCALES) {
      const all = Object.values(cgv(l)).join(' ¶ ')
      // 9+ consecutive digits (SIREN/SIRET), a French VAT number, a postal code + city shape
      expect(all, `${l} carries a registration-number shape`).not.toMatch(/\d{9,}/)
      expect(all, `${l} carries a VAT number`).not.toMatch(/\bFR\s?\d{2}\s?\d{9}\b/)
      expect(all, `${l} carries a French postcode`).not.toMatch(/\b\d{5}\s+[A-ZÀ-Þ]/)
      // and it never ASSERTS a legal identity it does not have
      expect(all, `${l} asserts a legal form`).not.toMatch(/\b(SAS|SARL|EURL|SASU)\b/)
    }
  })

  it('no locale invents a statutory delay or waives a consumer right', () => {
    for (const l of LOCALES) {
      const all = Object.values(cgv(l)).join(' ¶ ')
      // a legal withdrawal/guarantee period stated as a number of days/years would be invented law
      expect(all, `${l} states a statutory period`).not.toMatch(
        /\b\d+\s*(jours?|days?|días?|dias?|giorni?|mois|months?|meses|mesi|ans?|years?|años?|anni)\b/i)
      // …and never an ACT of renunciation. The ROOT alone is not the test: `rightsBody` says in every locale
      // that these terms « ne valent pas renonciation » — the opposite of a waiver — so a token-level ban would
      // forbid the very sentence that protects the customer. What is forbidden is the customer DOING it.
      expect(all, `${l} waives a right`).not.toMatch(
        /(vous|le client|l'?utilisateur)\s+renonc|you\s+(hereby\s+)?waive|(el|la)\s+(cliente|usuari\w+)\s+renunci|(il|l'?)\s*(cliente|utente)\s+rinunc|يتنازل/i)
    }
  })

  it('the product window is NOT presented as an absolute loss of rights (founder section 13)', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      // the window bullet must be paired with the human fallback and with the rights section
      expect(c.claimsSupport.trim().length, l).toBeGreaterThan(20)
      expect(c.rightsBody.trim().length, l).toBeGreaterThan(80)
      // a clause claiming the customer loses everything after the window is exactly what is forbidden
      expect(c.claimsWindow, l).not.toMatch(/définitif|forclos|forfeit|perd(ez|u)|pierde|perde/i)
    }
  })
})

// ── S-21 INSIDE THIS NAMESPACE ═══════════════════════════════════════════════════════════════════════
describe('L10 — the CGV make no banking promise (S-21)', () => {
  it('the bank paragraph says the timing depends on the bank, and names no delay', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      expect(c.claimsBank.trim().length, l).toBeGreaterThan(40)
      // no number at all in the bank sentence: the safest possible form of S-21 here
      expect(c.claimsBank, `${l} puts a number in the bank sentence`).not.toMatch(/\d|[٠-٩]/)
      expect(c.claimsBank, `${l} guarantees a delay`).not.toMatch(/garanti|guarantee|garantiz|garantit/i)
    }
  })

  it('approval is never worded as money already sent', () => {
    for (const l of LOCALES) {
      const c = cgv(l)
      expect(c.claimsApprovedNotPaid.trim().length, l).toBeGreaterThan(40)
      // FR/ES/IT are the traps: « remboursé », « reembolsado », « rimborsato » as a completed fact
      if (l === 'fr') expect(c.claimsApprovedNotPaid).toMatch(/pas un remboursement déjà effectué/)
      if (l === 'es') expect(c.claimsApprovedNotPaid).not.toMatch(/ya (ha sido|fue) reembolsad/i)
      if (l === 'it') expect(c.claimsApprovedNotPaid).not.toMatch(/già rimborsat/i)
      // EN and AR were skipped entirely on the first pass — an omission the adversarial review named. The
      // trap differs per language: English drifts into an immediate promise, Arabic into « the amount has
      // been returned ».
      if (l === 'en') {
        expect(c.claimsApprovedNotPaid).toMatch(/not a refund already made/i)
        expect(c.claimsApprovedNotPaid).not.toMatch(/we will refund you|has already been refunded/i)
      }
      if (l === 'ar') {
        expect(c.claimsApprovedNotPaid).toMatch(/[؀-ۿ]/)
        expect(c.claimsApprovedNotPaid).not.toMatch(/تم رد المبلغ بالفعل/)
      }
    }
  })
})

// ── THE LINK, AND NO CHECKBOX ════════════════════════════════════════════════════════════════════════
describe('L10 — the CGV are reachable, and filing a claim gained no consent gate', () => {
  it('the legal shell links to /legal/cgv ONCE, through the locale-aware Link', () => {
    const src = read(LAYOUT)
    expect(src.match(/\/legal\/cgv/g) ?? []).toHaveLength(1)
    expect(src).toContain("from '@/navigation'")
    expect(src).toContain("t('nav.cgv')")
    for (const l of LOCALES) {
      expect(typeof msgs(l).legal.nav.cgv, l).toBe('string')
      expect(msgs(l).legal.nav.cgv.trim().length, l).toBeGreaterThan(0)
    }
    // NOBODY hardcodes a locale-prefixed CGV URL anywhere in the product
    for (const f of ['app', 'lib', 'components']) {
      const hits = require('node:child_process')
        .execSync(`grep -rlE "/(fr|en|es|it|ar)/legal/cgv" ${f} || true`, { encoding: 'utf8' }).trim()
      expect(hits, `${f} hardcodes a locale-prefixed CGV URL`).toBe('')
    }
  })

  it('a CONSUMER can find it: the /eat surfaces that carry the legal triplet now carry four links', () => {
    // §15 — « lien visible ». Linking it only from inside /legal/* would mean nobody browsing /eat could
    // reach it. The four surfaces below already list the legal pages through the `legal.nav` namespace, so the
    // CGV costs one <Link> and one label each — and /eat/auth has TWO blocks (desktop AND mobile), which is
    // the easy one to forget, so both are asserted.
    const withCgv: Array<[string, number]> = [
      ['components/eat/EatShell.tsx', 1],
      ['app/[locale]/eat/auth/page.tsx', 2],
      ['components/business/PartnerShell.tsx', 1],
      ['app/[locale]/legal/layout.tsx', 1],
    ]
    for (const [f, n] of withCgv) {
      const src = read(f)
      expect(src.match(/href="\/legal\/cgv"/g) ?? [], `${f} should link the CGV ${n}×`).toHaveLength(n)
      // through the locale-aware Link, and beside the pages it belongs with
      expect(src, f).toContain("from '@/navigation'")
      expect(src, f).toContain('/legal/cookies')
    }
  })

  it('/legal/* is PUBLIC, so the page is reachable with every claims flag closed', () => {
    const mw = read('middleware.ts')
    expect(mw).toContain("restPath === '/legal' || restPath.startsWith('/legal/')")
  })

  it('NO CGV acceptance checkbox was added to the claim intake (founder section 14)', () => {
    // The claim form and its section component: a new consent gate here is the thing forbidden outright.
    for (const f of ['app/[locale]/eat/order/[orderId]/help/page.tsx', 'components/claims/ClaimSection.tsx']) {
      const src = read(f)
      expect(src, `${f} mentions the CGV`).not.toMatch(/cgv|conditions générales|terms of sale/i)
      expect(src, `${f} gained a checkbox`).not.toMatch(/type="checkbox"|type='checkbox'/)
    }
  })

  it('the draft banner and the noindex follow BOTH facts: identity filled AND counsel reviewed', async () => {
    const src = page()
    // D′ L10 adversarial review — gating on `isLegalInfoComplete()` alone meant that filling a SIREN would
    // silently publish an UNREVIEWED terms-of-sale page and remove its warning, as a side effect of an
    // unrelated edit. Two facts, two predicates, joined by isCgvPublishable().
    expect(src).toContain('robots: isCgvPublishable() ? undefined : { index: false, follow: false }')
    // §17 — the TITLE is localized, from the same key the <h1> renders, so the tab and the heading cannot
    // disagree. A static `metadata` object could not do it: the locale is only known per request.
    expect(src).toContain('export async function generateMetadata')
    expect(src).toContain("t('cgv.title')")
    expect(src).not.toMatch(/title:\s*'Conditions/)
    expect(src).toContain('{!publishable && (')
    const legal = await import('@/lib/legal-info')
    expect(legal.CGV_COUNSEL_REVIEWED, 'no lawyer has reviewed it yet').toBe(false)
    expect(legal.isCgvPublishable()).toBe(false)
    // NEGATIVE CONTROL: a fully-filled identity is NOT enough on its own — which is the whole point.
    const FILLED = JSON.parse(JSON.stringify(legal.LEGAL_INFO)) as typeof legal.LEGAL_INFO
    const fill = (o: Record<string, string>) => { for (const k of Object.keys(o)) o[k] = 'x' }
    fill(FILLED.editor as unknown as Record<string, string>)
    fill(FILLED.host as unknown as Record<string, string>)
    fill(FILLED.mediation as unknown as Record<string, string>)
    fill(FILLED.privacy as unknown as Record<string, string>)
    expect(legal.isLegalInfoComplete(FILLED), 'the identity would read complete').toBe(true)
    expect(legal.isCgvPublishable(FILLED), 'but it stays a draft until counsel reviews it').toBe(false)
    expect(src).toContain("t('cgv.draftBanner')")
  })

  it('no unsafe HTML injection — the copy is rendered as text', () => {
    expect(page()).not.toContain('dangerouslySetInnerHTML')
  })
})

// ── ARABIC / RTL ═════════════════════════════════════════════════════════════════════════════════════
describe('L10 — the Arabic page is really Arabic (founder section 16)', () => {
  it('every ar string is in Arabic script and differs from fr and en', () => {
    const ar = cgv('ar'), fr = cgv('fr'), en = cgv('en')
    for (const k of RENDERED) {
      expect(ar[k], `ar.${k} has no Arabic script`).toMatch(/[؀-ۿ]/)
      expect(ar[k], `ar.${k} is the French text`).not.toBe(fr[k])
      expect(ar[k], `ar.${k} is the English text`).not.toBe(en[k])
      // a silent fallback shows up as a long Latin run inside an Arabic string
      expect(ar[k].replace(/Grubano|CGV/g, ''), `ar.${k} embeds a Latin sentence`).not.toMatch(/[A-Za-z]{12,}/)
    }
  })

  it('the shell sets direction from the locale, and the page uses logical properties', () => {
    // dir is set once on <html> by the root locale layout; the page must not fight it with left/right padding
    expect(read(LAYOUT)).not.toMatch(/dir=["']ltr["']/)
    expect(page()).toContain('ps-5')          // padding-inline-start, not pl-5
    expect(page()).not.toMatch(/\bpl-\d/)
  })

  it('accessibility: one H1, semantic sections, and a keyboard-reachable skip link in the shell', () => {
    const src = page()
    // Matched on the ELEMENT shape, not the bare tag: the page's own doc comment mentions « the <h1> »,
    // and counting that as a heading is how a structural assertion starts reporting prose.
    expect(src.match(/<h1 className=/g) ?? []).toHaveLength(1)
    expect(src).toContain('<h2')
    expect(src).toContain('<section')
    expect(read(LAYOUT)).toContain('focus:not-sr-only')
    for (const l of LOCALES) expect(typeof msgs(l).legal.shell.skipToContent, l).toBe('string')
  })
})

// ── PRE-L11 — T-78 (the support contact) AND T-79 (version / not in force) ═══════════════════════════
describe('PRE-L11 T-78 — the terms point at the support channel the app ALREADY has, and at no new address', () => {
  it('ONE declaration, and the page reads it instead of carrying a literal', async () => {
    const { SUPPORT_EMAIL, SUPPORT_MAILTO } = await import('@/lib/support-contact')
    const src = page()
    expect(src).toContain("from '@/lib/support-contact'")
    expect(src).toContain('{SUPPORT_EMAIL}')
    expect(src).toContain('href={SUPPORT_MAILTO}')
    // the page itself must NOT contain the address — that is what « pas une deuxième adresse en dur » means
    expect(src).not.toContain(SUPPORT_EMAIL)
    expect(SUPPORT_MAILTO).toBe(`mailto:${SUPPORT_EMAIL}`)
    // lib/support-contact is a LEAF, so any surface may read it
    expect(read('lib/support-contact.ts')).not.toMatch(/^\s*import\s/m)
  })

  it('the declared address IS the one the product already publishes — measured, not assumed', async () => {
    const { SUPPORT_EMAIL } = await import('@/lib/support-contact')
    // (a) the transactional FROM, which the e-mail footer invites the customer to reply to
    expect(read('lib/transactional-emails.ts')).toContain(`<${SUPPORT_EMAIL}>`)
    // (b) the sentence the help screen shows, in ALL FIVE locales
    for (const l of LOCALES) {
      expect(msgs(l).eat.help.refundOffBody, `${l} help copy`).toContain(SUPPORT_EMAIL)
    }
    // A drift here means the terms would send a customer somewhere the product does not answer.
  })

  it('it is a SUPPORT channel, not a legal identity: LEGAL_INFO stays a placeholder and the page links out', async () => {
    const legal = await import('@/lib/legal-info')
    // §12 — the editor's published contact is a company fact the founder supplies; inventing one is forbidden.
    expect(legal.isPlaceholder(legal.LEGAL_INFO.editor.email)).toBe(true)
    expect(page()).toContain('/legal/mentions-legales')
    // …and the mediator is NOT invented either
    for (const f of ['nom', 'url', 'adresse'] as const) {
      expect(legal.isPlaceholder(legal.LEGAL_INFO.mediation[f]), `mediation.${f}`).toBe(true)
    }
  })
})

describe('PRE-L11 T-79 — three facts, and the third is deliberately not a date', () => {
  it('version, lastUpdated and effectiveDate are separate, and effectiveDate is null', async () => {
    const { CGV_VERSION, CGV_LAST_UPDATED, CGV_EFFECTIVE_DATE, cgvState } = await import('@/lib/cgv-version')
    expect(CGV_VERSION).toBe('0.1-beta')
    expect(CGV_LAST_UPDATED).toBe('2026-09-28')
    expect(CGV_EFFECTIVE_DATE).toBeNull()
    const s = cgvState()
    expect(s.inForce, 'nothing is in force while there is no date and no counsel review').toBe(false)
    expect(s).toEqual({ version: '0.1-beta', lastUpdated: '2026-09-28', effectiveDate: null, inForce: false })
  })

  it('the page renders the NOT-IN-FORCE sentence where a date would go, in all five locales', () => {
    const src = page()
    expect(src).toContain("t('cgv.notInForce')")
    expect(src).toContain('{state.inForce ? state.effectiveDate : ')
    for (const l of LOCALES) {
      const c = cgv(l)
      for (const k of ['versionLabel', 'lastUpdatedLabel', 'effectiveDateLabel', 'notInForce'] as const) {
        expect(typeof c[k], `${l}.legal.cgv.${k}`).toBe('string')
        expect(c[k].trim().length, `${l}.${k} empty`).toBeGreaterThan(0)
      }
      // the sentence must not smuggle in a date or a promise of one
      expect(c.notInForce, `${l} notInForce has a digit`).not.toMatch(/\d|[٠-٩]/)
    }
  })

  it('inForce needs BOTH a date and a counsel review — neither alone is enough', async () => {
    const { CGV_EFFECTIVE_DATE } = await import('@/lib/cgv-version')
    const legal = await import('@/lib/legal-info')
    // The two conditions, evaluated independently so the test says WHICH one is missing.
    expect(CGV_EFFECTIVE_DATE).toBeNull()
    expect(legal.CGV_COUNSEL_REVIEWED).toBe(false)
    // …and the source states the conjunction, so a future date alone cannot flip it
    expect(read('lib/cgv-version.ts')).toContain('CGV_EFFECTIVE_DATE !== null && CGV_COUNSEL_REVIEWED')
  })
})

describe('PRE-L11 — THE PRODUCTION GATE cannot be satisfied today, and it says why', () => {
  it('readiness is false, with every missing fact enumerated', async () => {
    const { cgvProductionReadiness } = await import('@/lib/cgv-version')
    const r = cgvProductionReadiness()
    expect(r.ready).toBe(false)
    // all four blockers hold right now: no counsel review, no effective date, placeholders, no mediator
    expect([...r.blockers].sort()).toEqual([
      'counsel_not_reviewed', 'legal_info_incomplete', 'no_effective_date', 'no_mediator',
    ])
  })

  it('EACH of the three founder conditions is sufficient ON ITS OWN to block production', () => {
    // Proven on the SOURCE, because the constants are compile-time: the function pushes a blocker for each
    // condition independently, with no `else`, so no condition can be masked by another being false.
    const src = read('lib/cgv-version.ts')
    expect(src).toContain("if (!CGV_COUNSEL_REVIEWED) blockers.push('counsel_not_reviewed')")
    expect(src).toContain("if (CGV_EFFECTIVE_DATE === null) blockers.push('no_effective_date')")
    expect(src).toContain("if (!isLegalInfoComplete()) blockers.push('legal_info_incomplete')")
    expect(src).toContain("blockers.push('no_mediator')")
    expect(src).toContain('ready: blockers.length === 0')
    // NO ESCAPE HATCH: no env read, no bypass identifier. Matched on the SHAPE of a hatch, not on the English
    // words — /force/i fires on « in force » and on `inForce`, i.e. on the very concept this file is about.
    // (Third time in this chantier: a ban that does not know the language it scans reports the language itself
    // as a defect.)
    expect(src).not.toMatch(/process\.env/)
    expect(src).not.toMatch(/FORCE_|_FORCE|forceReady|allowUnreviewed|bypass|overrideGate|skipGate/i)
  })

  it('the MEDIATOR is its own blocker, not merely implied by the completeness check', () => {
    // The founder named it specifically (« Si aucun médiateur réel n'est configuré … conserver la production
    // bloquée »), and a blocker that is only implied by another gets waived by accident the day the other is
    // satisfied. So it is listed separately — asserted here so a future refactor cannot collapse them.
    const src = read('lib/cgv-version.ts')
    const fn = src.slice(src.indexOf('export function cgvProductionReadiness'))
    expect(fn).toContain('LEGAL_INFO.mediation')
    expect(fn).toContain('no_mediator')
    expect(fn.indexOf('legal_info_incomplete')).toBeLessThan(fn.indexOf('no_mediator'))
  })

  it('the page is NOT indexable and carries its draft banner while readiness is false', async () => {
    const { cgvProductionReadiness } = await import('@/lib/cgv-version')
    expect(cgvProductionReadiness().ready).toBe(false)
    const src = page()
    expect(src).toContain('robots: isCgvPublishable() ? undefined : { index: false, follow: false }')
    expect(src).toContain('{!publishable && (')
  })

  it('this lot states no legal opinion — the gate reports MISSING FACTS only', () => {
    const src = read('lib/cgv-version.ts')
    // every blocker names something absent from the repository, never a judgement of the text
    expect(src).toContain('NOT A LEGAL OPINION')
    for (const judgement of ['compliant', 'lawful', 'enforceable', 'conforme au droit']) {
      expect(src.toLowerCase(), judgement).not.toContain(judgement)
    }
  })
})
