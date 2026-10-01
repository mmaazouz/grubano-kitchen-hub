import type { AllergenId } from '@/lib/dish-sheet'

// ── Allergen auto-suggestions (Mission 6) ───────────────────────────────────────
//
// suggestAllergens(ingredientNames) → keyword mapping FR/EN toward the 14 INCO
// allergens. These are SUGGESTIONS ONLY: the editor pre-checks them in a
// « suggéré » style and the chef confirms — never an automatic declaration.
// Pure module, no I/O. (CHOICE NOTED: the optional Claude confirmation pass was
// deliberately NOT wired — the chef's confirmation is the human gate, an LLM
// pass would add latency/cost without removing that gate. Mapping only.)
//
// The keyword list is deliberately a REASONABLE catch-net (common kitchen
// ingredients), not an exhaustive food database: a miss is fine (the chef
// checks the chip), a wrong suggestion is just one tap to clear.

const KEYWORDS: Record<AllergenId, string[]> = {
  gluten: [
    'farine', 'ble', 'blé', 'wheat', 'flour', 'pain', 'bread', 'pate', 'pâte', 'pasta',
    'gnocchi', 'semoule', 'semolina', 'orge', 'barley', 'seigle', 'rye', 'avoine', 'oat',
    'chapelure', 'breadcrumb', 'brioche', 'tortilla', 'wrap', 'couscous', 'boulgour', 'malt',
  ],
  crustaces: [
    'crevette', 'shrimp', 'prawn', 'crabe', 'crab', 'homard', 'lobster',
    'langoustine', 'ecrevisse', 'écrevisse', 'crayfish', 'gambas', 'scampi',
  ],
  oeufs: [
    'oeuf', 'œuf', 'egg', 'mayonnaise', 'mayo', 'aioli', 'aïoli', 'meringue',
    'omelette', 'carbonara',
  ],
  poissons: [
    'poisson', 'fish', 'saumon', 'salmon', 'thon', 'tuna', 'cabillaud', 'cod',
    'anchois', 'anchovy', 'sardine', 'bar', 'dorade', 'merlu', 'hake', 'colin',
    'maquereau', 'mackerel', 'truite', 'trout', 'nuoc-mam', 'worcestershire',
  ],
  arachides: [
    'arachide', 'cacahuete', 'cacahuète', 'peanut', 'satay', 'beurre de cacahuete',
  ],
  soja: [
    'soja', 'soy', 'tofu', 'edamame', 'miso', 'tempeh', 'teriyaki', 'sauce soja',
  ],
  lait: [
    'lait', 'milk', 'creme', 'crème', 'cream', 'beurre', 'butter', 'fromage', 'cheese',
    'parmesan', 'mozzarella', 'mascarpone', 'ricotta', 'yaourt', 'yogurt', 'gorgonzola',
    'comte', 'comté', 'emmental', 'cheddar', 'chevre', 'chèvre', 'feta', 'burrata',
    'gruyere', 'gruyère', 'lactose', 'ghee',
  ],
  fruits_a_coque: [
    'noix', 'walnut', 'noisette', 'hazelnut', 'amande', 'almond', 'pistache', 'pistachio',
    'cajou', 'cashew', 'pecan', 'pécan', 'macadamia', 'pignon', 'pine nut', 'praline',
    'nutella', 'frangipane',
  ],
  celeri: ['celeri', 'céleri', 'celery', 'celeriac'],
  moutarde: ['moutarde', 'mustard', 'dijon'],
  sesame: ['sesame', 'sésame', 'tahini', 'tahin', 'houmous', 'hummus'],
  sulfites: [
    'vin', 'wine', 'vinaigre', 'vinegar', 'sulfite', 'fruits secs', 'raisin sec',
    'abricot sec', 'cidre',
  ],
  lupin: ['lupin', 'lupine'],
  mollusques: [
    'moule', 'mussel', 'huitre', 'huître', 'oyster', 'calamar', 'calmar', 'squid',
    'poulpe', 'octopus', 'seiche', 'cuttlefish', 'escargot', 'snail', 'coquille',
    'saint-jacques', 'scallop', 'palourde', 'clam', 'bulot',
  ],
}

/** Lowercase + strip accents so 'Crème' matches 'creme'. */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Map free-text ingredient names to suggested INCO allergens. Word-boundary-ish
 * matching on the normalized text (substring per keyword — kitchen names are
 * compounds: « crème fraîche », « farine T55 »). Returns a stable-ordered,
 * de-duplicated list. Pure + never throws.
 */
export function suggestAllergens(ingredients: string[]): AllergenId[] {
  const haystack = normalize((ingredients ?? []).filter(Boolean).join(' | '))
  if (!haystack) return []
  const out: AllergenId[] = []
  for (const [allergen, words] of Object.entries(KEYWORDS) as [AllergenId, string[]][]) {
    if (words.some(w => haystack.includes(normalize(w)))) out.push(allergen)
  }
  return out
}
