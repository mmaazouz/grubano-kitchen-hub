import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  BETA_MONEY_OUT_MUST_BE_FALSE,
  checkMoneyOutFrozen,
  checkFlagCoupling,
  COUPLING_RULES,
} from '../scripts/check-flags.mjs'

/**
 * T-123 — ARBITRAGE FONDATEUR (2026-09-28).
 *
 * « Oui : pendant la bêta, check:flags doit exiger explicitement false pour
 *   FRANCHISE_SETTLEMENT_ENABLED et CREATOR_PAYOUT_ENABLED. Je préfère un build qui échoue si l'un de
 *   ces rails money-OUT est accidentellement ouvert plutôt qu'une simple surveillance qui laisse
 *   compiler. Ajoute cette contrainte avec les tests correspondants, sans modifier le comportement
 *   runtime au-delà de cette règle de préflight/build. »
 *
 * The two keys are the only locks on the two Stripe writes in the repository that PAY a third party
 * rather than recover from one. A refund returns money to a customer; a reversal recovers money. Only
 * these two send funds OUT to a beneficiary — that is the criterion, not "it is a money flag".
 */

const CLI = 'scripts/check-flags.mjs'
const SRC = readFileSync(CLI, 'utf8')

/** Run the REAL CLI as a child process. A rule that is only unit-tested has never been proven to
 *  fail a build: the exit code is the whole point of this arbitration. */
const runCli = (env: Record<string, string | undefined>, cwd = process.cwd()) => {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k]
  const r = spawnSync(process.execPath, [join(process.cwd(), CLI)], {
    cwd, env: merged, encoding: 'utf8', timeout: 60_000,
  })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** The CLI, run in a temp directory so an env FILE can be exercised without ever creating one in the
 *  repository — whose real `.env.local` holds live secrets. The two frozen keys are removed from the
 *  inherited environment, so only the file under test can open a rail. */
const runCliIn = (dir: string) => {
  const merged: NodeJS.ProcessEnv = { ...process.env }
  delete merged.CREATOR_PAYOUT_ENABLED
  delete merged.FRANCHISE_SETTLEMENT_ENABLED
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check-flags.mjs')], {
    cwd: dir, env: merged, encoding: 'utf8', timeout: 60_000,
  })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('T-123 — the two money-OUT rail flags are REQUIRED false', () => {
  it('names exactly the two rails that PAY a third party, each with its reason', () => {
    expect(BETA_MONEY_OUT_MUST_BE_FALSE.map((r) => r.flag).sort())
      .toEqual(['CREATOR_PAYOUT_ENABLED', 'FRANCHISE_SETTLEMENT_ENABLED'])
    for (const r of BETA_MONEY_OUT_MUST_BE_FALSE) expect(r.why.length).toBeGreaterThan(20)
  })

  it('THE NORMAL STATE — both keys absent → ok, with no special case for "absent"', () => {
    // `on()` compares to the exact string 'true', so an unset key is OFF and needs no exemption.
    // If this ever went red, every local build and every CI run would fail for no reason.
    expect(checkMoneyOutFrozen({})).toEqual({ ok: true, errors: [] })
    expect(checkMoneyOutFrozen({ FRANCHISE_SETTLEMENT_ENABLED: 'false', CREATOR_PAYOUT_ENABLED: 'false' }).ok).toBe(true)
  })

  it('each key set to the exact string "true" is an ERROR, and the message says what it guards', () => {
    for (const { flag } of BETA_MONEY_OUT_MUST_BE_FALSE) {
      const r = checkMoneyOutFrozen({ [flag]: 'true' })
      expect(r.ok, flag).toBe(false)
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).toContain(flag)
      expect(r.errors[0]).toMatch(/INTERDIT pendant la bêta/)
      expect(r.errors[0]).toMatch(/transfers\.create/)   // names the actual Stripe write
    }
    expect(checkMoneyOutFrozen({ FRANCHISE_SETTLEMENT_ENABLED: 'true', CREATOR_PAYOUT_ENABLED: 'true' }).errors)
      .toHaveLength(2)
  })

  it('mirrors the runtime exactly: "TRUE", "1", "" and "yes" are OFF, so they PASS', () => {
    // The app opens a rail only on the exact string 'true' (isFranchiseSettlementEnabled /
    // isCreatorPayoutEnabled). A build check that refused 'TRUE' would refuse a CLOSED rail — it would
    // be describing a different program than the one that ships.
    for (const v of ['TRUE', 'True', '1', 'yes', '', 'false', 'true ']) {
      expect(checkMoneyOutFrozen({ FRANCHISE_SETTLEMENT_ENABLED: v }).ok, JSON.stringify(v)).toBe(true)
    }
  })

  it('THE CASE THAT MATTERS — a coherently configured OPEN rail passes the couplings and still FAILS', () => {
    /* The accident the founder is guarding against is not a half-configured flag; it is a rail that is
       open and otherwise perfectly coherent, which every pre-existing rule happily accepts. */
    const coherent = {
      FRANCHISE_SETTLEMENT_ENABLED: 'true', FRANCHISE_CONNECT_ENABLED: 'true', FRANCHISE_ENABLED: 'true',
    }
    expect(checkFlagCoupling(coherent).ok, 'the couplings accept this configuration').toBe(true)
    expect(checkMoneyOutFrozen(coherent).ok, 'the freeze must refuse it anyway').toBe(false)

    const creator = { CREATOR_PAYOUT_ENABLED: 'true', CREATOR_CONNECT_ENABLED: 'true', CREATOR_ENABLED: 'true' }
    expect(checkFlagCoupling(creator).ok).toBe(true)
    expect(checkMoneyOutFrozen(creator).ok).toBe(false)
  })

  it('the freeze is evaluated BEFORE the couplings — a refusal must not be satisfiable by opening a second flag', () => {
    /* Measured while writing this: with FRANCHISE_SETTLEMENT_ENABLED=true and its Connect counterpart
       absent, the COUPLING rule spoke first and printed « exige FRANCHISE_CONNECT_ENABLED=true » —
       advice that invites an operator to open MORE money flags to go green. A refusal that can be
       satisfied by opening a second money flag is worse than no refusal. Asserted on source ORDER. */
    const freezeAt = SRC.indexOf('checkMoneyOutFrozen(moneyOutEnv')
    const couplingAt = SRC.indexOf('checkFlagCoupling(process.env)')
    expect(freezeAt, 'the freeze is not called in the CLI at all').toBeGreaterThan(0)
    expect(couplingAt).toBeGreaterThan(0)
    expect(freezeAt, 'the freeze must run FIRST').toBeLessThan(couplingAt)
    expect(SRC).toContain('Ne satisfaites PAS ce refus en ouvrant un autre drapeau')
  })

  it('THE TWO LISTS ARE DELIBERATELY NOT MERGED — check:flags must NOT require REFUNDS/CLAIMS false', () => {
    /* scripts/server/env-provenance.js MONEY_FLAGS_MUST_BE_FALSE (14 keys) is the RUNTIME posture the
       server preflight asserts before a rehearsal, and it contains REFUNDS_ENABLED and CLAIMS_ENABLED.
       Requiring those false HERE would make every bounded rehearsal impossible to compile — while a
       30-minute REFUNDS lease is precisely the mechanism the repository provides, and WARNING_RULES
       below already describe it as a legitimate configuration. Two questions, one word "money". */
    const frozen = BETA_MONEY_OUT_MUST_BE_FALSE.map((r) => r.flag)
    for (const k of ['REFUNDS_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_SURFACE_ENABLED', 'CHARGEBACKS_ENABLED', 'TIPS_ENABLED']) {
      expect(frozen, `${k} must NOT be required-false by the BUILD check`).not.toContain(k)
    }
    // and the positive control: a live rehearsal configuration still compiles
    expect(checkMoneyOutFrozen({ REFUNDS_ENABLED: 'true', CLAIMS_ENABLED: 'true' }).ok).toBe(true)
  })

  it('CONSEQUENCE, MEASURED AND DELIBERATE — royalty ACCRUAL now has no compilable configuration', () => {
    /* A consequence of the arbitration that the founder must know about, because it removes an option:
       COUPLING_RULES already say FRANCHISE_ROYALTY_ENABLED requires FRANCHISE_SETTLEMENT_ENABLED
       (« royalties accumulées sans reversement au franchiseur »). With the settlement rail now required
       FALSE, both exits are closed:
         royalty ON + settlement OFF → the COUPLING refuses;
         royalty ON + settlement ON  → the FREEZE refuses.
       So royalty accrual cannot be switched on during the beta at all. That is arguably the right answer
       — do not accrue an obligation you are forbidden to settle — but it is a product consequence, not a
       side effect to discover later. Pinned so nobody resolves the tension by weakening the freeze. */
    const royaltyOnly = { FRANCHISE_ROYALTY_ENABLED: 'true', FRANCHISE_ENABLED: 'true' }
    expect(checkFlagCoupling(royaltyOnly).ok, 'the coupling must still demand a settlement rail').toBe(false)
    expect(checkFlagCoupling(royaltyOnly).errors.join(' ')).toMatch(/exige FRANCHISE_SETTLEMENT_ENABLED=true/)

    const bothOn = { ...royaltyOnly, FRANCHISE_SETTLEMENT_ENABLED: 'true', FRANCHISE_CONNECT_ENABLED: 'true' }
    expect(checkFlagCoupling(bothOn).ok, 'satisfying the coupling is possible…').toBe(true)
    expect(checkMoneyOutFrozen(bothOn).ok, '…but the freeze then refuses it').toBe(false)
  })

  it('the pre-existing coupling rules are untouched (their pinned length still holds)', () => {
    // tests/claims-dprime-l1-flags.test.ts pins COUPLING_RULES at 21. The freeze is a SEPARATE list
    // precisely so that pin — and everything it protects — keeps its meaning.
    expect(COUPLING_RULES).toHaveLength(21)
    expect(COUPLING_RULES.some((r) => r.flag === 'FRANCHISE_SETTLEMENT_ENABLED')).toBe(true) // still coupled too
  })
})

describe('T-123 — the CLI really EXITS 1 (a rule never executed has never failed a build)', () => {
  it('clean environment → exit 0, and the success line states what it proved', () => {
    const r = runCli({ FRANCHISE_SETTLEMENT_ENABLED: undefined, CREATOR_PAYOUT_ENABLED: undefined })
    expect(r.status, r.out).toBe(0)
    expect(r.out).toMatch(/rails money-OUT gelés/)
  })

  it('FRANCHISE_SETTLEMENT_ENABLED=true in the environment → exit 1, and the freeze is the reason printed', () => {
    const r = runCli({ FRANCHISE_SETTLEMENT_ENABLED: 'true' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/RAIL MONEY-OUT OUVERT/)
    expect(r.out).toMatch(/source : process\.env/)
    // NOT the coupling advice, which would tell the operator to open another flag
    expect(r.out).not.toMatch(/exige FRANCHISE_CONNECT_ENABLED=true/)
  })

  it('CREATOR_PAYOUT_ENABLED=true in the environment → exit 1', () => {
    const r = runCli({ CREATOR_PAYOUT_ENABLED: 'true' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/CREATOR_PAYOUT_ENABLED=true est INTERDIT/)
  })

  it('an env FILE that opens a rail → exit 1, and the message names the FILE', () => {
    /* Reading only process.env would make the rule nearly decorative: nobody exports
       CREATOR_PAYOUT_ENABLED in a shell before `npm run build` — they write it in `.env.local`.
       Run in a temp directory: this test must never create an env file in the repository, whose real
       `.env.local` holds live secrets. */
    const dir = mkdtempSync(join(tmpdir(), 'grubano-flags-'))
    try {
      mkdirSync(join(dir, 'scripts'))
      cpSync(CLI, join(dir, 'scripts', 'check-flags.mjs'))
      writeFileSync(join(dir, '.env.local'), 'SOME_OTHER=1\nCREATOR_PAYOUT_ENABLED=true\n', 'utf8')
      const r = runCliIn(dir)
      expect(r.status, r.out).toBe(1)
      expect(r.out).toMatch(/source : \.env\.local/)

      // `export FLAG="true"` with quotes and a trailing space is what dotenv gives as 'true' → still caught
      writeFileSync(join(dir, '.env.local'), 'export FRANCHISE_SETTLEMENT_ENABLED="true" \n', 'utf8')
      const q = runCliIn(dir)
      expect(q.status).toBe(1)

      // NEGATIVE CONTROL — the same file saying false compiles
      writeFileSync(join(dir, '.env.local'), 'CREATOR_PAYOUT_ENABLED=false\n', 'utf8')
      const ok = runCliIn(dir)
      expect(ok.status, ok.out).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('the file never OVERRIDES the environment — a file saying false cannot mask a true env', () => {
    const r = runCli({ CREATOR_PAYOUT_ENABLED: 'true' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/source : process\.env/)
  })
})

describe('T-123 — the rule actually gates a BUILD', () => {
  const wf = (f: string) => readFileSync(`.github/workflows/${f}`, 'utf8')

  it('both deploy workflows run check:flags in their gating job, BEFORE the build', () => {
    /* It was invoked only in tests.yml — a SEPARATE workflow that does not block a deploy — so the rule
       had no teeth on the path that actually ships. Asserted per file, on ORDER. */
    for (const f of ['deploy-staging.yml', 'deploy-production.yml']) {
      const src = wf(f)
      const at = src.indexOf('npm run check:flags')
      expect(at, `${f} does not run check:flags at all`).toBeGreaterThan(0)
      const testJobAt = src.indexOf('\n  test:')
      const deployJobAt = src.indexOf('\n  deploy:')
      expect(testJobAt).toBeGreaterThan(0)
      expect(at, `${f}: check:flags must be inside the gating test job`).toBeGreaterThan(testJobAt)
      expect(at, `${f}: check:flags must be inside the gating test job`).toBeLessThan(deployJobAt)
      expect(at, `${f}: it must run BEFORE the compile gate`).toBeLessThan(src.indexOf('Build (compile gate)'))
      // and the deploy job really depends on that job
      expect(src).toMatch(/\n    needs: test/)
    }
  })

  it('tests.yml still runs it too — the standalone CI keeps its own copy of the gate', () => {
    expect(wf('tests.yml')).toContain('npm run check:flags')
  })

  it('the SCOPE of the rule is documented, because a build check cannot see the server env', () => {
    /* The value that matters in production lives in the SERVER's .env.local, which CI never writes
       (deploy-staging.yml says so explicitly). Claiming this rule closes that hole would be false
       reassurance, so the file states the boundary and names the mechanism that does cover it. */
    expect(SRC).toMatch(/phase2-preflight\.js/)
    expect(SRC).toMatch(/COMPLÉMENTAIRES/)
    expect(wf('deploy-staging.yml')).toMatch(/serveur n'est jamais écrit par la CI/)
  })
})
