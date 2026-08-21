// ── Customer avatar initials (arbitrage Design 2026-08-19) ────────────────────
// Rule: the FIRST GRAPHEME of each of the first two words of the displayed name
// — graphemes, not UTF-16 code units (the previous w[0] split a surrogate pair
// and rendered half an astral char). Any Unicode script is admissible when the
// grapheme is a LETTER. One word → one initial. If a word's first grapheme is
// not a letter, the first letter grapheme of that word is used instead; if the
// two first words yield nothing, the first letter grapheme of the whole name;
// if the name has no letter at all → single NEUTRAL glyph (never a raw
// uncontrolled char, never an empty avatar). Emails-as-names fall out of the
// same rule (first letter of the address) — the data itself is never touched.
// Capitalisation: toLocaleUpperCase(), a no-op for caseless scripts (Arabic…).
// The avatar COLOR stays derived from LoyaltyCustomer.id (lib/customer-avatar),
// never from the initials or the fallback.

export const NEUTRAL_GLYPH = '•' // • — neutre, couvert par le subset latin

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function graphemesOf(word: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(word), (s) => s.segment)
  return Array.from(word) // repli code points (jamais des demi-surrogates)
}

// new RegExp : le littéral /\p{L}/u exige target es6+ au tsc (tsconfig es5) ;
// la construction runtime est identique et supportée partout (Node 24, evergreen).
const LETTER_RE = new RegExp('\\p{L}', 'u')
const isLetter = (g: string) => LETTER_RE.test(g)

function firstLetterGrapheme(word: string): string | null {
  for (const g of graphemesOf(word)) if (isLetter(g)) return g
  return null
}

export function customerInitials(name: string): string {
  const words = (name ?? '').split(/\s+/).filter(Boolean)
  const picked: string[] = []
  for (const w of words.slice(0, 2)) {
    const g = firstLetterGrapheme(w)
    if (g) picked.push(g)
  }
  if (picked.length === 0) {
    for (const w of words.slice(2)) {
      const g = firstLetterGrapheme(w)
      if (g) {
        picked.push(g)
        break
      }
    }
  }
  if (picked.length === 0) return NEUTRAL_GLYPH
  return picked.map((g) => g.toLocaleUpperCase()).join('')
}
