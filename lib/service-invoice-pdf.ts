// lib/service-invoice-pdf.ts — server-side PDF of a SERVICE-MISSION invoice (P6, Agent 79).
//
// A NEW template (NOT a change to lib/invoice-pdf.ts — its exports stay byte-identical). It
// FORMATS stored figures + the PURE 5% split; it computes NO money and moves NONE. Pure-JS via
// pdf-lib (no Chromium, StandardFonts embedded → o2switch-safe, survives Next standalone). FR
// document. The prestataire is the ISSUER (bills the restaurant the agreed amount); the 5%
// Grubano commission split is shown for information. A clear note states NO payment has been
// taken yet (the real settlement is a LATER brick, P7).

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

export type ServiceInvoicePdfView = {
  number: string
  issuedAt: Date
  amountCents: number
  grubanoMarginCents: number
  prestataireNetCents: number
  ratePct: string                              // "5" (display only)
  serviceLabel: string                         // the offering title (may be empty)
  issuer:    { name: string; city: string; siren: string }   // the prestataire
  recipient: { name: string }                                 // the restaurant
  revealSplit: boolean                         // draw the RÉPARTITION block only for the prestataire/admin
}

const INK    = rgb(0.10, 0.10, 0.18)
const MUTED  = rgb(0.42, 0.42, 0.47)
const ORANGE = rgb(0.976, 0.451, 0.086)
const RULE   = rgb(0.80, 0.80, 0.84)

const PAGE_W = 595.28
const PAGE_H = 841.89
const M      = 50
const RIGHT  = PAGE_W - M
const EURO   = '€'

/** Keep only what pdf-lib's WinAnsi (StandardFont) can encode (ASCII + Latin-1 + euro), so
 *  user/legal text (incl. Arabic, emoji, CJK) can NEVER throw on draw. */
function safe(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[    ⁠​]/g, ' ')
    .replace(/[^\x20-\x7E¡-ÿ€]/g, '')
}

function eur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} ${EURO}`
}

function dateFr(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean)
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

export async function renderServiceInvoicePdf(v: ServiceInvoicePdfView): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(`Facture ${v.number} - Grubano`))
  doc.setProducer('Grubano')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([PAGE_W, PAGE_H])

  const text = (s: string, x: number, y: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y, size, font: f, color })
  const right = (s: string, xRight: number, y: number, size: number, f: PDFFont = font, color = INK) => {
    const str = safe(s)
    page.drawText(str, { x: xRight - f.widthOfTextAtSize(str, size), y, size, font: f, color })
  }

  let y = PAGE_H - M

  // ── Header ──
  text('GRUBANO', M, y - 4, 22, bold, ORANGE)
  right(`FACTURE ${v.number}`, RIGHT, y, 15, bold)
  right(`Émise le ${dateFr(v.issuedAt)}`, RIGHT, y - 16, 10, font, MUTED)
  y -= 56

  // ── Parties (two columns) — the prestataire issues to the restaurant ──
  const colR = M + 280
  text('ÉMETTEUR (prestataire)', M, y, 9, bold, MUTED)
  text('DESTINATAIRE (restaurant)', colR, y, 9, bold, MUTED)
  y -= 15
  text(v.issuer.name, M, y, 11, bold)
  text(v.recipient.name, colR, y, 11, bold)
  y -= 13
  if (v.issuer.city)  { text(v.issuer.city, M, y, 9, font, MUTED) }
  y -= 12
  if (v.issuer.siren) { text(`SIREN : ${v.issuer.siren}`, M, y, 9, font, MUTED) }
  y -= 28

  // ── Detail line ──
  const colAmt = RIGHT
  text('PRESTATION', M, y, 9, bold, MUTED)
  right('MONTANT', colAmt, y, 9, bold, MUTED)
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1, color: INK })
  y -= 16
  text(v.serviceLabel || 'Prestation de service', M, y, 10)
  right(eur(v.amountCents), colAmt, y, 10)
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: RULE })
  y -= 22

  // ── Total ──
  const labelX = RIGHT - 170
  text('Total (montant convenu)', labelX, y, 12, bold); right(eur(v.amountCents), RIGHT, y, 12, bold)
  y -= 28

  // ── Commission split (CONFIDENTIAL — prestataire/admin only; never on the resto's invoice) ──
  if (v.revealSplit) {
    text('RÉPARTITION', M, y, 9, bold, MUTED); y -= 16
    text(`Montant de la prestation`, M, y, 10); right(eur(v.amountCents), RIGHT, y, 10); y -= 14
    text(`Commission Grubano (${v.ratePct} %)`, M, y, 10); right(`- ${eur(v.grubanoMarginCents)}`, RIGHT, y, 10, font, MUTED); y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: RULE }); y -= 16
    text('Net prestataire', M, y, 11, bold); right(eur(v.prestataireNetCents), RIGHT, y, 11, bold); y -= 28
  }

  // ── Mention (document only — no payment yet) ──
  const mention =
    'Document généré électroniquement. Aucun paiement n\'a encore été prélevé ni reversé : ' +
    'cette facture matérialise le montant convenu' + (v.revealSplit ? ' et la répartition de la commission de service' : '') + '. ' +
    'Le règlement interviendra ultérieurement via la plateforme Grubano.'
  for (const line of wrap(mention, font, 9, RIGHT - M)) { text(line, M, y, 9, font, INK); y -= 12 }

  // ── Footer ──
  const footer = `Facture ${v.number} - numérotation continue.` +
    (v.revealSplit ? ` Commission de service Grubano au taux de ${v.ratePct} %.` : '')
  let fy = M + 4
  const fLines = wrap(footer, font, 8, RIGHT - M)
  fy += (fLines.length - 1) * 11
  for (const line of fLines) { text(line, M, fy, 8, font, MUTED); fy -= 11 }

  return doc.save()
}
