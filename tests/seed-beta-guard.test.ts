// ── GARDE BÊTA FAIL-CLOSED du seed démo (mission BETA SECURITY GATE, 2026-08-29) ──
// Décision produit DÉFINITIVE : app.grubano.com = closed beta à données réelles →
// le seed démo y est INTERDIT sans contournement. Ces tests exécutent le VRAI
// script en sous-processus et prouvent que le refus intervient AVANT toute
// connexion base (aucun require('@prisma/client') n'a lieu sur les chemins refusés).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const SCRIPT = path.join(process.cwd(), 'scripts', 'seed-demo-data.js')

function runSeed(env: Record<string, string>) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('seed-demo-data — garde bêta fail-closed', () => {
  it('REFUSE quand NEXTAUTH_URL désigne la bêta (app.grubano.com), avant toute écriture', () => {
    const r = runSeed({ NEXTAUTH_URL: 'https://app.grubano.com', SEED_DEMO_CONFIRM: 'yes', SEED_DEMO_PASSWORD: 'x'.repeat(12) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/LOCAUX|localhost/i)
    expect(r.out).not.toMatch(/seeded successfully/i)
  })

  it('REFUSE la prod (grubano.com) de la même façon', () => {
    const r = runSeed({ NEXTAUTH_URL: 'https://grubano.com', SEED_DEMO_CONFIRM: 'yes', SEED_DEMO_PASSWORD: 'x'.repeat(12) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
  })

  it('REFUSE toute URL non-locale (fail-closed, ex. env CI inconnu)', () => {
    const r = runSeed({ NEXTAUTH_URL: 'https://ci-runner.invalid', SEED_DEMO_CONFIRM: 'yes', SEED_DEMO_PASSWORD: 'x'.repeat(12) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
  })

  it('en LOCAL : exige SEED_DEMO_PASSWORD (plus aucun mot de passe versionné)', () => {
    const r = runSeed({ NEXTAUTH_URL: 'http://localhost:3000', SEED_DEMO_CONFIRM: 'yes', SEED_DEMO_PASSWORD: '' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/SEED_DEMO_PASSWORD/i)
    expect(r.out).not.toMatch(/seeded successfully/i)
  })

  it('en LOCAL : exige toujours la confirmation explicite (ordre des gardes prouvé)', () => {
    const r = runSeed({ NEXTAUTH_URL: 'http://localhost:3000', SEED_DEMO_PASSWORD: 'x'.repeat(12), SEED_DEMO_CONFIRM: '' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/confirmation/i)
  })
})
