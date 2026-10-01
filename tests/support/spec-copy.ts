// tests/support/spec-copy.ts — reads the verbatim copy tables of the frozen round-13 specification.
//
// J-C32 / J-C31 / F08 / F09 pin message values « verbatim from » named rules. Reading the frozen file itself keeps the
// expected table verbatim: a typo in the messages, or in a hand-copied table, cannot agree with it by accident.
// Table shape in the spec: a header line `key:` (or `NEW key:`, `a and b take the same strings:`, `key (note):`)
// followed by `- <locale> « value »` lines. Any other non-bullet line ends the table.
import { readFileSync } from 'node:fs'

export const SPEC_PATH = 'docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md'
export const SPEC_LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
export type SpecLocale = typeof SPEC_LOCALES[number]
export type LocaleValues = Record<SpecLocale, string>

/** The lines of rule `### <id> ` up to the next `### ` heading. */
export function specSection(id: string, src: string = readFileSync(SPEC_PATH, 'utf8')): string[] {
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith(`### ${id} `))
  if (start < 0) throw new Error(`spec rule ${id} not found`)
  let end = lines.findIndex((l, i) => i > start && l.startsWith('### '))
  if (end < 0) end = lines.length
  return lines.slice(start + 1, end)
}

const VALUE = /^- (fr|en|es|it|ar) « (.*) »$/
const HEADER = /^(?:NEW )?([A-Za-z][\w.]*)(?: and ([A-Za-z][\w.]*) take the same strings)?(?: \(.*\))?:$/
const ROOTED = /^(claimEmails|claims|eat)\./

/** Every complete (5-locale) table of the rule, keyed by full message path; `prefix` roots a relative key. */
export function specCopyTable(id: string, prefix: string, src?: string): Record<string, LocaleValues> {
  const out: Record<string, Partial<LocaleValues>> = {}
  let keys: string[] = []
  for (const line of specSection(id, src)) {
    const v = VALUE.exec(line)
    if (v) {
      for (const k of keys) (out[k] ??= {})[v[1] as SpecLocale] = v[2]
      continue
    }
    const h = HEADER.exec(line)
    if (h) {
      keys = [h[1], h[2]].filter((k): k is string => !!k).map((k) => (ROOTED.test(k) ? k : `${prefix}${k}`))
      continue
    }
    if (line.trim() && !line.startsWith('- ')) keys = []
  }
  const complete: Record<string, LocaleValues> = {}
  for (const [k, vals] of Object.entries(out)) {
    if (SPEC_LOCALES.every((l) => typeof vals[l] === 'string')) complete[k] = vals as LocaleValues
  }
  return complete
}

/** Reads a dotted path of a parsed messages file. */
export function messageAt(m: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, p) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined), m)
}
