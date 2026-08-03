import { describe, it, expect } from 'vitest'
import { checkFlagCoupling, COUPLING_RULES } from '../scripts/check-flags.mjs'

// ── P0-06 — couplages « racine de rôle » (doctrine Q8) ────────────────────────
// Chaque capacité d'un rôle masqué exige le flag racine du rôle : une capacité ON
// avec le rôle OFF est une incohérence (la surface répondrait alors que le rôle
// « n'existe pas » côté serveur). Fichier SÉPARÉ de tests/flag-coupling.test.ts
// (édité en parallèle par P0-25 sur vague1) pour éviter tout conflit de merge.

const ROOT_RULES: Array<[string, string]> = [
  ['CREATOR_CONNECT_ENABLED',              'CREATOR_ENABLED'],
  ['CREATOR_PAYOUT_ENABLED',               'CREATOR_ENABLED'],
  ['SUPPLIER_CONNECT_ENABLED',             'SUPPLIER_ENABLED'],
  ['FRANCHISE_CONNECT_ENABLED',            'FRANCHISE_ENABLED'],
  ['FRANCHISE_ROYALTY_ENABLED',            'FRANCHISE_ENABLED'],
  ['FRANCHISE_POS_TAGGING_ENABLED',        'FRANCHISE_ENABLED'],
  ['LOGISTICS_CONNECT_ENABLED',            'LOGISTICS_ENABLED'],
  ['LOGISTICS_MISSIONS_ENABLED',           'LOGISTICS_ENABLED'],
  ['LOGISTICS_COURIER_ACTIVATION_ENABLED', 'LOGISTICS_ENABLED'],
  ['LOGISTICS_AVAILABILITY_ENABLED',       'LOGISTICS_ENABLED'],
  ['LOGISTICS_TRACKING_ENABLED',           'LOGISTICS_ENABLED'],
]

describe('P0-06 — les règles racine-de-rôle existent dans COUPLING_RULES', () => {
  for (const [flag, requires] of ROOT_RULES) {
    it(`${flag} exige ${requires}`, () => {
      expect(COUPLING_RULES.some((r: { flag: string; requires: string }) => r.flag === flag && r.requires === requires)).toBe(true)
    })
  }
})

describe('P0-06 — la vérification refuse capacité ON + rôle OFF, accepte rôle ON', () => {
  for (const [flag, requires] of ROOT_RULES) {
    it(`${flag}=true sans ${requires} → erreur ; avec → ok (transitives satisfaites)`, () => {
      const bad = checkFlagCoupling({ [flag]: 'true' })
      expect(bad.ok).toBe(false)
      expect(bad.errors.join('\n')).toContain(requires)
      // env complet : la racine + toutes les exigences transitives déjà réglées
      const full: Record<string, string> = { [flag]: 'true', [requires]: 'true' }
      for (let i = 0; i < 5; i++) {
        for (const r of COUPLING_RULES as Array<{ flag: string; requires: string }>) {
          if (full[r.flag] === 'true' && full[r.requires] !== 'true') full[r.requires] = 'true'
        }
      }
      expect(checkFlagCoupling(full).ok).toBe(true)
    })
  }
})

describe('P0-06 — les 4 racines seules (rôles ouverts, aucune capacité) restent cohérentes', () => {
  it('CREATOR/SUPPLIER/FRANCHISE/LOGISTICS_ENABLED=true seuls → ok', () => {
    expect(checkFlagCoupling({
      CREATOR_ENABLED: 'true', SUPPLIER_ENABLED: 'true',
      FRANCHISE_ENABLED: 'true', LOGISTICS_ENABLED: 'true',
    }).ok).toBe(true)
  })
})
