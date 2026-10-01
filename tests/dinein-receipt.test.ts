import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Mission AU — reçu post-paiement dine-in (surface privée /eat/receipt/[id]) ──
// Contrats épinglés :
//   • GET /api/eat/tickets/[id]/receipt : gardes = patron AR à l'identique,
//     PROPRIÉTÉ AVANT STATUT (un tiers n'apprend jamais si l'addition est
//     payée) ; walk-in/inexistant/pendu indistinguables ; amountPaid servi tel
//     quel (jamais recalculé) ; aucun identifiant Stripe/technique.
//   • Carte « Mes commandes » : le « Reçu » dine-in mène à /eat/receipt/[id] ;
//     delivery/pickup STRICTEMENT inchangés ; « Recommander » intact ; le
//     bouton « Justificatif » et son handler ont disparu de l'interface (la
//     route PDF et ses tests restent, hors interface).
//   • i18n : eat.receipt ×5, espace client toujours exempt de termes fiscaux
//     (l'acquis est aussi épinglé par tests/payment-proof.test.ts sur eat.*).

const { db, tokenMock } = vi.hoisted(() => ({
  db: {
    tableTicket: { findUnique: vi.fn() },
    reservation: { findUnique: vi.fn() },
  },
  tokenMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

import { GET } from '@/app/api/eat/tickets/[id]/receipt/route'
import { reservationCode } from '@/lib/reservation-code'

const call = (id = 'tk1') =>
  GET(new Request(`https://app.grubano.com/api/eat/tickets/${id}/receipt`) as never, { params: { id } })

// Lignes GELÉES divergentes du montant encaissé (30,50 vs 34,50) : le reçu doit
// servir LES DEUX valeurs stockées, sans jamais recalculer.
const PAID_TICKET = {
  status: 'paid', currency: 'eur',
  subtotal: 30.5, amountPaid: 34.5,
  paidAt: new Date('2026-08-08T19:47:00Z'),
  reservationId: 'resv1',
  items: [
    { name: 'Gnocchi gorgonzola', unitPrice: 12, quantity: 2 },
    { name: 'Tiramisu', unitPrice: 6.5, quantity: 1 },
  ],
  restaurant: {
    name: 'Gnocchi Bar', address: '12 rue des Antiquaires', city: 'Orange',
    operator: { officialName: null },
  },
  restaurantTable: { name: 'T4' },
}

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'u1' })
  db.tableTicket.findUnique.mockResolvedValue(PAID_TICKET)
  db.reservation.findUnique.mockResolvedValue({ userId: 'u1' })
})

describe('AU — GET /api/eat/tickets/[id]/receipt : accès (patron AR, propriété AVANT statut)', () => {
  it('⭐ propriétaire + payé → 200, données du reçu, amountPaid SERVI TEL QUEL (30,50 de lignes / 34,50 payés), no-store', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    const { receipt } = await res.json()
    expect(receipt.amountPaid).toBe(34.5)          // référence, jamais recalculée
    expect(receipt.subtotal).toBe(30.5)            // total STOCKÉ, libellé distinct côté page
    expect(receipt.paidAt).toBe('2026-08-08T19:47:00.000Z')
    expect(receipt.currency).toBe('eur')
    expect(receipt.lines).toEqual(PAID_TICKET.items) // détail gelé, ordre inclus
    expect(receipt.sessionCode).toBe(reservationCode('resv1'))
    expect(receipt.restaurantName).toBe('Gnocchi Bar')
    expect(receipt.officialName).toBeNull()        // jamais de placeholder
    expect(receipt.tableName).toBe('T4')
    expect(db.reservation.findUnique).toHaveBeenCalledWith({ where: { id: 'resv1' }, select: { userId: true } })
  })

  it('⭐ un AUTRE compte → 403, même sur une addition NON payée (propriété jugée AVANT statut — le statut ne fuit jamais)', async () => {
    tokenMock.mockResolvedValue({ sub: 'u2' })
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, status: 'open' })
    const res = await call()
    expect(res.status).toBe(403) // pas 409 : un tiers n'apprend pas que l'addition n'est pas payée
    expect(await res.json()).toEqual({ error: 'Cette addition n’est pas liée à votre compte.' })
  })

  it('⭐ non payée (propriétaire) → 409, jamais traitée comme un reçu', async () => {
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, status: 'open' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Addition non payée — aucun reçu disponible.' })
  })

  it('⭐ walk-in (reservationId null) → 404, la réservation n’est JAMAIS interrogée — aucun accès privé par construction', async () => {
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, reservationId: null })
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Addition introuvable' })
    expect(db.reservation.findUnique).not.toHaveBeenCalled()
  })

  it('inexistante / rattachement pendu / réservation anonyme → mêmes réponses que le patron AR (404/404/403)', async () => {
    db.tableTicket.findUnique.mockResolvedValue(null)
    expect((await call('ghost')).status).toBe(404)
    db.tableTicket.findUnique.mockResolvedValue(PAID_TICKET)
    db.reservation.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    db.reservation.findUnique.mockResolvedValue({ userId: null })
    expect((await call()).status).toBe(403)
  })

  it('sans session → 401, la base n’est jamais consultée', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(db.tableTicket.findUnique).not.toHaveBeenCalled()
  })

  it('payée mais amountPaid/paidAt manquant (anomalie) → 500 tracé, aucun montant inventé', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, amountPaid: null })
    expect((await call()).status).toBe(500)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[AU]'))
    errSpy.mockRestore()
  })

  it('⭐ contenu interdit — le payload intégral est scanné : aucun identifiant Stripe/technique, aucune note/allergie, aucun terme fiscal', async () => {
    const body = JSON.stringify(await (await call()).json())
    for (const re of [
      /stripe/i, /\bpi_/i, /facture/i, /invoice/i, /\bTVA\b/i, /\bVAT\b/i, /\bHT\b/, /\bTTC\b/i,
      /référence/i, /\bnum[ée]ro\b/i, /N°/, /notes/i, /allergies/i, /addedBy/, /platformFee/i, /tipAmount/i,
      /"id"/, /reservationId/, // aucun identifiant technique ne sort (seul le code dérivé #XXXX)
    ]) {
      expect(body, `contenu interdit : ${re}`).not.toMatch(re)
    }
  })

  it('aucun identifiant Stripe sélectionné (preuve source)', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'api', 'eat', 'tickets', '[id]', 'receipt', 'route.ts'), 'utf8')
    expect(src).not.toContain('stripePaymentIntentId')
  })
})

describe('AU — carte « Mes commandes » : Reçu redirigé, Justificatif retiré, le reste intact (épinglage source)', () => {
  const src = readFileSync(join(__dirname, '..', 'app', '[locale]', 'eat', 'orders', 'page.tsx'), 'utf8')

  it('⭐ le « Reçu » dine-in mène à /eat/receipt/[id] ; delivery/pickup gardent /eat/track (branche BYTE-identique) ; jamais /t/ pour le reçu', () => {
    expect(src).toContain("c.kind === 'dinein' ? `/eat/receipt/${c.id}` : `/eat/track/${c.trackingId}`")
  })

  it('⭐ la carte COURANTE dine-in garde « Voir l’addition & payer » vers /t/[tableId] (surface publique de PAIEMENT, hors périmètre)', () => {
    expect(src).toContain('`/t/${c.tableId}`') // uniquement le CTA payer de la carte courante
    expect(src).toContain("t('actPayBill')")
  })

  it('⭐ « Recommander » inchangé (bouton partagé food/dine-in)', () => {
    expect(src).toContain("onClick={() => reorder(c)}")
    expect(src).toContain("t('reorder')")
  })

  it('⭐ le bouton « Justificatif de paiement » et toute sa plomberie ont disparu de l’interface', () => {
    expect(src).not.toContain('downloadPaymentProof')
    expect(src).not.toContain('proofErrs')
    expect(src).not.toContain("t('paymentProof')")
    expect(src).not.toContain('payment-proof') // plus aucun appel réseau vers la route PDF
  })

  it('la route PDF et son générateur restent dans l’arbre (hors interface — décision mission : signalés orphelins, pas supprimés)', () => {
    expect(() => readFileSync(join(__dirname, '..', 'app', 'api', 'eat', 'tickets', '[id]', 'payment-proof', 'route.ts'), 'utf8')).not.toThrow()
    expect(() => readFileSync(join(__dirname, '..', 'lib', 'payment-proof-pdf.ts'), 'utf8')).not.toThrow()
  })
})

describe('AU — i18n : eat.receipt ×5, clés du justificatif conservées (règle « aucune clé supprimée »)', () => {
  it('⭐ les 16 clés eat.receipt existent dans les 5 locales, placeholders préservés, et paymentProof/paymentProofError restent (mortes, documentées)', () => {
    // MAJ mission BC : disclaimer / editedLine / linesNote SORTIES par décision
    // fondateur (la référence prime) — clés RETIRÉES ×5, ne plus les exiger.
    const NEEDED = ['title', 'back', 'retry', 'loadError', 'officialName', 'table', 'paidLine',
      'sessionLabel', 'linesLabel', 'unitPrice', 'linesTotal', 'amountPaid',
      'signIn', 'signInCta']
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(join(__dirname, '..', 'messages', `${loc}.json`), 'utf8'))
      for (const k of NEEDED) expect(m.eat.receipt?.[k], `${loc}: eat.receipt.${k}`).toBeTruthy()
      expect(m.eat.receipt.paidLine).toContain('{date}')
      expect(m.eat.receipt.paidLine).toContain('{time}')
      expect(m.eat.receipt.unitPrice).toContain('{price}')
      // Ponctuation LOCALISÉE dans la clé (revue : plus de « : » codé en dur).
      expect(m.eat.receipt.sessionLabel).toContain('{code}')
      // Clés AR conservées mortes (jamais supprimer une clé — précédent sortRating).
      expect(m.eat.orders.paymentProof).toBeTruthy()
      expect(m.eat.orders.paymentProofError).toBeTruthy()
    }
    // IT : forme de politesse Lei homogène dans le bloc (revue : « Riprova » cassait le registre).
    const it_ = JSON.parse(readFileSync(join(__dirname, '..', 'messages', 'it.json'), 'utf8'))
    expect(it_.eat.receipt.retry).toBe('Riprovi')
  })
})

describe('AU — la PAGE du reçu est épinglée (revue : la surface livrée n’était couverte par rien)', () => {
  const src = readFileSync(join(__dirname, '..', 'app', '[locale]', 'eat', 'receipt', '[id]', 'page.tsx'), 'utf8')

  it('⭐ les DEUX montants sous libellés distincts sont au source (divergence → les deux rendus)', () => {
    // NOTE (mission AW) : totaux CONDITIONNELS (règle AQ — rendus quand
    // subtotal diverge d'amountPaid, comparés en centimes) ; garantie RUNTIME
    // dans tests/dinein-receipt-visual.test.ts.
    // MAJ mission BC : clause de nature + mention de consultation SORTIES par
    // décision fondateur (la référence prime) — leurs asserts sont déplacés en
    // asserts d'ABSENCE dans dinein-receipt-visual.test.ts.
    expect(src).toContain("t('linesTotal')")
    expect(src).toContain("t('amountPaid')")
    // amountPaid affiché TEL QUEL — jamais une somme de lignes à sa place.
    expect(src).toContain('money(receipt.amountPaid)')
    expect(src).toContain('money(receipt.subtotal)')
  })

  it('⭐ RTL : montants isolés en <bdi> (règle 2 gb-rtl) et flèche retour miroitée ms-flip (règle 3)', () => {
    expect((src.match(/<bdi>/g) ?? []).length).toBeGreaterThanOrEqual(5) // vedette, unité, ligne, 2 totaux (+ code)
    expect(src).toContain('className="ms ms-flip rc-back"')
  })

  it('⭐ session : fetch gaté authenticated + PURGE du reçu si la session tombe ; id encodé ; erreur AVANT reçu (jamais un reçu partiel)', () => {
    expect(src).toContain("authStatus === 'authenticated'")
    expect(src).toContain("authStatus === 'unauthenticated'")
    expect(src).toContain('setReceipt(null)')
    expect(src).toContain('encodeURIComponent(id)')
    expect(src.indexOf(': error ?')).toBeGreaterThan(-1)
    expect(src.indexOf(': error ?')).toBeLessThan(src.indexOf(': receipt ?')) // ordre des états
  })

  it('argent via lib/format-money (locale validée) — devise inattendue affichée telle quelle, jamais substituée', () => {
    expect(src).toContain("from '@/lib/format-money'")
    expect(src).toContain('formatEuros(n, locale)')
    expect(src).not.toContain("|| 'eur'") // plus d'euro inventé
    expect(src).toContain('cur.toUpperCase()')
  })

  it('dates : mois en toutes lettres (jamais de tout-numérique ambigu) + fuseau Europe/Paris', () => {
    expect(src).toContain("month: 'long'")
    expect(src).not.toMatch(/month:\s*'2-digit'/)
    expect(src).toContain("'Europe/Paris'")
  })

  it('aucune ressource distante (page + css)', () => {
    expect(src).not.toMatch(/https?:\/\//)
    const css = readFileSync(join(__dirname, '..', 'app', '[locale]', 'eat', 'receipt', '[id]', 'receipt.css'), 'utf8')
    expect(css).not.toMatch(/url\(|@import|@font-face|https?:\/\//)
  })
})
