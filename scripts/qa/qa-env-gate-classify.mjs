// qa-env-gate-classify.mjs — PURE decision logic of the QA environment gate.
//
// WHY THIS EXISTS: the local QA MariaDB stopped three times in one session, and
// a whole /login diagnosis was first blamed on a routing defect that did not
// exist — the symptom was an ABSENT database (callback/credentials → 401). The
// gate makes that cause observable BEFORE any QA pass can produce a misleading
// product diagnosis. It CONSTATES and REFUSES; it never repairs.
//
// Six situations, checked in this order — they are NOT interchangeable (an open
// port does not prove SQL works; SQL working does not prove the right schema;
// the right schema does not prove the right INSTANCE):
//   A  port-closed      — nothing listens on the DB port
//   B  sql-unreachable  — something listens but a real SQL query fails
//   C  wrong-instance   — SQL works but @@datadir ≠ the QA datadir of the fiche
//   D  schema-missing   — right instance but expected database/table absent
//   E  seed-missing     — right database but the QA operator account is absent
//   F  ok               — QA environment healthy
//
// PURE on purpose: no I/O, no DB, no clock — the decision is unit-testable
// without a database (mirrors operator-qa-diagnose.mjs).

/** Distinct exit codes so the CAUSE is readable from the process status alone. */
export const EXIT = Object.freeze({
  ok: 0,
  'config-error': 2,
  'port-closed': 10,
  'sql-unreachable': 11,
  'wrong-instance': 12,
  'schema-missing': 13,
  'seed-missing': 14,
})

/** Exact relaunch command of the QA fiche (memory grubano-qa-env-local) — NEVER a variant. */
export const RELAUNCH_COMMAND_FICHE =
  "Start-Process 'C:\\Program Files\\MariaDB 12.3\\bin\\mysqld.exe' " +
  "-ArgumentList '--defaults-file=\"C:\\Users\\Lenovo\\grubano-localdb\\data\\my.ini\"' -WindowStyle Hidden"

/** Datadir of the QA instance, as documented by the fiche. */
export const QA_DATADIR_FICHE = 'C:\\Users\\Lenovo\\grubano-localdb\\data'

/**
 * Normalise a Windows path ONLY as far as a mechanical comparison requires:
 * separators (\ → /), trailing separator, and case (NTFS is case-insensitive).
 * Nothing else — no prefix matching, no resolution of symlinks, no widening.
 */
export function normalizeWinPath(p) {
  if (typeof p !== 'string') return ''
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Classify the observed environment. `obs` carries what the runner could
 * observe, in check order; a property left `undefined` means the check was not
 * reached (an earlier one failed). Expected values travel alongside.
 * @returns {{ kind: string, code: number, pass: boolean, property: string|null,
 *             expected: string|null, observed: string|null, message: string, action: string|null }}
 */
export function classifyEnv(obs) {
  const exp = obs.expected || {}
  const out = (kind, property, expected, observed, message, action) => ({
    kind, code: EXIT[kind], pass: kind === 'ok', property, expected, observed, message, action,
  })

  if (obs.portOpen !== true) {
    return out('port-closed', 'tcp listener on ' + (exp.host || '?') + ':' + (exp.port || '?'),
      'a MariaDB server listening', obs.portError || 'connection refused / no listener',
      'A — no server listens on the database port: the QA MariaDB is STOPPED (or bound elsewhere). ' +
      'This is an ENVIRONMENT failure, not a product one — nothing has been measured.',
      'Relaunch the QA instance with the EXACT fiche command:\n  ' + RELAUNCH_COMMAND_FICHE)
  }
  if (obs.sqlOk !== true) {
    return out('sql-unreachable', 'real SQL query (SELECT 1)', 'a row back from the server',
      obs.sqlError || 'query failed',
      'B — a server listens on the port but a real SQL query fails (credentials, protocol, ' +
      'or a foreign server on the port). Do NOT interpret any login failure until this is fixed.',
      'Check DATABASE_URL credentials against the instance, and that the listener on the port is MariaDB.')
  }
  const want = normalizeWinPath(exp.datadir), got = normalizeWinPath(obs.datadir)
  if (!want) {
    return out('config-error', '@@datadir', '(no expected datadir configured)', obs.datadir ?? null,
      'instance identity cannot be checked: no expected datadir — refusing to claim the instance is verified.',
      null)
  }
  if (got !== want) {
    return out('wrong-instance', '@@datadir', exp.datadir, obs.datadir ?? '(null)',
      'C — SQL works but this is NOT the QA instance: the server answering on the port runs another ' +
      'datadir. A different mysqld (service, other profile) is listening. Stop using it for QA.',
      'Stop the foreign instance yourself (the gate never kills processes), then relaunch the QA one:\n  ' +
      RELAUNCH_COMMAND_FICHE)
  }
  if (obs.schemaOk !== true) {
    return out('schema-missing', 'database ' + (exp.database || '?') + ' + table ' + (exp.table || 'Operator'),
      'current database = ' + (exp.database || '?') + ' with table ' + (exp.table || 'Operator'),
      obs.schemaError || ('database=' + (obs.database ?? '(null)') + ', table rows in information_schema=' + (obs.tableCount ?? '?')),
      'D — right instance but the expected database/table is absent: the schema was never pushed here, ' +
      'or DATABASE_URL points to another database name.',
      'Run the schema push of the QA procedure (prisma db push) — the gate does not do it.')
  }
  if (obs.seedOk !== true) {
    return out('seed-missing', 'QA operator account ' + (exp.email || '?'),
      'one Operator row, role ' + (exp.role || 'restaurant') + ', status ' + (exp.status || 'active'),
      obs.seedObserved || 'no matching row',
      'E — right database but the QA seed is absent or not in the expected state: the base was reset ' +
      'and not re-seeded, or seeded with another account.',
      'Run the seeds IN ORDER of the QA procedure: seed-qa-operator then seed-qa-mock-parity — the gate does not seed.')
  }
  return out('ok', null, null, null, 'F — QA environment healthy: port, SQL, instance (datadir), schema and seed all verified.', null)
}
