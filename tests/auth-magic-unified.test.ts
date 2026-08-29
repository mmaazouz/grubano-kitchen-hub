// ── /fr/auth/magic UNIFIÉ sur tous les hôtes (mission 2026-08-30) ─────────────
// La page ne doit plus JAMAIS diverger par hostname : même shell moderne
// (PartnerShell, réf bankée), même lien d'inscription, sur app.grubano.com ET
// business.grubano.com. Verrous SOURCE (le rendu SSR/browser est prouvé au banc
// Puppeteer + curl du train — ces tests empêchent la RÉGRESSION du mécanisme).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(path.join(process.cwd(), 'app', '[locale]', 'auth', 'magic', 'page.tsx'), 'utf8')
// portion CODE seulement (les commentaires documentent l'historique et peuvent
// citer les anciens noms) : on retire les commentaires avant d'asserter.
const CODE = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

describe('/auth/magic — expérience unifiée (aucune divergence hostname)', () => {
  it('ne lit PLUS le hostname (fini le conditionnel client business/app)', () => {
    expect(CODE).not.toMatch(/hostname/)
    expect(CODE).not.toMatch(/isPartner/)
  })

  it("n'utilise PLUS le chrome legacy PartnerChrome (ancienne identité)", () => {
    expect(CODE).not.toMatch(/PartnerChrome/)
  })

  it('rend le shell moderne PartnerShell INCONDITIONNELLEMENT', () => {
    expect(CODE).toMatch(/import PartnerShell from '@\/components\/business\/PartnerShell'/)
    expect(CODE).toMatch(/<PartnerShell mode="parcours"/)
  })

  it("le lien d'inscription partenaire est UNCONDITIONNEL (plus d'impasse UX)", () => {
    expect(CODE).toMatch(/registerPrompt/)
    expect(CODE).toMatch(/href="\/business\/start"/)
    // il vit HORS de tout bloc conditionnel isPartner (déjà garanti par le 1er test)
  })

  it('le chrome + titre + lien inscription vivent HORS du bailout Suspense (SSR non blanche)', () => {
    // le Suspense n'enveloppe QUE la carte dynamique, avec un squelette non-nul
    expect(CODE).toMatch(/<Suspense fallback=\{<CardSkeleton \/>\}>/)
    expect(CODE).not.toMatch(/fallback=\{null\}/)
    const suspensePos = CODE.indexOf('<Suspense')
    expect(CODE.indexOf('<PartnerShell')).toBeGreaterThan(-1)
    expect(CODE.indexOf('<PartnerShell')).toBeLessThan(suspensePos)
    expect(CODE.indexOf('registerPrompt', suspensePos)).toBeGreaterThan(suspensePos) // lien après la carte, hors MagicCard
  })

  it('aucun OperatorShell (verrou auth-magic-bare préservé)', () => {
    expect(CODE).not.toMatch(/OperatorShell/)
  })

  it('le flow magic est inchangé (mêmes appels : mint + credentials magicToken/otp)', () => {
    expect(CODE).toMatch(/requestMagicLink\(email, \{ locale \}\)/)
    expect(CODE).toMatch(/signIn\('credentials', \{ magicToken: token, redirect: false \}\)/)
    expect(CODE).toMatch(/signIn\('credentials', \{ email, otp: c, redirect: false \}\)/)
  })
})
