// operator-qa-normalize.mjs — pure capture-time normalizations for the operator
// visual-QA robot (baseline mission, decisions ❶❺❻❼ validated by the founder).
//
// WHY: the first comparable baseline requires removing MEASUREMENT artefacts
// without touching the reference files or the product:
//   · harness — the CD demo bar (<body> > .bar: ÉTABLISSEMENTS/ÉTAT/THÈME/SENS/
//     ÉCRAN toggles, 52px desktop / 175px mobile, sticky IN FLOW) exists only
//     in the refs; it shifts all content and ghosts every glyph. Hidden at
//     capture time ONLY — the file keeps its functional toggles. The selector
//     is body > .bar: op-dashboard also has a NESTED .op-kpi__goal .bar (a KPI
//     progress bar) that must NEVER match.
//   · scale — the mocks default to the aggregated N≥2 establishments state;
//     the QA app runs single-establishment. setScale('single') (a mock-provided
//     toggle) puts the ref in the state the app actually shows.
//   · anim — the only default-visible animation (live-pulse ring, op-orders)
//     produced 20px of temporal noise; animations and transitions are frozen on
//     BOTH sides at capture time.
//   · dates — header dates are runtime-generated app-side (« dimanche 16 août »)
//     and hard-coded mock-side (« Lundi 1 juillet ») — never equalisable by
//     data. The comparator cannot exclude a zone, so the SAME elements are
//     hidden on BOTH sides before capture (complement ②: a one-sided mask
//     would create the very gap it claims to remove): .op-top__date (topbar,
//     shared class app+refs) and .op-dash__sub (dated subtitle, shared class).
//     visibility:hidden keeps the layout, so both sides show the same blank.
//
// PURE on purpose (the operator-qa-diagnose/render-health pattern): no imports,
// no I/O — tests prove the CSS/scripts per side without executing the robot.

/** Normalization steps, in the order they are measured (N1→N4). */
export const NORM_STEPS = ['harness', 'scale', 'anim', 'dates']

/** Parse the QA_NORM env value ("harness,scale") into a validated step list. */
export function parseNormSteps(envValue) {
  if (!envValue) return []
  const steps = String(envValue).split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = steps.filter((s) => !NORM_STEPS.includes(s))
  if (unknown.length) throw new Error(`QA_NORM: étapes inconnues ${unknown.join(', ')} (valides: ${NORM_STEPS.join(',')})`)
  return NORM_STEPS.filter((s) => steps.includes(s)) // canonical order
}

/**
 * CSS to inject at capture time for one side.
 * @param {string[]} steps  validated step list
 * @param {'app'|'ref'} side
 * @returns {string} CSS text ('' when nothing applies)
 */
export function normCssFor(steps, side) {
  const css = []
  if (steps.includes('harness') && side === 'ref') {
    // body > .bar ONLY — never the nested KPI .op-kpi__goal .bar.
    css.push('body > .bar{display:none !important}')
  }
  if (steps.includes('anim')) {
    // Both sides: freeze temporal noise (live-pulse ring measured at 20px).
    css.push('*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}')
  }
  if (steps.includes('dates')) {
    // Both sides, SAME elements, visibility (not display) to keep layout:
    // .op-top__date  — topbar date (OperatorShell.tsx:199 ↔ mocks, same class)
    // .op-dash__sub  — dated subtitle («Actualisé à HH:MM», agg label) — same class both sides
    css.push('.op-top__date,.op-dash__sub{visibility:hidden !important}')
  }
  return css.join('\n')
}

/**
 * Page script to run at capture time (ref side only).
 * @returns {string|null} JS text or null
 */
export function normScriptFor(steps, side) {
  if (side !== 'ref') return null
  if (!steps.includes('scale')) return null
  // setScale exists in 14/15 mocks (op-reorder has no harness nor set* —
  // the typeof guard makes this a no-op there, which the caller reports).
  return "typeof setScale === 'function' ? (setScale('single'), true) : false"
}
