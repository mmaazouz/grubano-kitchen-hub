import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ── GEOLOCATION ACQUISITION ON /eat (production bug, grubano.com/fr/eat) ─────
//
// WHAT WAS WRONG. Three separate defects, reported as one symptom.
//
// 1. THE DEAD BUTTON. « Utiliser ma position actuelle » lives INSIDE `.step-search`
//    (components/eat/geoloc.css keeps every step in the DOM and reveals one through
//    `data-step`). Its handler's only action, when a position was already held, was
//    `setStep('search')` — the step the button itself is on. A pure no-op: no acquisition,
//    no feedback, the sheet unchanged. That is exactly « aucun feedback visible, modal
//    toujours ouvert ».
//
// 2. ONE ATTEMPT, EIGHT SECONDS, NO FALLBACK. The options were a single
//    `{ enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 }`. A cold
//    acquisition can need far longer — proven in the browser console on the affected
//    machine, where `{ highAccuracy: true, maximumAge: 0, timeout: 10_000 }` returned
//    TIMEOUT and `{ highAccuracy: false, maximumAge: 60_000, timeout: 30_000 }` succeeded.
//    (Two variables moved between those tests, so neither alone is proven decisive; the fix
//    therefore does not rely on attributing it to one.)
//
// 3. A TIMEOUT WAS REPORTED AS A MISSING CAPABILITY. `err.code === PERMISSION_DENIED ?
//    'denied' : 'unavailable'` folded TIMEOUT into `unavailable`, which /eat renders as
//    « la géolocalisation n'est pas disponible sur cet appareil » — false about a device
//    that locates itself perfectly well — and which BOTH controls used to disable
//    themselves. One slow fix locked the user out until a page reload.
//
// HOW THIS IS PROVEN. The retry rule is a pure exported function (`geoAfterError`) and the
// two option objects are exported constants, so every case below runs the real decision and
// reads the real values rather than a copy of them. The sequencing of the two attempts is
// modelled, because that part is control flow inside a callback; the source pins at the end
// hold the real files to it, and the mutation battery is what makes those pins non-vacuous.

import {
  geoAfterError, GEO_ATTEMPT_1, GEO_ATTEMPT_2, GEO_ERR, type GeoStatus,
  // THE REAL LOCK, not a copy: `geoBeginAcquisition` is what actually refuses a second
  // concurrent acquisition in the hook, so the concurrency cases call it rather than
  // restating its rule. `__resetGeoOwner` clears it (and the epoch) between cases.
  geoBeginAcquisition, geoEndAcquisition, getGeoEpoch, __resetGeoOwner,
} from '@/lib/use-geolocation'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/** Drop whole-line // comments first, then block and JSX comments. */
function executable(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
}
const HOOK = 'lib/use-geolocation.ts'
const SHEET = 'components/eat/GeolocSheet.tsx'
const HOME = 'app/[locale]/eat/page.tsx'
const SEARCH = 'app/[locale]/eat/search/page.tsx'

/**
 * MODELLED: only which callback the platform fires and when. Every DECISION is the real
 * exported one — `geoAfterError` for the retry rule, and the real GEO_ATTEMPT_* objects for
 * what each attempt asks the platform for.
 */
function mountAcquisition(opts: { supported?: boolean } = {}) {
  const supported = opts.supported !== false
  let status: GeoStatus = 'idle'
  let coords: { lat: number; lng: number } | null = null
  const asked: PositionOptions[] = []
  let pending: { attempt: 1 | 2 } | null = null

  function attemptWith(attempt: 1 | 2): void {
    asked.push(attempt === 1 ? GEO_ATTEMPT_1 : GEO_ATTEMPT_2)
    pending = { attempt }
  }

  function request(): void {
    if (!supported) { status = 'unsupported'; return }
    // THE REAL ADMISSION DECISION. A second click joins the acquisition already running
    // instead of starting another one.
    if (!geoBeginAcquisition(getGeoEpoch())) return
    status = 'requesting'
    attemptWith(1)
  }

  /** The platform answers the attempt in flight. */
  function succeed(lat: number, lng: number): void {
    if (!pending) throw new Error('no attempt in flight')
    pending = null
    geoEndAcquisition()
    coords = { lat, lng }
    status = 'granted'
  }
  function fail(code: number): void {
    if (!pending) throw new Error('no attempt in flight')
    const { attempt } = pending
    pending = null
    const outcome = geoAfterError(code, attempt)
    // the fallback is the SAME acquisition: the lock is deliberately kept
    if (outcome === 'retry') { attemptWith(2); return }   // status stays 'requesting'
    geoEndAcquisition()
    status = outcome
  }

  return {
    request,
    succeed,
    fail,
    get status() { return status },
    get coords() { return coords },
    get asked() { return asked },
    get inFlight() { return pending !== null },
    /** What the sheet and the banner derive from the hook. */
    get view() {
      return {
        geoOn: status === 'granted' && coords !== null,
        locating: status === 'requesting',
        // only a state that retrying genuinely cannot fix may disable a control
        controlsDisabled: status === 'requesting' || status === 'unsupported',
        retryOffered: status === 'timeout' || status === 'unavailable',
        manualEntryAvailable: true,   // the address field is never disabled — pinned below
        // WHAT IS ON SCREEN, by i18n key, derived the way the JSX derives it. The JSX is
        // pinned separately (every key, and the conditionals around them), so the two
        // together bind the real component rather than this model agreeing with itself.
        buttonLabelKey: status === 'requesting' ? 'locating' : 'useMyPosition',
        messageKey:
          status === 'requesting' ? 'locatingHint'
            : status === 'denied' ? 'errDenied'
              : status === 'timeout' ? 'errTimeout'
                : status === 'unsupported' ? 'errUnsupported'
                  : status === 'unavailable' ? 'errUnavailable'
                    : status === 'granted' && coords !== null ? 'statusOnSub'
                      : null,
      }
    },
  }
}

// ══ 1–8 : the mandated non-regression matrix ════════════════════════════════

// The lock and the epoch are module state in the real hook, so they are reset between
// cases — otherwise a case that leaves an acquisition in flight silently refuses the next
// case's first request, and every assertion after it would be measuring the wrong thing.
beforeEach(() => { __resetGeoOwner() })

describe('acquisition — the eight cases', () => {
  it('1 — immediate success: coordinates, geo on, nothing else attempted', () => {
    const a = mountAcquisition()
    a.request()
    expect(a.status).toBe('requesting')
    expect(a.asked).toEqual([GEO_ATTEMPT_1])
    a.succeed(45.764, 4.835)
    expect(a.status).toBe('granted')
    expect(a.coords).toEqual({ lat: 45.764, lng: 4.835 })
    expect(a.view.geoOn).toBe(true)
    expect(a.asked.length, 'the fallback is not used when the first attempt lands').toBe(1)
  })

  it('2 — the first attempt times out, the FALLBACK succeeds', () => {
    const a = mountAcquisition()
    a.request()
    a.fail(GEO_ERR.TIMEOUT)
    // the fallback is in flight and the screen still says « locating » — it does not flash
    // an error it is about to retract
    expect(a.asked).toEqual([GEO_ATTEMPT_1, GEO_ATTEMPT_2])
    expect(a.status).toBe('requesting')
    expect(a.view.locating).toBe(true)
    expect(a.inFlight).toBe(true)
    a.succeed(48.857, 2.352)
    expect(a.status).toBe('granted')
    expect(a.coords).toEqual({ lat: 48.857, lng: 2.352 })
    expect(a.view.geoOn).toBe(true)
  })

  it('3 — the user REFUSES: no retry, no re-prompt, and no retry offered', () => {
    const a = mountAcquisition()
    a.request()
    a.fail(GEO_ERR.PERMISSION_DENIED)
    expect(a.status).toBe('denied')
    expect(a.asked, 'a refusal is never retried — it would re-prompt').toEqual([GEO_ATTEMPT_1])
    expect(a.view.geoOn).toBe(false)
    expect(a.view.retryOffered, 'offering a retry on a refusal would be a lie').toBe(false)
    expect(a.view.controlsDisabled, 'but the user may still enable it in the browser').toBe(false)
    expect(a.view.manualEntryAvailable).toBe(true)
  })

  it('4 — POSITION_UNAVAILABLE: the fallback runs, then an honest retryable state', () => {
    const a = mountAcquisition()
    a.request()
    a.fail(GEO_ERR.POSITION_UNAVAILABLE)
    expect(a.asked).toEqual([GEO_ATTEMPT_1, GEO_ATTEMPT_2])
    a.fail(GEO_ERR.POSITION_UNAVAILABLE)
    expect(a.status).toBe('unavailable')
    expect(a.view.retryOffered).toBe(true)
    expect(a.view.controlsDisabled, 'transient: the control stays usable').toBe(false)
  })

  it('5 — a FINAL timeout: reported as a timeout, not as a device that cannot locate', () => {
    const a = mountAcquisition()
    a.request()
    a.fail(GEO_ERR.TIMEOUT)
    a.fail(GEO_ERR.TIMEOUT)
    expect(a.status, 'NOT `unsupported`, and NOT `unavailable`').toBe('timeout')
    expect(a.asked.length, 'two attempts, then it stops').toBe(2)
    expect(a.view.retryOffered).toBe(true)
    expect(a.view.controlsDisabled, 'THE LOCKOUT: this used to be true').toBe(false)
    expect(a.view.manualEntryAvailable).toBe(true)
  })

  it('6 — no false « Position activée » at any point before coordinates arrive', () => {
    const a = mountAcquisition()
    expect(a.view.geoOn).toBe(false)
    a.request()
    expect(a.view.geoOn, 'not while requesting').toBe(false)
    a.fail(GEO_ERR.TIMEOUT)
    expect(a.view.geoOn, 'not between the two attempts').toBe(false)
    a.fail(GEO_ERR.TIMEOUT)
    expect(a.view.geoOn, 'not after a final timeout').toBe(false)
    // every terminal failure, checked the same way
    for (const code of [GEO_ERR.PERMISSION_DENIED, GEO_ERR.POSITION_UNAVAILABLE, GEO_ERR.TIMEOUT]) {
      const b = mountAcquisition()
      b.request()
      b.fail(code)
      if (b.inFlight) b.fail(code)
      expect(b.view.geoOn, `code ${code}`).toBe(false)
      expect(b.coords, `code ${code}`).toBeNull()
    }
    // and an unsupported platform never claims it either
    const c = mountAcquisition({ supported: false })
    c.request()
    expect(c.status).toBe('unsupported')
    expect(c.view.geoOn).toBe(false)
    expect(c.asked, 'nothing is even asked of a platform that has no API').toEqual([])
  })

  it('7 — the sheet advances only once coordinates are held', () => {
    // The intent effect is keyed on `geoOn`, which requires coordinates; neither the step
    // nor the sheet's open state can therefore change on a `requesting` or a failed attempt.
    const a = mountAcquisition()
    a.request()
    expect(a.view.geoOn).toBe(false)         // no advance
    a.fail(GEO_ERR.TIMEOUT)
    expect(a.view.geoOn).toBe(false)         // still no advance
    a.succeed(45.1, 4.1)
    expect(a.view.geoOn, 'only now').toBe(true)
    const src = executable(read(SHEET))
    expect(src).toMatch(/const geoOn = status === 'granted' && !!coords/)
    expect(src).toMatch(
      /if \(!geoOn\) return\s*\n\s*const want = intent\.current\s*\n\s*if \(want === 'none'\) return\s*\n\s*intent\.current = 'none'/,
    )
  })

  it('8 — manual entry is available in every failure state', () => {
    // The address field sits on the same step as the button and is never disabled, so a
    // refusal, a timeout or an unavailable position always leaves a way through. EXACT SET
    // over the input's own attributes: adding a `disabled` here would break it.
    const src = executable(read(SHEET))
    const input = src.slice(src.indexOf('<input'), src.indexOf('placeholder={t(\'searchPlaceholder\')}'))
    expect(input.length, 'the search input was found').toBeGreaterThan(1)
    expect(src).toMatch(
      /<input\s*\n\s*value=\{query\}\s*\n\s*onChange=\{\(e\) => setQuery\(e\.target\.value\)\}\s*\n\s*placeholder=\{t\('searchPlaceholder'\)\}\s*\n\s*aria-label=\{t\('searchPlaceholder'\)\}\s*\n\s*\/>/,
    )
    for (const a of [
      mountAcquisition(), mountAcquisition(), mountAcquisition(), mountAcquisition({ supported: false }),
    ]) {
      a.request()
      expect(a.view.manualEntryAvailable).toBe(true)
    }
  })
})

// ══ 9–11 : concurrency, one implementation, and the visible transitions ═════

describe('9–11 — the three coverages a measurement showed were missing', () => {
  it('9 — a double click is ONE acquisition, and so are two mounted instances', () => {
    const a = mountAcquisition()
    a.request()
    a.request()                       // the user clicks again before anything answers
    a.request()
    expect(a.asked, 'one platform request, not three').toEqual([GEO_ATTEMPT_1])
    expect(a.status).toBe('requesting')
    a.succeed(45.1, 4.1)
    expect(a.coords).toEqual({ lat: 45.1, lng: 4.1 })
    // …and the lock is released, so a LATER deliberate re-acquisition still works
    a.request()
    expect(a.asked, 'a new gesture after the first finished does acquire').toEqual([
      GEO_ATTEMPT_1, GEO_ATTEMPT_1,
    ])

    // TWO INSTANCES, ONE LOCK. Every /eat page mounts the hook twice — the screen and the
    // « Livrer à » sheet — and both expose the same `request`. The lock is module state, so
    // it is shared: the second instance joins rather than opening its own request.
    __resetGeoOwner()
    const screen = mountAcquisition()
    const sheet = mountAcquisition()
    screen.request()
    sheet.request()
    expect(screen.asked).toEqual([GEO_ATTEMPT_1])
    expect(sheet.asked, 'the sheet did not open a second one').toEqual([])

    // and the lock is held ACROSS the fallback — the retry is the same acquisition
    __resetGeoOwner()
    const b = mountAcquisition()
    b.request()
    b.fail(GEO_ERR.TIMEOUT)
    expect(b.asked).toEqual([GEO_ATTEMPT_1, GEO_ATTEMPT_2])
    b.request()
    expect(b.asked, 'a click during the fallback starts nothing new').toEqual([
      GEO_ATTEMPT_1, GEO_ATTEMPT_2,
    ])
  })

  it('10 — there is exactly ONE acquisition implementation in the app', () => {
    // « réutiliser la même fonction d'acquisition que le reste du parcours afin d'éviter
    // deux implémentations divergentes ». The sheet's button goes through the hook's own
    // `request`; it does not call the platform itself. Proven by scanning the app rather
    // than by reading the one file: a second implementation would be somewhere else.
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const hits = execFileSync('git', ['grep', '-l', 'getCurrentPosition', '--', '*.ts', '*.tsx'], {
      cwd: process.cwd(), encoding: 'utf8',
    }).trim().split('\n').filter(Boolean).filter((f) => !f.startsWith('tests/'))
    expect(hits, 'one source file may call the platform geolocation API').toEqual([HOOK])
    // and the sheet reaches it only through the hook's returned `request`
    const sheet = executable(read(SHEET))
    expect(sheet).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(sessionStamp\)/)
    expect(sheet, 'no navigator access in the component').not.toMatch(/navigator\./)
    expect(sheet.split('\n').map((l) => l.trim()).filter((l) => /(^|[^\w.])request\(\)/.test(l))).toEqual([
      'request()',        // toggleGeo, when turning it on
      'request()',        // useMyPosition
      'request()',        // the footer CTA
    ])
  })

  it('11 — the VISIBLE sequence of a timeout-then-retry-then-success, as the user sees it', () => {
    // Not the internal statuses: the label on the button, the message under it, whether a
    // retry is offered, and whether the address field is still usable.
    const a = mountAcquisition()
    const seen: Array<[string, string | null, boolean]> = []
    const snap = () => seen.push([a.view.buttonLabelKey, a.view.messageKey, a.view.retryOffered])

    snap()                                  // the sheet has just opened
    a.request(); snap()                     // the user taps « Utiliser ma position actuelle »
    a.fail(GEO_ERR.TIMEOUT); snap()         // the quick attempt gives up — still locating
    a.fail(GEO_ERR.TIMEOUT); snap()         // the fallback gives up too
    a.request(); snap()                     // the user taps « Réessayer »
    a.succeed(45.764, 4.835); snap()        // and this time it lands

    expect(seen).toEqual([
      ['useMyPosition', null, false],
      ['locating', 'locatingHint', false],
      ['locating', 'locatingHint', false],   // the fallback does NOT flash an error
      ['useMyPosition', 'errTimeout', true], // an honest timeout, and a way out
      ['locating', 'locatingHint', false],   // the retry really re-acquires
      ['useMyPosition', 'statusOnSub', false], // a visible success, not silence
    ])
    expect(a.view.geoOn, 'and only now is the position active').toBe(true)
    // the one thing that never changes through all of it
    expect(seen.length).toBe(6)
    expect(a.view.manualEntryAvailable).toBe(true)
  })
})


// ══ 12–13 : the two round-4 corrections ═════════════════════════════════════

/**
 * The sheet's three intents, on top of the acquisition model. The decisions are still the
 * real ones (`geoAfterError`, `geoBeginAcquisition`); what is modelled here is the effect
 * that reads the intent once a valid fix lands — control flow around a ref, which has no
 * decision to export. The source is bound separately by the EXACT SET over every `intent`
 * line and by the anchor on the effect body.
 */
function mountSheet() {
  const acq = mountAcquisition()
  let modalOpen = true
  let step: 'perm' | 'search' | 'map' = 'perm'
  let intent: 'none' | 'advance' | 'close' = 'none'
  let effectRuns = 0
  let lastGeoOn = false

  /** The effect: runs when `geoOn` changes, reads the intent once and consumes it. */
  const flush = () => {
    const geoOn = acq.view.geoOn
    if (geoOn === lastGeoOn) return        // React: an effect keyed on [geoOn] does not re-run
    lastGeoOn = geoOn
    effectRuns += 1
    if (!geoOn) return
    const want = intent
    if (want === 'none') return
    intent = 'none'
    if (want === 'close') modalOpen = false
    else step = 'search'
  }
  /** A reverse-geocode enrichment: the SAME fix gains a label. `geoOn` does not change. */
  const enrich = () => { flush() }

  return {
    acq,
    openSheet() { modalOpen = true; step = 'perm'; intent = 'none' },
    later() { step = 'search' },                       // « Plus tard — saisir une adresse »
    toggleSwitch() { intent = 'none'; acq.request(); flush() },
    footerCta() { intent = 'advance'; acq.request(); flush() },
    useMyPosition() { intent = 'close'; acq.request(); flush() },
    settle(fn: () => void) { fn(); flush() },
    enrich,
    get view() { return { modalOpen, step, intent, effectRuns, ...acq.view } },
  }
}

describe('12 — the sheet closes on a fix it was asked for, and only then', () => {
  it('« Utiliser ma position actuelle » + success ⇒ the modal closes', () => {
    const sh = mountSheet()
    sh.openSheet(); sh.later()
    sh.useMyPosition()
    expect(sh.view.modalOpen, 'still open while locating').toBe(true)
    expect(sh.view.locating).toBe(true)
    sh.settle(() => sh.acq.succeed(45.764, 4.835))
    expect(sh.view.modalOpen, 'a valid fix completes the selection').toBe(false)
    expect(sh.view.geoOn).toBe(true)
  })

  it('…and the RAW fix is enough: closing does not wait for the reverse-geocode', () => {
    const sh = mountSheet()
    sh.openSheet(); sh.later()
    sh.useMyPosition()
    sh.settle(() => sh.acq.succeed(45.764, 4.835))
    expect(sh.view.modalOpen).toBe(false)
    // the label lands afterwards; nothing about the close depended on it
    expect(sh.acq.coords, 'the raw fix is what completed the selection').toEqual({ lat: 45.764, lng: 4.835 })
  })

  it('a LATE reverse-geocode cannot close the sheet a second time', () => {
    const sh = mountSheet()
    sh.openSheet(); sh.later()
    sh.useMyPosition()
    sh.settle(() => sh.acq.succeed(45.764, 4.835))
    expect(sh.view.modalOpen).toBe(false)
    const runs = sh.view.effectRuns
    sh.openSheet()                       // the user re-opens it by hand
    expect(sh.view.modalOpen).toBe(true)
    sh.enrich()                          // …and only now the postal label arrives
    sh.enrich()
    expect(sh.view.modalOpen, 'the intent was consumed; nothing closes it again').toBe(true)
    expect(sh.view.effectRuns, '`geoOn` did not change, so the effect did not even run').toBe(runs)
  })

  it('a failure NEVER closes the sheet — timeout, refusal or unavailable', () => {
    for (const script of [['timeout', 'timeout'], ['denied'], ['unavailable', 'unavailable']]) {
      const sh = mountSheet()
      sh.openSheet(); sh.later()
      sh.useMyPosition()
      sh.settle(() => { sh.acq.fail(script[0] === 'denied' ? GEO_ERR.PERMISSION_DENIED
        : script[0] === 'timeout' ? GEO_ERR.TIMEOUT : GEO_ERR.POSITION_UNAVAILABLE) })
      if (sh.acq.inFlight) sh.settle(() => sh.acq.fail(script[1] === 'timeout' ? GEO_ERR.TIMEOUT : GEO_ERR.POSITION_UNAVAILABLE))
      expect(sh.view.modalOpen, script.join('+')).toBe(true)
      expect(sh.view.step, script.join('+')).toBe('search')
      expect(sh.view.geoOn, script.join('+')).toBe(false)
      expect(sh.view.manualEntryAvailable, script.join('+')).toBe(true)
    }
  })

  it('the SWITCH never closes and never navigates; the step-1 button advances', () => {
    // « ne ferme PAS arbitrairement le modal lors d'une activation via le simple switch »
    const bySwitch = mountSheet()
    bySwitch.openSheet()
    bySwitch.toggleSwitch()
    bySwitch.settle(() => bySwitch.acq.succeed(45.7, 4.8))
    expect(bySwitch.view.modalOpen, 'the switch only reflects state').toBe(true)
    expect(bySwitch.view.step, 'and does not navigate either').toBe('perm')

    const byCta = mountSheet()
    byCta.openSheet()
    byCta.footerCta()
    byCta.settle(() => byCta.acq.succeed(45.7, 4.8))
    expect(byCta.view.modalOpen, 'the step-1 button moves the user on, it does not finish').toBe(true)
    expect(byCta.view.step).toBe('search')
  })

  it('EXACT SET — every line naming the intent, so a fourth meaning cannot appear unseen', () => {
    const src = executable(read(SHEET))
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /(?<![\w$])intent(?![\w$])/.test(l))).toEqual([
      "const intent = useRef<'none' | 'advance' | 'close'>('none')",
      "intent.current = 'none'",                 // reset when the sheet opens
      'const want = intent.current',             // read ONCE in the effect
      "intent.current = 'none'          // consumed exactly once",
      "intent.current = 'none' // the switch only reflects state: never navigate, never close",
      "intent.current = 'close'",                // « Utiliser ma position actuelle »
      "intent.current = 'advance'",              // the step-1 primary button
    ])
    // the effect acts only on a valid fix, and consumes the intent BEFORE acting
    expect(src).toMatch(
      /if \(!geoOn\) return\s*\n\s*const want = intent\.current\s*\n\s*if \(want === 'none'\) return\s*\n\s*intent\.current = 'none'[^\n]*\n\s*if \(want === 'close'\) onClose\(\)\s*\n\s*else setStep\('search'\)/,
    )
    // MEASURED — four sites, in file order: the intent effect, Escape, the address
    // confirmation (which already closed the sheet), and the « gérer mes adresses » link.
    // A fifth would be a new way to close the sheet, and has to be looked at.
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /onClose\(\)/.test(l))).toEqual([
      "if (want === 'close') onClose()",
      "if (e.key === 'Escape') onClose()",
      'onClose()',
      "onClick={() => { onClose(); router.push('/eat/account/addresses') }}",
    ])
  })
})

describe('13 — a reverse-geocode enrichment must not re-fire the catalogue', () => {
  /** The effect's trigger, modelled both ways, to show what the dep change buys. */
  const runsFor = (dep: 'object' | 'numbers', fixes: Array<{ lat: number; lng: number; label?: string }>) => {
    let fetches = 0
    let prev: string | null = null
    for (const f of fixes) {
      const key = dep === 'object'
        ? JSON.stringify(f)                      // a new object identity every time
        : `${f.lat},${f.lng}`                    // the two numbers only
      if (key !== prev) { fetches += 1; prev = key }
    }
    return fetches
  }

  it('same lat/lng + a new label ⇒ ONE fetch (it used to be two)', () => {
    const sequence = [
      { lat: 45.764, lng: 4.835 },                                        // the raw fix
      { lat: 45.764, lng: 4.835, label: '16 Rue de la République 69002 Lyon' },  // enriched
    ]
    expect(runsFor('object', sequence), 'the old dependency').toBe(2)
    expect(runsFor('numbers', sequence), 'the new one').toBe(1)
  })

  it('a real move ⇒ a new fetch, so the saving is not a loss of freshness', () => {
    expect(runsFor('numbers', [
      { lat: 45.764, lng: 4.835 },
      { lat: 45.764, lng: 4.835, label: 'a' },
      { lat: 48.857, lng: 2.352 },                 // the user actually moved
      { lat: 48.857, lng: 2.352, label: 'b' },
    ])).toBe(2)
    // a change in EITHER number is enough
    expect(runsFor('numbers', [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }])).toBe(2)
    expect(runsFor('numbers', [{ lat: 1, lng: 2 }, { lat: 9, lng: 2 }])).toBe(2)
  })

  it('both surfaces take the position as numbers, and keep every owner/alive guard', () => {
    for (const [file, deps] of [
      [HOME, '[lat, lng, liveOwner]'],
      [SEARCH, '[query, cuisine, sort, lat, lng, favsOwner]'],
    ] as const) {
      const src = executable(read(file))
      expect(src, file).toMatch(/const lat = coords\?\.lat \?\? null\s*\n\s*const lng = coords\?\.lng \?\? null/)
      expect(src, file).toMatch(/if \(lat !== null && lng !== null\) \{\s*\n\s*sp\.set\('lat', String\(lat\)\)\s*\n\s*sp\.set\('lng', String\(lng\)\)/)
      expect(src.includes(`}, ${deps})`), `${file} deps ${deps}`).toBe(true)
      // the guards from the earlier rounds are untouched: the owner stamp and the
      // invalidation flag still wrap every commit
      expect(src, file).toMatch(/let alive = true/)
      expect(src, file).toMatch(/return \(\) => \{ alive = false \}/)
      expect(src, file).toMatch(/owner: requestOwner/)
    }
    // …and the position still reaches those numbers only through the GATE: `lat`/`lng` are
    // derived FROM `coords`, which the hook returns as null unless its owner is the live one.
    expect(executable(read(HOME))).toMatch(/const \{ coords, status, request, clear \} = useGeolocation\(liveOwner\)/)
    expect(executable(read(SEARCH))).toMatch(/const \{ coords \} = useGeolocation\(favsOwner\)/)
  })
})

// ══ the retry rule itself, every input ══════════════════════════════════════

describe('geoAfterError — the real decision, all six combinations', () => {
  it('a refusal is terminal on either attempt; the other two retry once', () => {
    expect(geoAfterError(GEO_ERR.PERMISSION_DENIED, 1)).toBe('denied')
    expect(geoAfterError(GEO_ERR.PERMISSION_DENIED, 2)).toBe('denied')
    expect(geoAfterError(GEO_ERR.TIMEOUT, 1)).toBe('retry')
    expect(geoAfterError(GEO_ERR.POSITION_UNAVAILABLE, 1)).toBe('retry')
    expect(geoAfterError(GEO_ERR.TIMEOUT, 2)).toBe('timeout')
    expect(geoAfterError(GEO_ERR.POSITION_UNAVAILABLE, 2)).toBe('unavailable')
  })

  it('an unknown code is not silently treated as a refusal', () => {
    // A platform that invents a code must not be read as « the user said no », which would
    // suppress the retry AND tell the user they refused something they never saw.
    expect(geoAfterError(99, 1)).toBe('retry')
    expect(geoAfterError(99, 2)).toBe('unavailable')
    expect(geoAfterError(0, 2)).toBe('unavailable')
  })

  it('the fallback is strictly more permissive than the first attempt, on both axes', () => {
    // Read off the real exported objects. If a future edit tightens the fallback, the
    // fallback stops being one.
    expect(GEO_ATTEMPT_2.timeout!).toBeGreaterThan(GEO_ATTEMPT_1.timeout!)
    expect(GEO_ATTEMPT_2.maximumAge!).toBeGreaterThan(GEO_ATTEMPT_1.maximumAge!)
    expect(GEO_ATTEMPT_1.enableHighAccuracy, 'a list ordered by proximity does not need GPS-grade precision').toBe(false)
    expect(GEO_ATTEMPT_2.enableHighAccuracy).toBe(false)
    // the console evidence from the affected machine: 10s was not enough for a cold fix,
    // 30s was. The fallback must be at least that patient.
    expect(GEO_ATTEMPT_2.timeout!).toBeGreaterThanOrEqual(30_000)
    // …and the quick attempt must stay quick, or the fallback arrives too late to matter
    expect(GEO_ATTEMPT_1.timeout!).toBeLessThanOrEqual(10_000)
  })
})

// ══ the real files, pinned ══════════════════════════════════════════════════

describe('the source really implements this', () => {
  it('POSITIVE CONTROL — the stripper left the code being judged', () => {
    for (const f of [HOOK, SHEET, HOME]) {
      expect(executable(read(f)).includes('status'), f).toBe(true)
    }
    expect(read(HOOK)).toContain('// THE PROMPT CAN SIT OPEN FOR MINUTES.')
    expect(executable(read(HOOK))).not.toContain('// THE PROMPT CAN SIT OPEN FOR MINUTES.')
  })

  it('the hook runs TWO attempts, and the second only on a retry verdict', () => {
    const src = executable(read(HOOK))
    // the attempt function takes the attempt number and picks the real options by it
    expect(src).toMatch(
      /const attemptWith = \(attempt: 1 \| 2\) => navigator\.geolocation\.getCurrentPosition\(/,
    )
    expect(src).toMatch(/attempt === 1 \? GEO_ATTEMPT_1 : GEO_ATTEMPT_2,/)
    expect(src).toMatch(/\n\s*attemptWith\(1\)\s*\n/)
    // the error path goes through the exported decision, and ONLY `retry` re-attempts
    expect(src).toMatch(
      /const outcome = geoAfterError\(err\.code, attempt\)\s*\n\s*if \(outcome === 'retry'\) \{/,
    )
    // ANCHORED THROUGH THE RELEASE. The lock is held across the fallback — the retry is the
    // same acquisition — and released only at the terminal commit. Asserting the whole
    // sequence in one expression is what fixes WHERE the release sits: a release moved up
    // beside `attemptWith(2)` would let a click during the fallback start a second one.
    expect(src).toMatch(
      /attemptWith\(2\)\s*\n\s*return\s*\n\s*\}\s*\n\s*geoEndAcquisition\(\)\s*\n\s*commit\(\{ status: outcome \}\)/,
    )
    // EXACT SET over the lock's own call sites, so neither can be added or moved unseen
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /geo(Begin|End)Acquisition\(/.test(l))).toEqual([
      'export function geoBeginAcquisition(requestEpoch: number): boolean {',
      'export function geoEndAcquisition(): void {',
      'geoEndAcquisition()',                               // geoInvalidateInFlight
      'if (!geoBeginAcquisition(requestEpoch)) return',    // admission, before `requesting`
      'geoEndAcquisition()',                               // terminal: success
      'geoEndAcquisition()',                               // terminal: final failure
    ])
    // admission happens BEFORE the status is announced, so a refused second click cannot
    // even flip the screen into « locating »
    expect(src).toMatch(
      /if \(!geoBeginAcquisition\(requestEpoch\)\) return\s*\n\s*commit\(\{ status: 'requesting' \}\)/,
    )
    // EXACT SET, MEASURED. The declaration is NOT in it: it reads `attemptWith = (`, which
    // a search for `attemptWith(` cannot match — the same trap as `, setStep]` below. These
    // are the two call sites, so a third cannot be added unseen.
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /attemptWith\(/.test(l))).toEqual([
      'attemptWith(2)',
      'attemptWith(1)',
    ])
    // the magic numbers are named, and the decision is not restated anywhere
    expect(src).toMatch(/if \(code === GEO_ERR\.PERMISSION_DENIED\) return 'denied'/)
    expect(src, 'the old single-attempt option literal is gone').not.toMatch(/timeout: 10_000/)
    expect(src, 'and TIMEOUT is no longer folded into unavailable')
      .not.toMatch(/err\.code === err\.PERMISSION_DENIED \? 'denied' : 'unavailable'/)
    // a missing API is `unsupported`, not `unavailable`
    expect(src).toMatch(
      /if \(typeof navigator === 'undefined' \|\| !navigator\.geolocation\) \{\s*\n\s*commit\(\{ status: 'unsupported' \}\)/,
    )
  })

  it('the modal button ACQUIRES — it no longer navigates to the step it is on', () => {
    const src = executable(read(SHEET))
    // the handler, whole: no setStep, and the acquisition is unconditional
    expect(src).toMatch(
      /const useMyPosition = useCallback\(\(\) => \{\s*\n\s*intent\.current = 'close'\s*\n\s*request\(\)\s*\n\s*\}, \[request\]\)/,
    )
    // and the button that calls it is the one inside the SEARCH step — which is why
    // setStep('search') was a no-op. EXACT SET over every setStep call in the file, so a
    // future edit cannot quietly put one back into this handler.
    // MEASURED. The useState declaration is NOT in this set: it reads `, setStep]`, which a
    // search for `setStep(` cannot match. Six sites — the open reset, the grant
    // auto-advance, pickSaved, the two header back-arrows, and the footer « Continuer ».
    // NONE of them is in `useMyPosition` any more, which is the whole point of the fix.
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /setStep\(/.test(l))).toEqual([
      "setStep('perm')",
      "else setStep('search')",
      "setStep('map')",
      "const headBack = step === 'map' ? () => setStep('search') : step === 'search' ? () => setStep('perm') : null",
      "setStep('search')",
      "onClick={() => setStep('search')}",
    ])
  })

  it('the sheet renders progress and every failure, and disables only what it must', () => {
    const src = executable(read(SHEET))
    expect(src).toMatch(/\{status === 'requesting' && \(/)
    expect(src).toMatch(/role="status"/)
    expect(src).toMatch(/role="alert"/)
    for (const key of ['locating', 'locatingHint', 'errTimeout', 'errDenied', 'errUnavailable', 'errUnsupported', 'retry']) {
      expect(src, `the sheet uses t('${key}')`).toContain(`t('${key}')`)
    }
    // a retry is offered for the transient states ONLY
    expect(src).toMatch(/\{\(status === 'timeout' \|\| status === 'unavailable'\) && \(/)
    // AND A VISIBLE SUCCESS: without it the acquisition ended in silence on this step, the
    // button label simply reverting — which reads exactly like the dead button being fixed.
    expect(src).toMatch(/\{geoOn && \(\s*<p className="geo-loc-msg geo-loc-msg--ok" role="status">/)
    expect(src).toMatch(/<span>\{coords\?\.label \|\| t\('statusOnSub'\)\}<\/span>/)
    // EXACT SET over every `disabled` in the file: no control may be disabled by a
    // transient failure again. This is the lockout, pinned.
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /^disabled=/.test(l))).toEqual([
      "disabled={status === 'requesting' || status === 'unsupported'}",
      "disabled={status === 'requesting' || status === 'unsupported'}",
      "disabled={status === 'requesting' || status === 'unsupported'}",
    ])
  })

  it('the /eat banner stops claiming the device cannot locate itself', () => {
    const src = executable(read(HOME))
    expect(src).toMatch(/status === 'timeout'\s*\n\s*\? t\('geoBannerTimeout'\)/)
    expect(src).toMatch(/status === 'unsupported'\s*\n\s*\? t\('geoBannerUnsupported'\)/)
    expect(src).toMatch(/status === 'requesting'\s*\n\s*\? t\('geoBannerLocating'\)/)
    expect(src.split('\n').map((l) => l.trim()).filter((l) => /^disabled=\{status/.test(l))).toEqual([
      "disabled={status === 'requesting' || status === 'unsupported'}",
    ])
    // The position really is what drives proximity. It now enters the query as the two
    // NUMBERS derived from the gated object rather than the object itself, so that a
    // reverse-geocode enrichment — same place, new identity — does not re-run the fetch.
    expect(src).toMatch(/const lat = coords\?\.lat \?\? null\s*\n\s*const lng = coords\?\.lng \?\? null/)
    expect(src).toMatch(/sp\.set\('lat', String\(lat\)\)\s*\n\s*sp\.set\('lng', String\(lng\)\)/)
    expect(src).toMatch(/const geoActive = status === 'granted' && !!coords/)
  })

  it('the nine new strings exist in all five locales', () => {
    const keys = {
      'eat.geoloc': ['locating', 'locatingHint', 'errTimeout', 'errDenied', 'errUnavailable', 'errUnsupported', 'retry'],
      'eat.home': ['geoBannerLocating', 'geoBannerTimeout', 'geoBannerUnsupported', 'geoEnabling'],
    }
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as Record<string, never>
      for (const [path, names] of Object.entries(keys)) {
        const node = path.split('.').reduce<Record<string, unknown>>(
          (o, k) => o[k] as Record<string, unknown>, m as unknown as Record<string, unknown>,
        )
        for (const n of names) {
          expect(typeof node[n], `${loc} ${path}.${n}`).toBe('string')
          expect(String(node[n]).trim().length, `${loc} ${path}.${n} not empty`).toBeGreaterThan(1)
        }
      }
      // and the old wording moved: `geoBannerUnavailable` must no longer deny the capability
      const home = (m as unknown as { eat: { home: Record<string, string> } }).eat.home
      expect(home.geoBannerUnavailable, loc).not.toBe(home.geoBannerUnsupported)
    }
  })

  it('the saved-address path was not touched', () => {
    // « ne pas casser les adresses enregistrées » — the picking, the default commit and the
    // first-frame stamp guard are all unchanged by this fix.
    const src = executable(read(SHEET))
    expect(src).toMatch(/const stampOk = addrStamp !== null && addrStamp === sessionStamp/)
    expect(src).toMatch(/const visibleAddrs = stampOk \? addresses : \[\]/)
    expect(src).toMatch(/if \(shownPicked\) setDefaultAddress\(shownPicked\.id\)/)
    expect(src).toMatch(/const pickSaved = useCallback\(\(a: EatAddress\) => \{/)
  })
})
