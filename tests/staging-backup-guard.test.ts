// ── GARDES FAIL-CLOSED de l'opérateur de backup staging (Clean Room runbook étape 1, 2026-09-07) ──
// Exécute le VRAI script en sous-processus avec une DSN factice : chaque refus doit
// tomber AVANT require('@prisma/client'), AVANT mysqldump et AVANT toute écriture de
// fichier — la DSN factice n'est jamais contactée (déterministe en local COMME en CI).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const SCRIPT = path.join(process.cwd(), 'scripts', 'server', 'staging-backup.js')

function run(args: string[], env: Record<string, string | undefined>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-backup-guard-'))
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: 'mysql://guard:guard@localhost:3306/guard_never_connected',
    GRUBANO_BACKUP_DIR: dir,
    MYSQLDUMP_BIN: path.join(dir, 'mysqldump-must-never-run'),
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k]
    else merged[k] = v
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: merged, encoding: 'utf8', timeout: 30_000 })
  const files = fs.readdirSync(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), files }
}

describe('staging-backup — gardes fail-closed (aucune base réelle touchée, aucun fichier écrit)', () => {
  it('REFUSE une base de PRODUCTION (deyi0010_grubano) même avec une URL staging', () => {
    const r = run(['--label', 'guard'], {
      NEXTAUTH_URL: 'https://app.grubano.com',
      DATABASE_URL: 'mysql://guard:guard@localhost:3306/deyi0010_grubano',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/RESULT: FAIL/)
    expect(r.out).toMatch(/PRODUCTION/)
    expect(r.out).toMatch(/DATABASE CHANGED: NO/)
    expect(r.files).toEqual([])
  })

  it('REFUSE une URL de PRODUCTION (grubano.com) même avec une base *_staging', () => {
    const r = run([], {
      NEXTAUTH_URL: 'https://grubano.com',
      DATABASE_URL: 'mysql://guard:guard@localhost:3306/deyi0010_grubano_staging',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/PRODUCTION/)
    expect(r.files).toEqual([])
  })

  it('REFUSE une cible ambiguë (ni base *_staging ni URL staging)', () => {
    const r = run([], { NEXTAUTH_URL: 'https://example.com' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/cannot confirm STAGING/)
    expect(r.files).toEqual([])
  })

  it('ne révèle jamais le mot de passe de la DSN dans sa sortie', () => {
    const r = run([], {
      NEXTAUTH_URL: 'https://grubano.com',
      DATABASE_URL: 'mysql://guarduser:S3cretGuardPass@localhost:3306/deyi0010_grubano_staging',
    })
    expect(r.out).not.toMatch(/S3cretGuardPass/)
    expect(r.out).not.toMatch(/guarduser/)
  })
})
