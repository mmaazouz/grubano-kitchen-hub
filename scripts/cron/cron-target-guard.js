'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   cron-target-guard.js — B2: THE ONE definition of « which host may a Grubano cron
   call », and it REFUSES. Not a warning, not a log line: a non-zero exit.

   FOUNDER ARBITRATION (2026-09-29): « livre immédiatement le garde cron B2 pour que les
   trois jobs soient techniquement incapables de cibler la production pendant cette phase,
   même si CRON_TARGET_BASE_URL est modifiée par erreur. Je veux la même doctrine que
   T-123 : refus explicite, pas simple surveillance. »

   WHAT WAS WRONG. `cron.yml`'s guard job checked ONE thing — that the repo variable
   `CRON_TARGET_BASE_URL` was not EMPTY — and then handed whatever it contained to every
   job. It never asked whether the value was staging. So the protection was a
   CONFIGURATION (« we set it to staging »), not a CONSTRAINT: one mistaken edit of one
   variable would have sent, on the next 20-minute tick, the order-confirmation e-mail
   catch-up and the onboarding nudges at production — and on the 1st of the month the
   invoice batch and the franchisor settlement. Separately, the three Node cron scripts
   fell back to `https://www.grubano.com` when `SITE_URL` was absent: a SILENT DEFAULT TO
   THE MOST DANGEROUS TARGET, which is the same defect wearing different clothes.

   THE RULE IS A WHITELIST, NOT A BLOCKLIST. A blocklist of production hostnames would let
   an unknown host through, and « I typed the wrong domain » is at least as likely as « I
   typed production ». So the target must POSITIVELY identify itself as staging; everything
   else is refused, production included.

   PRODUCTION IS REACHABLE ONLY BY AN ATTESTATION, never by a boolean. Same shape as
   `staging-backup.js --production` + `GRUBANO_BACKUP_CONFIRM`: an exact sentence in
   `CRON_ALLOW_PRODUCTION`. A second variable set to an exact sentence cannot be produced
   by a typo, and it reads as a decision in the repo settings.

   AND THE ATTESTATION UNLOCKS PRODUCTION ONLY — never an unknown host. « We authorised
   production » must not become « we authorised whatever someone typed ». An unrecognised
   host is refused WITH the attestation exactly as without it.

   WHY https IS REQUIRED. Every cron call carries `INTERNAL_CRON_TOKEN` or `CRON_SECRET`
   in a header. `http://app.grubano.com` would put a live credential on the wire in clear,
   and it would satisfy a naive host check. It is refused.

   WHY A PATH IS REFUSED. Callers build `${BASE}/api/...`. A base with a path or a query
   silently produces a wrong URL that still looks plausible in a log.

   LIVES IN scripts/cron/ ON PURPOSE: the deploy workflows ship `scripts/cron/*.js` (and
   nothing else from `scripts/` except `scripts/server/*.js`), so this file reaches the
   server, where the three cPanel cron jobs need it. It is a library, not an entry point —
   the crontab never calls it directly.

   PURE: no network, no filesystem, no DB, no process.env read except the attestation that
   is passed IN. The CLI at the bottom is the only side effect.

     CLI:  node scripts/cron/cron-target-guard.js "<base-url>"
             → stdout: the normalised base, exit 0
             → stderr: a ::error:: line naming what is wrong, exit 1
   ═══════════════════════════════════════════════════════════════════════════════ */

/** The only hosts a cron may call in the closed-beta / closed-production phase. */
const STAGING_HOSTS = ['app.grubano.com', 'business.grubano.com']

/** Recognised production hosts. Listed so the refusal can NAME production instead of
 *  saying « unknown host », and so the attestation can unlock these and only these. */
const PRODUCTION_HOSTS = ['grubano.com', 'www.grubano.com']

/** The repo variable that may unlock production, and the exact sentence it must hold. */
const ATTESTATION_VAR = 'CRON_ALLOW_PRODUCTION'
const ATTESTATION_SENTENCE = 'I AUTHORIZE GRUBANO PRODUCTION CRONS'

/**
 * Classify a candidate base URL. PURE — returns a verdict, never throws, never exits.
 * @param {unknown} raw
 * @returns {{kind: 'empty'|'malformed'|'insecure'|'has_path'|'staging'|'production'|'unknown', host: string|null, base: string|null, detail: string}}
 */
function classifyCronTarget(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { kind: 'empty', host: null, base: null, detail: 'the value is empty or unset' }

  let u
  try { u = new URL(s) } catch (_) {
    return { kind: 'malformed', host: null, base: null, detail: 'not a parseable absolute URL' }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { kind: 'malformed', host: null, base: null, detail: `scheme ${u.protocol} is not http(s)` }
  }
  // https ONLY: the cron token travels in a request header.
  if (u.protocol !== 'https:') {
    return { kind: 'insecure', host: u.hostname.toLowerCase(), base: null, detail: 'http:// would put the cron token on the wire in clear' }
  }
  // A base is an ORIGIN. Callers append `/api/...` to it.
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
    return { kind: 'has_path', host: u.hostname.toLowerCase(), base: null, detail: 'a base URL must be an origin: no path, no query, no fragment' }
  }
  // A base carrying credentials or a port is not something we accept silently either.
  if (u.username || u.password) {
    return { kind: 'malformed', host: u.hostname.toLowerCase(), base: null, detail: 'the URL carries credentials' }
  }

  const host = u.hostname.toLowerCase()
  const base = `https://${host}${u.port ? ':' + u.port : ''}`

  if (STAGING_HOSTS.includes(host)) return { kind: 'staging', host, base, detail: 'staging' }
  if (PRODUCTION_HOSTS.includes(host)) return { kind: 'production', host, base, detail: 'production' }
  return { kind: 'unknown', host, base, detail: 'not a recognised Grubano environment' }
}

/**
 * The decision. PURE — `env` is passed in so the same call is testable and so this module
 * never reads the ambient process.
 * @param {unknown} raw                 the candidate base URL
 * @param {Record<string, string|undefined>} [env]  the environment holding the attestation
 * @returns {{ok: true, base: string, kind: 'staging'|'production'} | {ok: false, error: string}}
 */
function assertCronTargetAllowed(raw, env) {
  const e = env || {}
  const v = classifyCronTarget(raw)

  switch (v.kind) {
    case 'empty':
      return { ok: false, error: 'CRON_TARGET_BASE_URL is not set. This workflow never defaults to production. Set it to https://app.grubano.com (GitHub → Settings → Secrets and variables → Actions → Variables), or set SITE_URL for a server-side run.' }
    case 'malformed':
    case 'insecure':
    case 'has_path':
      return { ok: false, error: `CRON TARGET REFUSED — ${v.detail}. Expected exactly one of: ${STAGING_HOSTS.map((h) => 'https://' + h).join(' , ')}` }
    case 'staging':
      return { ok: true, base: v.base, kind: 'staging' }
    case 'production':
      /* The attestation is checked ONLY here, so a wrong host can never be excused by it. */
      if (e[ATTESTATION_VAR] === ATTESTATION_SENTENCE) return { ok: true, base: v.base, kind: 'production' }
      return {
        ok: false,
        error: `CRON TARGET REFUSED — ${v.host} is PRODUCTION and Grubano crons are frozen to staging for this phase. `
             + `Do NOT satisfy this refusal by widening the host list or by pointing the base somewhere else: point it back at staging. `
             + `Reaching production is a named decision — set ${ATTESTATION_VAR} to the exact sentence "${ATTESTATION_SENTENCE}".`,
      }
    default:
      /* 'unknown' — refused WITH the attestation exactly as without it. */
      return {
        ok: false,
        error: `CRON TARGET REFUSED — ${v.host} is not a recognised Grubano environment. `
             + `Allowed: ${STAGING_HOSTS.map((h) => 'https://' + h).join(' , ')}. `
             + `${ATTESTATION_VAR} unlocks PRODUCTION only — it does not authorise an arbitrary host.`,
      }
  }
}

module.exports = {
  STAGING_HOSTS,
  PRODUCTION_HOSTS,
  ATTESTATION_VAR,
  ATTESTATION_SENTENCE,
  classifyCronTarget,
  assertCronTargetAllowed,
}

/* ── CLI ────────────────────────────────────────────────────────────────────────
   Used by the `guard` job of .github/workflows/cron.yml and by the three cron scripts.
   stdout carries the normalised base and NOTHING else, so it can be captured directly. */
if (require.main === module) {
  const r = assertCronTargetAllowed(process.argv[2], process.env)
  if (!r.ok) {
    console.error('::error::' + r.error)
    process.exit(1)
  }
  console.error(`[cron-target-guard] ALLOWED kind=${r.kind.toUpperCase()} host=${new URL(r.base).hostname}`)
  process.stdout.write(r.base)
}
