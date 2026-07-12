# Visual-QA diff robot (`scripts/design-qa.mjs`)

Automates "real page vs CD mock" visual checks so we stop depending on manual / broken
screenshot tooling. For each configured screen × state × viewport it writes, under
`design-qa/<screen>/<state>-<viewport>/`:

- `app.png`  — the **real** local page (Next server)
- `ref.png`  — the **CD reference** mock (a local HTML file rendered via `file://`)
- `diff.png` — pixelmatch highlight of the differing pixels
- and a `design-qa/<screen>/resume.json` with the **% of differing pixels** per case

It drives an **already-installed Chrome/Edge** (no browser download — the network blocks that)
through `puppeteer-core`, and diffs with `pixelmatch` + `pngjs` (all devDependencies).
TOOLING ONLY — it never imports or changes app code, routes, money or auth.

## Run

```bash
# 1. build once (the robot can start `next start` itself, which needs a build)
npm run build

# 2. run the robot (starts a server on :3000 if none is reachable, else reuses it)
node scripts/design-qa.mjs            # every screen in the config
node scripts/design-qa.mjs eat-auth   # a single screen

# options
BASE_URL=http://localhost:3210 node scripts/design-qa.mjs   # reuse a server you started
CHROME_BIN="C:/path/to/chrome.exe"  node scripts/design-qa.mjs   # force a browser binary
```

Output (also printed as a table at the end):

```
design-qa/eat-auth/
  signin-mobile/{app,ref,diff}.png
  signin-desktop/{app,ref,diff}.png
  signup-mobile/{app,ref,diff}.png
  signup-desktop/{app,ref,diff}.png
  resume.json
```

`design-qa/` is git-ignored (generated images); the script, the config and the reference
HTML under `scripts/design-qa-refs/` are tracked.

## Add a screen

Edit `scripts/design-qa.config.mjs` and drop a reference mock under `scripts/design-qa-refs/`:

```js
{
  name: 'eat-cart',
  url: '/fr/eat/cart',
  reference: 'scripts/design-qa-refs/eat-cart.html',
  viewports: [{ name: 'mobile', w: 390, h: 844 }, { name: 'desktop', w: 1280, h: 820 }],
  states: [
    { name: 'default', theme: 'light' },
    // reach a React-state on the real page with `action` (JS run in the page); reach the
    // matching state on the mock with `refClass` (a class added to its root) and/or `theme`.
    { name: 'empty', theme: 'light', action: `document.querySelector('[data-clear]')?.click()` },
  ],
}
```

## Interpreting the %

The % is a signal, not a hard pass/fail: layout / colour / size drift shows up as a high
diff in the affected region. Known, expected differences (the mock is EN with a placeholder
"g" logo; the real app is FR with the real Grubano symbol) will always contribute some %, so
read `diff.png` to see *where* the difference is — structural drift (panels swapped, wrong
gradient, wrong sizes) is what matters; copy/logo deltas are expected.

## Reference HTML

Each `scripts/design-qa-refs/*.html` is a VERBATIM copy of the corresponding Claude-Design
mock (from Notion), with only the demo `.preview-bar` + `<script>` removed (the robot drives
state via `refClass` / `theme`). Keep them in sync with the frozen CD references.
