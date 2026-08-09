import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Mission AW — rendu du reçu post-paiement : la conception AQ en 5 blocs ────
// Correction PUREMENT VISUELLE : gardes, sélection serveur et données intactes
// (la route n'est pas touchée — tests AU inchangés). Ces tests verrouillent :
// le total des consommations conditionnel (règle AQ), la ville dédupliquée,
// les mentions restaurées toujours présentes, le vert rendu à l'état payé
// (plus d'orange), l'absence de termes interdits et de ressources distantes,
// et la non-régression du lien « Reçu » delivery/pickup.

const ROOT = process.cwd()
const PAGE = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'receipt', '[id]', 'page.tsx'), 'utf8')
const CSS = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'receipt', '[id]', 'receipt.css'), 'utf8')
const ORDERS = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'orders', 'page.tsx'), 'utf8')

describe('AW — total des consommations : conditionnel selon la règle AQ', () => {
  it('⭐ le bloc totaux ne se rend QUE quand subtotal diverge de amountPaid (égaux → le héros suffit, rien de répété)', () => {
    // Le rendu des totaux est enveloppé dans le test de divergence…
    expect(PAGE).toMatch(/receipt\.subtotal !== receipt\.amountPaid \? \([\s\S]{0,400}?rc-totals[\s\S]{0,400}?\) : null/)
    // …et les deux libellés distincts y restent (le cas divergent affiche TOUJOURS les deux).
    const totalsBlock = PAGE.match(/receipt\.subtotal !== receipt\.amountPaid \? \(([\s\S]*?)\) : null/)?.[1] ?? ''
    expect(totalsBlock).toContain("t('linesTotal')")
    expect(totalsBlock).toContain("t('amountPaid')")
    expect(totalsBlock).toContain('money(receipt.subtotal)')
  })

  it('⭐ le montant payé n’est plus rendu deux fois hors divergence : un seul money(amountPaid) hors du bloc conditionnel (le héros)', () => {
    const outside = PAGE.replace(/receipt\.subtotal !== receipt\.amountPaid \? \(([\s\S]*?)\) : null/, '')
    expect((outside.match(/money\(receipt\.amountPaid\)/g) ?? []).length).toBe(1)
  })
})

describe('AW — la ville n’apparaît qu’une fois', () => {
  it('⭐ l’adresse est dédupliquée (containment insensible casse/accents) et l’ancienne jointure aveugle a disparu', () => {
    expect(PAGE).toMatch(/norm\(addr\)\.includes\(norm\(city\)\) \? addr : `\$\{addr\}, \$\{city\}`/)
    expect(PAGE).toContain("normalize('NFD')")
    expect(PAGE).not.toContain('[receipt.address, receipt.city].filter(Boolean).join')
  })

  it('la logique elle-même : « 84100 Orange » + ville « Orange » → une seule occurrence ; ville absente → ajoutée', () => {
    // Reproduit la fonction de la page (même classe de caractères combinants).
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const line = (addr: string, city: string) =>
      norm(addr).includes(norm(city)) ? addr : `${addr}, ${city}`
    expect(line('12 Rue de la République, 84100 Orange', 'Orange')).toBe('12 Rue de la République, 84100 Orange')
    expect(line('1 quai des Moulins, 34200 SETE', 'Sète')).toBe('1 quai des Moulins, 34200 SETE')
    expect(line('12 Rue des Lices', 'Avignon')).toBe('12 Rue des Lices, Avignon')
  })
})

describe('AW — les mentions restaurées par revue adversariale restent (discrètes, jamais retirées)', () => {
  it('⭐ clause de nature + mention de consultation toujours rendues', () => {
    expect(PAGE).toContain("t('disclaimer')")
    expect(PAGE).toContain("t('editedLine'")
    // Discrètes : dans le pied (rc-foot), tailles CSS < corps de texte.
    expect(PAGE).toMatch(/rc-foot[\s\S]{0,300}?t\('disclaimer'\)/)
    expect(CSS).toMatch(/\.rc-foot p \{[^}]*font-size: 11\.5px/)
  })
})

describe('AW — le VERT rendu à l’état payé (l’orange reste à l’addition en cours)', () => {
  it('⭐ héros, pastille et sceau sur les tokens --gb-success ; plus AUCUN --gb-accent dans le CSS du reçu', () => {
    expect(CSS).toMatch(/\.rc-hero \{[\s\S]{0,400}?--gb-success/)
    expect(CSS).toMatch(/rc-banner__pill[\s\S]{0,200}?--gb-success/)
    expect(CSS).toMatch(/rc-seal[\s\S]{0,200}?--gb-success/)
    expect(CSS).not.toContain('--gb-accent')
    expect(CSS).not.toContain('#FF6A1F')
  })

  it('⭐ hiérarchie du héros : label AU-DESSUS, montant dominant (36px/800), date en sous-titre EN DESSOUS', () => {
    const hero = PAGE.match(/<div className="rc-hero">([\s\S]*?)<\/div>/)?.[1] ?? ''
    const iLabel = hero.indexOf("t('heroLabel')")
    const iAmount = hero.indexOf('money(receipt.amountPaid)')
    const iWhen = hero.indexOf("t('paidLine'")
    expect(iLabel).toBeGreaterThan(-1)
    expect(iAmount).toBeGreaterThan(iLabel)
    expect(iWhen).toBeGreaterThan(iAmount)
    expect(CSS).toMatch(/rc-hero__amount \{[^}]*font-size: 36px/)
  })

  it('les 5 blocs séparés existent avec respiration (grid gap), l’ancienne carte unique a disparu', () => {
    for (const cls of ['rc-banner', 'rc-hero', 'rc-seal', 'rc-lines', 'rc-meta']) {
      expect(PAGE).toContain(`className="${cls}`)
    }
    expect(PAGE).not.toContain('rc-card')
    expect(PAGE).not.toContain('rc-estab')
    expect(CSS).toMatch(/\.rc-blocks \{ display: grid; gap: 14px/)
  })

  it('le titre du détail n’a plus de parenthèse technique + un compteur d’articles existe (×5 locales)', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const j = JSON.parse(readFileSync(join(ROOT, `messages/${loc}.json`), 'utf8'))
      const r = j.eat?.receipt
      expect(r?.linesLabel, `${loc} linesLabel`).not.toMatch(/\(|\)/)
      for (const k of ['paidPill', 'heroLabel', 'sealLabel', 'bannerTable', 'bannerDinein', 'linesCount']) {
        expect(r?.[k], `${loc} ${k}`).toBeTruthy()
      }
    }
    expect(PAGE).toContain("t('linesCount', { count: receipt.lines.length })")
  })
})

describe('AW — sûreté du rendu', () => {
  it('⭐ aucun terme interdit sur la page ni dans les clés ×5 (Stripe, TVA/HT/TTC, facture, moyen de paiement, PII)', () => {
    const FORBIDDEN = /stripe|pi_|\btva\b|\bvat\b|\bttc\b|\bht\b|facture|invoice|allergi|paymentMethod|cardNumber/i
    expect(PAGE).not.toMatch(FORBIDDEN)
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const j = JSON.parse(readFileSync(join(ROOT, `messages/${loc}.json`), 'utf8'))
      const vals = Object.values(j.eat.receipt as Record<string, string>).join(' ')
      expect(vals, loc).not.toMatch(/stripe|pi_|\btva\b|\bvat\b|facture d|invoice/i)
    }
  })

  it('⭐ aucune ressource distante (page + css), icônes = Material Symbols locaux uniquement', () => {
    expect(PAGE).not.toMatch(/https?:\/\//)
    expect(CSS).not.toMatch(/url\(|@import|@font-face|https?:\/\//)
    expect(PAGE).not.toMatch(/from 'lucide-react'/) // pas nécessaire ici — ms locaux suffisent
  })

  it('⭐ RTL conservé : montants en <bdi> (≥5) + flèche retour ms-flip, y compris dans les nouveaux blocs', () => {
    expect((PAGE.match(/<bdi>/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(PAGE).toContain('className="ms ms-flip rc-back"')
    const hero = PAGE.match(/rc-hero__amount"><bdi>/)
    expect(hero).not.toBeNull()
  })

  it('⭐ NON-RÉGRESSION delivery/pickup : le Link « Reçu » partagé garde EXACTEMENT ses deux branches (AU, byte-identique)', () => {
    expect(ORDERS).toContain(
      'href={c.kind === \'dinein\' ? `/eat/receipt/${c.id}` : `/eat/track/${c.trackingId}`}',
    )
  })
})
