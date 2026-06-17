import { describe, it, expect } from 'vitest'
import {
  LEGAL_INFO,
  isLegalInfoComplete,
  isPlaceholder,
  type LegalInfo,
} from '@/lib/legal-info'

// ── Agent 34 — legal-info completeness guard ─────────────────────────────────
// Locks the behaviour that drives the "en cours de finalisation" banner: the
// shipped LEGAL_INFO (all placeholders) must read as INCOMPLETE, a fully-filled
// one as COMPLETE, optional fields (tvaIntra/telephone) must never block, and any
// single required field left as a placeholder flips it back to incomplete.

const FILLED: LegalInfo = {
  editor: {
    raisonSociale:        'Grubano SAS',
    formeJuridique:       'SAS',
    capitalSocial:        '10 000 €',
    siren:                '900000000',
    siret:                '90000000000011',
    rcsVille:             'Avignon',
    tvaIntra:             'FR00900000000',
    siegeAdresse:         '1 rue Exemple, 84000 Avignon',
    email:                'contact@grubano.com',
    telephone:            '+33 4 00 00 00 00',
    directeurPublication: 'Mohammed Maazouz',
  },
  host: {
    nom:     'Hébergeur Exemple',
    adresse: '2 rue Hébergeur, 00000 Ville',
    contact: 'support@hebergeur.example',
  },
  mediation: {
    nom:     'Médiateur Exemple',
    url:     'https://mediateur.example',
    adresse: '3 rue Médiation, 00000 Ville',
  },
}

describe('isPlaceholder', () => {
  it('flags empty, whitespace and the marker prefix; passes a real value', () => {
    expect(isPlaceholder('')).toBe(true)
    expect(isPlaceholder('   ')).toBe(true)
    expect(isPlaceholder('[[À COMPLÉTER — SIREN (9 chiffres)]]')).toBe(true)
    expect(isPlaceholder('Grubano SAS')).toBe(false)
  })
})

describe('isLegalInfoComplete', () => {
  it('the shipped LEGAL_INFO (all placeholders) is INCOMPLETE → banner shows', () => {
    expect(isLegalInfoComplete()).toBe(false)
    expect(isLegalInfoComplete(LEGAL_INFO)).toBe(false)
  })

  it('a fully-filled info is COMPLETE → banner hidden', () => {
    expect(isLegalInfoComplete(FILLED)).toBe(true)
  })

  it('optional fields (tvaIntra / telephone) left as placeholder do NOT block completion', () => {
    const info: LegalInfo = {
      ...FILLED,
      editor: {
        ...FILLED.editor,
        tvaIntra:  '[[À COMPLÉTER — TVA intracommunautaire (optionnel)]]',
        telephone: '[[À COMPLÉTER — téléphone (optionnel)]]',
      },
    }
    expect(isLegalInfoComplete(info)).toBe(true)
  })

  it('a single required field still a placeholder flips it back to incomplete', () => {
    const missingSiren: LegalInfo = {
      ...FILLED,
      editor: { ...FILLED.editor, siren: '[[À COMPLÉTER — SIREN (9 chiffres)]]' },
    }
    expect(isLegalInfoComplete(missingSiren)).toBe(false)

    const missingHost: LegalInfo = {
      ...FILLED,
      host: { ...FILLED.host, adresse: '' },
    }
    expect(isLegalInfoComplete(missingHost)).toBe(false)

    const missingMediator: LegalInfo = {
      ...FILLED,
      mediation: { ...FILLED.mediation, nom: '[[À COMPLÉTER — nom du médiateur de la consommation]]' },
    }
    expect(isLegalInfoComplete(missingMediator)).toBe(false)
  })
})
