// tests/prel11-money-write-guard.test.ts — T-90: EVERY financial Stripe write declares itself, and the
// declaration cannot be loose.
//
// THE DEFECT. The money-write recon confirmed from six independent directions that the product flags are
// read at CALLERS and nowhere else. lib/refund.ts's own header states the policy — « All routes are GATED
// by REFUNDS_ENABLED » — and lib/dispute.ts:341 states « called ONLY when CHARGEBACKS_ENABLED is ON (the
// webhook gates it) ». Both were TRUE and neither was ENFORCED: `executeRefund`,
// `finalizeRefundRowFromStripe` and `handleDisputeEvent` each reached `stripe.refunds.create` or
// `transfers.createReversal` with no flag consulted inside the module. An invariant that lives in a comment
// is one refactor away from being false, and the refactor that breaks it moves money.
//
// WHAT THIS FILE PROVES, in order of strength:
//   1. ENUMERATION — every financial write verb in lib/ and app/ is IMMEDIATELY preceded by
//      `assertMoneyWriteAllowed`. No allowlist, no exceptions. A new write site fails this test.
//   2. THE EXPRESSION — each `rail_open` / `dispute_rail_open` site passes the REAL gate
//      (`refundGateState().open`, `isRefundsEnabled()`, `isChargebacksEnabled()`), not a literal.
//   3. RUNTIME — the guard refuses a closed rail, and refuses a `completing_settled_movement` that cannot
//      name the movement. Both with negative AND positive controls.
//   4. THE EXCEPTION IS NAMED — the one authorization that bypasses every flag is the one that completes a
//      movement Stripe already made, it requires a proof id, and exactly one site in the repository uses it.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync, type Dirent, mkdtempSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertMoneyWriteAllowed,
  MoneyWriteRefused,
  FINANCIAL_STRIPE_WRITE_VERBS,
  PARTNER_PAYOUT_FLAGS,
} from '@/lib/stripe-money-guard'
import { refundGateState } from '@/lib/refund'
import { openRefundWindow, closeRefundWindow, openChargebackRail, closeChargebackRail } from './support/refund-window'

/** Files that may contain a financial Stripe write. Walked, not assumed: see the enumeration test. */
/* THE ORACLE WALKS THE FILESYSTEM, NOT A LIST — and this is the SECOND version.
   The first walked six hand-written filenames. FOUR independent reviewers pointed at the same hole within
   minutes: `lib/creator-payout.ts` calls `transfers.create` to pay a creator, an affiliate or a courier,
   from a rail a scheduled job can poke, and a six-file list could never see it. One of those six entries
   (`lib/payouts.ts`) did not even exist, and nothing said so.
   An allowlist is not an enumeration. It answers « are the writes I already knew about declared? » — which
   is exactly the question that cannot find the write you forgot. */
const SOURCE_ROOTS = ['lib', 'app', 'scripts']
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/
function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '__snapshots__') continue
      walk(full, out)
    } else if (CODE_EXT.test(e.name)) out.push(full.split(sep).join('/'))
  }
  return out
}
/** Every code file under lib/, app/ and scripts/. The breadth is asserted below, not assumed. */
const SOURCES = SOURCE_ROOTS.flatMap((r) => walk(r))
const read = (p: string) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n') } catch { return null } }

/* T-120 — WHY THE PROBES DO NOT WRITE INTO `lib/`.
   The first version of the T-118 probes created real files under `lib/` and deleted them straight after, the
   way the T-109 probe had always done. Running the FULL suite immediately failed three unrelated files with
   `ENOENT … lib/__t118_linebreak_probe__.ts`: vitest runs files in parallel workers, this repository has many
   suites that walk `lib/` and read every file they find, and a probe that exists for a few milliseconds is
   long enough to be LISTED by one of them and gone before it is READ. T-109 had the same hazard and was
   simply lucky; three more probes widened the window until it wasn't.
   A test that mutates the source tree is a test that can fail code it never meant to touch. So the probes now
   write into an OS temp directory and the SHIPPED `walk` / `writeSites` / `stripeAliasSites` are pointed at
   it — which still proves the mechanism (the real readdir, the real extension filter, the real normalisation,
   the real guard rule) and not merely the algorithm. What a temp root cannot prove — that the shipped roots
   really are `lib/`, `app/` and `scripts/` — is proven separately, and unconditionally, by the breadth
   assertions over the real `SOURCES` above. Two checkable halves, and no race. */
const sandbox = (): string => mkdtempSync(join(tmpdir(), 'grubano-oracle-'))

afterEach(() => { closeRefundWindow(); closeChargebackRail() })

// ══ 1. ENUMERATION — no financial write without a declaration ══════════════════════════════════════
describe('T-90 — every financial Stripe write in the repository declares itself', () => {
  /**
   * Find every call to a verb in FINANCIAL_STRIPE_WRITE_VERBS, anywhere under lib/ and app/, and return
   * {file, line, verb, guarded} for each. «Guarded» means an `assertMoneyWriteAllowed(` appears in the 30
   * lines above with no other call to the same verb in between — i.e. the declaration belongs to THIS write.
   */
  const writeSites = (files: string[] = SOURCES) => {
    const sites: Array<{ file: string; line: number; verb: string; guarded: boolean }> = []
    for (const file of files) {
      const src = read(file)
      if (src === null) continue
      // strip line comments and JSDoc bodies so a verb NAMED in prose is never counted as a call
      const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      /* T-118 — A LINE BREAK IS NOT A HIDING PLACE.
         The final invariant review measured that this match was per-LINE and literal, so
         `getStripe().transfers` + newline + `.create({...})` — valid, prettier-produced, and the shape any
         formatter will eventually impose on a long call — returned NO site at all. Not « unguarded »: absent.
         An oracle whose miss is silent is worse than no oracle, because the empty array reads as proof.
         So the file is flattened ONCE with an index→line map, then whitespace adjacent to `.` and before `(`
         is dropped while the map stays aligned. `a.b(` and `a\n  .b(` and `a . b (` become the same text, and
         the site is still reported at the line the receiver sits on. */
      const flatChars: string[] = []
      const flatLine:  number[] = []
      code.forEach((l, i) => { for (const ch of `${l}\n`) { flatChars.push(ch); flatLine.push(i) } })
      const normChars: string[] = []
      const normLine:  number[] = []
      for (let k = 0; k < flatChars.length; k++) {
        if (!/\s/.test(flatChars[k])) { normChars.push(flatChars[k]); normLine.push(flatLine[k]); continue }
        let m = k
        while (m < flatChars.length && /\s/.test(flatChars[m])) m++
        const prev = normChars.length ? normChars[normChars.length - 1] : ''
        const next = flatChars[m] ?? ''
        // whitespace that merely separates a receiver from `.verb(` carries no meaning — drop it
        if (!(prev === '.' || next === '.' || next === '(')) { normChars.push(' '); normLine.push(flatLine[k]) }
        k = m - 1
      }
      const norm = normChars.join('')
      for (const verb of FINANCIAL_STRIPE_WRITE_VERBS) {
        let at = norm.indexOf(`${verb}(`)
        while (at >= 0) {
          const i = normLine[at]
          const next = norm.indexOf(`${verb}(`, at + 1)
          at = next
          /* «GUARDED» IS NOT MERE PROXIMITY — and the first version of this oracle only pretended it was.
             Its docstring promised « no other call to the same verb in between » while the code simply
             searched the 30 lines above for a declaration. Two reviewers named the consequence: a second,
             entirely undeclared write placed just after a guarded one ADOPTS its neighbour's declaration and
             passes — the normal shape of lib/dispute.ts, which has two reversals. The clause is implemented
             now: the nearest preceding declaration must be CLOSER than the nearest preceding call to the
             same verb. The negative control below builds exactly that shape and requires a miss. */
          let declAt = -1, priorCallAt = -1
          for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
            if (declAt < 0 && code[j].includes('assertMoneyWriteAllowed(')) declAt = j
            if (priorCallAt < 0 && code[j].includes(`${verb}(`)) priorCallAt = j
            if (declAt >= 0 && priorCallAt >= 0) break
          }
          sites.push({ file, line: i + 1, verb, guarded: declAt >= 0 && declAt > priorCallAt })
        }
      }
    }
    return sites
  }

  /* T-118 — THE SECOND SHAPE: AN ALIASED RECEIVER.
     `const t = getStripe().transfers` followed by `t.create(...)` contains no financial verb as text, so no
     amount of whitespace normalisation can find it. Rather than teach the oracle to follow assignments —
     which would be a type-checker, and would fail silently the first time it met a shape it did not model —
     this asserts the much stronger and checkable property: the repository NEVER binds a Stripe namespace to
     a local identifier. If nobody can write `t.create(`, the blind spot has nothing to hide in. */
  const stripeAliasSites = (files: string[] = SOURCES) => {
    const hits: Array<{ file: string; line: number; alias: string }> = []
    const TAILS = Array.from(new Set(FINANCIAL_STRIPE_WRITE_VERBS.map((v) => v.split('.').pop()!)))
    for (const file of files) {
      const src = read(file)
      if (src === null) continue
      const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      // an identifier bound to getStripe() or to one of its namespaces
      const aliases = new Set<string>()
      code.forEach((l) => {
        const m = l.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=]*getStripe\(\)/)
        if (m) aliases.add(m[1])
      })
      if (aliases.size === 0) continue
      code.forEach((l, i) => {
        for (const a of Array.from(aliases)) {
          for (const tail of TAILS) {
            // `alias.create(` — a financial verb reached through a binding, invisible to the text oracle
            if (l.includes(`${a}.${tail}(`)) hits.push({ file, line: i + 1, alias: `${a}.${tail}` })
          }
        }
      })
    }
    return hits
  }

  it('the walk covers the whole source tree, and every file it names exists', () => {
    // The first version listed six files, one of which did not exist. A walk cannot name a missing file —
    // but it CAN silently cover nothing, so the breadth is asserted.
    expect(SOURCES.length, 'the walk found almost no files — it is not walking').toBeGreaterThan(400)
    for (const f of SOURCES.slice(0, 50)) expect(read(f), f).not.toBeNull()
    expect(SOURCES.some((f) => f.startsWith('lib/'))).toBe(true)
    expect(SOURCES.some((f) => f.startsWith('app/api/'))).toBe(true)
    expect(SOURCES.some((f) => f.startsWith('scripts/'))).toBe(true)
    expect(SOURCES.every((f) => !f.includes('node_modules'))).toBe(true)
    // and the file four reviewers found is now in scope, which a six-file list could never have been
    expect(SOURCES).toContain('lib/creator-payout.ts')
  })

  it('the walk FINDS the writes — an enumeration that found nothing would pass vacuously', () => {
    const sites = writeSites()
    // Measured at the time of writing: refunds.create ×2 (lib/refund.ts, lib/refunds.ts) and
    // transfers.createReversal ×3 (lib/refund.ts ×1, lib/dispute.ts ×2).
    expect(sites.length, JSON.stringify(sites)).toBeGreaterThanOrEqual(7)
    const verbs = new Set(sites.map((s) => s.verb))
    expect(verbs.has('refunds.create')).toBe(true)
    expect(verbs.has('transfers.createReversal')).toBe(true)
    expect(verbs.has('transfers.create')).toBe(true)
    const files = new Set(sites.map((s) => s.file))
    for (const f of ['lib/refund.ts', 'lib/refunds.ts', 'lib/dispute.ts', 'lib/franchise-settlement.ts', 'lib/creator-payout.ts']) {
      expect(files.has(f), f).toBe(true)
    }
  })

  it('EVERY one of them is preceded by assertMoneyWriteAllowed — no allowlist, no exception', () => {
    const naked = writeSites().filter((s) => !s.guarded)
    expect(naked, `undeclared financial Stripe write(s): ${JSON.stringify(naked)}`).toEqual([])
  })

  it('NEGATIVE CONTROL — a second write ADOPTING its neighbour\'s declaration is caught', () => {
    // Run the SHIPPED rule over a fabricated file, so the control and the oracle cannot drift apart.
    const fabricated = [
      "  assertMoneyWriteAllowed({ authorization: 'settlement_rail_open', railOpen: x })",
      '  const a = await getStripe().transfers.create({ amount: 1 })',
      '  const b = await getStripe().transfers.create({ amount: 2 })',
    ]
    const verdicts: Array<{ line: number; guarded: boolean }> = []
    fabricated.forEach((l, i) => {
      if (!l.includes('transfers.create(')) return
      let declAt = -1, priorCallAt = -1
      for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
        if (declAt < 0 && fabricated[j].includes('assertMoneyWriteAllowed(')) declAt = j
        if (priorCallAt < 0 && fabricated[j].includes('transfers.create(')) priorCallAt = j
        if (declAt >= 0 && priorCallAt >= 0) break
      }
      verdicts.push({ line: i + 1, guarded: declAt >= 0 && declAt > priorCallAt })
    })
    expect(verdicts).toEqual([{ line: 2, guarded: true }, { line: 3, guarded: false }])
    // …and the shipped oracle really implements that rule rather than proximity
    const self = read('tests/prel11-money-write-guard.test.ts')!
    // Asserted on the FUNCTION's body, not on the file: a test file that quotes the old expression in
    // order to ban it would ban itself. (It just did — hence this note.)
    /* Anchored on the NAME, not on the signature: T-118 added a `files` parameter and this pin silently
       sliced an EMPTY string, so every `toContain` below passed vacuously for one run. A pin that can match
       nothing is not a pin. The anchor is asserted before it is used. */
    const fnAt = self.indexOf('const writeSites = (')
    expect(fnAt, 'the pin lost its anchor — writeSites was renamed or re-signed').toBeGreaterThan(0)
    const fn = self.slice(fnAt, self.indexOf("  it('the walk covers"))
    expect(fn.length, 'the pinned slice is empty — it would pass every assertion below vacuously').toBeGreaterThan(400)
    expect(fn).toContain('guarded: declAt >= 0 && declAt > priorCallAt')
    expect(fn).not.toContain('above.includes(')
    expect(fn).toContain('if (priorCallAt < 0 && code[j].includes(`${verb}(`)) priorCallAt = j')
  })

  it('T-120 — no probe in this file ever writes into the SOURCE tree (the race that broke three suites)', () => {
    /* The rule, pinned so it cannot come back: every `writeFileSync` here targets a sandbox path. vitest runs
       files in parallel workers and this repository is full of suites that walk lib/ and read what they list,
       so a probe living inside the source tree for a few milliseconds is a real, intermittent failure in code
       that has nothing to do with money. It happened; the ENOENT named three innocent files. */
    const self = readFileSync('tests/prel11-money-write-guard.test.ts', 'utf8')
    const writes = Array.from(self.matchAll(/writeFileSync\(([^,]+),/g)).map((m) => m[1].trim())
    expect(writes.length, 'the probes vanished — this assertion would then be vacuous').toBeGreaterThanOrEqual(4)
    for (const target of writes) {
      // every one is the `probe` binding, and every `probe` binding is built from `sandbox()`
      expect(target, 'a probe writes somewhere other than the sandboxed `probe` path').toBe('probe')
    }
    /* The needle is BUILT, not written: a literal `const probe = ` in this file would match ITSELF — which is
       exactly how this assertion first failed, reporting its own regex source as a probe path. Third time a
       source-scanning test in this repository has had to be taught not to read itself. */
    const BT = String.fromCharCode(96)
    const decls = Array.from(self.matchAll(new RegExp('const ' + 'probe = ' + BT + '([^' + BT + ']+)' + BT, 'g')))
    const probeDecls = decls.map((m) => m[1])
    expect(probeDecls.length).toBeGreaterThanOrEqual(4)
    for (const d of probeDecls) expect(d, 'a probe path is not rooted in the sandbox').toContain('${dir}/')
    expect(self).not.toMatch(/const probe = 'lib\//)
  })

  it('T-118 — a LINE-BROKEN call is CAUGHT (real file, shipped walk), because a formatter is not an exploit', () => {
    /* The shape the final invariant review measured as INVISIBLE: receiver on one line, `.verb(` on the next.
       Written as a real file so the SHIPPED walk and the SHIPPED normalisation are what gets tested — the
       hardening is worthless if only a string fixture exercises it. */
    const dir = sandbox()
    const probe = `${dir}/__t118_linebreak_probe__.ts`
    const body = [
      '// Deleted by tests/prel11-money-write-guard.test.ts immediately after the assertion below.',
      "import { getStripe } from '@/lib/stripe'",
      'export async function payAcrossTwoLines(dest: string) {',
      '  return getStripe().transfers',
      '    .create({ amount: 100, currency: "eur", destination: dest })',
      '}',
      '',
    ].join('\n')
    writeFileSync(probe, body, 'utf8')
    try {
      // SOURCES was built at module load, before this file existed — so re-walk and feed the
      // SHIPPED function, rather than re-implementing its rule here (a re-implementation proves
      // the algorithm, never the code that runs in CI).
      const walked = walk(dir)
      expect(walked, 'the SHIPPED walk must see the probe file').toHaveLength(1)
      const found = writeSites(walked).filter((w) => w.file === walked[0])
      // BEFORE T-118 this array was EMPTY — not « unguarded », absent. That is the whole finding.
      expect(found.length, 'the line-broken call was not seen at all').toBe(1)
      expect(found[0]).toMatchObject({ verb: 'transfers.create', guarded: false })
      // reported at the RECEIVER's line (4), which is where a human would look
      expect(found[0].line).toBe(4)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('T-118 — `a . b (` with spaces everywhere is the same call, and is CAUGHT', () => {
    const dir = sandbox()
    const probe = `${dir}/__t118_spaces_probe__.ts`
    writeFileSync(probe, [
      "import { getStripe } from '@/lib/stripe'",
      'export async function spaced(dest: string) {',
      '  return getStripe() . transfers . create ({ amount: 1, currency: "eur", destination: dest })',
      '}',
      '',
    ].join('\n'), 'utf8')
    try {
      // SOURCES was built at module load, before this file existed — so re-walk and feed the
      // SHIPPED function, rather than re-implementing its rule here (a re-implementation proves
      // the algorithm, never the code that runs in CI).
      const walked = walk(dir)
      expect(walked, 'the SHIPPED walk must see the probe file').toHaveLength(1)
      const found = writeSites(walked).filter((w) => w.file === walked[0])
      expect(found.length).toBe(1)
      expect(found[0]).toMatchObject({ verb: 'transfers.create', guarded: false })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('T-118 — NO Stripe namespace is ever bound to a local identifier, so `t.create(` cannot exist', () => {
    /* The second shape, and the one whitespace normalisation can never reach: `const t = getStripe().transfers`
       then `t.create(...)` contains no financial verb as TEXT. Teaching the oracle to follow assignments would
       make it a type-checker that fails silently on the first shape it does not model; asserting the property
       instead is checkable and stronger. */
    expect(stripeAliasSites()).toEqual([])
  })

  it('T-118 — POSITIVE CONTROL: the alias detector really fires on an aliased receiver', () => {
    // Without this, the assertion above is indistinguishable from a detector that matches nothing.
    const dir = sandbox()
    const probe = `${dir}/__t118_alias_probe__.ts`
    writeFileSync(probe, [
      "import { getStripe } from '@/lib/stripe'",
      'export async function payViaAlias(dest: string) {',
      '  const t = getStripe().transfers',
      '  return t.create({ amount: 100, currency: "eur", destination: dest })',
      '}',
      '',
    ].join('\n'), 'utf8')
    try {
      const walked = walk(dir)
      const hits = stripeAliasSites(walked).filter((h) => h.file === walked[0])
      expect(hits).toEqual([{ file: walked[0], line: 4, alias: 't.create' }])
      // and it is invisible to the text oracle — which is exactly why the property above is asserted
      expect(writeSites(walked)).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('T-109 — A REAL NEW FILE with an undeclared write is CAUGHT, end to end', () => {
    /* FOUNDER ARBITRATION (T-109): « Je veux que l'oracle prouve que tout nouveau site Stripe financier
       ajouté ultérieurement devra lui aussi déclarer explicitement son autorisation. »
       Every control above reasons about STRINGS. This one writes an actual file, re-runs the SHIPPED walk over
       a real filesystem, and requires the site to come back NAKED. It proves the mechanism rather than the
       algorithm: an extension filter that misses `.ts`, a swallowed readdir, a guard rule that degraded into
       proximity — each would pass every string-level control and fail this one.

       TWO CORRECTIONS, both made after this test had been green for a whole lot.
       (1) T-120 — it used to write into `lib/`. Running the full suite then failed THREE unrelated files with
           `ENOENT … lib/__t118_*_probe__.ts` once three more probes joined it: vitest runs files in parallel
           workers, many suites in this repository walk `lib/` and read every file they list, and a probe that
           lives for milliseconds is long enough to be listed and gone before it is read. A test that mutates
           the source tree can fail code it never meant to touch. The probe writes to an OS temp dir now; that
           the shipped roots really are `lib/`, `app/` and `scripts/` is proven unconditionally above, over the
           real `SOURCES`.
       (2) It used to RE-IMPLEMENT the guard rule inline — a copy of the 30-line lookback, pasted into the
           test. A re-implementation proves the algorithm and never the code that runs in CI: the shipped
           function could have rotted while this test stayed green on its private copy. It now calls
           `writeSites` itself. */
    const dir = sandbox()
    const probe = `${dir}/__t109_oracle_probe__.ts`
    const body = [
      "import { getStripe } from '@/lib/stripe'",
      'export async function payAnUnsuspectingPartner(dest: string) {',
      '  return getStripe().transfers.create({ amount: 100, currency: "eur", destination: dest })',
      '}',
      '',
    ].join(String.fromCharCode(10))
    try {
      writeFileSync(probe, body, 'utf8')
      // The walk is run fresh: SOURCES was built at module load, before this file existed.
      const walked = walk(dir)
      expect(walked, 'the SHIPPED walk must SEE a file created after module load').toHaveLength(1)
      const found = writeSites(walked)
      expect(found, 'the probe write was not detected at all').toHaveLength(1)
      expect(found[0].verb).toBe('transfers.create')
      expect(found[0].guarded, 'a NEW financial site with no declaration must be reported NAKED').toBe(false)
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
    expect(existsSync(probe), 'the probe must not survive the test').toBe(false)
    // and nothing was ever created inside the real source tree
    expect(existsSync('lib/__t109_oracle_probe__.ts')).toBe(false)
  })

  it('T-109 — all three payout rails obey the SAME guard, each with its OWN functional flag', () => {
    /* FOUNDER ARBITRATION: « ils obéissent tous au même invariant de sécurité au niveau LEAF / money-write
       guard … chaque rail peut conserver son autorisation fonctionnelle propre … mais aucun ne doit pouvoir
       contourner le garde financier commun. » One guard, three flags — and the creator rail's flag is now a
       real internal gate rather than `() => true` (T-90-ter). */
    const src = read('lib/creator-payout.ts')!
    // ONE guard, at the single shared write point
    expect((src.match(/assertMoneyWriteAllowed\(/g) || []).length).toBe(1)
    expect(src).toContain("authorization: 'partner_payout_rail_open',")
    expect(src).toContain('flag: PAYOUT_FLAG_BY_ROLE[role],')
    // THREE functional authorizations, each its own, none of them a literal
    expect(src).toContain("creator:   'CREATOR_PAYOUT_ENABLED',")
    expect(src).toContain("affiliate: 'AFFILIATE_CONNECT_ENABLED',")
    expect(src).toContain("logistics: 'LOGISTICS_PAYOUT_ENABLED',")
    // and EVERY adapter reads a flag — no rail is open by construction any more
    expect(src).toContain('enabled:        () => isCreatorPayoutEnabled(),')
    expect(src).toContain('enabled:        () => isAffiliateConnectEnabled(),')
    expect(src).toContain('enabled:        () => isLogisticsPayoutEnabled(),')
    expect(src, 'T-90-ter: no rail may be enabled by construction').not.toContain('enabled:        () => true,')
    // the guard refuses a flag outside the declared set — a fourth rail cannot smuggle itself in
    expect(PARTNER_PAYOUT_FLAGS).toEqual(['CREATOR_PAYOUT_ENABLED', 'AFFILIATE_CONNECT_ENABLED', 'LOGISTICS_PAYOUT_ENABLED'])
    expect(() => assertMoneyWriteAllowed({
      verb: 'transfers.create', authorization: 'partner_payout_rail_open',
      why: 'test', railOpen: true, flag: 'SOME_OTHER_FLAG',
    })).toThrow(/is not one of/)
  })

  it('NEGATIVE CONTROL — the walk really would catch an undeclared write', () => {
    // The oracle is only worth what it would refuse. Feed it a fabricated file and require a miss.
    const fabricated = [
      'export async function sneak() {',
      '  return await getStripe().transfers.createReversal(tr, { amount: 1 })',
      '}',
    ].join('\n')
    const lines = fabricated.split('\n')
    let found = false
    lines.forEach((l, i) => {
      if (!l.includes('transfers.createReversal(')) return
      found = true
      expect(lines.slice(Math.max(0, i - 30), i).join('\n').includes('assertMoneyWriteAllowed(')).toBe(false)
    })
    expect(found, 'the fabricated write was not even detected').toBe(true)
  })

  it('a verb NAMED IN PROSE is not counted as a call — the walk strips comments', () => {
    // lib/refund.ts's header names transfers.createReversal in a comment. Counting it would report a
    // permanent false positive and train a reader to ignore this test.
    const header = read('lib/refund.ts')!.split('\n').slice(0, 40).join('\n')
    expect(header).toContain('transfers.createReversal')
    expect(writeSites().every((s) => s.line > 40 || s.guarded)).toBe(true)
  })
})

// ══ 2. THE EXPRESSION — a rail_open site passes the REAL gate, never a literal ═════════════════════
describe('T-90 — each initiating write passes its module\'s own gate, not a hardcoded true', () => {
  it('lib/refund.ts declares rail_open with refundGateState().open', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain("authorization: 'rail_open',")
    expect(src).toContain('railOpen: refundGateState().open,')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/refunds.ts declares rail_open with isRefundsEnabled()', () => {
    const src = read('lib/refunds.ts')!
    expect(src).toContain("authorization: 'rail_open',")
    expect(src).toContain('railOpen: isRefundsEnabled(),')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/dispute.ts declares dispute_rail_open with isChargebacksEnabled(), at BOTH reversals', () => {
    const src = read('lib/dispute.ts')!
    expect(src.match(/authorization: 'dispute_rail_open',/g)).toHaveLength(2)
    expect(src.match(/railOpen: isChargebacksEnabled\(\),/g)).toHaveLength(2)
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/franchise-settlement.ts declares settlement_rail_open with isFranchiseSettlementEnabled()', () => {
    // The site the ENUMERATION found. It pays a franchisor — the only financial write that credits a third
    // party instead of recovering from one, and therefore the one whose gate matters most.
    const src = read('lib/franchise-settlement.ts')!
    expect(src).toContain("authorization: 'settlement_rail_open',")
    expect(src).toContain('railOpen: isFranchiseSettlementEnabled(),')
    expect(src).not.toContain('railOpen: true')
  })

  it('lib/creator-payout.ts names WHICH payout rail authorized the transfer', () => {
    const src = read('lib/creator-payout.ts')!
    expect(src).toContain("authorization: 'partner_payout_rail_open',")
    expect(src).toContain('flag: PAYOUT_FLAG_BY_ROLE[role],')
    expect(src).toContain('railOpen: ADAPTERS[role].enabled(),')
    expect(src).not.toContain('railOpen: true')
    expect(src).toContain("creator:   'CREATOR_PAYOUT_ENABLED',")
    expect(src).toContain("affiliate: 'AFFILIATE_CONNECT_ENABLED',")
    expect(src).toContain("logistics: 'LOGISTICS_PAYOUT_ENABLED',")
    /* THE RESIDUAL THIS TEST ONCE DOCUMENTED IS CLOSED. It asserted `enabled: () => true` on the creator
       adapter, because the previous lot deliberately did NOT tighten a rail that might be paying creators
       today on a guess about a production env var — and said so rather than acting. The founder then ruled
       (T-90-ter): « le rail créateur doit avoir une vraie autorisation interne explicite ». So the assertion
       INVERTS: no rail may be open by construction, and the creator rail reads its own flag. */
    expect(src).not.toContain('enabled:        () => true,')
    expect(src).toContain('enabled:        () => isCreatorPayoutEnabled(),')
    expect(src).toContain('T-90-ter — FOUNDER ARBITRATION')
    expect(src).toContain('CREATOR_PAYOUT_ENABLED, not a borrowed one')
  })

  it('NO site anywhere passes a literal — that is the one way to make the declaration meaningless', () => {
    // every file that declares, whichever they turn out to be — not a list
    const declaring = SOURCES.filter((f) => (read(f) ?? '').includes('assertMoneyWriteAllowed('))
    expect(declaring.length, 'no file declares — the check would be vacuous').toBeGreaterThanOrEqual(5)
    for (const f of declaring) {
      /* Scoped to the ASSERTION's own argument list. A first version scanned the whole file and reported
         `lib/refund.ts` — because `logMoneyWrite({ … railOpen: false … })` at the entry of `executeRefund`
         says, correctly, that the rail is closed. A log is not a declaration, and a check that cannot tell
         them apart reports the honest line as the defect. Fourth time in this chantier that a lexical rule
         had to be narrowed from the token to the construct. */
      const src = read(f)!
      for (const m of Array.from(src.matchAll(/assertMoneyWriteAllowed\(\{([\s\S]{0,600}?)\}\)/g))) {
        expect(m[1], `${f}: a declaration hardcodes its gate`).not.toMatch(/railOpen:\s*(true|false)\b/)
        expect(m[1], f).not.toMatch(/railOpen:\s*!!\s*1/)
      }
    }
  })
})

// ══ 3. RUNTIME — the guard refuses, and the refusal is not vacuous ════════════════════════════════
describe('T-90 — the guard refuses a closed rail and an unprovable completion', () => {
  const decl = (over: Record<string, unknown> = {}) => ({
    verb: 'refunds.create',
    authorization: 'rail_open' as const,
    why: 'test',
    railOpen: refundGateState().open,
    ...over,
  })

  it('rail CLOSED → refused, and the refusal names the rail', () => {
    closeRefundWindow()
    expect(refundGateState().open).toBe(false)
    expect(() => assertMoneyWriteAllowed(decl())).toThrow(MoneyWriteRefused)
    try { assertMoneyWriteAllowed(decl()) } catch (e) {
      expect((e as Error).message).toContain('did not assert its gate')
    }
  })

  it('POSITIVE CONTROL — rail OPEN (flag AND live lease) → allowed', () => {
    openRefundWindow()
    expect(refundGateState().open).toBe(true)
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: refundGateState().open }))).not.toThrow()
  })

  it('a bare flag with NO lease is still closed — the guard cannot be opened by half an authorization', () => {
    closeRefundWindow()
    process.env.REFUNDS_ENABLED = 'true' // flag only, no REFUNDS_WINDOW_UNTIL
    expect(refundGateState()).toEqual({ open: false, reason: 'no_lease' })
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: refundGateState().open }))).toThrow(MoneyWriteRefused)
  })

  it('a caller that ASSERTS a gate the process contradicts is refused, not trusted', () => {
    // The floor: railOpen says open while the raw flag is absent. Those two cannot both be right, and
    // guessing which is exactly what a money guard must not do.
    closeRefundWindow()
    expect(() => assertMoneyWriteAllowed(decl({ railOpen: true }))).toThrow(/cannot both be right/)
  })

  it('completing_settled_movement WITHOUT a proof is refused — that authorization bypasses every flag', () => {
    closeRefundWindow()
    const d = { verb: 'transfers.createReversal', authorization: 'completing_settled_movement' as const, why: 'test' }
    expect(() => assertMoneyWriteAllowed(d)).toThrow(/no proof id/)
    expect(() => assertMoneyWriteAllowed({ ...d, proof: '' })).toThrow(/no proof id/)
    expect(() => assertMoneyWriteAllowed({ ...d, proof: 'not-an-id' })).toThrow(/not a settled-movement/)
    // a PaymentIntent proves an INTENTION, not a movement
    expect(() => assertMoneyWriteAllowed({ ...d, proof: 'pi_3AbcDef' })).toThrow(/not a settled-movement/)
  })

  it('completing_settled_movement WITH a proof is allowed even with every flag closed — by design', () => {
    closeRefundWindow()
    closeChargebackRail()
    for (const proof of ['re_1', 're_rf_A', 're_3AbcDefGhi', 'tr_x1', 'trr_abc', 'ch_1', 'fr_9', 'py_z']) {
      expect(() => assertMoneyWriteAllowed({
        verb: 'transfers.createReversal', authorization: 'completing_settled_movement',
        why: 'completing a movement Stripe already made', proof,
      }), proof).not.toThrow()
    }
  })

  it('the dispute rail obeys its OWN flag, independently of the refund rail', () => {
    closeRefundWindow(); closeChargebackRail()
    const d = { verb: 'transfers.createReversal', authorization: 'dispute_rail_open' as const, why: 'test', railOpen: false }
    expect(() => assertMoneyWriteAllowed(d)).toThrow(MoneyWriteRefused)
    openChargebackRail()
    expect(() => assertMoneyWriteAllowed({ ...d, railOpen: true })).not.toThrow()
    // …and opening the REFUND rail does not open the dispute one
    closeChargebackRail(); openRefundWindow()
    expect(() => assertMoneyWriteAllowed({ ...d, railOpen: true })).toThrow(/CHARGEBACKS_ENABLED/)
  })
})

// ══ 4. THE EXCEPTION IS NAMED, AND IT IS EXACTLY ONE SITE ═════════════════════════════════════════
describe('T-90 — the one authorization that bypasses the flags is used in exactly one place', () => {
  it('only the royalty clawback completing an already-paid refund claims it', () => {
    const sites: string[] = []
    for (const f of SOURCES) {
      const src = read(f)
      if (src === null) continue
      const n = (src.match(/authorization: 'completing_settled_movement',/g) || []).length
      for (let i = 0; i < n; i++) sites.push(f)
    }
    expect(sites, 'a second bypass appeared — it must be justified in the report, not added quietly')
      .toEqual(['lib/refund.ts'])
    const src = read('lib/refund.ts')!
    expect(src).toContain('proof: stripeRefund.id,')
    expect(src).toContain('royalty clawback completing a refund Stripe has already paid the customer')
  })

  it('and the T-90 bound is written down where the write is, not only in a report', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain('THE ONE FINANCIAL WRITE REACHABLE WITH THE FOUR PRODUCT FLAGS CLOSED')
    expect(src).toContain('bounded by the 20 h resume')
    expect(src).toContain('pendingRowsUnder20hWithSettledRoyalty')
  })

  it('the 20 h brake it relies on is REAL and already pinned by the engine suite', () => {
    const src = read('lib/refund.ts')!
    expect(src).toContain('export const RESUME_CREATE_WINDOW_MS = 20 * 60 * 60 * 1000')
    expect(src).toContain('throw new ResumeIdempotencyExpired(row.id + \':clawback\')')
    const engine = readFileSync('tests/refund-engine.test.ts', 'utf8')
    expect(engine).toContain('clawback RESUME AFTER the idempotency window with no adoptable reversal')
    expect(engine).toContain('expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()')
  })

  it('the audit line exists, and a refusal is logged as an ERROR — a warning nobody reads is not a control', () => {
    const src = read('lib/stripe-money-guard.ts')!
    expect(src).toContain('[MONEY WRITE]')
    expect(src).toContain('if (refusal) console.error(parts.join')
    expect(src).toContain("else console.warn(parts.join")
    // no secret may ride along: the line carries a verb, an authorization, a Stripe id, an order and cents
    expect(src).not.toMatch(/process\.env\.(STRIPE_SECRET_KEY|DATABASE_URL|SMTP_PASS|NEXTAUTH_SECRET)/)
  })

  it('the guard is a LEAF — it is imported by three money modules and imports nothing itself', () => {
    const src = read('lib/stripe-money-guard.ts')!
    expect(src).not.toMatch(/^\s*import\s/m)
    for (const f of ['lib/refund.ts', 'lib/refunds.ts', 'lib/dispute.ts']) {
      expect(read(f)!, f).toContain("from '@/lib/stripe-money-guard'")
    }
  })
})
