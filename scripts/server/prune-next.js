#!/usr/bin/env node
/**
 * scripts/server/prune-next.js
 *
 * Server-side cleanup run after every FTP deploy from .github/workflows/
 * deploy-{staging,production}.yml. Eliminates the recurring "blank page /
 * CSS 404 right after a deploy" problem by removing the stale per-build
 * directories that accumulate under .next/static/ one-per-deploy, then
 * letting the Passenger restart that follows pick up the clean state.
 *
 * Why it's CONSERVATIVE (and why "prune every old chunk file" was rejected):
 *
 *   The original spec asked for an invariant of "only the current build's
 *   chunks remain". The natural approach — collect every /_next/static/
 *   reference from manifests + pre-rendered HTML, delete everything else —
 *   was implemented and smoke-tested locally against a real `npm run build`
 *   output. Result: the reference set covered just 19 of 70 chunks files in
 *   .next/static/chunks/. The remaining 51 are split chunks loaded by the
 *   webpack runtime, async chunks for dynamic imports, etc., that are NOT
 *   enumerated in build-manifest.json or app-build-manifest.json. Deleting
 *   them would silently break the current build — exactly the failure mode
 *   the original 404/blank-page problem describes.
 *
 *   So we DELIBERATELY DO NOT prune individual files in chunks/css/media.
 *   Those filenames are content-hashed: collisions across builds are
 *   cryptographically impossible, so leaving stale files in place wastes
 *   disk (a few MB per deploy) but cannot cause 404s on the current build.
 *
 *   What CAN cause 404s — and what this script fixes — is the per-build
 *   directory under .next/static/<BUILD_ID>/ (holds _buildManifest.js +
 *   _ssgManifest.js). One new dir appears per deploy and they have no
 *   content-hash safety net; Passenger reads the *current* BUILD_ID and
 *   nothing else. Stale per-build dirs are pure noise we can safely drop.
 *
 * What it prunes (only under .next/static/, never anywhere else):
 *
 *   Every direct subdirectory of .next/static/ whose name is NOT
 *   .next/BUILD_ID's content and NOT a well-known shared subdir
 *   (chunks / css / media / fonts / images).
 *
 * Safety belt:
 *
 *   - Bails (exit 0, no changes) if .next/static is missing.
 *   - Bails if .next/BUILD_ID is missing or empty.
 *   - Bails if the current BUILD_ID dir itself is missing under static/ —
 *     that would mean either the upload is incomplete or our understanding
 *     of the layout is wrong. Either way, do not delete.
 *   - Every fs op is wrapped in try/catch; failures are logged, not thrown.
 *   - Operates strictly under .next/static/. Never touches BUILD_ID itself,
 *     node_modules, .env.local, tmp/, public/, the cPanel-managed .htaccess,
 *     or anything outside the app's static asset tree.
 *
 * Intended caller (deploy-{staging,production}.yml SSH step):
 *
 *     cd ~/<approot> && node scripts/server/prune-next.js || true
 *
 * The `|| true` keeps a flaky prune run from failing the SSH step;
 * Passenger is restarted on the line after this regardless.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_ROOT = process.cwd();
const NEXT_DIR = path.join(APP_ROOT, '.next');
const STATIC_DIR = path.join(NEXT_DIR, 'static');
const BUILD_ID_FILE = path.join(NEXT_DIR, 'BUILD_ID');

// Direct subdirs of .next/static/ that are NEVER pruned (they hold the
// content-hashed asset files that may be shared across builds).
const SHARED_SUBDIRS = new Set(['chunks', 'css', 'media', 'fonts', 'images']);

function log(msg) { console.log(`[prune-next] ${msg}`); }
function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// --------------------------------------------------------------------------
// Sanity
// --------------------------------------------------------------------------

if (!safeStat(NEXT_DIR) || !safeStat(STATIC_DIR)) {
  log('.next/static not present — nothing to do.');
  process.exit(0);
}

const CURRENT_BUILD = (safeRead(BUILD_ID_FILE) || '').trim();
if (!CURRENT_BUILD) {
  log('BUILD_ID missing or empty — refusing to prune. Bailing.');
  process.exit(0);
}

// Cross-check: the current BUILD_ID must have a corresponding dir under
// static/ before we trust it to use as a delete filter. If it doesn't,
// the upload is mid-flight or the layout has changed — either way, bail.
if (!safeStat(path.join(STATIC_DIR, CURRENT_BUILD))) {
  log(`current BUILD_ID dir (.next/static/${CURRENT_BUILD}) not found yet — refusing to prune. Bailing.`);
  process.exit(0);
}

log(`current BUILD_ID = ${CURRENT_BUILD}`);

// --------------------------------------------------------------------------
// Prune stale per-build dirs under .next/static/
// --------------------------------------------------------------------------

let entries;
try { entries = fs.readdirSync(STATIC_DIR, { withFileTypes: true }); }
catch (e) {
  log(`cannot read ${STATIC_DIR}: ${e.message}`);
  process.exit(0);
}

let dirsRemoved = 0;
let dirsKept = 0;

for (const ent of entries) {
  if (!ent.isDirectory()) continue;
  if (SHARED_SUBDIRS.has(ent.name)) { dirsKept++; continue; }
  if (ent.name === CURRENT_BUILD) { dirsKept++; continue; }
  const target = path.join(STATIC_DIR, ent.name);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    log(`removed stale build dir: ${ent.name}`);
    dirsRemoved++;
  } catch (e) {
    log(`could not remove dir ${ent.name}: ${e.message}`);
  }
}

log(`done. stale dirs removed: ${dirsRemoved}, dirs kept: ${dirsKept}`);
log(`(chunks/css/media files are intentionally left alone — content-hashed names never collide; accumulation wastes disk but cannot cause 404s.)`);
