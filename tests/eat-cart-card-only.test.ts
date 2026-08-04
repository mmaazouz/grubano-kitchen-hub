import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-30 (vague 2 — Q2 fondateur) : le panier /eat ne propose PLUS les espèces ──
// Depuis P0-02 le serveur refuse toute création non-carte ; le panier proposait
// pourtant encore le toggle « Espèces à la livraison » → l'utilisateur recevait le
// 400 serveur affiché brut (cul-de-sac signalé en mission C, axe 3 du sondage).
// P0-30 retire le choix de l'interface : la carte est le seul mode, AUCUN chemin
// d'interface ne mène au refus serveur. Source-scan style (composant 'use client',
// vérité navigateur hors harnais node — même style maison que
// tests/eat-wallet-checkout.test.ts), commentaires STRIPPÉS avant scan.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const CART = 'app/[locale]/eat/cart/page.tsx'

describe('P0-30 — le mode espèces n’est plus proposé par le panier', () => {
  const code = stripComments(read(CART))

  it("⭐ plus aucun state card|cash ni toggle setPayment — le choix a disparu de l'interface", () => {
    expect(/useState<'card'\s*\|\s*'cash'>/.test(code)).toBe(false)
    expect(/setPayment/.test(code)).toBe(false)
  })

  it("⭐ le mode est une CONSTANTE 'card' et c'est elle qui part au serveur (paymentMethod: payment)", () => {
    expect(/const payment = 'card' as const/.test(code)).toBe(true)
    expect(/paymentMethod:\s*payment/.test(code)).toBe(true)
  })

  it("plus aucune mention d'espèces dans le code actif (cashOnDelivery retiré de l'affichage)", () => {
    expect(/cashOnDelivery/.test(code)).toBe(false)
    expect(/'cash'/.test(code)).toBe(false)
  })

  it("l'AUTRE émetteur (eat-next/checkout-order.ts) reste câblé 'card' en dur — verrouillé lui aussi (revue)", () => {
    const co = stripComments(read('app/[locale]/eat-next/checkout-order.ts'))
    expect(/paymentMethod:\s*'card'/.test(co)).toBe(true)
    expect(/'cash'|'wallet'/.test(co)).toBe(false)
  })

  it('parcours carte inchangé : post-succès → TOUJOURS /eat/checkout/[orderId] (la branche non-carte → /eat/track est retirée)', () => {
    expect(/router\.push\(`\/eat\/checkout\/\$\{data\.orderId\}`\)/.test(code)).toBe(true)
    expect(/router\.push\(`\/eat\/track\/\$\{data\.orderId\}`\)/.test(code)).toBe(false)
  })

  it("cohérence post-pilote : la clé i18n cashOnDelivery reste dans les messages (capacité réversible, rien n'est détruit)", () => {
    const fr = JSON.parse(read('messages/fr.json')) as Record<string, unknown>
    const walk = (o: unknown): boolean => {
      if (!o || typeof o !== 'object') return false
      return Object.entries(o as Record<string, unknown>).some(([k, v]) =>
        k === 'cashOnDelivery' || walk(v))
    }
    expect(walk(fr)).toBe(true)
  })
})
