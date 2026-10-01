// tests/claims-r13-residuals.test.ts — T-49 round 13, slice W8: J-M27 (C11, D2 RESIDUALS, binding rule 14) and the W8
// consistency sweep.
//
// J-M27: the residuals of the Claims-side quiescence rules are stated verbatim in docs/ops/REFUND-FINANCIAL-CONTRACT.md
// « Résidus round 13 » and in the it.skip reasons of the stalled-attempt race test; the withdrawn engine guard is recorded
// there as a founder decision for a later round, and the real two-connection rehearsal (J-M24) with its server version and
// result, to be re-run on the certified release-candidate SHA before any window. The texts are read out of C11 itself.
//
// Sweep (W8 scope, tightened by the W8 fixer, rounds 1 and 2): docs/ops/CLAIMS-R13-RULE-COVERAGE.md has exactly one row
// per rule id of sections A-J and every cell resolves to a ROUND-13 site (a bare-token match is not a citation: earlier
// projects reuse the same ids — franchise B1-B7, dine-in G1-G3, checkout C1 …); every A and B-I rule has a Round-13
// citation in a TEST file unless its row is NOTE-ONLY (which requires an IMPLEMENTATION NOTE); no rule's latest note says
// OPEN; every J rule names a file that exists or is NOTE-ONLY; no deleted round-12 surface (or withdrawn-guard vocabulary)
// is back in code.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const SPEC = read('docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md')
const DOC = read('docs/ops/REFUND-FINANCIAL-CONTRACT.md')
const STALE = read('tests/claims-r13-stale-attempt.test.ts')
const COVERAGE_PATH = 'docs/ops/CLAIMS-R13-RULE-COVERAGE.md'
const COVERAGE = read(COVERAGE_PATH)

/** The body of one spec rule, from its heading to the next heading. */
function ruleBody(spec: string, id: string): string {
  const start = spec.indexOf(`\n### ${id} `)
  if (start < 0) return ''
  const next = spec.indexOf('\n### ', start + 1)
  return spec.slice(start, next < 0 ? spec.length : next)
}

/** C11's residuals (R1-R5), read out of the frozen rule. */
function c11Residuals(spec: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of Array.from(ruleBody(spec, 'C11').matchAll(/^\((R[1-5])\) (.+)$/gm))) out[m[1]] = m[2]
  return out
}

/** The « Résidus round 13 » section of the contract doc (heading to the next ## heading). */
function residualSection(doc: string): string | null {
  const lines = doc.split('\n')
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes('Résidus round 13'))
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  return lines.slice(start, end).join('\n')
}

/** Every way the doc and the skip reasons fail J-M27 (empty = compliant). */
function residualViolations(doc: string, staleSrc: string, spec: string): string[] {
  const out: string[] = []
  const want = c11Residuals(spec)
  if (Object.keys(want).join(',') !== 'R1,R2,R3,R4,R5') out.push('C11 does not list R1-R5')
  const section = residualSection(doc)
  if (section === null) return [...out, 'no « Résidus round 13 » section']
  const got: Record<string, string> = {}
  for (const m of Array.from(section.matchAll(/^- \*\*\((R[1-5])\)\*\* (.+)$/gm))) got[m[1]] = m[2]
  for (const [id, sentence] of Object.entries(want)) if (got[id] !== sentence) out.push(`${id} not stated verbatim`)
  if (!(section.includes('exclusiveReason') && section.includes('founder decision for a later round'))) out.push('the engine guard is not recorded as a founder decision for a later round')
  if (!(section.includes('MariaDB 12.3.2') && section.includes('20/20') && section.includes('certified release-candidate SHA') && section.includes('before any Claims window'))) {
    out.push('the J-M24 rehearsal (server version, result, re-run before any window) is not recorded')
  }
  const skips = Array.from(staleSrc.matchAll(/it\.skip\(\s*"([^"]+)"/g)).map((m) => m[1])
  if (JSON.stringify(skips) !== JSON.stringify(['R1', 'R2', 'R3', 'R4'].map((id) => want[id]))) out.push('the it.skip reasons are not R1-R4 verbatim')
  return out
}

describe('J-M27 — residuals stated verbatim (C11)', () => {
  it('C11 lists five residuals, and the shipped doc and skip reasons state them', () => {
    expect(Object.keys(c11Residuals(SPEC))).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect(residualViolations(DOC, STALE, SPEC)).toEqual([])
  })

  it('each it.skip reason equals its doc sentence (R1-R4), and R5 is in the doc', () => {
    const want = c11Residuals(SPEC)
    const section = residualSection(DOC) ?? ''
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5']) expect(section, id).toContain(`- **(${id})** ${want[id]}`)
    expect(Array.from(STALE.matchAll(/it\.skip\(\s*"([^"]+)"/g)).map((m) => m[1])).toEqual(['R1', 'R2', 'R3', 'R4'].map((id) => want[id]))
  })

  it('NEGATIVE CONTROL — the doc without R5 is red; one word of R3 changed is red; a skip reason reworded is red; no section is red', () => {
    const want = c11Residuals(SPEC)
    const withoutR5 = DOC.split('\n').filter((l) => !l.startsWith('- **(R5)**')).join('\n')
    expect(residualViolations(withoutR5, STALE, SPEC)).toEqual(['R5 not stated verbatim'])
    const r3Edited = DOC.replace(`- **(R3)** ${want.R3}`, `- **(R3)** ${want.R3.replace('Dashboard', 'Stripe')}`)
    expect(r3Edited).not.toBe(DOC)
    expect(residualViolations(r3Edited, STALE, SPEC)).toEqual(['R3 not stated verbatim'])
    const skipEdited = STALE.replace(want.R2, want.R2.replace('admin rail', 'operator rail'))
    expect(residualViolations(DOC, skipEdited, SPEC)).toEqual(['the it.skip reasons are not R1-R4 verbatim'])
    expect(residualViolations(DOC.replace('Résidus round 13', 'Residuals'), STALE, SPEC)).toEqual(['no « Résidus round 13 » section'])
    const noRehearsal = DOC.replace(residualSection(DOC)!, residualSection(DOC)!.split('certified release-candidate SHA').join('next SHA'))
    expect(residualViolations(noRehearsal, STALE, SPEC)).toEqual(['the J-M24 rehearsal (server version, result, re-run before any window) is not recorded'])
  })
})

// ══ A-S00 — the CUSTOMER keys the state rows name, read out of the convention row ═══════════════════════════
type Catalogs = Record<'fr' | 'en' | 'es' | 'it' | 'ar', { claims: { status: Record<string, string> } }>
const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const

/** FVc (5 locales), RFc (5 locales) and APc (fr) as A-S00 states them, compared with messages/*.json (empty = equal). */
function customerKeyViolations(spec: string, catalogs: Catalogs): string[] {
  const row = ruleBody(spec, 'A-S00')
  const fv = /FVc = claims\.status\.financial_verification \(fr « (.+?) » \/ en « (.+?) » \/ es « (.+?) » \/ it « (.+?) » \/ ar « (.+?) »\)/.exec(row)
  const rf = /RFc = claims\.status\.refunded \((.+?) \/ (.+?) \/ (.+?) \/ (.+?) \/ (.+?)\)/.exec(row)
  const ap = /APc = claims\.status\.approved \(« (.+?) »/.exec(row)
  if (!fv || !rf || !ap) return ['A-S00 does not state FVc, RFc and APc']
  const out: string[] = []
  LOCALES.forEach((l, i) => {
    if (catalogs[l].claims.status.financial_verification !== fv[i + 1]) out.push(`${l} FVc`)
    if (catalogs[l].claims.status.refunded !== rf[i + 1]) out.push(`${l} RFc`)
  })
  if (catalogs.fr.claims.status.approved !== ap[1]) out.push('fr APc')
  return out
}

describe('A-S00 — the customer keys FVc, RFc and APc equal the message catalogs', () => {
  const catalogs = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))])) as Catalogs

  it('5 locales for FVc and RFc, fr for APc', () => {
    expect(customerKeyViolations(SPEC, catalogs)).toEqual([])
  })

  it('NEGATIVE CONTROL — a catalog whose es FVc or fr RFc differs is caught; a row without the keys is caught', () => {
    const mutated = JSON.parse(JSON.stringify(catalogs)) as Catalogs
    mutated.es.claims.status.financial_verification = 'Su solicitud está en revisión.'
    mutated.fr.claims.status.refunded = 'Remboursement effectué'
    expect(customerKeyViolations(SPEC, mutated)).toEqual(['fr RFc', 'es FVc'])
    expect(customerKeyViolations(SPEC.replace('FVc = claims.status.financial_verification', 'FVc = ?'), catalogs)).toEqual(['A-S00 does not state FVc, RFc and APc'])
  })
})

// ══ W8 consistency sweep ════════════════════════════════════════════════════════════════════════════════
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? (n === 'node_modules' || n === '.next' ? [] : walk(p)) : [p]
})

/**
 * Section rules [id, body] from the line starting with `from` to the next line starting with `to` — or to the end of
 * the file when `to` is omitted or not found (section J is the last one).
 */
function sectionRules(spec: string, from: string, to?: string): Array<[string, string]> {
  const lines = spec.split('\n')
  const start = lines.findIndex((l) => l.startsWith(from))
  if (start < 0) return []
  const found = to === undefined ? -1 : lines.findIndex((l, i) => i > start && l.startsWith(to))
  const end = found < 0 ? lines.length : found
  const out: Array<[string, string]> = []
  for (let i = start; i < end; i++) {
    const m = /^### ([A-Z]-?[0-9A-Za-z-]*) \[(CORE|DEFER)\]/.exec(lines[i])
    if (!m) continue
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith('### ') && !lines[j].startsWith('## ')) j++
    out.push([m[1], lines.slice(i + 1, j).join('\n')])
  }
  return out
}
/**
 * A rule id standing as a token (never « claim C2 », a claim's name; never AM_B3 or E-01x). The id tokens of earlier
 * projects are the same shape (franchise B1-B7, dine-in G1-G3, checkout C1, dish-sheet D2, Claims batch C2 …), so a
 * token alone is never a citation: see r13CitingLines.
 */
const idToken = (id: string) => new RegExp(`(^|[^A-Za-z0-9_-])(?<![Cc]laims? )${id.replace(/-/g, '\\-')}(?![0-9A-Za-z_]|-[0-9])`)
const R13_MARK = /round[ -]13|ROUND 13|Round 13|\bR13\b/
const R13_PATH = /(^|\/)(claims-r13-|claims-t49-round13-)/
/** Files that implement copy or record a residual, and carry no « ROUND 13 » marker of their own. */
const CONTENT_FILE = /^(messages\/[a-z]{2}\.json|docs\/ops\/[A-Za-z0-9-]+\.md|\.github\/workflows\/cron\.yml)$/
const isCommentLine = (l: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)

/**
 * The 0-based lines of a file that cite `id` AS A ROUND-13 RULE: the token is on the line, and the file is a round-13
 * file (its path is claims-r13-* / claims-t49-round13-*, or its first line names round 13), or the line names round 13,
 * or it is a comment whose contiguous comment block above names round 13.
 */
function r13CitingLines(path: string, text: string, id: string): number[] {
  const lines = text.split('\n')
  const token = idToken(id)
  const fileR13 = R13_PATH.test(path) || R13_MARK.test(lines[0] ?? '')
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!token.test(lines[i])) continue
    let ok = fileR13 || R13_MARK.test(lines[i])
    for (let j = i - 1; !ok && isCommentLine(lines[i]) && j >= 0 && isCommentLine(lines[j]); j--) ok = R13_MARK.test(lines[j])
    if (ok) out.push(i)
  }
  return out
}

/** True when the LAST implementation note of a rule body declares it OPEN (a word quoted inside « » does not count). */
function latestNoteOpen(body: string): boolean {
  const notes = body.split('\n').filter((l) => l.startsWith('IMPLEMENTATION NOTE'))
  return notes.length > 0 && /\bOPEN\b/.test(notes[notes.length - 1].replace(/«[^»]*»/g, ''))
}

type CoverageRow = { id: string; status: 'IMPLEMENTED' | 'NOTE-ONLY'; code: string[]; tests: string[]; residual: string[] }
/** The rows of docs/ops/CLAIMS-R13-RULE-COVERAGE.md. */
function coverageRows(doc: string): CoverageRow[] {
  const entries = (cell: string) => Array.from(cell.matchAll(/`([^`]+)`/g)).map((m) => m[1])
  return doc.split('\n').flatMap((l) => {
    const m = /^\| ([A-Z][0-9A-Za-z-]*) \| (IMPLEMENTED|NOTE-ONLY) \| (.*) \| (.*) \| (.*) \|$/.exec(l)
    return m ? [{ id: m[1], status: m[2] as CoverageRow['status'], code: entries(m[3]), tests: entries(m[4]), residual: entries(m[5]) }] : []
  })
}

/**
 * Why one cell entry of a non-J row does not name a Round-13 site of that row (null = it does).
 *   `path`       — the file carries a Round-13 citation of the id (r13CitingLines);
 *   `path#text`  — the file contains text; when text names the id, a line holding it is a Round-13 citation; when it does
 *                  not (an implementing symbol, a copy value), the file carries a Round-13 reference or is a CONTENT_FILE;
 *   `path#`      — only a NOTE-ONLY map may name a file without a site.
 * J rows cite the FILE their rule names: an entry must only exist (and a `path#text` contain its text).
 */
function entryViolation(row: CoverageRow, e: string, fileText: (p: string) => string | null): string | null {
  const k = e.indexOf('#')
  const path = k < 0 ? e : e.slice(0, k)
  const text = fileText(path)
  if (text === null) return `${row.id}: ${path} does not exist`
  if (row.id.startsWith('J-')) return k < 0 || k === e.length - 1 || text.includes(e.slice(k + 1)) ? null : `${row.id}: ${e} does not resolve`
  if (k === e.length - 1) return row.status === 'NOTE-ONLY' ? null : `${row.id}: ${e} names no site`
  const content = CONTENT_FILE.test(path)
  if (!content && !(R13_PATH.test(path) || R13_MARK.test(text))) return `${row.id}: ${path} has no Round-13 reference`
  if (k < 0) return r13CitingLines(path, text, row.id).length ? null : `${row.id}: ${path} does not cite ${row.id} as a Round-13 rule`
  const anchor = e.slice(k + 1)
  if (!text.includes(anchor)) return `${row.id}: ${e} does not resolve`
  if (content || !idToken(row.id).test(anchor)) return null
  const scoped = new Set(r13CitingLines(path, text, row.id))
  return text.split('\n').some((l, i) => l.includes(anchor) && scoped.has(i)) ? null : `${row.id}: ${e} is not a Round-13 citation of ${row.id}`
}

/** Every way the coverage doc fails the spec (empty = compliant). `fileText` returns a repo file's text, or null. */
function coverageViolations(doc: string, spec: string, fileText: (p: string) => string | null): string[] {
  const out: string[] = []
  const rules = new Map(sectionRules(spec, '## A. '))
  const rows = coverageRows(doc)
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.id)) out.push(`${r.id}: duplicate row`)
    seen.add(r.id)
  }
  for (const id of Array.from(rules.keys())) if (!seen.has(id)) out.push(`${id}: no row`)
  for (const r of rows) {
    const body = rules.get(r.id)
    if (body === undefined) { out.push(`${r.id}: not a rule of sections A-J`); continue }
    if (!r.code.length) out.push(`${r.id}: no code site`)
    if (r.status === 'IMPLEMENTED' && !r.tests.some((e) => /^(tests|EMAIL-FACTUAL-PACK\/tools)\//.test(e))) out.push(`${r.id}: no test file`)
    if (r.status === 'NOTE-ONLY' && !/IMPLEMENTATION NOTE/.test(body)) out.push(`${r.id}: NOTE-ONLY without an IMPLEMENTATION NOTE`)
    for (const e of [...r.code, ...r.tests, ...r.residual]) {
      const v = entryViolation(r, e, fileText)
      if (v) out.push(v)
    }
  }
  return out
}

/** A and B-I rule ids with no Round-13 citation in any test file [path, text], and not NOTE-ONLY in the coverage doc. */
function untestedRules(spec: string, testFiles: Array<[string, string]>, noteOnly: Set<string>): string[] {
  return sectionRules(spec, '## A. ', '## J. ')
    .filter(([id]) => !noteOnly.has(id) && !testFiles.some(([p, s]) => r13CitingLines(p, s, id).length > 0))
    .map(([id]) => id)
}

/** J rules whose FILE names no existing file and that are not NOTE-ONLY in the coverage doc. */
function jRulesWithoutFile(spec: string, exists: (p: string) => boolean, noteOnly: Set<string>): string[] {
  return sectionRules(spec, '## J. ').filter(([id]) => !noteOnly.has(id)).filter(([, body]) => {
    const file = /^FILE: (.+)$/m.exec(body)
    const paths = file ? Array.from(file[1].matchAll(/((?:tests|EMAIL-FACTUAL-PACK|scripts|lib|app)\/[A-Za-z0-9_.\/[\]-]+\.(?:ts|tsx|js|mjs))/g)).map((m) => m[1]) : []
    return !paths.some(exists)
  }).map(([id]) => id)
}

/** Deleted round-12 surfaces, withdrawn-guard vocabulary and superseded phrases (E0 REMOVED, J-M41, J-M42, binding rule 1). */
const DELETED = [
  'awaiting_other_row', 'refundRowBelongsToClaim', 'boundPathRowTruth', 'closureRecordedByCaller', 'otherClaimRows', 'boundElsewhere', 'mayMoveMoney',
  'noRowEverMoved', 'listRevertedAfterRefundClaims', 'revertedAfterRefund', 'refund_reverted_claim', 'apply-row-failure', 'terminalBeforeEpoch',
  'terminalDecidedFromEpochBeforeLive', 'exclusiveReason', 'E5b', 'ownStampedRowIds', 'settled_by_support',
  'relèvent d’AUTRES réclamations', 'jamais déplacé', 'n’a déplacé d’argent', 'Absence de remboursement PROUVÉE', 'aucun code ne sort',
  "De l'argent A bougé, mais pas au titre de cette réclamation", 'annuler l’approbation',
]
function deletedSurfaceHits(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([f, s]) => {
    const code = /\.(ts|tsx|js|mjs)$/.test(f) ? stripComments(s) : s
    return DELETED.filter((t) => code.includes(t)).map((t) => `${f}: ${t}`)
  })
}

describe('W8 sweep — one coverage row per rule, every rule tested or noted, no OPEN note, every J rule filed, no deleted surface back', () => {
  const codeFiles = ['lib', 'app', 'components', 'scripts'].flatMap(walk).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
  const testFiles = walk('tests').filter((f) => /\.(ts|tsx)$/.test(f) && f !== 'tests/claims-r13-residuals.test.ts').map((f): [string, string] => [f, read(f)])
  const fileText = (p: string) => (existsSync(p) && statSync(p).isFile() ? read(p) : null)
  const noteOnly = new Set(coverageRows(COVERAGE).filter((r) => r.status === 'NOTE-ONLY').map((r) => r.id))
  /** The coverage doc with the row of `id` replaced. */
  const withRow = (doc: string, id: string, row: string) => {
    const next = doc.split('\n').map((l) => (l.startsWith(`| ${id} |`) ? row : l)).join('\n')
    expect(next, `row ${id} replaced`).not.toBe(doc)
    return next
  }

  it('sections A-J: 96 + 117 + 102 rules; the coverage doc has exactly one resolving row for each', () => {
    expect(sectionRules(SPEC, '## A. ', '## B. ').length).toBe(96)
    expect(sectionRules(SPEC, '## B. ', '## J. ').length).toBe(117)
    expect(sectionRules(SPEC, '## J. ').length).toBe(102)
    expect(coverageRows(COVERAGE).length).toBe(315)
    expect(coverageViolations(COVERAGE, SPEC, fileText)).toEqual([])
    expect(Array.from(noteOnly).sort()).toEqual(['H18', 'J-C19'])
  })

  it('every A and B-I rule has a Round-13 citation in a test file unless NOTE-ONLY; no rule of A-J has a latest note that says OPEN', () => {
    expect(untestedRules(SPEC, testFiles, noteOnly)).toEqual([])
    expect(sectionRules(SPEC, '## A. ').filter(([, body]) => latestNoteOpen(body)).map(([id]) => id)).toEqual([])
  })

  it('section J: every rule names an existing file or is NOTE-ONLY', () => {
    expect(jRulesWithoutFile(SPEC, existsSync, noteOnly)).toEqual([])
  })

  it('no deleted round-12 surface or withdrawn-guard word in lib/, app/, components/, scripts/ or messages/ (comments stripped)', () => {
    const files = Object.fromEntries([...codeFiles, ...readdirSync('messages').filter((f) => f.endsWith('.json')).map((f) => `messages/${f}`)].map((f) => [f, read(f)]))
    expect(deletedSurfaceHits(files)).toEqual([])
  })

  it('NEGATIVE CONTROL — a missing row, an unresolved cell, a NOTE-ONLY row without a note, a row without a test file, a docs-only citation, an OPEN note, a J rule with no file and a live deleted identifier are all caught', () => {
    const withoutC11 = COVERAGE.split('\n').filter((l) => !l.startsWith('| C11 |')).join('\n')
    expect(coverageViolations(withoutC11, SPEC, fileText)).toEqual(['C11: no row'])
    const badAnchor = COVERAGE.replace('`messages/fr.json#"orderCancelledPaidOff"`', '`messages/fr.json#"orderCancelledPaidOffX"`')
    expect(badAnchor).not.toBe(COVERAGE)
    expect(coverageViolations(badAnchor, SPEC, fileText)).toEqual(['H17: messages/fr.json#"orderCancelledPaidOffX" does not resolve'])
    const synthSpec = `${SPEC}\n### Z99 [CORE] Synthetic\nFILE: tests/claims-r13-no-such-file.test.ts (new)\n`
    const synthRow = '| Z99 | NOTE-ONLY | `scripts/check-translations.js#` | — | — |'
    expect(coverageViolations(`${COVERAGE}\n${synthRow}\n`, synthSpec, fileText)).toEqual(['Z99: NOTE-ONLY without an IMPLEMENTATION NOTE'])
    expect(coverageViolations(`${COVERAGE}\n${synthRow.replace('NOTE-ONLY', 'IMPLEMENTED')}\n`, synthSpec, fileText)).toEqual(['Z99: no test file', 'Z99: scripts/check-translations.js# names no site'])
    expect(coverageViolations(`${COVERAGE}\n| Z99 | IMPLEMENTED | \`lib/claims.ts\` | \`tests/claims-r13-rules.test.ts#\` | — |\n`, synthSpec, fileText))
      .toEqual(['Z99: lib/claims.ts does not cite Z99 as a Round-13 rule', 'Z99: tests/claims-r13-rules.test.ts# names no site'])
    const bi = `${SPEC.slice(0, SPEC.indexOf('\n## J. '))}\n### Z98 [CORE] Synthetic\nCited in docs only.\n${SPEC.slice(SPEC.indexOf('\n## J. '))}`
    expect(untestedRules(bi, testFiles, noteOnly)).toEqual(['Z98'])
    expect(untestedRules(bi, [...testFiles, ['tests/claims-r13-synthetic.test.ts', '// Z98']], noteOnly)).toEqual([])
    // a token in a file with no round-13 scope, or a claim NAMED Z98, is not a citation; « ROUND 13 (Z98) » on the line is
    expect(untestedRules(bi, [...testFiles, ['tests/legacy-synthetic.test.ts', '// Z98']], noteOnly)).toEqual(['Z98'])
    expect(untestedRules(bi, [...testFiles, ['tests/claims-r13-synthetic.test.ts', "it('claim Z98 is refunded')"]], noteOnly)).toEqual(['Z98'])
    expect(untestedRules(bi, [...testFiles, ['tests/legacy-synthetic.test.ts', '// ROUND 13 (Z98): synthetic']], noteOnly)).toEqual([])
    expect(latestNoteOpen('IMPLEMENTATION NOTE (W1): landed.\nIMPLEMENTATION NOTE (W2): OPEN. still to do.')).toBe(true)
    expect(latestNoteOpen('IMPLEMENTATION NOTE (W1): OPEN.\nIMPLEMENTATION NOTE (W8): CLOSED — the « STILL OPEN » item is closed.')).toBe(false)
    expect(jRulesWithoutFile(synthSpec, existsSync, noteOnly)).toEqual(['Z99'])
    expect(jRulesWithoutFile(synthSpec, existsSync, new Set([...Array.from(noteOnly), 'Z99']))).toEqual([])
    expect(deletedSurfaceHits({ 'lib/x.ts': '// boundPathRowTruth only in a comment\nexport const y = 1', 'lib/z.ts': 'export function boundPathRowTruth() {}' })).toEqual(['lib/z.ts: boundPathRowTruth'])
  })

  it('NEGATIVE CONTROL (W8 fixer round 2) — an id token of an earlier project is never a Round-13 citation: franchise B4, Claims batch C2, an unscoped G1 comment', () => {
    const b4Tests = '`tests/claims-identity-writers.test.ts#J-M09 (B4, B6 (1))`'
    const b4Code = '`lib/claims.ts#return tx.refund.create({ data: mirrorData, select: { id: true } })`'
    // the regenerated B4 row is compliant; the round-1 citations (franchise conditions, franchise royalty tests) are red
    expect(coverageViolations(withRow(COVERAGE, 'B4', `| B4 | IMPLEMENTED | ${b4Code} | ${b4Tests} | — |`), SPEC, fileText)).toEqual([])
    expect(coverageViolations(withRow(COVERAGE, 'B4', `| B4 | IMPLEMENTED | \`app/api/brands/[id]/route.ts\` | ${b4Tests} | — |`), SPEC, fileText))
      .toEqual(['B4: app/api/brands/[id]/route.ts has no Round-13 reference'])
    expect(coverageViolations(withRow(COVERAGE, 'B4', `| B4 | IMPLEMENTED | \`app/api/brands/[id]/route.ts#B4 — franchise conditions\` | ${b4Tests} | — |`), SPEC, fileText))
      .toEqual(['B4: app/api/brands/[id]/route.ts has no Round-13 reference'])
    expect(coverageViolations(withRow(COVERAGE, 'B4', `| B4 | IMPLEMENTED | ${b4Code} | \`tests/franchise-royalty.test.ts\` | — |`), SPEC, fileText))
      .toEqual(['B4: tests/franchise-royalty.test.ts has no Round-13 reference'])
    // a claims file that carries round-13 references elsewhere, but never cites C2 as a round-13 rule
    const c2Code = '`lib/claims.ts#export const reconcileRequiredMarker = (now: Date, nonce: string) =>`'
    expect(coverageViolations(withRow(COVERAGE, 'C2', `| C2 | IMPLEMENTED | ${c2Code} | \`tests/claims-c2.test.ts\` | — |`), SPEC, fileText))
      .toEqual(['C2: tests/claims-c2.test.ts does not cite C2 as a Round-13 rule'])
    // an anchor naming G1 on a line of lib/claims.ts that no round-13 marker scopes
    const g1Tests = '`tests/claims-exit-parity.test.ts#J-M29 (D0, G1 list flags)`'
    expect(coverageViolations(withRow(COVERAGE, 'G1', `| G1 | IMPLEMENTED | \`lib/claims.ts#G1: the gate is ONE rule shared with the lists\` | ${g1Tests} | — |`), SPEC, fileText))
      .toEqual(['G1: lib/claims.ts#G1: the gate is ONE rule shared with the lists is not a Round-13 citation of G1'])
    expect(coverageViolations(withRow(COVERAGE, 'G1', `| G1 | IMPLEMENTED | \`lib/claims.ts#ROUND 13 (G1 / D5 / D14, W3 round-1 fix)\` | ${g1Tests} | — |`), SPEC, fileText)).toEqual([])
    // an empty anchor names no site outside a J row or a NOTE-ONLY map
    expect(coverageViolations(withRow(COVERAGE, 'G1', `| G1 | IMPLEMENTED | \`lib/claim-action-rules.ts#\` | ${g1Tests} | — |`), SPEC, fileText))
      .toEqual(['G1: lib/claim-action-rules.ts# names no site'])
    // the scoping rule itself
    // line 0 names no round: only the comment under the ROUND 13 block cites G1 (a trailing comment and a detached block do not)
    expect(r13CitingLines('lib/x.ts', "import x from 'y'\n// ROUND 13 (slice W9): the reconcile gate\n// G1 admits it\nconst a = 1 // G1\n\n// G1 unscoped", 'G1')).toEqual([2])
    // a first line that names round 13 makes the whole file a round-13 file
    expect(r13CitingLines('lib/x.ts', '// ROUND 13 (slice W9): the reconcile gate\n// G1 admits it\nconst a = 1 // G1', 'G1')).toEqual([1, 2])
    expect(r13CitingLines('tests/claims-r13-x.test.ts', "it('claim C2 is refunded')\n// C2 step 1\nconst AM_C2 = 1", 'C2')).toEqual([1])
    expect(r13CitingLines('tests/legacy.test.ts', '// tests/legacy.test.ts — T-49 round 13, J-M99 (B4)\nit(\'B4\')', 'B4')).toEqual([0, 1])
  })
})
