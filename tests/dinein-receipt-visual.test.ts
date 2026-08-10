import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Mission BC — reproduction VERBATIM de la référence archivée ───────────────
// La cible est scripts/design-qa-refs/eat-receipt.html (écran 3 « Payée » de la
// conception AQ), mesurée par le robot design-qa (écran `eat-receipt`). Ces
// tests verrouillent la STRUCTURE (le pixel est jugé par le robot, pas ici) :
// les 3 mentions SORTIES (décision fondateur), la hiérarchie du héros (montant
// NAVY, date nue), la carte détail fermée par « Total payé », la méta 4 rangées,
// les 2 actions gatées par contexte, l'absence de termes interdits et de
// ressources distantes, la non-régression delivery/pickup, et l'intégrité de la
// référence + de son câblage (la mesure ne doit pas être déplacée).

const ROOT = process.cwd()
const PAGE = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'receipt', '[id]', 'page.tsx'), 'utf8')
const CSS = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'receipt', '[id]', 'receipt.css'), 'utf8')
const ORDERS = readFileSync(join(ROOT, 'app', '[locale]', 'eat', 'orders', 'page.tsx'), 'utf8')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar'] as const
const msg = (loc: string) => JSON.parse(readFileSync(join(ROOT, `messages/${loc}.json`), 'utf8'))

describe('BC — les trois mentions SORTENT (décision fondateur — la référence prime)', () => {
  it('⭐ clause de nature, mention de consultation et note lignes-gelées ABSENTES du rendu', () => {
    expect(PAGE).not.toContain("t('disclaimer')")
    expect(PAGE).not.toContain("t('editedLine'")
    expect(PAGE).not.toContain("t('linesNote')")
    expect(PAGE).not.toContain('rc-nature')
    expect(PAGE).not.toContain('rc-brand') // logotype de pied absent de la référence
  })

  it('⭐ leurs clés i18n sont retirées des 5 locales (ordre fondateur explicite)', () => {
    for (const loc of LOCALES) {
      const r = msg(loc).eat.receipt
      expect(r.disclaimer, `${loc} disclaimer`).toBeUndefined()
      expect(r.editedLine, `${loc} editedLine`).toBeUndefined()
      expect(r.linesNote, `${loc} linesNote`).toBeUndefined()
    }
  })
})

describe('BC — structure de la référence (écran 3 « Payée »)', () => {
  it('⭐ barre de titre : « Mon addition » + pastille de référence mono (code de session)', () => {
    expect(msg('fr').eat.receipt.title).toBe('Mon addition')
    expect(PAGE).toMatch(/rc-tnum mono"><bdi>#\{receipt\.sessionCode\}/)
  })

  it('⭐ héros : label → montant → date NUE (sans préfixe), montant en NAVY (couleur de texte), fond TRÈS PÂLE', () => {
    const hero = PAGE.match(/<div className="rc-hero">([\s\S]*?)<\/div>/)?.[1] ?? ''
    const iLabel = hero.indexOf("t('heroLabel')")
    const iAmount = hero.indexOf('money(receipt.amountPaid)')
    const iWhen = hero.indexOf("t('heroDate'")
    expect(iLabel).toBeGreaterThan(-1)
    expect(iAmount).toBeGreaterThan(iLabel)
    expect(iWhen).toBeGreaterThan(iAmount)
    expect(hero).not.toContain("t('paidLine'") // la date du héros est NUE
    expect(CSS).toMatch(/rc-hero__amount \{[\s\S]{0,300}?color: var\(--gb-text\)/)
    expect(CSS).toMatch(/rc-hero \{[\s\S]{0,300}?linear-gradient\(160deg, var\(--gb-success-bg/)
    expect(CSS).toMatch(/rc-hero__amount \{[\s\S]{0,200}?font-size: 36px/)
  })

  it('⭐ la carte détail se ferme par « Total payé » ; le total des lignes ne s’y ajoute QUE s’il diverge (centimes)', () => {
    const card = PAGE.match(/<section className="rc-lines">([\s\S]*?)<\/section>/)?.[1] ?? ''
    expect(card).toContain('rc-total--paid')
    expect(card).toContain('money(receipt.amountPaid)')
    expect(PAGE).toMatch(/Math\.round\(receipt\.subtotal \* 100\) !== Math\.round\(receipt\.amountPaid \* 100\)/)
    const cond = PAGE.match(/\{showSubtotal \? \(([\s\S]*?)\) : null\}/)?.[1] ?? ''
    expect(cond).toContain("t('linesTotal')")
    expect(cond).toContain('money(receipt.subtotal)')
    // « Session / réservation » n'est plus intercalée entre détail et total.
    expect(PAGE).not.toContain("t('sessionLabel'")
  })

  it('⭐ en-tête du détail : « Détail de l’addition », icône restaurant_menu, compteur ROND (nombre seul + aria pluriel)', () => {
    expect(msg('fr').eat.receipt.linesLabel).toBe("Détail de l'addition")
    const head = PAGE.match(/rc-lines__head([\s\S]*?)<\/header>/)?.[1] ?? ''
    expect(head).toContain('restaurant_menu')
    expect(head).toMatch(/rc-lines__count mono" aria-label=\{t\('linesCount'/)
    expect(head).toContain('{receipt.lines.length}')
    expect(CSS).toMatch(/rc-lines__count \{[\s\S]{0,200}?border-radius: 999px/)
  })

  it('⭐ méta : 4 rangées clé/valeur (Restaurant · Table · Payée le · Référence), valeurs date/réf en mono', () => {
    const meta = PAGE.match(/<section className="rc-meta">([\s\S]*?)<\/section>/)?.[1] ?? ''
    for (const k of ['metaRestaurant', 'metaTable', 'metaPaidAt', 'metaRef']) {
      expect(meta).toContain(`t('${k}')`)
    }
    expect((meta.match(/rc-meta__v mono/g) ?? []).length).toBe(2)
    // La méta compte EXACTEMENT les 4 rangées de la référence — adresse et
    // raison sociale n'y figurent pas. Revue BC : c'est un retrait de contenu
    // AU-DELÀ des 3 mentions listées par le fondateur, signalé au rapport pour
    // arbitrage ; on verrouille donc la conformité à la référence (4 rangées),
    // PAS une interdiction définitive de ces deux données.
    expect((meta.match(/rc-meta__row/g) ?? []).length).toBe(4)
  })

  it('⭐ actions : « Noter » gatée par une lecture SERVEUR (jamais un paramètre d’URL) ; « Un problème » = canal réel mailto avec la référence', () => {
    // Revue BC : un ?r= falsifié aurait publié un VRAI avis chez un autre
    // restaurant. L'id vient de MES commandes (session-gatée) et doit
    // correspondre à CE ticket.
    expect(PAGE).not.toContain('URLSearchParams')
    expect(PAGE).toContain("fetch('/api/eat/orders')")
    expect(PAGE).toMatch(/c\?\.kind === 'dinein' && c\?\.id === id/)
    expect(PAGE).toMatch(/\{rateRestoId \? \([\s\S]{0,400}?\/eat\/r\/\$\{rateRestoId\}\/reviews/)
    expect(PAGE).toMatch(/mailto:contact@grubano\.com\?subject=\$\{encodeURIComponent\(t\('issueSubject'/)
  })

  it('pied : « Reçu conservé dans “Mes commandes” » (référence), rien d’autre', () => {
    expect(PAGE).toMatch(/rc-foot">\{t\('footNote'\)\}/)
  })

  it('les 9 nouvelles clés existent ×5 et paidLine/sessionLabel/table/officialName restent (règle « aucune clé supprimée » hors ordre fondateur)', () => {
    for (const loc of LOCALES) {
      const r = msg(loc).eat.receipt
      for (const k of ['heroDate', 'metaRestaurant', 'metaTable', 'metaPaidAt', 'metaRef', 'footNote', 'rateAction', 'issueAction', 'issueSubject']) {
        expect(r[k], `${loc} ${k}`).toBeTruthy()
      }
      for (const k of ['paidLine', 'sessionLabel', 'table', 'officialName']) {
        expect(r[k], `${loc} ${k} (conservée)`).toBeTruthy()
      }
    }
  })
})

describe('BC — sûreté et non-régression', () => {
  it('⭐ aucun terme interdit sur la page ni dans les nouvelles clés ×5', () => {
    // Revue BC : \bht\b et cardNumber RESTAURÉS (aucun des deux ne matchait la
    // page — leur retrait avait affaibli le filet sans nécessité).
    expect(PAGE).not.toMatch(/stripe|pi_|\btva\b|\bvat\b|\bttc\b|\bht\b|facture|invoice|allergi|paymentMethod|cardNumber/i)
    for (const loc of LOCALES) {
      const vals = Object.values(msg(loc).eat.receipt as Record<string, string>).join(' ')
      expect(vals, loc).not.toMatch(/stripe|pi_|\btva\b|\bvat\b|facture d|invoice/i)
    }
  })

  it('⭐ aucune ressource distante dans la PAGE (le mailto n’est pas une ressource) ni dans le CSS', () => {
    expect(PAGE).not.toMatch(/https?:\/\//)
    expect(CSS).not.toMatch(/url\(|@import|@font-face|https?:\/\//)
  })

  it('⭐ RTL : montants/codes en <bdi> (≥7) + flèche retour et chevrons ms-flip', () => {
    expect((PAGE.match(/<bdi>/g) ?? []).length).toBeGreaterThanOrEqual(7)
    expect(PAGE).toContain('className="ms ms-flip rc-back"')
    expect(PAGE).toContain('ms ms-flip rc-act__chev')
  })

  it('⭐ « Mes commandes » STRICTEMENT inchangée : le Link partagé est byte-identique (delivery/pickup → /eat/track)', () => {
    expect(ORDERS).toContain("c.kind === 'dinein' ? `/eat/receipt/${c.id}` : `/eat/track/${c.trackingId}`")
  })

  it('⭐ l’état ACQUIS reste vert (héros + sceau sur basil/success) ; les accents zest reproduisent la référence, jamais --gb-accent', () => {
    // Revue BC : la garde couleur d'AW avait disparu. La référence emploie
    // elle-même --gb-zest-600 pour les accents (quantité, chevrons, pastille de
    // référence) — c'est l'ÉTAT PAYÉ (héros, sceau) qui doit rester vert.
    expect(CSS).toMatch(/rc-hero__label \{[\s\S]{0,300}?--gb-basil-600/)
    expect(CSS).toMatch(/rc-seal \{[\s\S]{0,300}?--gb-basil-600/)
    expect(CSS).toMatch(/rc-banner__pill \{[\s\S]{0,300}?#7FD8A4/)
    expect(CSS).not.toContain('--gb-accent')
  })

  it('⭐ la RÉFÉRENCE et son câblage ne sont PAS altérés (la mesure n’a pas bougé)', () => {
    const ref = readFileSync(join(ROOT, 'scripts', 'design-qa-refs', 'eat-receipt.html'), 'utf8')
    expect(ref).toContain('<b>Mon addition</b>')
    expect(ref).toContain("Détail de l'addition")
    expect(ref).toContain('class="totrow tot"')
    const cfg = readFileSync(join(ROOT, 'scripts', 'design-qa.config.mjs'), 'utf8')
    expect(cfg).toContain("name: 'eat-receipt'")
    expect(cfg).toContain("url: '/fr/eat/receipt/demo'")
    expect(cfg).toContain("reference: 'scripts/design-qa-refs/eat-receipt.html'")
  })
})
