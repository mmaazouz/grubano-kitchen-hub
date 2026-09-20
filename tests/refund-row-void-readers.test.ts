// tests/refund-row-void-readers.test.ts — MODE B commit B : ce que les LECTEURS disent d'une ligne libérée.
//
// La libération n'a de valeur que si personne ne la raconte de travers. Deux mensonges étaient
// possibles et sont épinglés ici :
//   · « le remboursement Stripe <id> a ÉCHOUÉ » avec, à la place de l'id, l'identifiant de la LIGNE —
//     une affirmation d'échec Stripe alors que rien n'a jamais existé chez Stripe ;
//   · l'état argent « stripe_failed », dont la consigne opérateur dit « statut enregistré d'après
//     Stripe » — faux pour la même raison.
// On vérifie aussi le sens inverse : une ligne (failed, re_…) doit CONSERVER l'ancien texte.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isReleasedRow } from '@/lib/refund-void-state'
import { moneyStateGuidance } from '@/lib/claim-action-rules'

const ROOT = path.join(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('MODE B — la consigne opérateur d’une ligne libérée ne ment pas', () => {
  it('row_voided a sa propre consigne, et elle n’affirme AUCUN versement', () => {
    const g = moneyStateGuidance('row_voided' as never)
    expect(typeof g).toBe('string')
    expect(g).toMatch(/LIBÉRÉE/)
    expect(g).toMatch(/n’a PAS été payé/)
    // elle ne doit pas reprendre la formule de stripe_failed (« statut enregistré d’après Stripe »)
    expect(g).not.toMatch(/d’après Stripe/)
  })

  it('la consigne stripe_failed reste INCHANGÉE pour une vraie ligne échouée chez Stripe', () => {
    expect(moneyStateGuidance('stripe_failed' as never)).toMatch(/d’après Stripe/)
  })
})

describe('MODE B — la cascade d’état argent teste la libération AVANT « failed »', () => {
  const src = read('lib/claims.ts')

  it('isReleasedRow est consulté avant la branche failed (sinon une ligne libérée serait « stripe_failed »)', () => {
    const flat = src.replace(/\s+/g, ' ')
    const released = flat.indexOf("isReleasedRow(row)) moneyState = 'row_voided'")
    const failed = flat.indexOf("row.status === 'failed') moneyState = 'stripe_failed'")
    expect(released).toBeGreaterThan(-1)
    expect(failed).toBeGreaterThan(-1)
    expect(released).toBeLessThan(failed)
  })

  it('la ligne lue porte bien le troisième discriminant (idempotencyKey)', () => {
    const flat = src.replace(/\s+/g, ' ')
    expect(flat).toMatch(/select: \{ id: true, orderId: true, status: true, amountCents: true, stripeRefundId: true, createdAt: true, reason: true, idempotencyKey: true \}/)
  })
})

describe('MODE B — le réconciliateur n’affirme plus un échec Stripe inexistant', () => {
  const src = read('lib/claims.ts')

  it('la branche « échec » distingue une ligne LIBÉRÉE d’un échec Stripe réel', () => {
    const flat = src.replace(/\s+/g, ' ')
    expect(flat).toMatch(/const released = !input\.stripeRefundId && isReleasedRow\(row\)/)
    expect(flat).toMatch(/refundError: released \?/)
    expect(flat).toMatch(/row_voided: la ligne de remboursement \$\{input\.refundRowId\} a été LIBÉRÉE/)
    // l'ancien texte survit pour le vrai cas (un id Stripe existe)
    expect(flat).toMatch(/stripe_failed: le remboursement Stripe \$\{input\.stripeRefundId \?\? input\.refundRowId\} a ÉCHOUÉ/)
  })

  it('la ligne est lue avec les deux discriminants nécessaires', () => {
    const flat = src.replace(/\s+/g, ' ')
    expect(flat).toMatch(/select: \{ status: true, reason: true, stripeRefundId: true, idempotencyKey: true \}/)
  })
})

describe('MODE B — le texte « ligne morte » décrit désormais une SORTIE', () => {
  const src = read('lib/claims.ts')

  it('il ne dit plus qu’aucune procédure ne lève le refus, et il nomme la libération + son instant', () => {
    expect(src).not.toMatch(/aucune procédure documentée ne lève ce refus/)
    expect(src).toMatch(/un administrateur peut la LIBÉRER/)
    expect(src).toMatch(/VOID_MIN_AGE_MS/)
    // et il reste honnête sur le fait que la libération ne paie rien
    expect(src).toMatch(/la libération ne verse rien/)
  })
})

describe('MODE B — le détecteur de « retour à la vie » est la seule alarme automatique', () => {
  it('le webhook alerte si un remboursement Stripe porte l’identité d’une ligne libérée', () => {
    const src = read('app/api/webhooks/stripe/route.ts')
    expect(src).toMatch(/isReleasedRow\(row\)/)
    expect(src).toMatch(/voided_row_came_alive/)
    // il ALERTE, il ne réécrit rien
    const at = src.indexOf('voided_row_came_alive')
    const window = src.slice(at - 600, at + 600)
    expect(window).not.toMatch(/prisma\.refund\.update/)
  })
})

describe('MODE B — le recensement MESURE les lignes libérées (une alerte n’est pas une mesure)', () => {
  it('le compteur existe des DEUX côtés, avec la même définition', () => {
    const lib = read('lib/claims-census.ts')
    const op = read('scripts/server/phase2-claims-gate.js')
    for (const s of [lib, op]) {
      expect(s).toMatch(/voidedRefundRows/)
      expect(s).toMatch(/status: 'failed'/)
      expect(s).toMatch(/stripeRefundId: null/)
    }
    expect(lib).toMatch(/idempotencyKey: \{ contains: VOID_KEY_MARK \}/)
    expect(op).toMatch(/idempotencyKey: \{ contains: ':void:' \}/)
  })

  it('le prédicat partagé et la requête du recensement décrivent le même objet', () => {
    expect(isReleasedRow({ status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o1:0:void:2026' })).toBe(true)
    expect(isReleasedRow({ status: 'failed', stripeRefundId: null, idempotencyKey: 'refund:o1:0:failed:re_1' })).toBe(false)
  })
})
