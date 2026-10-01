// ── P4.4-B — server-side PDF rendering of a commission invoice (Agent 55) ────────
//
// Produces a REAL PDF of an EXISTING invoice — it formats the stored figures, it does
// NOT recalculate anything (the caller passes the invoice's stored HT/TVA/TTC, its
// gapless number, the resolved VAT %, and the fiscal identities). PURE-JS via pdf-lib
// (no Chromium/Puppeteer, no native deps, StandardFonts embedded in-package -> runs on
// o2switch shared hosting + survives Next.js standalone file-tracing). FR document
// (legal invoice), mirroring the existing printable HTML.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type InvoicePdfLine = { label: string; count: number; grossCents: number; feeCents: number }

export type InvoicePdfView = {
  number: string
  issuedAt: Date
  periodStart: Date
  periodEnd: Date
  totalHtCents: number
  totalTvaCents: number
  totalTtcCents: number
  entriesCount: number
  vatPct: string                                  // display only, e.g. "20" (from resolveVatRate)
  issuer:    { name: string; address: string; siren: string; vat: string }
  recipient: { name: string; address: string; city: string; vat: string }
  lines:     InvoicePdfLine[]
  driftDetailFeeCents: number | null              // null = no drift note
}

const INK    = rgb(0.10, 0.10, 0.18)
const MUTED  = rgb(0.42, 0.42, 0.47)
const ORANGE = rgb(0.976, 0.451, 0.086)
const RULE   = rgb(0.80, 0.80, 0.84)

// A4 portrait, in PDF points.
const PAGE_W = 595.28
const PAGE_H = 841.89
const M      = 50            // margin
const RIGHT  = PAGE_W - M    // right edge

const EURO = '€'

/** Keep only what pdf-lib's WinAnsi (StandardFont) can encode: printable ASCII +
 *  Latin-1 (accents) + the euro sign. Typographic quotes/dashes/ellipsis and exotic
 *  spaces are normalised first, then anything else (emoji, CJK, Arabic, control bytes)
 *  is dropped — so user/legal text can NEVER throw on draw. */
function safe(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’′]/g, "'")                       // smart single quotes / prime
    .replace(/[“”″]/g, '"')                       // smart double quotes
    .replace(/[–—−]/g, '-')                       // en/em dash, minus
    .replace(/…/g, '...')                                   // ellipsis
    .replace(/[    ⁠​]/g, ' ')     // exotic spaces -> normal
    .replace(/[^\x20-\x7E¡-ÿ€]/g, '')             // keep ASCII + Latin-1 + euro
}

/** Cents -> "12,00 EURO" with a NORMAL space (never a narrow no-break space, which
 *  WinAnsi can't encode). Same value the HTML invoice shows. */
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

export async function renderInvoicePdf(v: InvoicePdfView): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(`Facture ${v.number} - Grubano`))
  doc.setProducer('Grubano')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page: PDFPage = doc.addPage([PAGE_W, PAGE_H])

  const text = (s: string, x: number, y: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(s), { x, y, size, font: f, color })
  const right = (s: string, xRight: number, y: number, size: number, f: PDFFont = font, color = INK) => {
    const str = safe(s)
    page.drawText(str, { x: xRight - f.widthOfTextAtSize(str, size), y, size, font: f, color })
  }

  let y = PAGE_H - M

  // ── Header ──────────────────────────────────────────────────────────────────
  text('GRUBANO', M, y - 4, 22, bold, ORANGE)
  right(`FACTURE ${v.number}`, RIGHT, y, 15, bold)
  right(`Émise le ${dateFr(v.issuedAt)}`, RIGHT, y - 16, 10, font, MUTED)
  const endShown = new Date(v.periodEnd.getTime() - 1)
  right(`Période : du ${dateFr(v.periodStart)} au ${dateFr(endShown)}`, RIGHT, y - 30, 10, font, MUTED)
  y -= 64

  // ── Parties (two columns) ───────────────────────────────────────────────────
  const colR = M + 280
  text('ÉMETTEUR', M, y, 9, bold, MUTED)
  text('DESTINATAIRE', colR, y, 9, bold, MUTED)
  y -= 15
  text(v.issuer.name, M, y, 11, bold)
  text(v.recipient.name, colR, y, 11, bold)
  y -= 13
  text(v.issuer.address, M, y, 9, font, MUTED)
  text(v.recipient.address, colR, y, 9, font, MUTED)
  y -= 12
  text(`SIREN : ${v.issuer.siren}`, M, y, 9, font, MUTED)
  text(v.recipient.city, colR, y, 9, font, MUTED)
  y -= 12
  text(`TVA intracommunautaire : ${v.issuer.vat}`, M, y, 9, font, MUTED)
  text(`N° TVA intracommunautaire : ${v.recipient.vat}`, colR, y, 9, font, MUTED)
  y -= 30

  // ── Detail table ────────────────────────────────────────────────────────────
  const colOps = M + 300
  const colGross = M + 380
  const colFee = RIGHT
  text('CANAL', M, y, 9, bold, MUTED)
  right('OPÉRATIONS', colOps, y, 9, bold, MUTED)
  right('ENCAISSEMENTS', colGross, y, 9, bold, MUTED)
  right('COMMISSION (TTC)', colFee, y, 9, bold, MUTED)
  y -= 6
  page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 1, color: INK })
  y -= 16
  for (const ln of v.lines) {
    text(ln.label, M, y, 10)
    right(String(ln.count), colOps, y, 10)
    right(eur(ln.grossCents), colGross, y, 10)
    right(eur(ln.feeCents), colFee, y, 10)
    y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.5, color: RULE })
    y -= 16
  }

  // ── Totals (right block) ────────────────────────────────────────────────────
  y -= 8
  const labelX = RIGHT - 150
  text('Total HT', labelX, y, 11); right(eur(v.totalHtCents), RIGHT, y, 11); y -= 16
  text(`TVA ${v.vatPct} %`, labelX, y, 11); right(eur(v.totalTvaCents), RIGHT, y, 11); y -= 8
  page.drawLine({ start: { x: labelX, y }, end: { x: RIGHT, y }, thickness: 1, color: INK }); y -= 16
  text('Total TTC', labelX, y, 13, bold); right(eur(v.totalTtcCents), RIGHT, y, 13, bold); y -= 30

  // ── Mention (acquittee) ─────────────────────────────────────────────────────
  const mention =
    'Commission de service prélevée à la source sur vos encaissements - facture acquittée. ' +
    'Le montant TTC ci-dessus a déjà été retenu sur les paiements qui vous ont été reversés sur la période : ' +
    `aucun règlement n'est attendu. ${v.entriesCount} opération(s) couverte(s) par cette facture.`
  for (const line of wrap(mention, font, 9.5, RIGHT - M)) { text(line, M, y, 9.5, font, INK); y -= 13 }
  y -= 6

  if (v.driftDetailFeeCents != null) {
    const drift = `Note : des écritures ont été ajoutées au registre après l'émission (détail affiché : ` +
      `${eur(v.driftDetailFeeCents)} - total facturé : ${eur(v.totalTtcCents)}). Les totaux facturés font foi ; ` +
      `l'écart sera repris sur la facture suivante.`
    for (const line of wrap(drift, font, 8.5, RIGHT - M)) { text(line, M, y, 8.5, font, MUTED); y -= 11 }
    y -= 6
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footer = `Facture établie par ${v.issuer.name} pour le compte de la plateforme Grubano. ` +
    `Numérotation continue ${v.number} - document généré électroniquement, valable sans signature. ` +
    `TVA sur les services de commission au taux normal de ${v.vatPct} %.`
  let fy = M + 4
  const fLines = wrap(footer, font, 8, RIGHT - M)
  fy += (fLines.length - 1) * 11
  for (const line of fLines) { text(line, M, fy, 8, font, MUTED); fy -= 11 }

  return doc.save()
}
