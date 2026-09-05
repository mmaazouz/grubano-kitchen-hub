// tests/fix-server-preamble.test.ts — scripts/fix-server.js injects the env-provenance preamble
// into the DEPLOYED Passenger entry (.next/standalone/server.js) BEFORE `require('next')`, so the
// snapshot of process.env is taken before @next/env loads any env file. Idempotent, value-free,
// never throws at runtime (whole preamble is try/catch).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixer = require('../scripts/fix-server.js') as { injectProvenancePreamble: (c: string) => string; PREAMBLE_MARKER: string; patchWindowsPaths: (c: string) => string }

const STANDALONE = [
  "const path = require('path')",
  '',
  'const dir = path.join(__dirname)',
  "process.env.NODE_ENV = 'production'",
  'process.chdir(__dirname)',
  'const nextConfig = {"outputFileTracingRoot":"C:\\\\Users\\\\Lenovo\\\\grubano"}',
  'process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)',
  '',
  "require('next')",
  "const { startServer } = require('next/dist/server/lib/start-server')",
  'startServer({ dir })',
  '',
].join('\n')

describe('fix-server.js — provenance preamble injection', () => {
  it('injects exactly once, BEFORE require(\'next\'), after the standalone config line', () => {
    const out = fixer.injectProvenancePreamble(STANDALONE)
    expect(out.split(fixer.PREAMBLE_MARKER).length - 1).toBe(1)
    const i = out.indexOf(fixer.PREAMBLE_MARKER), j = out.indexOf("require('next')"), k = out.indexOf('__NEXT_PRIVATE_STANDALONE_CONFIG')
    expect(i).toBeGreaterThan(k)
    expect(i).toBeLessThan(j)
  })
  it('is idempotent (second pass is a no-op)', () => {
    const once = fixer.injectProvenancePreamble(STANDALONE)
    expect(fixer.injectProvenancePreamble(once)).toBe(once)
  })
  it('leaves the file untouched when the anchor is absent (never corrupts an unknown entry)', () => {
    expect(fixer.injectProvenancePreamble('console.log(1)\n')).toBe('console.log(1)\n')
  })
  it('the injected preamble is valid JS, runs before Next, writes a value-free tmp/env-provenance.json, and never throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-preamble-'))
    fs.mkdirSync(path.join(dir, 'scripts', 'server'), { recursive: true })
    fs.copyFileSync(path.resolve(__dirname, '../scripts/server/env-provenance.js'), path.join(dir, 'scripts', 'server', 'env-provenance.js'))
    fs.writeFileSync(path.join(dir, '.env.local'), 'INTERNAL_CRON_TOKEN=file-token-value-0001\n TIPS_ENABLED = true\nSMTP_PASS=p@ss\n')
    // Stop right after the preamble: a fake `next` module that records the order and exits.
    fs.mkdirSync(path.join(dir, 'node_modules', 'next'), { recursive: true })
    // The report lands OUTSIDE the app root: ~/.grubano/env-provenance.json (home = the temp dir here).
    const home = path.join(dir, 'home')
    fs.mkdirSync(home, { recursive: true })
    const reportPath = path.join(home, '.grubano', 'env-provenance.json')
    fs.writeFileSync(path.join(dir, 'node_modules', 'next', 'index.js'), "require('fs').writeFileSync(require('path').join(__dirname, '..', '..', 'next-required.txt'), String(require('fs').existsSync(" + JSON.stringify(reportPath) + "))); process.exit(0)")
    const entry = fixer.injectProvenancePreamble(STANDALONE.replace("const { startServer } = require('next/dist/server/lib/start-server')\nstartServer({ dir })\n", ''))
    fs.writeFileSync(path.join(dir, 'server.js'), entry)
    const r = spawnSync(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOME: home, USERPROFILE: home, INTERNAL_CRON_TOKEN: 'hosting-token-value-0002', TIPS_ENABLED: undefined as unknown as string }, encoding: 'utf8' })
    expect(r.status).toBe(0)
    // the provenance file existed BEFORE `next` was required (snapshot taken pre-load)
    expect(fs.readFileSync(path.join(dir, 'next-required.txt'), 'utf8')).toBe('true')
    expect(fs.existsSync(path.join(dir, 'tmp', 'env-provenance.json'))).toBe(false) // never under the docroot
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    expect(rep.keys.INTERNAL_CRON_TOKEN).toMatchObject({ presentBeforeEnvLoad: true, presentInEnvFiles: true, equalProcessVsFiles: false, effectiveSource: 'process' })
    expect(rep.keys.TIPS_ENABLED).toMatchObject({ presentInEnvFiles: true, effectiveSource: '.env.local' }) // dotenv loads ` TIPS_ENABLED = true`
    const raw = fs.readFileSync(reportPath, 'utf8')
    for (const s of ['file-token', 'hosting-token', 'p@ss', '0001', '0002']) expect(raw).not.toContain(s)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('a missing helper never blocks startup (preamble swallows the error)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-preamble-'))
    const home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(path.join(dir, 'node_modules', 'next'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'next', 'index.js'), 'process.exit(0)')
    fs.writeFileSync(path.join(dir, 'server.js'), fixer.injectProvenancePreamble(STANDALONE.replace("const { startServer } = require('next/dist/server/lib/start-server')\nstartServer({ dir })\n", '')))
    const r = spawnSync(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(fs.existsSync(path.join(home, '.grubano', 'env-provenance.json'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('Windows path patching is unchanged', () => {
    expect(fixer.patchWindowsPaths(STANDALONE)).toContain('"outputFileTracingRoot":"/home/deyi0010/grubano.com"')
  })
})
