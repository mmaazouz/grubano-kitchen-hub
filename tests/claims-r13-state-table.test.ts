// tests/claims-r13-state-table.test.ts — T-49 round 13, J-M01 (A-S00, E0 mapping): state-table fixture completeness.
//
// Every section-A state of the frozen spec has exactly ONE fixture entry, with its ten expected fields and the E ids
// its row names; the withdrawn engine guard appears nowhere in the table. The executable facts the parity tests run
// (J-M03, J-M04, J-M43) hang off the same entries, so a state cannot be pinned by one test and missing from another.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STATES, FACTS, J_M03_STATES, J_M04_STATES, type StateEntry } from './fixtures/claims-r13-states'

const SPEC = readFileSync('docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md', 'utf8').replace(/\r\n/g, '\n')
/** IMPLEMENTATION NOTE (W3) on J-M01: the ids come from the frozen spec's section-A headings (the addendum has no round-13 table). */
const SPEC_IDS = Array.from(SPEC.matchAll(/^### (A-S[0-9A-Za-z-]+) /gm)).map((m) => m[1]).filter((id) => id !== 'A-S00')
const FIELDS = ['stripe', 'dbRefunds', 'claim', 'engineAccepts', 'engineResumes', 'safeExit', 'newMoney', 'customer', 'admin', 'reconciliation'] as const
const REGISTRY = new Set(Array.from({ length: 18 }, (_, i) => `E-${String(i + 1).padStart(2, '0')}`))
const WITHDRAWN = /E5b|exclusiveReason|awaiting_other_row/

/** Every way a table can fail J-M01, as messages (empty = complete). */
function tableViolations(table: StateEntry[], ids: string[]): string[] {
  const out: string[] = []
  const count = new Map<string, number>()
  for (const s of table) count.set(s.id, (count.get(s.id) ?? 0) + 1)
  for (const id of ids) if ((count.get(id) ?? 0) !== 1) out.push(`${id}: ${count.get(id) ?? 0} entries`)
  for (const s of table) {
    if (!ids.includes(s.id)) out.push(`${s.id}: not a section-A state`)
    for (const f of FIELDS) if (typeof s.expected?.[f] !== 'string' || !s.expected[f].trim()) out.push(`${s.id}: empty ${f}`)
    for (const r of s.registry) if (!REGISTRY.has(r)) out.push(`${s.id}: registry ${r}`)
  }
  if (WITHDRAWN.test(JSON.stringify(table))) out.push('the withdrawn guard vocabulary is present')
  return out
}

describe('J-M01 — one fixture entry per section-A state', () => {
  it('the spec names the states the table covers (95, A-S00 is the conventions row)', () => {
    expect(SPEC_IDS.length).toBe(95)
    expect(new Set(SPEC_IDS).size).toBe(SPEC_IDS.length)
  })

  it('the shipped table is complete: exactly one entry per id, ten non-empty fields, E-01..E-18 registry ids, no withdrawn guard', () => {
    expect(tableViolations(STATES, SPEC_IDS)).toEqual([])
  })

  it('the executable facts belong to real states, and every parity list is backed by facts', () => {
    for (const id of Object.keys(FACTS)) expect(SPEC_IDS, id).toContain(id)
    for (const id of J_M03_STATES) expect(FACTS[id]?.engine, id).toBeDefined()
    for (const id of J_M04_STATES) expect(FACTS[id]?.resume, id).toBeDefined()
  })

  it('the engine facts agree with the row text: YES ⇔ accepts, a resume state says ENGINE RESUMES YES', () => {
    for (const s of STATES) {
      if (s.engine) expect(s.expected.engineAccepts.startsWith(s.engine.accepts ? 'YES' : 'NO'), `${s.id} « ${s.expected.engineAccepts} »`).toBe(true)
      if (s.engine && !s.engine.accepts) expect(s.expected.engineAccepts, s.id).toContain(s.engine.step)
      if (s.resume) expect(s.expected.engineResumes.startsWith('YES'), `${s.id} « ${s.expected.engineResumes} »`).toBe(true)
    }
  })

  it('NEGATIVE CONTROL — the table with the A-S31d entry removed is red; so is it without A-S01b (the break/restore entry)', () => {
    expect(tableViolations(STATES.filter((s) => s.id !== 'A-S31d'), SPEC_IDS)).toEqual(['A-S31d: 0 entries'])
    expect(tableViolations(STATES.filter((s) => s.id !== 'A-S01b'), SPEC_IDS)).toEqual(['A-S01b: 0 entries'])
    // …and the other failure modes are caught too
    const dup = [...STATES, STATES[0]]
    expect(tableViolations(dup, SPEC_IDS)).toEqual([`${STATES[0].id}: 2 entries`])
    const blank = STATES.map((s) => (s.id === 'A-S02' ? { ...s, expected: { ...s.expected, admin: ' ' } } : s))
    expect(tableViolations(blank, SPEC_IDS)).toEqual(['A-S02: empty admin'])
    const guard = STATES.map((s) => (s.id === 'A-S05c-2b' ? { ...s, expected: { ...s.expected, engineAccepts: 'NO (E5b)' } } : s))
    expect(tableViolations(guard, SPEC_IDS)).toEqual(['the withdrawn guard vocabulary is present'])
  })
})
