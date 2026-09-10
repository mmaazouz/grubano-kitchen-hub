#!/usr/bin/env node
'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   PHASE 2 — STALE TRUE-FLAG BACKUP NEUTRALIZER (staging) — FAIL-CLOSED
   ───────────────────────────────────────────────────────────────────────────────
   The refund-window operator backs up .env.local before EVERY canonical write. The
   backup taken right before the RE-FREEZE therefore contains REFUNDS_ENABLED=true.
   Restoring such a file (cp .env.local.bak-… .env.local) would silently re-enable
   refunds. This operator:

     1. scans the app root for `.env.local.bak*` files (operator backups and legacy hand backups) whose EFFECTIVE
        REFUNDS_ENABLED (dotenv semantics, last occurrence wins) is "true";
     2. for each: archives forensic evidence OUTSIDE the app root
        (~/.grubano/phase2-evidence/<name>.manifest.json — sha256, size, mtime, the
        flag value, no secret values) plus a NEUTRALIZED copy (flag rewritten to
        false, mode 600), then removes the dangerous restorable copy from the app root;
     3. proves: live .env.local effective REFUNDS_ENABLED = false (NEVER modified by
        this script), live gate = 403 gated, no restorable true-flag backup left.

   It NEVER touches .env.local itself, never writes "true" anywhere, never contacts
   Stripe, never restarts Passenger. Any unexpected condition ⇒ that file is left in
   place and the RESULT is FAIL (fail-closed).

   Usage (founder, staging):
     ~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase2-backup-neutralize.js
   Dry run (report only): PHASE2_BACKUP_DRY_RUN=1 …
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const prov = require(path.join(__dirname, 'env-provenance.js'))

const APP_ROOT = process.env.PHASE2_APP_ROOT || path.join(__dirname, '..', '..')
const EVIDENCE_DIR = process.env.PHASE2_EVIDENCE_DIR || path.join(os.homedir(), '.grubano', 'phase2-evidence')
const DRY = process.env.PHASE2_BACKUP_DRY_RUN === '1'

const facts = [], anomalies = []
const F = (k, v) => { facts.push(k + ' = ' + v); console.log('  ' + k + ' = ' + v) }
const A = (m) => { anomalies.push(m); console.log('  !! ANOMALY: ' + m) }
const scrub = (m) => String(m == null ? '' : ((m && m.message) || m)).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '<url>').replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 160)

function done(result, failedStep) {
  console.log('========================================')
  console.log('GRUBANO PHASE 2 BACKUP SAFETY (staging) — every value below is MEASURED')
  console.log('RESULT: ' + result)
  if (failedStep) console.log('FAILED STEP: ' + failedStep)
  for (const l of facts) console.log(l)
  if (anomalies.length) { console.log('ANOMALIES (' + anomalies.length + '):'); for (const a of anomalies) console.log('  - ' + a) }
  console.log('ACTION: PASTE THIS WHOLE OUTPUT TO CLAUDE CODE')
  console.log('========================================')
  process.exitCode = result.startsWith('PASS') ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 1500).unref()
}
const fail = (step) => done('FAIL', step)

/** Effective value of one key under dotenv semantics (last occurrence wins). */
function effective(text, key) {
  const parsed = prov.parseEnvDotenv(text)
  const v = parsed && typeof parsed === 'object' ? (parsed.values ? parsed.values[key] : parsed[key]) : undefined
  return v === undefined ? undefined : String(v)
}
// T-54 (2026-09-10) — the neutraliser covered REFUNDS_ENABLED only. The claims operator also
// backs up .env.local before every write, so the copy taken just before its close contains
// CLAIMS_ENABLED=true and was equally restorable. Same defect class, second flag.
//
// This is DEFENCE IN DEPTH, not the authorization control: since T-53 a restored backup cannot
// reopen the claims surface anyway, because the lease it carries is expired by the time anyone
// restores it. Both layers are kept — the lease is the lock, this is the tidy-up.
const GUARDED_FLAGS = ['REFUNDS_ENABLED', 'CLAIMS_ENABLED']

/** The flags a backup would re-enable if it were copied over .env.local. */
function dangerousFlags(text) {
  return GUARDED_FLAGS.filter((k) => effective(text, k) === 'true')
}

/** Rewrite EVERY guarded flag to false, in one pass. */
function neutralizeAll(text) {
  return GUARDED_FLAGS.reduce((acc, k) => neutralize(acc, k), text)
}

/** Rewrite EVERY assignment of `key` to `key=false` (comments untouched). */
function neutralize(text, key) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return text.split(/\r?\n/).map((raw) => {
    const t = raw.replace(/^﻿/, '').trim()
    if (!t || t.startsWith('#')) return raw
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    return m && m[1] === key ? key + '=false' : raw
  }).join(eol)
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function probeGate(base) {
  try {
    const r = await fetch(base + '/api/admin/refunds/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'grubano-phase2-backup-neutralize/1' }, body: '{}', redirect: 'manual' })
    const b = await r.json().catch(() => null)
    if (r.status === 403 && b && b.gated === true) return '403'
    return String(r.status)
  } catch { return 'UNREACHABLE' }
}

async function main() {
  console.log('[1] live flag (read-only)')
  const envFile = path.join(APP_ROOT, '.env.local')
  if (!fs.existsSync(envFile)) return fail('1 env: .env.local not found under ' + APP_ROOT)
  const liveText = fs.readFileSync(envFile, 'utf8')
  const texts = prov.readNextEnvFiles(fs, path, APP_ROOT)
  const merged = prov.mergeNextEnvFiles(texts).merged
  const liveFlag = merged.REFUNDS_ENABLED === undefined ? 'ABSENT→false' : merged.REFUNDS_ENABLED
  F('LIVE REFUNDS_ENABLED (Next merged view)', liveFlag)
  if (liveFlag !== 'false' && liveFlag !== 'ABSENT→false') return fail('1 env: live REFUNDS_ENABLED is not false — this script never edits .env.local; investigate first')
  const liveClaims = merged.CLAIMS_ENABLED === undefined ? 'ABSENT→false' : merged.CLAIMS_ENABLED
  F('LIVE CLAIMS_ENABLED (Next merged view)', liveClaims)
  if (liveClaims !== 'false' && liveClaims !== 'ABSENT→false') return fail('1 env: live CLAIMS_ENABLED is not false — this script never edits .env.local; close the claims window first')
  const nextauthUrl = (merged.NEXTAUTH_URL || '').replace(/\/$/, '')
  const base = (process.env.PHASE2_BASE_URL || nextauthUrl).replace(/\/$/, '')
  try { const bu = new URL(base); const loop = bu.hostname === '127.0.0.1' || bu.hostname === 'localhost'; if (!(bu.protocol === 'https:' && bu.hostname === 'app.grubano.com') && !loop) return fail('1 env: probe base not staging') } catch { return fail('1 env: probe base invalid') }
  const liveSha = sha256(fs.readFileSync(envFile))

  console.log('[2] scan app-root backups')
  const names = fs.readdirSync(APP_ROOT).filter((n) => /^\.env\.local\.bak/.test(n)).sort()
  F('BACKUP FILES IN APP ROOT', names.length ? names.join(', ') : 'none')
  const dangerous = [], safe = [], unparsable = []
  for (const n of names) {
    try {
      const text = fs.readFileSync(path.join(APP_ROOT, n), 'utf8')
      const bad = dangerousFlags(text)
      if (bad.length) dangerous.push(n)
      else safe.push(n + ' (' + GUARDED_FLAGS.map((k) => k + '=' + (effective(text, k) ?? 'ABSENT→false')).join(' ') + ')')
    } catch (e) { unparsable.push(n); A('2 scan: cannot parse ' + n + ' — ' + scrub(e)) }
  }
  F('STALE TRUE-FLAG BACKUP EXISTS', dangerous.length ? 'YES (' + dangerous.join(', ') + ')' : 'NO')
  F('SAFE BACKUPS (effective false)', safe.length ? safe.join(', ') : 'none')
  F('COULD RESTORING RE-ENABLE REFUNDS', dangerous.length ? 'YES — a plain copy over .env.local followed by a Passenger reload/respawn would set the process flag to true' : 'NO')

  console.log('[3] ' + (DRY ? 'dry run (no change)' : 'archive evidence outside the app root, then remove the restorable copies'))
  const remediated = []
  if (dangerous.length && !DRY) {
    try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 }); fs.chmodSync(EVIDENCE_DIR, 0o700) } catch (e) { return fail('3 evidence dir: ' + scrub(e)) }
    for (const n of dangerous) {
      const src = path.join(APP_ROOT, n)
      try {
        const buf = fs.readFileSync(src); const st = fs.statSync(src); const text = buf.toString('utf8')
        const neutralized = neutralizeAll(text)
        if (dangerousFlags(neutralized).length) { A('3 ' + n + ': neutralized copy still enables ' + dangerousFlags(neutralized).join('/') + ' — left in place'); continue }
        const manifest = { file: n, appRoot: APP_ROOT, originalSha256: sha256(buf), originalBytes: st.size, originalMtime: st.mtime.toISOString(), guardedFlagsEnabled: dangerousFlags(text).join(','), neutralizedSha256: sha256(Buffer.from(neutralized, 'utf8')), archivedAt: new Date().toISOString(), note: 'Backup written by a phase2 gate operator right before its close write; original removed from the app root because it was restorable with a money-bearing flag set to true (see guardedFlagsEnabled). Secret values are NOT recorded here.' }
        const manPath = path.join(EVIDENCE_DIR, n + '.manifest.json'), neuPath = path.join(EVIDENCE_DIR, n + '.neutralized')
        fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2), { mode: 0o600 }); fs.writeFileSync(neuPath, neutralized, { mode: 0o600 })
        try { fs.chmodSync(manPath, 0o600); fs.chmodSync(neuPath, 0o600) } catch { /* best-effort */ }
        // verify the archive before removing anything
        if (!fs.existsSync(manPath) || sha256(fs.readFileSync(neuPath)) !== manifest.neutralizedSha256) { A('3 ' + n + ': archive verification failed — left in place'); continue }
        fs.unlinkSync(src)
        remediated.push(n)
        F('REMEDIATED', n + ' → archived (manifest + neutralized copy, mode 600) under ' + EVIDENCE_DIR + ' · original removed from app root')
      } catch (e) { A('3 ' + n + ': ' + scrub(e) + ' — left in place') }
    }
  }

  console.log('[4] proof')
  if (sha256(fs.readFileSync(envFile)) !== liveSha) return fail('4 proof: .env.local changed during the run — this script never writes it; investigate')
  const mergedAfter = prov.mergeNextEnvFiles(prov.readNextEnvFiles(fs, path, APP_ROOT)).merged
  F('LIVE REFUNDS_ENABLED', mergedAfter.REFUNDS_ENABLED === undefined ? 'ABSENT→false' : mergedAfter.REFUNDS_ENABLED)
  F('LIVE CLAIMS_ENABLED', mergedAfter.CLAIMS_ENABLED === undefined ? 'ABSENT→false' : mergedAfter.CLAIMS_ENABLED)
  const gate = await probeGate(base)
  F('PROCESS REFUND GATE', gate)
  if (gate !== '403') A('4 proof: live gate is not 403 gated')
  // AUDIT FIX (T-49 audit): the final proof still filtered on REFUNDS_ENABLED alone, so a
  // claims-only true-flag backup was reported as 'no restorable backup'. Both flags now.
  const left = fs.readdirSync(APP_ROOT).filter((n) => /^.env.local.bak/.test(n)).filter((n) => { try { return dangerousFlags(fs.readFileSync(path.join(APP_ROOT, n), 'utf8')).length > 0 } catch { return true } })
  F('RESTORABLE TRUE-FLAG BACKUP IN ACTIVE APP AREA', left.length ? 'YES (' + left.join(', ') + ')' : 'NO')
  // A restorable true-flag backup is an UNREMEDIATED RISK whether or not this was a dry run.
  // (Audit 2026-09-09: the dry run used to print RESULT: PASS and exit 0 while the footgun was
  // still in the app root — a report a reader would reasonably take as "nothing to do".)
  if (left.length) A('4 proof: restorable true-flag backup(s) still present' + (DRY ? ' — DRY RUN made no change; re-run WITHOUT PHASE2_BACKUP_DRY_RUN to remediate' : ''))
  F('STALE TRUE-FLAG BACKUP REMEDIATED', DRY ? 'NO — DRY RUN, nothing changed' : (dangerous.length ? (remediated.length === dangerous.length ? 'YES (' + remediated.length + ')' : 'PARTIAL (' + remediated.length + '/' + dangerous.length + ')') : 'NOT REQUIRED'))
  const backupSafety = !left.length && gate === '403' && !anomalies.length
  F('BACKUP SAFETY', backupSafety ? 'PASS' : 'FAIL')
  done(backupSafety ? (DRY ? 'PASS (dry run — nothing needed remediation)' : 'PASS') : 'FAIL')
}

main().catch((e) => fail('unexpected: ' + scrub(e)))
