// Decision logic of the QA environment gate — PURE, no database needed.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain ESM module without types (same pattern as the other QA modules)
import { classifyEnv, normalizeWinPath, EXIT, RELAUNCH_COMMAND_FICHE, QA_DATADIR_FICHE } from '../scripts/qa/qa-env-gate-classify.mjs'

const expected = { host: 'localhost', port: 3306, database: 'deyi0010_grubano_staging', table: 'Operator', datadir: QA_DATADIR_FICHE, email: 'qa+op@grubano.test', role: 'restaurant', status: 'active' }
const healthy = { expected, portOpen: true, sqlOk: true, datadir: 'C:\\Users\\Lenovo\\grubano-localdb\\data\\', schemaOk: true, database: 'deyi0010_grubano_staging', tableCount: 1, seedOk: true }

describe('normalizeWinPath — only what the comparison mechanically needs', () => {
  it('equates separators, trailing separator and case', () => {
    expect(normalizeWinPath('C:\\Users\\Lenovo\\grubano-localdb\\data\\')).toBe(normalizeWinPath('c:/users/lenovo/grubano-localdb/data'))
  })
  it('does NOT widen: a different directory never equates', () => {
    expect(normalizeWinPath('C:\\Program Files\\MariaDB 12.3\\data')).not.toBe(normalizeWinPath(QA_DATADIR_FICHE))
    expect(normalizeWinPath('C:\\Users\\Lenovo\\grubano-localdb\\data2')).not.toBe(normalizeWinPath(QA_DATADIR_FICHE))
    expect(normalizeWinPath('C:\\Users\\Lenovo\\grubano-localdb')).not.toBe(normalizeWinPath(QA_DATADIR_FICHE))
  })
  it('is safe on non-strings', () => { expect(normalizeWinPath(undefined)).toBe(''); expect(normalizeWinPath(null)).toBe('') })
})

describe('classifyEnv — six situations, distinct exit codes, checked in order', () => {
  it('F — healthy environment passes with exit 0', () => {
    const v = classifyEnv(healthy)
    expect(v.kind).toBe('ok'); expect(v.code).toBe(0); expect(v.pass).toBe(true)
  })
  it('A — closed port: exit 10, names the fiche relaunch command EXACTLY', () => {
    const v = classifyEnv({ expected, portOpen: false, portError: 'ECONNREFUSED' })
    expect(v.kind).toBe('port-closed'); expect(v.code).toBe(10); expect(v.pass).toBe(false)
    expect(v.observed).toBe('ECONNREFUSED')
    expect(v.action).toContain(RELAUNCH_COMMAND_FICHE)
    expect(RELAUNCH_COMMAND_FICHE).toContain('--defaults-file="C:\\Users\\Lenovo\\grubano-localdb\\data\\my.ini"')
    expect(RELAUNCH_COMMAND_FICHE).not.toContain('--datadir=') // never the variant
  })
  it('B — port open but SQL fails: exit 11, not confused with a stopped base', () => {
    const v = classifyEnv({ expected, portOpen: true, sqlOk: false, sqlError: 'Authentication failed' })
    expect(v.kind).toBe('sql-unreachable'); expect(v.code).toBe(11)
    expect(v.observed).toBe('Authentication failed')
    expect(v.action).not.toContain(RELAUNCH_COMMAND_FICHE)
  })
  it('C — SQL works but another datadir: exit 12, a foreign mysqld never passes', () => {
    const v = classifyEnv({ ...healthy, datadir: 'C:\\Program Files\\MariaDB 12.3\\data\\' })
    expect(v.kind).toBe('wrong-instance'); expect(v.code).toBe(12)
    expect(v.expected).toBe(QA_DATADIR_FICHE)
    expect(v.observed).toBe('C:\\Program Files\\MariaDB 12.3\\data\\')
  })
  it('C — a null datadir (query failed) is a wrong instance, never a pass', () => {
    const v = classifyEnv({ ...healthy, datadir: null })
    expect(v.kind).toBe('wrong-instance')
  })
  it('identity check is mandatory: no expected datadir → config error, never a pass', () => {
    const v = classifyEnv({ ...healthy, expected: { ...expected, datadir: '' } })
    expect(v.kind).toBe('config-error'); expect(v.code).toBe(2); expect(v.pass).toBe(false)
  })
  it('D — right instance, schema missing: exit 13', () => {
    const v = classifyEnv({ ...healthy, schemaOk: false, database: 'deyi0010_grubano_staging', tableCount: 0 })
    expect(v.kind).toBe('schema-missing'); expect(v.code).toBe(13)
    expect(v.observed).toContain('information_schema=0')
  })
  it('E — right base, seed absent: exit 14, distinct from a dead base', () => {
    const v = classifyEnv({ ...healthy, seedOk: false, seedObserved: 'no row' })
    expect(v.kind).toBe('seed-missing'); expect(v.code).toBe(14)
    expect(v.observed).toBe('no row')
    expect(v.action).toContain('seed-qa-operator')
  })
  it('E — seed present but in the wrong state is still a seed failure', () => {
    const v = classifyEnv({ ...healthy, seedOk: false, seedObserved: '1 row(s): role=consumer status=active' })
    expect(v.kind).toBe('seed-missing')
  })
  it('order: an earlier failure wins even if later observations look fine', () => {
    expect(classifyEnv({ ...healthy, portOpen: false }).kind).toBe('port-closed')
    expect(classifyEnv({ ...healthy, sqlOk: false }).kind).toBe('sql-unreachable')
    expect(classifyEnv({ ...healthy, datadir: 'D:\\elsewhere' }).kind).toBe('wrong-instance')
  })
  it('exit codes are all distinct and non-zero except ok', () => {
    const codes = Object.values(EXIT) as number[]
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.filter((c) => c === 0)).toEqual([0])
  })
})
