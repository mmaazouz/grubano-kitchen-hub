import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── V5-3 — l'étiquette « Motif client » sur une demande SYSTÈME est fausse ────
// P0-08 crée des réclamations d'origine système (reason 'system_order_cancelled',
// marqueur préfixe 'system_', status 'arbitration' directement — elles
// n'atteignent JAMAIS le panneau resto). La console admin les étiquetait
// « Motif client » / « Détails du client ». Gardes source + i18n : l'origine
// affichée suit le marqueur EXISTANT (aucun champ ajouté), une demande client
// garde ses étiquettes, et les clés existent dans les 5 locales.

const ROOT = process.cwd()
const COMPONENT = path.join(ROOT, 'components/claims/AdminClaimsArbitration.tsx')

describe('V5-3 — étiquette d’origine des réclamations (console admin)', () => {
  const src = fs.readFileSync(COMPONENT, 'utf8')

  it('le composant distingue l’origine via le marqueur P0-08 (préfixe system_), sans nouveau champ', () => {
    expect(src).toMatch(/isSystemClaim = \(reason: string\) => reason\.startsWith\('system_'\)/)
  })

  it('les DEUX rendus (file en attente + arbitrage) basculent le libellé motif ET détails', () => {
    const reasonSwitches = src.match(/isSystemClaim\([pc]\.reason\) \? 'admin\.reasonSystem' : 'admin\.reason'/g) ?? []
    const detailSwitches = src.match(/isSystemClaim\([pc]\.reason\) \? 'admin\.systemDetails' : 'admin\.clientDetails'/g) ?? []
    expect(reasonSwitches.length).toBe(2)
    expect(detailSwitches.length).toBe(2)
  })

  it('une demande CLIENT conserve son étiquette (admin.reason toujours la branche par défaut)', () => {
    expect(src).toContain(": 'admin.reason'")
    expect(src).toContain(": 'admin.clientDetails'")
  })

  it('les clés existent ×5 locales et le libellé du reason système reste marqué (système)', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, `messages/${loc}.json`), 'utf8'))
      expect(j.claims?.admin?.reasonSystem, `${loc} reasonSystem`).toBeTruthy()
      expect(j.claims?.admin?.systemDetails, `${loc} systemDetails`).toBeTruthy()
      expect(j.claims?.reason?.system_order_cancelled, `${loc} reason.system_order_cancelled`).toBeTruthy()
    }
  })
})
