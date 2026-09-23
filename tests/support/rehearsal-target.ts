// tests/support/rehearsal-target.ts — THE guard that keeps a database rehearsal off real data.
//
// Extracted verbatim from tests/claims-attribution-race.db.test.ts (T-49 round 13, slice W4, C10) when the D′ L5
// lot added a SECOND rehearsal against a real database. A safety rule that exists in two copies is a safety rule
// that will one day disagree with itself: both rehearsals now ask the same function, and the always-run tests of
// that function live beside the rehearsal that first needed it.
//
// The rule: a rehearsal database must be a DISPOSABLE LOCAL one. A loopback host alone proves nothing — a hosted
// database reached through an SSH tunnel is also on loopback — so the database must additionally SAY it is
// disposable (its name), must not carry the o2switch account prefix, and must not be, or share a name with, any
// DATABASE_URL* the application itself reads. Values are compared, never printed.

import { existsSync, readFileSync } from 'node:fs'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
/** C10 (W4 fixer): the database must SAY it is a disposable rehearsal database — a loopback host alone proves nothing. */
const DISPOSABLE_DB_NAME = /^claims_race(?:_[a-z0-9]+)?$/i
/** The o2switch cPanel account prefix: every hosted database and database user carries it (/home/deyi0010). */
const HOSTED_ACCOUNT_PREFIX = /deyi0010/i

/**
 * The DATABASE_URL* values the application reads: process.env AND the env files, which vitest does not load into
 * process.env (vitest.config.ts sets no env loading). Values are only compared, never printed.
 */
export function applicationDatabaseUrls(
  env: Record<string, string | undefined>,
  files: string[] = ['.env.local', '.env'],
): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(env)) if (/^DATABASE_URL/.test(k) && v) out.push(v)
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?DATABASE_URL[A-Z0-9_]*\s*=\s*(.*?)\s*$/)
      if (m && m[1]) out.push(m[1].replace(/^(['"])(.*)\1$/, '$2'))
    }
  }
  return out
}

export const dbName = (u: URL) => decodeURIComponent(u.pathname.replace(/^\//, ''))

/** C10: only a disposable local MySQL/MariaDB database is accepted. Returns the refusal reason, or null. */
export function rehearsalTargetRefusal(raw: string | undefined, applicationUrls: string[]): string | null {
  if (!raw) return 'CLAIMS_RACE_DATABASE_URL is not set'
  let u: URL
  try { u = new URL(raw) } catch { return 'not a URL' }
  if (u.protocol !== 'mysql:') return 'not a mysql:// URL'
  if (!LOOPBACK.has(u.hostname)) return `host ${u.hostname} is not a local loopback host: staging and production are refused`
  if (/grubano|o2switch|jabatus/i.test(raw)) return 'the URL names a Grubano or o2switch resource'
  if (HOSTED_ACCOUNT_PREFIX.test(raw)) return 'the URL carries the o2switch cPanel account prefix: a hosted database or user, possibly through a loopback tunnel'
  const name = dbName(u)
  if (!name) return 'no database name'
  if (!DISPOSABLE_DB_NAME.test(name)) return `database ${name} is not named as a disposable rehearsal database (claims_race…)`
  for (const app of applicationUrls) {
    if (app === raw) return 'the URL equals an application DATABASE_URL: a rehearsal database is disposable, never an application database'
    let a: URL | null = null
    try { a = new URL(app) } catch { /* an unparseable application URL is compared as text only */ }
    if (a && dbName(a) === name) return 'the database name equals an application database name'
  }
  return null
}
