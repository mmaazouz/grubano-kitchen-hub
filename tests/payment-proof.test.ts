import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Mission AR — justificatif de paiement client (bêta) ─────────────────────────
// Périmètre fermé : addition PAYÉE → accès autorisé (propriétaire seul) →
// téléchargement d'une PREUVE DE PAIEMENT. Jamais une facture ni un document
// fiscal. Contrats épinglés ici :
//   • propriété = chaîne TableTicket.reservationId → Reservation.userId ===
//     token.sub (patron réutilisé de /api/eat/orders et reservations/[id]/cancel) ;
//   • une addition NON payée ne donne aucun accès ; un walk-in n'a AUCUN point
//     d'entrée (ni route, ni carte « Mes commandes ») ;
//   • amountPaid = référence JAMAIS recalculée ; subtotal STOCKÉ affiché sous un
//     libellé DISTINCT quand ils divergent, sans explication inventée ;
//   • aucun terme interdit dans le document (test de CONTENU, pas de relecture) ;
//   • échec → AUCUN fichier.

const { db, tokenMock } = vi.hoisted(() => ({
  db: {
    tableTicket: { findUnique: vi.fn(), findMany: vi.fn() },
    order:       { findMany: vi.fn() },
    reservation: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  tokenMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

import { GET } from '@/app/api/eat/tickets/[id]/payment-proof/route'
import { GET as ORDERS_GET } from '@/app/api/eat/orders/route'
import { buildPaymentProofView, renderPaymentProofPdf, amountText } from '@/lib/payment-proof-pdf'
import { reservationCode } from '@/lib/reservation-code'

const call = (id = 'tk1') =>
  GET(new Request(`https://app.grubano.com/api/eat/tickets/${id}/payment-proof`) as never, { params: { id } })

// Addition payée du consommateur u1 — lignes GELÉES divergentes du montant payé
// (30,50 € de lignes, 34,50 € réellement encaissés — ex. service dine-in) : le
// document doit montrer LES DEUX, sans jamais recalculer.
// ⚠️ reservationId = SCALAIRE sans relation Prisma (vérifié au schéma) — la
// propriété se résout par une DEUXIÈME requête, comme /api/eat/orders.
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

describe('AR — GET /api/eat/tickets/[id]/payment-proof : accès', () => {
  it('⭐ le propriétaire obtient un vrai PDF (bytes %PDF, en-têtes de téléchargement, no-store)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="justificatif-paiement-2026-08-08.pdf"')
    expect(res.headers.get('Cache-Control')).toContain('no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(500)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    // La propriété a bien été jugée sur la chaîne reservationId → userId.
    expect(db.reservation.findUnique).toHaveBeenCalledWith({ where: { id: 'resv1' }, select: { userId: true } })
  })

  it('⭐ un AUTRE compte ne l’obtient pas — 403, message du patron réutilisé, aucun PDF', async () => {
    tokenMock.mockResolvedValue({ sub: 'u2' })
    const res = await call()
    expect(res.status).toBe(403)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Cette addition n’est pas liée à votre compte.' })
  })

  it('sans session → 401, la base n’est jamais consultée', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(db.tableTicket.findUnique).not.toHaveBeenCalled()
  })

  it('⭐ une addition NON payée (open) → 409, aucun fichier', async () => {
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, status: 'open' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Addition non payée — aucun justificatif disponible.' })
  })

  it('⭐ walk-in (reservationId null) → 404 — la vue privée n’est pas servie, la réservation jamais interrogée', async () => {
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, reservationId: null })
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Addition introuvable' })
    expect(db.reservation.findUnique).not.toHaveBeenCalled()
  })

  it('rattachement pendu (réservation disparue) → même 404 que le walk-in, rien n’est révélé', async () => {
    db.reservation.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('addition inexistante → 404 (même réponse que walk-in : rien n’est révélé)', async () => {
    db.tableTicket.findUnique.mockResolvedValue(null)
    expect((await call('tk-ghost')).status).toBe(404)
  })

  it('réservation ANONYME (userId null) → 403 — jamais un accès par défaut', async () => {
    db.reservation.findUnique.mockResolvedValue({ userId: null })
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cette addition n’est pas liée à votre compte.' })
  })

  it('⭐ libellé NON IMPRIMABLE (nom de plat entièrement arabe, police Latin-1) → 500 tracé, AUCUN document amputé', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.tableTicket.findUnique.mockResolvedValue({
      ...PAID_TICKET,
      items: [{ name: 'كسكس ملكي', unitPrice: 12, quantity: 1 }],
    })
    const res = await call()
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('non imprimable'))
    errSpy.mockRestore()
  })

  it('payée mais amountPaid/paidAt absents (anomalie) → 500 tracé, AUCUN fichier, aucun montant inventé', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.tableTicket.findUnique.mockResolvedValue({ ...PAID_TICKET, amountPaid: null })
    const res = await call()
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[AR]'))
    errSpy.mockRestore()
  })

  it('⭐ AUCUN identifiant Stripe ne traverse la route (jamais sélectionné — preuve source)', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'api', 'eat', 'tickets', '[id]', 'payment-proof', 'route.ts'), 'utf8')
    expect(src).not.toContain('stripePaymentIntentId')
    expect(src.toLowerCase()).not.toContain('pi_')
  })
})

describe('AR — walk-in : aucun point d’entrée côté « Mes commandes »', () => {
  it('⭐ sans réservation possédée, les tickets ne sont même pas interrogés — un walk-in ne produit aucune carte', async () => {
    tokenMock.mockResolvedValue({ sub: 'u1' })
    db.order.findMany.mockResolvedValue([])
    db.reservation.findMany.mockResolvedValue([])
    const res = await ORDERS_GET(new Request('https://app.grubano.com/api/eat/orders') as never)
    expect(res.status).toBe(200)
    expect(db.tableTicket.findMany).not.toHaveBeenCalled() // seul chemin d'accès = réservations possédées
    expect(await res.json()).toEqual({ current: [], past: [] })
  })
})

describe('AR — contenu du document (modèle COMPLET, libellés compris)', () => {
  const view = buildPaymentProofView({
    paidAt: new Date('2026-08-08T19:47:00Z'),
    amountPaid: 34.5, subtotal: 30.5, currency: 'eur',
    lines: PAID_TICKET.items,
    sessionCode: reservationCode('resv1'),
    restaurantName: 'Gnocchi Bar', officialName: null,
    address: '12 rue des Antiquaires', city: 'Orange', tableName: 'T4',
    editedAt: new Date('2026-08-09T10:00:00Z'),
  })

  it('⭐ divergence lignes/encaissé : LES DEUX montants, libellés DISTINCTS, amountPaid JAMAIS recalculé', () => {
    expect(view.amountPaidText).toBe('34,50 €')            // la référence, telle qu'en base
    expect(view.subtotalText).toBe('30,50 €')              // le total STOCKÉ des consommations
    expect(view.amountPaidLabel).not.toBe(view.subtotalLabel)
    // Aucune explication inventée sur l'écart (le modèle n'a AUCUN autre champ montant).
    const texts = JSON.stringify(view)
    expect(texts).not.toMatch(/service|frais|écart|différence/i)
    // La somme des lignes (30,50) n'écrase jamais le montant payé.
    expect(view.lines.map((l) => l.amountText)).toEqual(['24,00 €', '6,50 €'])
  })

  it('⭐ AUCUN terme interdit — test de contenu sur le modèle intégral (règles 6, 9, 11, 18)', () => {
    const texts = JSON.stringify(view)
    for (const re of [
      /facture/i, /invoice/i, /\bTVA\b/i, /\bVAT\b/i, /\bHT\b/, /\bTTC\b/i,
      /fiscal/i, /référence/i, /\bnum[ée]ro\b/i, /N°/, /stripe/i, /\bpi_/i,
    ]) {
      expect(texts, `terme interdit détecté : ${re}`).not.toMatch(re)
    }
  })

  it('date de règlement HISTORIQUE au bloc dominant — « Addition réglée le » (vrai même en paiement fractionné : amountPaid cumulatif + paidAt = dernier encaissement) ; date d’édition DISTINCTE + mention (règles 3, 5, 7)', () => {
    expect(view.paidAtLabel).toBe('Addition réglée le 08/08/2026 à 21:47')  // Europe/Paris (UTC+2 en août)
    expect(view.paidAtLabel).not.toContain('Payé le') // la conjonction « payé X € à HH:MM » serait fausse en fractionné
    expect(view.editedLine).toContain('Édité le 09/08/2026')
    expect(view.editedLine).toContain('connues à cette date')
  })

  it('le code de session porte le SEUL libellé « Session / réservation » (règle 8)', () => {
    expect(view.sessionLabel).toBe('Session / réservation')
    expect(view.sessionCode).toBe(reservationCode('resv1'))     // déterministe, dérivé — jamais un compteur
    expect(view.sessionCode).toMatch(/^#[0-9A-Z]{4}$/)
  })

  it('⭐ identité légale : nom commercial TOUJOURS, raison sociale SEULEMENT si renseignée — jamais de placeholder (règle 12)', () => {
    expect(view.restaurantName).toBe('Gnocchi Bar')
    expect(view.officialNameLine).toBeNull()                    // null → la ligne n'existe PAS
    const withLegal = buildPaymentProofView({
      paidAt: new Date(), amountPaid: 10, subtotal: 10, currency: 'eur', lines: [],
      sessionCode: '#A3F2', restaurantName: 'Gnocchi Bar',
      officialName: 'Maazouz Restauration SASU', address: null, city: null,
      tableName: null, editedAt: new Date(),
    })
    expect(withLegal.officialNameLine).toBe('Raison sociale : Maazouz Restauration SASU')
    expect(withLegal.addressLine).toBeNull()                    // absent → absent, pas de « — »
  })

  it('devise : eur → € ; autre code affiché tel quel, jamais inventé', () => {
    expect(amountText(12, 'eur')).toBe('12,00 €')
    expect(amountText(12, 'chf')).toBe('12,00 CHF')
  })
})

// Les flux de contenu pdf-lib sont compressés (FlateDecode) et le texte dessiné
// y est encodé en CHAÎNES HEX (PDFHexString, octets WinAnsi) : pour scanner le
// TEXTE réellement imprimé, on déflate chaque segment stream…endstream puis on
// décode toutes les chaînes <hex> en latin1 (vérifié empiriquement sur pdf-lib
// 1.17.1 — le texte n'apparaît JAMAIS en clair dans les octets bruts).
async function pdfVisibleText(bytes: Uint8Array): Promise<string> {
  const { inflateSync } = await import('node:zlib')
  const buf = Buffer.from(bytes)
  const decodeHex = (s: string) =>
    Array.from(s.matchAll(/<([0-9A-Fa-f]+)>/g), (m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n')
  let out = buf.toString('latin1') // métadonnées (Info dict) + flux non compressés
  out += '\n' + decodeHex(out)
  let idx = 0
  for (;;) {
    const s = buf.indexOf('stream', idx)
    if (s === -1) break
    const start = buf.indexOf('\n', s) + 1
    const end = buf.indexOf('endstream', start)
    if (start <= 0 || end === -1) break
    try {
      const inflated = inflateSync(buf.subarray(start, end)).toString('latin1')
      out += '\n' + inflated + '\n' + decodeHex(inflated)
    } catch { /* flux non-flate */ }
    idx = end + 9
  }
  return out
}

describe('AR — rendu pdf-lib réel (métadonnées, pagination, octets)', () => {
  const smallView = buildPaymentProofView({
    paidAt: new Date('2026-08-08T19:47:00Z'), amountPaid: 34.5, subtotal: 30.5,
    currency: 'eur', lines: PAID_TICKET.items, sessionCode: '#A3F2',
    restaurantName: 'Gnocchi Bar', officialName: null,
    address: '12 rue des Antiquaires', city: 'Orange', tableName: 'T4',
    editedAt: new Date('2026-08-09T10:00:00Z'),
  })

  it('⭐ métadonnées + octets du DOCUMENT RÉEL : titre/producteur véridiques, aucun terme interdit, montants présents', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const bytes = await renderPaymentProofPdf(smallView)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getTitle()).toBe('Justificatif de paiement - Gnocchi Bar')
    // pdf-lib estampille SON producer au save (idem factures pro) — on exige
    // seulement qu'aucun terme interdit n'y figure, pas une égalité.
    expect(doc.getProducer() ?? '').not.toMatch(/facture|tva|n°/i)
    expect(doc.getPageCount()).toBe(1)
    // On scanne le FICHIER produit (flux décompressés), pas seulement le modèle.
    const raw = await pdfVisibleText(bytes)
    expect(raw).toContain('Montant pay')            // les montants sont bien DANS le fichier
    expect(raw).toContain('Total des consommations')
    expect(raw).toContain('Session / r')            // « réservation » (é encodé latin1)
    for (const bad of ['Facture', 'facture', 'TVA', 'N°', 'Num\xe9ro', 'stripe', 'pi_', 'HT ', 'TTC']) {
      expect(raw, `terme interdit dans le PDF : ${bad}`).not.toContain(bad)
    }
  })

  it('⭐ addition LONGUE (45 lignes) : PAGINÉE — les deux montants et la mention datée restent DANS le document (jamais un justificatif amputé servi en 200)', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const longView = buildPaymentProofView({
      paidAt: new Date('2026-08-08T19:47:00Z'), amountPaid: 540, subtotal: 540,
      currency: 'eur',
      lines: Array.from({ length: 45 }, (_, i) => ({ name: `Plat n${i + 1} de la grande tablée`, unitPrice: 12, quantity: 1 })),
      sessionCode: '#A3F2', restaurantName: 'Gnocchi Bar', officialName: null,
      address: null, city: null, tableName: null, editedAt: new Date('2026-08-09T10:00:00Z'),
    })
    const bytes = await renderPaymentProofPdf(longView)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
    const raw = await pdfVisibleText(bytes)
    expect(raw).toContain('Montant pay')
    expect(raw).toContain('connues \xe0 cette date') // la mention règle 5 n'est jamais perdue
  })

  it('nom démesuré sans espace (191 caractères, plafond colonne MySQL) : coupé DUR, jamais rogné hors page', async () => {
    const bytes = await renderPaymentProofPdf(buildPaymentProofView({
      paidAt: new Date(), amountPaid: 10, subtotal: 10, currency: 'eur',
      lines: [{ name: 'X'.repeat(191), unitPrice: 10, quantity: 1 }],
      sessionCode: '#A3F2', restaurantName: 'R'.repeat(150), officialName: null,
      address: null, city: null, tableName: null, editedAt: new Date(),
    }))
    expect(bytes.length).toBeGreaterThan(500) // rend sans throw ; le wrap coupe au caractère
  })
})

describe('AR — espaces de traduction du parcours client : acquis règle 18 préservé', () => {
  it('⭐ aucun mot fiscal dans eat.* (5 locales), y compris les 2 clés ajoutées', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(join(__dirname, '..', 'messages', `${loc}.json`), 'utf8'))
      expect(m.eat.orders.paymentProof, `${loc}: clé CTA absente`).toBeTruthy()
      expect(m.eat.orders.paymentProofError, `${loc}: clé notice absente`).toBeTruthy()
      const eat = JSON.stringify(m.eat)
      for (const re of [/facture/i, /\bTVA\b/i, /\bHT\b/, /\bTTC\b/i, /justificatif fiscal/i]) {
        expect(eat, `${loc}: terme fiscal détecté ${re}`).not.toMatch(re)
      }
    }
  })
})
