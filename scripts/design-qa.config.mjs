/**
 * design-qa.config.mjs — screens the visual-QA robot diffs.
 *
 * Each screen: { name, url (path on the local Next), reference (CD mock HTML file, relative to
 * the repo root), settle?, viewports?, states? }.
 * A state can set:
 *   - query    : appended to the real URL (for URL-addressable states)
 *   - theme    : value set on <html data-theme> before the shot (for the REF mock; the real
 *                /eat/auth decouples its colours per screen so this is harmless there)
 *   - action   : a JS expression run in the REAL page to reach a React-state (e.g. click a link)
 *   - refClass : a class added to the REF mock's root to reach that state (e.g. 'is-signup')
 *
 * Add a screen + a reference HTML under scripts/design-qa-refs/ to extend coverage.
 */
export const screens = [
  {
    name: 'eat-auth',
    url: '/fr/eat/auth',
    reference: 'scripts/design-qa-refs/eat-auth.html',
    settle: 650,
    viewports: [
      { name: 'mobile', w: 390, h: 844 },
      { name: 'desktop', w: 1280, h: 820 },
    ],
    states: [
      // CONNEXION — the real app is ALWAYS light here (fixed-per-screen colours).
      { name: 'signin', theme: 'light' },
      // INSCRIPTION — real app is ALWAYS dark. Real page: click the "S'inscrire" link to flip
      // the React tab. Ref mock follows data-theme, so force dark + add `is-signup`.
      {
        name: 'signup',
        theme: 'dark',
        refClass: 'is-signup',
        action: `(() => { const a=[...document.querySelectorAll('.auth__sub a')].find(x=>/inscrire|create/i.test(x.textContent||'')); if(a) a.click(); })()`,
      },
    ],
  },
  {
    name: 'eat-magic-sent',
    url: '/fr/eat/magic',
    reference: 'scripts/design-qa-refs/eat-magic-sent.html',
    settle: 700,
    states: [
      {
        name: 'sent',
        // Seed the email /eat/auth hands over so the page shows "Check your email" (it otherwise
        // redirects back to /eat/auth). The page fires the real magic-link API on mount
        // (anti-enumeration → generic), which is harmless for a non-existent demo address.
        before: `(function(){try{sessionStorage.setItem('gb_magic_email','sofia@email.com')}catch(e){}})()`,
      },
    ],
  },
  {
    name: 'eat-magic-verifying',
    url: '/fr/eat/magic',
    reference: 'scripts/design-qa-refs/eat-magic-verifying.html',
    settle: 700,
    states: [
      {
        name: 'verifying',
        query: '?token=demo-magic-token-for-qa',
        // Hang every /api/auth/* call so signIn never resolves → the "Signing you in…" spinner
        // stays on screen to be captured. waitUntil drops to domcontentloaded (networkidle never
        // fires while a request is intentionally pending).
        waitUntil: 'domcontentloaded',
        before: `(function(){var of=window.fetch;window.fetch=function(u,o){if(String(u).indexOf('/api/auth/')>-1){return new Promise(function(){})}return of.call(this,u,o)}})()`,
      },
    ],
  },
]
