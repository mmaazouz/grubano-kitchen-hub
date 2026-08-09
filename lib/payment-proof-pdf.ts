// ── Mission AR — justificatif de paiement CLIENT (bêta) ─────────────────────────
//
// Le document est EXCLUSIVEMENT une preuve de paiement d'une addition de table.
// Ce n'est NI une facture-métier, NI un document à valeur comptable : aucun
// numéro documentaire, aucune taxe, aucun identifiant Stripe, aucun payeur.
//
// Deux couches, séparées à dessein :
//   • buildPaymentProofView — PURE : produit le MODÈLE DE CONTENU complet
//     (chaque libellé et chaque valeur qui apparaîtront sur le papier). C'est
//     la couche testée mécaniquement (termes interdits, montants, règles 1-14).
//   • renderPaymentProofPdf — mise en page pdf-lib UNIQUEMENT : ne dessine que
//     des chaînes du modèle, n'ajoute aucun contenu. Patron repris de
//     lib/invoice-pdf.ts (pur JS, StandardFonts embarquées → o2switch +
//     standalone), PAS son gabarit qui est fiscal.
//
// Règles clés incarnées ici :
//   1. amountPaid = montant de référence, JAMAIS recalculé depuis les lignes.
//   2. Total des lignes (subtotal STOCKÉ, gelé au paiement) et montant payé
//      affichés TOUS LES DEUX sous des libellés distincts, sans explication.
//   5. Coordonnées de l'établissement = données ACTUELLES : date d'édition
//      distincte + mention explicite.
//   7. Le bloc dominant = date-heure de paiement + montant (repère, pas un
//      identifiant).
//   8. Le code de session porte le seul libellé « Session / réservation ».

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type PaymentProofLine = { name: string; quantity: number; unitPrice: number }

export type PaymentProofInput = {
  paidAt: Date
  amountPaid: number          // euros — la référence, telle qu'en base
  subtotal: number            // euros — total STOCKÉ des consommations (gelé)
  currency: string            // 'eur' attendu ; autre → code affiché tel quel
  lines: PaymentProofLine[]   // lignes ACTIVES uniquement (name/unitPrice gelés)
  sessionCode: string         // lib/reservation-code — '#XXXX'
  restaurantName: string      // nom commercial (ACTUEL)
  officialName: string | null // raison sociale — imprimée SEULEMENT si renseignée
  address: string | null      // ACTUELS
  city: string | null
  tableName: string | null    // ACTUEL
  editedAt: Date              // date d'édition (≠ date de paiement)
}

/** Modèle de contenu : TOUT ce qui sera imprimé, libellés compris. */
export type PaymentProofView = {
  title: string
  disclaimer: string
  paidAtLabel: string         // « Payé le … à … » (bloc dominant)
  amountPaidText: string      // montant payé formaté (bloc dominant)
  sessionLabel: string        // « Session / réservation »
  sessionCode: string
  establishmentLabel: string
  restaurantName: string
  officialNameLine: string | null // « Raison sociale : … » ou null (jamais de placeholder)
  addressLine: string | null
  tableLine: string | null
  linesLabel: string
  lines: Array<{ text: string; amountText: string }>
  subtotalLabel: string       // libellé DISTINCT du montant payé (règle 2)
  subtotalText: string
  amountPaidLabel: string
  editedLine: string          // date d'édition + mention coordonnées actuelles
  footer: string
}

const PARIS = 'Europe/Paris'

function dateFr(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
}

function timeFr(d: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS, hour: '2-digit', minute: '2-digit',
  }).format(d)
}

/** Euros → « 12,34 € » (currency 'eur') ; autre devise → « 12,34 XXX » (code
 *  affiché tel quel, jamais inventé). Espace NORMALE (WinAnsi). */
export function amountText(value: number, currency: string): string {
  const n = value.toFixed(2).replace('.', ',')
  return currency?.toLowerCase() === 'eur' ? `${n} €` : `${n} ${String(currency ?? '').toUpperCase()}`
}

export function buildPaymentProofView(input: PaymentProofInput): PaymentProofView {
  const cur = input.currency
  return {
    title: 'Justificatif de paiement',
    disclaimer:
      'Preuve de paiement uniquement — ce document ne constitue pas une pièce comptable officielle.',
    // « Addition réglée le … » (revue adversariale) : amountPaid est CUMULATIF
    // et paidAt = l'instant du DERNIER encaissement (paiement fractionné prévu
    // par /pay). « Payé le X à Y » + montant total affirmait une conjonction
    // fausse dans ce cas ; « addition réglée le X » + « montant payé (total) »
    // est vrai dans tous les états atteignables.
    paidAtLabel: `Addition réglée le ${dateFr(input.paidAt)} à ${timeFr(input.paidAt)}`,
    amountPaidText: amountText(input.amountPaid, cur),
    sessionLabel: 'Session / réservation',
    sessionCode: input.sessionCode,
    establishmentLabel: 'Établissement',
    restaurantName: input.restaurantName,
    officialNameLine: input.officialName ? `Raison sociale : ${input.officialName}` : null,
    addressLine: [input.address, input.city].filter(Boolean).join(', ') || null,
    tableLine: input.tableName ? `Table : ${input.tableName}` : null,
    linesLabel: 'Consommations (au moment du paiement)',
    lines: input.lines.map((l) => ({
      text: `${l.quantity} × ${l.name} à ${amountText(l.unitPrice, cur)}`,
      // Présentation ligne à ligne des valeurs GELÉES — le total payé, lui,
      // n'est jamais dérivé d'ici (règle 1).
      amountText: amountText(l.unitPrice * l.quantity, cur),
    })),
    subtotalLabel: 'Total des consommations',
    subtotalText: amountText(input.subtotal, cur),
    amountPaidLabel: 'Montant payé',
    editedLine:
      `Édité le ${dateFr(input.editedAt)} — les coordonnées de l'établissement et de la table sont celles connues à cette date.`,
    footer: 'Grubano',
  }
}

// ── Rendu pdf-lib (patron lib/invoice-pdf.ts : safe/wrap/A4) ─────────────────────

const INK    = rgb(0.10, 0.10, 0.18)
const MUTED  = rgb(0.42, 0.42, 0.47)
const ORANGE = rgb(0.976, 0.451, 0.086)
const RULE   = rgb(0.80, 0.80, 0.84)

const PAGE_W = 595.28
const PAGE_H = 841.89
const M      = 50
const RIGHT  = PAGE_W - M

/** WinAnsi-safe (repris du patron invoice-pdf) : ASCII + Latin-1 + €, jamais
 *  de throw au dessin sur du texte utilisateur. */
function safe(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  -​  　]/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ€]/g, '')
}

/** Coupe DUR un token unique plus large que la colonne (revue adversariale :
 *  le wrap du patron ne cassait jamais un mot de 191 caractères → rang rogné
 *  hors page en silence). */
function hardBreak(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = []
  let cur = ''
  for (const ch of word.split('')) {
    if (cur && font.widthOfTextAtSize(cur + ch, size) > maxWidth) { parts.push(cur); cur = ch }
    else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean)
    .flatMap((w) => (font.widthOfTextAtSize(w, size) > maxWidth ? hardBreak(w, font, size, maxWidth) : [w]))
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (cur && font.widthOfTextAtSize(test, size) > maxWidth) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

/** VRAI si la chaîne survit au filtre WinAnsi (safe) avec du contenu visible.
 *  Un libellé source non vide qui deviendrait VIDE à l'impression (nom
 *  entièrement arabe/CJK) ne doit PAS produire un document amputé : l'appelant
 *  refuse la génération (aucun fichier, notice honnête — règle 16). */
export function isPrintable(s: string | null | undefined): boolean {
  const src = String(s ?? '').trim()
  if (!src) return true // vide à la source = rien à imprimer, pas une perte
  return safe(src).trim().length > 0
}

export async function renderPaymentProofPdf(v: PaymentProofView): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(`${v.title} - ${v.restaurantName}`))
  doc.setProducer('Grubano')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  // ── Pagination (revue adversariale) : pdf-lib dessine SANS ERREUR en y
  // négatif — une addition longue produisait un 200 avec les montants et la
  // mention datée HORS page. need() ouvre une page neuve dès que la place
  // manque : les deux montants et le pied sont toujours visibles.
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - M
  const need = (pts: number) => {
    if (y - pts < M) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - M
    }
  }

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color })
  const textRight = (s: string, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x: RIGHT - f.widthOfTextAtSize(safe(s), size), y: yy, size, font: f, color })
  const hr = (yy: number) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: RIGHT, y: yy }, thickness: 0.7, color: RULE })
  const para = (s: string, size: number, lineH: number, f: PDFFont = font, color = INK) => {
    for (const l of wrap(s, f, size, RIGHT - M)) { need(lineH); text(l, M, y, size, f, color); y -= lineH }
  }

  // Titre + avertissement de nature.
  text(v.title, M, y, 20, bold, ORANGE); y -= 16
  para(v.disclaimer, 9, 12, font, MUTED)
  y -= 10; hr(y); y -= 26

  // BLOC DOMINANT (règle 7) : date-heure de règlement + montant. Un repère de
  // lecture — jamais présenté comme identifiant.
  para(v.paidAtLabel, 13, 26, bold)
  text(v.amountPaidText, M, y, 28, bold, ORANGE); y -= 34

  // Session / réservation (règle 8 — seul libellé autorisé pour le code).
  para(`${v.sessionLabel} : ${v.sessionCode}`, 11, 24)
  hr(y); y -= 18

  // Établissement — données ACTUELLES (la mention datée est en pied). Tout est
  // wrappé (revue : un nom de 124+ caractères sortait de la colonne en silence).
  need(60)
  text(v.establishmentLabel, M, y, 9, bold, MUTED); y -= 14
  para(v.restaurantName, 12, 15, bold)
  if (v.officialNameLine) para(v.officialNameLine, 10, 13, font, MUTED)
  if (v.addressLine) para(v.addressLine, 10, 13)
  if (v.tableLine) para(v.tableLine, 10, 13)
  y -= 8; hr(y); y -= 18

  // Consommations — instantané historique.
  need(30)
  text(v.linesLabel, M, y, 9, bold, MUTED); y -= 16
  for (const l of v.lines) {
    const label = wrap(l.text, font, 10, RIGHT - M - 90)
    for (let i = 0; i < label.length; i++) {
      need(13)
      text(label[i], M, y, 10)
      if (i === 0) textRight(l.amountText, y, 10)
      y -= 13
    }
  }
  y -= 6; need(50); hr(y); y -= 18

  // Les DEUX montants, libellés distincts (règles 1-2) — jamais d'explication.
  need(16); text(v.subtotalLabel, M, y, 10, font, MUTED); textRight(v.subtotalText, y, 10); y -= 16
  need(26); text(v.amountPaidLabel, M, y, 12, bold); textRight(v.amountPaidText, y, 12, bold, ORANGE); y -= 26

  // Pied : date d'édition distincte + mention coordonnées actuelles (règle 5).
  para(v.editedLine, 8.5, 11, font, MUTED)
  y -= 4
  need(12); text(v.footer, M, y, 9, bold, MUTED)

  return doc.save()
}
