import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  NORM_STEPS,
  parseNormSteps,
  normCssFor,
  normScriptFor,
} from '../scripts/qa/operator-qa-normalize.mjs'

// ── Mission baseline — capture-time normalizations (decisions ❶❺❻❼) ─────────
// The refs and the product are NEVER modified: everything is injected at the
// screenshot only. These tests prove the pure module and the robot wiring.

describe('parseNormSteps — étapes validées, ordre canonique', () => {
  it('empty env → no normalization (the robot behaves exactly as before)', () => {
    expect(parseNormSteps(undefined)).toEqual([])
    expect(parseNormSteps('')).toEqual([])
  })
  it('canonical order regardless of input order', () => {
    expect(parseNormSteps('dates,harness')).toEqual(['harness', 'dates'])
    expect(parseNormSteps('harness,scale,anim,dates')).toEqual(NORM_STEPS)
  })
  it('an unknown step THROWS — a typo must never silently skip a normalization', () => {
    expect(() => parseNormSteps('harness,darkmode')).toThrow(/inconnues/)
  })
})

describe('normCssFor — le bon masque du bon côté', () => {
  it('harness hides body > .bar on the REF side only — never the nested KPI bar', () => {
    const ref = normCssFor(['harness'], 'ref')
    expect(ref).toContain('body > .bar{display:none !important}')
    // the selector is CHILD-scoped: '.bar{' alone (which would catch the
    // .op-kpi__goal .bar progress bar of op-dashboard) must not appear.
    expect(ref).not.toMatch(/(^|[^>] )\.bar\{/)
    expect(normCssFor(['harness'], 'app')).toBe('')
  })
  it('anim freezes animations and transitions on BOTH sides', () => {
    for (const side of ['app', 'ref'] as const) {
      const css = normCssFor(['anim'], side)
      expect(css).toContain('animation:none !important')
      expect(css).toContain('transition:none !important')
    }
  })
  it('dates hides the SAME elements on BOTH sides — a one-sided mask would create the gap it claims to remove', () => {
    const app = normCssFor(['dates'], 'app')
    const ref = normCssFor(['dates'], 'ref')
    expect(app).toContain('.op-top__date,.op-dash__sub{visibility:hidden !important}')
    expect(ref).toContain('.op-top__date,.op-dash__sub{visibility:hidden !important}')
    // visibility (keeps layout), never display (would reflow one side)
    expect(app).not.toContain('.op-top__date,.op-dash__sub{display')
  })
})

describe('normScriptFor — échelle pilotée côté ref uniquement', () => {
  it("scale drives setScale('single') on the ref, guarded for mocks without a harness (op-reorder)", () => {
    const s = normScriptFor(['scale'], 'ref')
    expect(s).toContain("setScale('single')")
    expect(s).toContain("typeof setScale === 'function'")
  })
  it('never on the app side, never without the scale step', () => {
    expect(normScriptFor(['scale'], 'app')).toBeNull()
    expect(normScriptFor(['harness', 'anim', 'dates'], 'ref')).toBeNull()
  })
})

describe('le robot est câblé aux normalisations', () => {
  const robotSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'qa', 'operator-visual-qa.mjs'), 'utf8',
  )
  it('imports the module and parses QA_NORM once (throwing on typos)', () => {
    expect(robotSrc).toContain("from './operator-qa-normalize.mjs'")
    expect(robotSrc).toContain('parseNormSteps(process.env.QA_NORM)')
  })
  it('applies per SIDE — app shot and ref shot are distinct', () => {
    expect(robotSrc).toContain("await shoot(browser, BASE + screen.url, vp, sessionCookie, 'app')")
    expect(robotSrc).toContain("await shoot(browser, refUrl, vp, null, 'ref')")
    expect(robotSrc).toContain('normScriptFor(NORM, side)')
    expect(robotSrc).toContain('normCssFor(NORM, side)')
  })
  it('records the audit fields: normApplied, refScaleApplied, comparedFraction, ignoredRefPx, diffBox', () => {
    for (const field of ['rec.normApplied', 'rec.refScaleApplied', 'rec.comparedFraction', 'rec.ignoredRefPx', 'rec.diffBox']) {
      expect(robotSrc).toContain(field)
    }
    // the compared fraction also reaches the console table
    expect(robotSrc).toContain("'ref cmp%'")
  })
  it('normalization happens between settle and probe/screenshot (capture-time only)', () => {
    const settleIdx = robotSrc.indexOf('settle fonts / late paints')
    const normIdx = robotSrc.indexOf('normScriptFor(NORM, side)')
    const probeIdx = robotSrc.indexOf('page.evaluate(domProbe)')
    expect(settleIdx).toBeGreaterThan(0)
    expect(normIdx).toBeGreaterThan(settleIdx)
    expect(probeIdx).toBeGreaterThan(normIdx)
  })
})
