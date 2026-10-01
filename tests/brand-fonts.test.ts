// Polices de la charte AUTO-HÉBERGÉES (arbitrage Design 2026-08-19) :
// les 4 familles en @font-face locaux, fichiers présents, licences/provenance,
// et AUCUNE dépendance Google Fonts restante dans les feuilles de la charte.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const brandCss = readFileSync(join(root, 'app/brand-fonts.css'), 'utf8')

describe('brand-fonts.css — les 4 familles locales', () => {
  it('déclare Gabarito, Hanken Grotesk, JetBrains Mono et Cairo', () => {
    for (const fam of ['Gabarito', 'Hanken Grotesk', 'JetBrains Mono', 'Cairo']) {
      expect(brandCss).toContain(`font-family: '${fam}';`)
    }
  })

  it('chaque src pointe un fichier EXISTANT de public/fonts', () => {
    const files = [...brandCss.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1])
    expect(files.length).toBeGreaterThanOrEqual(15)
    for (const f of files) {
      expect(existsSync(join(root, 'public/fonts', f)), `public/fonts/${f} manquant`).toBe(true)
    }
  })

  it('plages de poids couvrant les besoins de la charte (400-900/800/700/800)', () => {
    expect(brandCss).toMatch(/font-family: 'Gabarito';[^}]*font-weight: 400 900/)
    expect(brandCss).toMatch(/font-family: 'Hanken Grotesk';[^}]*font-weight: 400 800/)
    expect(brandCss).toMatch(/font-family: 'JetBrains Mono';[^}]*font-weight: 400 700/)
    expect(brandCss).toMatch(/font-family: 'Cairo';[^}]*font-weight: 400 800/)
  })

  it('Cairo couvre le subset arabe (unicode-range U+0600-06FF)', () => {
    expect(brandCss).toMatch(/font-family: 'Cairo';[^}]*U\+0600-06FF/)
  })

  it('AUCUNE source distante dans brand-fonts.css', () => {
    expect(brandCss.includes('http')).toBe(false)
  })

  it('licences OFL + provenance présentes dans public/fonts', () => {
    for (const f of ['OFL-gabarito.txt', 'OFL-hanken-grotesk.txt', 'OFL-jetbrains-mono.txt', 'OFL-cairo.txt', 'provenance.json']) {
      expect(existsSync(join(root, 'public/fonts', f)), `${f} manquant`).toBe(true)
    }
  })

  it('le layout racine importe brand-fonts.css', () => {
    const layout = readFileSync(join(root, 'app/[locale]/layout.tsx'), 'utf8')
    expect(layout).toContain("import '../brand-fonts.css'")
  })
})

describe('aucun @import Google Fonts restant dans les feuilles de la charte', () => {
  const sheets = [
    'app/tokens.css',
    'app/gb-foundation/gb-tokens.css',
    'app/[locale]/franchise/franchise-landing.css',
    'app/[locale]/franchise/apply/franchise-apply.css',
    'app/[locale]/creators/creator-landing.css',
    'app/[locale]/creators/apply/creator-apply.css',
    'app/[locale]/business/logistics/logistics-landing.css',
    'app/[locale]/business/logistics/register/logistics-apply-form.css',
    'app/[locale]/affiliate/apply/affiliate-landing.css',
    'app/[locale]/affiliate/apply/candidature/affiliate-apply-form.css',
    'app/[locale]/eat/orders/orders.css',
  ]
  for (const rel of sheets) {
    it(rel, () => {
      const css = readFileSync(join(root, rel), 'utf8')
      expect(css.includes("@import url('https://fonts.googleapis")).toBe(false)
    })
  }
})
