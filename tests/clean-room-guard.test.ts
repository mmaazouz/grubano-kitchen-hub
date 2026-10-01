// ── GARDES FAIL-CLOSED du Clean Room final (mission FINAL BETA ACCEPTANCE, 2026-08-30) ──
// Le Clean Room est le script le plus destructif du repo : ces tests exécutent le
// VRAI script en sous-processus et prouvent que CHAQUE refus tombe AVANT tout
// require('@prisma/client') et AVANT toute lecture de DATABASE_URL — la
// DATABASE_URL factice n'est jamais contactée (déterministe en local COMME en CI).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const SCRIPT = path.join(process.cwd(), 'scripts', 'server', 'clean-room.js')

function runCleanRoom(args: string[], env: Record<string, string | undefined>) {
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    // fake DSN: the guards must ALL fire BEFORE any DB connection could happen
    DATABASE_URL: 'mysql://guard:guard@localhost:3306/guard_never_connected',
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k]
    else merged[k] = v
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: merged, encoding: 'utf8', timeout: 30_000 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('clean-room — gardes fail-closed (aucune base réelle touchée)', () => {
  it('sans argument → usage + exit 1 (AUCUNE écriture, AUCUNE connexion)', () => {
    const r = runCleanRoom([], { NEXTAUTH_URL: 'http://localhost:3000' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/usage/i)
    expect(r.out).toMatch(/--dry-run/)
    expect(r.out).toMatch(/--i-confirm-local-backup/)
    expect(r.out).not.toMatch(/CLEAN ROOM COMPLET/i)
  })

  it('REFUSE la production (grubano.com) même en --dry-run', () => {
    const r = runCleanRoom(['--dry-run'], { NEXTAUTH_URL: 'https://grubano.com' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/PRODUCTION/i)
  })

  it('REFUSE quand NEXTAUTH_URL est absent (fail-closed, jamais de cible devinée)', () => {
    const r = runCleanRoom(['--dry-run'], { NEXTAUTH_URL: undefined })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/NEXTAUTH_URL/)
  })

  it('REFUSE --execute sans --i-confirm-local-backup (règle NO LOCAL BACKUP = NO CLEAN ROOM)', () => {
    const r = runCleanRoom(['--execute'], { NEXTAUTH_URL: 'http://localhost:3000' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/NO LOCAL BACKUP = NO CLEAN ROOM/i)
    expect(r.out).toMatch(/--i-confirm-local-backup/)
  })

  it('REFUSE tout hôte inconnu (fail-closed — ex. un staging fantôme)', () => {
    const r = runCleanRoom(['--dry-run'], { NEXTAUTH_URL: 'https://beta.grubano.dev' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/inconnu/i)
  })

  it('REFUSE --dry-run + --execute combinés (mutuellement exclusifs)', () => {
    const r = runCleanRoom(['--dry-run', '--execute', '--i-confirm-local-backup'], { NEXTAUTH_URL: 'http://localhost:3000' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/mutuellement exclusifs/i)
  })

  it('REFUSE --execute hors staging — localhost ne vaut que pour --dry-run (pas de détour vers la prod via .env.local)', () => {
    const r = runCleanRoom(['--execute', '--i-confirm-local-backup'], { NEXTAUTH_URL: 'http://localhost:3000' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/app\.grubano\.com/)
    expect(r.out).toMatch(/--dry-run/)
  })

  it('REFUSE un hostname qui COMMENCE par 127 sans être une IP loopback (127.evil.com)', () => {
    const r = runCleanRoom(['--dry-run'], { NEXTAUTH_URL: 'https://127.evil.com' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/REFUS/i)
    expect(r.out).toMatch(/inconnu/i)
  })
})
