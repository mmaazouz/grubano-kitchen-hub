// operator-qa-render-health.mjs — pure render-health classifier for the operator
// visual-QA robot (mission CK).
//
// WHY THIS EXISTS: on /fr/orders mobile the robot shot a 738x844 capture on a
// 390x844 viewport and produced diffPercent 15.69 — the page's DOCUMENT was 200
// but its stylesheets and fonts had been refused under an HTTP 429 storm, so the
// capture was raw unstyled HTML (Material Symbols ligature names visible). The
// robot watched ONLY the document's status; subresource failures were entirely
// unobserved, document.fonts.ready resolves even when fonts FAIL, and
// networkidle0 is satisfied by requests that COMPLETED in error (a 429 settles
// faster than a 200). This module classifies the render health of a capture so
// the robot prefers "RENDER INVALID" over a meaningless diffPercent.
//
// SIGNALS (both come from what puppeteer already emits — no new waits):
//   · network — every subresource 'response' with status >= 400 plus every
//     'requestfailed' (net::ERR_*, ERR_ABORTED excluded as benign cancellation).
//     A 429 is a COMPLETED response, so it arrives via 'response', never
//     'requestfailed' (puppeteer types.d.ts:7710-7716).
//   · DOM ground truth — after fonts.ready + settle: stylesheet <link>s whose
//     .sheet never materialised (disabled links and non-matching media filtered)
//     and FontFace entries whose status is 'error'.
//
// CLASSIFICATION (validated design, phase-2 authorisation):
//   invalid   — DOM probe shows an unloaded stylesheet or an errored font
//               (ground truth: the page IS missing render CSS/fonts), OR a
//               same-origin /_next/ script chunk failed (Next's own render JS —
//               hydration is dead). ORIGIN IS NEVER A FILTER: the product's icon
//               font is SELF-HOSTED, so a same-origin failure counts fully.
//   unknown   — the DOM probe itself failed: the capture cannot be certified.
//   degraded  — non-critical failures only: an uncorroborated network CSS/font
//               error (multi-src @font-face fallback or a failed preload whose
//               re-fetch succeeded — the final render is fine), a third-party
//               script, an image/media asset, or a SUB-frame document. The diff
//               is still computed but must never read as a normal verdict.
//   ok        — nothing failed.
//   Types outside {stylesheet, font, script, image, media, document} — xhr,
//   fetch, websocket, prefetch, preflight, ping, manifest, texttrack,
//   eventsource, signedexchange, cspviolationreport, fedcm, other — are data or
//   plumbing, not rendering: IGNORED by explicit default.
//
// PURE on purpose (the operator-qa-diagnose.mjs pattern): no imports, no I/O,
// no clock — tests prove every verdict without executing the robot.

/** The banner the robot prints instead of a diffPercent on an invalid capture. */
export const RENDER_INVALID_MESSAGE = 'RENDER INVALID — CRITICAL STATIC RESOURCE FAILED'

/**
 * DOM ground-truth probe. SELF-CONTAINED — the robot passes this function to
 * page.evaluate(), which serialises its source: it may only touch page globals.
 * Runs after fonts.ready + settle, EVEN when goto timed out.
 * @returns {{ unloadedStylesheets: string[], erroredFonts: string[] }}
 */
export function domProbe() {
  const unloadedStylesheets = []
  for (const l of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
    // A disabled link (theme-switcher pattern) or a media query that does not
    // match this shot's viewport (print, desktop-only during mobile) is
    // INTENTIONALLY not applied — its absence is not a failure.
    if (l.disabled) continue
    let applies = true
    try { applies = !l.media || matchMedia(l.media).matches } catch { /* keep true */ }
    if (!applies) continue
    // .sheet is non-null once a stylesheet LOADED (cross-origin included — only
    // cssRules access throws); null = the CSS never arrived.
    if (!l.sheet) unloadedStylesheets.push(l.href || '(inline)')
  }
  const erroredFonts = []
  try {
    for (const f of Array.from(document.fonts || [])) {
      if (f.status === 'error') erroredFonts.push(f.family)
    }
  } catch { /* FontFaceSet unavailable → nothing to report */ }
  return { unloadedStylesheets, erroredFonts }
}

/** Resource types that degrade the capture without invalidating it. */
const DEGRADED_TYPES = new Set(['image', 'media'])
/** Network-suspect types that only the DOM probe can confirm as critical. */
const CORROBORATED_TYPES = new Set(['stylesheet', 'font'])

/** True for a same-origin Next.js build asset — the page's own render JS. */
function isNextChunk(url, pageOrigin) {
  return !!pageOrigin && String(url).startsWith(`${pageOrigin}/_next/`)
}

/** Compact human label for one failure. */
function describeFailure(f) {
  // DOM ground-truth entries carry no status/errorText — they are "the resource
  // never materialised", which may have no network trace at all.
  const status = f.origin === 'dom'
    ? 'never loaded (DOM)'
    : f.status != null ? `HTTP ${f.status}` : (f.errorText || 'network failure')
  return `${f.type} ${status} ${f.url ?? f.family ?? ''}`.trim()
}

/**
 * Classify the render health of one capture.
 * @param {{
 *   pageOrigin: string|null,
 *     // origin of the shot target for http(s) pages; null for file:// refs
 *     // (a file page has no same-origin /_next/ — its remote subresources are
 *     // still fully watched).
 *   failures: Array<{ type: string, url: string, status: number|null, errorText?: string }>,
 *     // collected by the robot's listeners; MAIN-frame document excluded
 *     // (diagnoseShot owns it), net::ERR_ABORTED excluded.
 *   probe: { unloadedStylesheets: string[], erroredFonts: string[] } | null,
 *     // null when the DOM probe itself failed (wedged/crashed page).
 *   navSettled?: boolean,
 *     // false when goto returned no response (networkidle0 timeout / net-level
 *     // document failure): the capture happened on a page that never reached
 *     // network quiet — it can be photographed but not certified settled, so
 *     // an otherwise-clean shot is capped at 'degraded' (adversarial review:
 *     // a half-painted timeout page must never produce an unflagged diff).
 * }} input
 * @returns {{ health: 'ok'|'degraded'|'invalid'|'unknown',
 *             errors: Array<{ type: string, url?: string, family?: string,
 *                             status?: number|null, errorText?: string,
 *                             origin: 'network'|'dom' }>,
 *             message: string|null }}
 */
export function classifyRenderHealth({ pageOrigin, failures, probe, navSettled = true }) {
  const errors = []
  let scriptCritical = false
  let degradedAny = false

  for (const f of failures ?? []) {
    const type = String(f.type || 'other')
    if (type === 'script') {
      const critical = isNextChunk(f.url, pageOrigin)
      errors.push({ type, url: f.url, status: f.status ?? null, ...(f.errorText ? { errorText: f.errorText } : {}), origin: 'network' })
      if (critical) scriptCritical = true
      else degradedAny = true
    } else if (CORROBORATED_TYPES.has(type) || DEGRADED_TYPES.has(type) || type === 'document') {
      // stylesheet/font: network suspicion (the DOM probe decides criticality);
      // image/media: visual but non-blocking; document here is a SUB-frame only.
      errors.push({ type, url: f.url, status: f.status ?? null, ...(f.errorText ? { errorText: f.errorText } : {}), origin: 'network' })
      degradedAny = true
    }
    // every other type: ignored by explicit default (see header).
  }

  const domCritical = !!probe && (probe.unloadedStylesheets.length > 0 || probe.erroredFonts.length > 0)
  if (probe) {
    for (const url of probe.unloadedStylesheets) errors.push({ type: 'stylesheet', url, origin: 'dom' })
    for (const family of probe.erroredFonts) errors.push({ type: 'font', family, origin: 'dom' })
  }

  // Precedence: a proven critical failure outranks a failed probe — a dead
  // /_next/ chunk is decisive whether or not the probe ran.
  if (domCritical || scriptCritical) {
    const criticals = errors.filter((e) =>
      e.origin === 'dom' || (e.type === 'script' && isNextChunk(e.url, pageOrigin)))
    return {
      health: 'invalid',
      errors,
      message:
        `${RENDER_INVALID_MESSAGE} — ${criticals.length} critical failure(s): ` +
        criticals.slice(0, 3).map(describeFailure).join(' · ') +
        (criticals.length > 3 ? ` · +${criticals.length - 3} more` : ''),
    }
  }
  if (!probe) {
    return {
      health: 'unknown',
      errors,
      message: 'RENDER UNKNOWN — DOM probe failed; the capture cannot be certified rendered.',
    }
  }
  if (degradedAny) {
    return {
      health: 'degraded',
      errors,
      message:
        `RENDER DEGRADED — ${errors.length} non-critical resource failure(s); ` +
        'the diff is computed but is NOT a normal visual verdict.',
    }
  }
  if (!navSettled) {
    return {
      health: 'degraded',
      errors,
      message:
        'RENDER DEGRADED — navigation never settled (goto returned no response); ' +
        'the capture cannot be certified complete — the diff is NOT a normal visual verdict.',
    }
  }
  return { health: 'ok', errors, message: null }
}
