// operator-qa-diagnose.mjs — pure navigation-outcome classifier for the operator
// visual-QA robot (mission CD, chantier ⑥c).
//
// WHY THIS EXISTS: the previous in-line guard was INVERTED — it read an arrival
// on /eat/auth as "session valid, role missing", while in the product /eat/auth
// receives UNAUTHENTICATED visitors. Worse: for the operator screens the robot
// shoots, the middleware sends unauthenticated requests to /{locale}/login
// (middleware.ts) and insufficient-role sessions to /{locale}/eat or the role's
// own home — URLs the old guard did not watch at all, so both failures were
// silent. This module states the four situations decision ⑥c requires:
//
//   'unauthenticated'  — the request carried NO usable session: the final URL is
//                        an auth page (/login via middleware, /auth/magic via
//                        page-level guards, /eat/auth via consumer guards).
//   'role-mismatch'    — the session was ACCEPTED (not sent to an auth page) but
//                        the middleware bounced the navigation to another space:
//                        this account cannot reach the requested screen.
//   'onboarding-gate'  — session AND role accepted; the dashboard layout bounced
//                        an un-seeded restaurant account to /business/onboarding.
//                        (A refinement of ③, found in adversarial review: calling
//                        it a role problem would reproduce the old inversion.)
//   'app-error'        — the target answered but broke: HTTP >= 400 on the final
//                        document, or the navigation produced no page at all.
//   'ok'               — the requested screen rendered at the requested path.
//
// (The fourth ⑥c situation, a true LOGIN failure, is diagnosed earlier and
// separately by login() in operator-visual-qa.mjs, which throws before any
// screenshot when no session cookie comes back.)
//
// PURE on purpose: no imports, no I/O, no clock — so tests can prove the four
// diagnoses without executing the robot (⑥c places account access AFTER the
// verified fix; importing the robot itself would run its main()).

/** True when the pathname is an auth page, with or without a locale prefix. */
function isAuthPagePath(pathname) {
  // The product has THREE auth pages that receive bounced traffic:
  //   /login      — middleware target for no-session requests on gated routes
  //   /auth/magic — page-level defence-in-depth on operator screens (tables,
  //                 add-activity, establishments…) when the session is rejected
  //                 or the operator row behind it no longer exists
  //   /eat/auth   — consumer per-page guards
  // All optionally /{locale}-prefixed.
  return /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/login(?:\/|$)/.test(pathname) ||
         /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/auth\/magic(?:\/|$)/.test(pathname) ||
         /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/eat\/auth(?:\/|$)/.test(pathname)
}

/** True when the pathname is the partner onboarding gate's destination. */
function isOnboardingGatePath(pathname) {
  // app/[locale]/dashboard/layout.tsx redirects a RESTAURANT-role session with
  // no brand or no establishment to /business/onboarding: the role is RIGHT,
  // the account is simply not seeded — calling that a role problem would be
  // exactly the inversion this mission removes.
  return /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/business\/onboarding(?:\/|$)/.test(pathname)
}

/** Pathname of a URL string, '' when unparseable. Trailing slash normalised. */
function pathnameOf(url, base) {
  try {
    const p = new URL(url, base).pathname
    return p.length > 1 ? p.replace(/\/+$/, '') : p
  } catch {
    return ''
  }
}

/**
 * Classify one authenticated app shot.
 * @param {{ requestedUrl: string, finalUrl: string, status: number|null }} shot
 *   requestedUrl — the absolute URL the robot navigated to
 *   finalUrl     — page.url() after navigation (redirects followed)
 *   status       — HTTP status of the FINAL document, or null when the
 *                  navigation produced no response (timeout, crash)
 * @returns {{ kind: 'unauthenticated'|'role-mismatch'|'onboarding-gate'|'app-error'|'ok', message: string|null }}
 */
export function diagnoseShot({ requestedUrl, finalUrl, status }) {
  const requestedPath = pathnameOf(requestedUrl)
  const finalPath = pathnameOf(finalUrl, requestedUrl)

  // ① The bounce to an auth page is the PRIMARY fact — it wins over any status:
  //   an auth page rendering 200 (or even erroring) still means the original
  //   request was treated as carrying no valid session.
  if (isAuthPagePath(finalPath)) {
    return {
      kind: 'unauthenticated',
      message:
        `request was treated as UNAUTHENTICATED — landed on the auth page ${finalPath}. ` +
        'The injected session cookie was absent, expired or rejected. This is NOT a ' +
        'role problem: check the login step and the cookie domain/secure flags.',
    }
  }

  // ② No page at all: the navigation died before producing a document.
  if (!finalPath || finalPath === 'blank' || /^about:/.test(String(finalUrl))) {
    return {
      kind: 'app-error',
      message: 'navigation produced no page (timeout or crash) — application or network error.',
    }
  }

  // ③ The final document answered with an error code (404 also counts: the
  //   configured screen did not render — flag-gated layouts included).
  if (typeof status === 'number' && status >= 400) {
    return {
      kind: 'app-error',
      message: `HTTP ${status} on ${finalPath} — application error, not an auth problem.`,
    }
  }

  // ④ Bounced to the partner onboarding: session AND role were accepted — the
  //   dashboard layout gates un-seeded restaurant accounts (no brand or no
  //   establishment yet). A seeding problem, never an auth or role problem.
  if (isOnboardingGatePath(finalPath)) {
    return {
      kind: 'onboarding-gate',
      message:
        `session and role ACCEPTED — bounced to ${finalPath} because the account has ` +
        'no brand or no establishment yet. Seed a brand + establishment for the QA account.',
    }
  }

  // ⑤ Bounced OFF the requested screen without hitting an auth page: the session
  //   was accepted, but the middleware sent this account to another space.
  if (requestedPath && finalPath !== requestedPath) {
    return {
      kind: 'role-mismatch',
      message:
        `session ACCEPTED but bounced off the target: requested ${requestedPath}, ` +
        `landed on ${finalPath}. Most likely this account lacks a role that can reach ` +
        "this screen (operator screens need 'restaurant' or 'admin'). If the landing " +
        'page is ANOTHER operator screen, the QA config ids (QA_RESTAURANT_ID / ' +
        'QA_BRAND_ID) may be wrong instead.',
    }
  }

  return { kind: 'ok', message: null }
}
