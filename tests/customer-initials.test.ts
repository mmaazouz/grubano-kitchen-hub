// Initiales par GRAPHÈMES + fallback déterministe (arbitrage Design 2026-08-19).
// Les tests vérifient l'arbitrage — ils ne créent aucune politique nouvelle.
import { describe, expect, it } from 'vitest'
import { customerInitials, NEUTRAL_GLYPH } from '@/lib/customer-initials'

describe('customerInitials — règle des graphèmes', () => {
  it('cas nominal : Marc Dupont → MD', () => {
    expect(customerInitials('Marc Dupont')).toBe('MD')
  })

  it('un seul mot → une seule initiale', () => {
    expect(customerInitials('Sophie')).toBe('S')
  })

  it('accents précomposés conservés (É, Ầ)', () => {
    expect(customerInitials('Élodie Martin')).toBe('ÉM')
    expect(customerInitials('Ầu Văn')).toBe('ẦV')
  })

  it('graphème COMPOSÉ (NFD, plusieurs code points) pris en entier', () => {
    // A + circonflexe combinant + grave combinant = Ầ décomposé (3 code points)
    const nfd = 'A\u0302\u0300u Nguyen'
    const out = customerInitials(nfd)
    expect(out.normalize('NFC').startsWith('Ầ')).toBe(true)
    // le graphème décomposé complet (3 unités) + N : jamais tronqué
    expect(out.length).toBe(4)
  })

  it('écritures non latines (cyrillique, majuscule appliquée)', () => {
    expect(customerInitials('дмитрий Иванов')).toBe('ДИ')
  })

  it('arabe (sans casse — graphèmes conservés tels quels)', () => {
    expect(customerInitials('محمد معزوز')).toBe('مم')
  })

  it('Ǆ (U+01C4) reste une initiale légitime — la contention gère la largeur', () => {
    expect(customerInitials('Ǆemal Ǆaković')).toBe('ǄǄ')
    expect(customerInitials('ǆemal ǆaković')).toBe('ǄǄ')
  })

  it('emoji en tête de mot : la première LETTRE exploitable du mot est utilisée', () => {
    expect(customerInitials('\u{1F468}‍\u{1F373} Chef')).toBe('C')
    // le mot-emoji stérile ne contribue pas ; la règle reste « les 2 premiers
    // mots » → une seule initiale (pas de remplacement par le 3e mot)
    expect(customerInitials('\u{1F469} Marie Dupont')).toBe('M')
  })

  it('emoji jamais rendu en demi-surrogate (l ancien w[0] cassait les astraux)', () => {
    const out = customerInitials('\u{1F355}Pizza Corp')
    expect(out).toBe('PC')
    expect(out.includes('�')).toBe(false)
  })

  it('chiffres : non-lettres → première lettre exploitable du mot', () => {
    expect(customerInitials('7-Eleven Shop')).toBe('ES')
    expect(customerInitials('123 Restaurant')).toBe('R')
  })

  it('ponctuation seule en tête de mot ignorée', () => {
    expect(customerInitials("'' Dupont")).toBe('D')
  })

  it('email comme nom : fallback déterministe = première lettre, donnée intacte', () => {
    expect(customerInitials('m.maazouz@gmail.com')).toBe('M')
  })

  it('aucune lettre exploitable → glyphe NEUTRE unique, jamais vide, jamais brut', () => {
    expect(customerInitials('\u{1F355}\u{1F355}')).toBe(NEUTRAL_GLYPH)
    expect(customerInitials('123 456')).toBe(NEUTRAL_GLYPH)
    expect(customerInitials('')).toBe(NEUTRAL_GLYPH)
    expect(customerInitials('   ')).toBe(NEUTRAL_GLYPH)
    expect(NEUTRAL_GLYPH.length).toBe(1)
  })

  it('2 premiers mots sans lettre mais nom lettré ailleurs → première lettre du nom', () => {
    expect(customerInitials('123 456 Marc')).toBe('M')
  })

  it('déterministe : même entrée → même sortie', () => {
    for (const n of ['Marc Dupont', 'محمد', '\u{1F355}\u{1F355}', 'Ǆemal Ǆaković']) {
      expect(customerInitials(n)).toBe(customerInitials(n))
    }
  })
})
