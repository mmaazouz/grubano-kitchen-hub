/**
 * Food Images — curated catalogue of food photography for Grubano.
 *
 * Owned by Agent 6 (Design System). Each entry references an Unsplash photo
 * ID. Photos are downloaded to public/images/food/{category}/{slug}.jpg via
 * `node scripts/download-food-images.js`.
 *
 * Why a local mirror?  We don't want to depend on a 3rd-party CDN at runtime
 * for production assets, but we want the same photos in dev and prod.
 * `getFoodImage()` returns the LOCAL path — fall back to `getFoodImageRemote()`
 * if the download hasn't run yet (e.g. fresh checkout before build).
 *
 * Usage:
 *   import { getFoodImage } from '@/lib/food-images'
 *   <DishCard photo={getFoodImage('pizza', dish.id)} ... />
 */

export type FoodCategory =
  | 'pizza'
  | 'burgers'
  | 'asian'
  | 'healthy'
  | 'desserts'
  | 'wraps'
  | 'pasta'
  | 'drinks'

export type RestaurantCover = 'cover'

interface PhotoEntry {
  /** Unsplash photo ID (the slug after /photo-). */
  id: string
  /** Short kebab-case slug used as the on-disk filename. */
  slug: string
  /** Suggested alt text. */
  alt: string
}

/**
 * Catalogue. Order matters — index N is stable, so the same restaurant/dish
 * keeps the same photo across renders. To replace a photo without shifting
 * the index, swap its entry in place.
 */
export const FOOD_CATALOG: Record<FoodCategory, ReadonlyArray<PhotoEntry>> = {
  pizza: [
    { id: '1565299624946-b28f40a0ae38', slug: 'margherita',     alt: 'Pizza margherita' },
    { id: '1574071318508-1cdbab80d002', slug: 'basil',          alt: 'Pizza au basilic' },
    { id: '1604382354936-07c5d9983bd3', slug: 'pepperoni',      alt: 'Pizza pepperoni' },
    { id: '1593560708920-61dd98c46a4e', slug: 'slice',          alt: 'Part de pizza' },
    { id: '1513104890138-7c749659a591', slug: 'table',          alt: 'Pizza sur table' },
    { id: '1571997478779-2adcbbe9ab2f', slug: 'fresh',          alt: 'Pizza fraîche' },
    { id: '1590947132387-155cc02f3212', slug: 'artisan',        alt: 'Pizza artisanale' },
    { id: '1542528180-a1208c5169a5',    slug: 'meat',           alt: 'Pizza viande' },
    { id: '1555072956-7758afb20e8f',    slug: 'slice-up',       alt: 'Part de pizza' },
    { id: '1571066811602-716837d681de', slug: 'dough',          alt: 'Pâte à pizza' },
  ],
  burgers: [
    { id: '1568901346375-23c9450c58cd', slug: 'classic',        alt: 'Burger classique' },
    { id: '1571091718767-18b5b1457add', slug: 'fries',          alt: 'Burger frites' },
    { id: '1572802419224-296b0aeee0d9', slug: 'cheese',         alt: 'Cheeseburger' },
    { id: '1550317138-10000687a72b',    slug: 'gourmet',        alt: 'Burger gourmet' },
    { id: '1586816001966-79b736744398', slug: 'double',         alt: 'Double burger' },
    { id: '1561758033-d89a9ad46330',    slug: 'chicken',        alt: 'Burger poulet' },
    { id: '1607013251379-e6eecfffe234', slug: 'closeup',        alt: 'Burger gros plan' },
    { id: '1626700051175-6818013e1d4f', slug: 'smash',          alt: 'Smash burger' },
    { id: '1597600159211-d6c104f408d1', slug: 'bacon',          alt: 'Burger bacon' },
    { id: '1551782450-a2132b4ba21d',    slug: 'street',         alt: 'Burger street food' },
  ],
  asian: [
    { id: '1617196034796-73dfa7b1fd56', slug: 'ramen',          alt: 'Bol de ramen' },
    { id: '1569718212165-3a8278d5f624', slug: 'sushi',          alt: 'Sushi' },
    { id: '1579871494447-9811cf80d66c', slug: 'pho',            alt: 'Soupe phở' },
    { id: '1607301405390-d831c242f59b', slug: 'rolls',          alt: 'Makis' },
    { id: '1546069901-ba9599a7e63c',    slug: 'poke',           alt: 'Poke bowl' },
    { id: '1535007813616-79dc02ba4021', slug: 'dumplings',      alt: 'Gyozas' },
    { id: '1626804475297-41608ea09aeb', slug: 'pad-thai',       alt: 'Pad thaï' },
    { id: '1611143669185-af224c5e3252', slug: 'banh-mi',        alt: 'Bánh mì' },
    { id: '1559314809-0d155014e29e',    slug: 'ramen-bowl',     alt: 'Ramen' },
    { id: '1579952363873-27f3bade9f55', slug: 'sushi-plate',    alt: 'Plateau de sushi' },
  ],
  healthy: [
    { id: '1512621776951-a57141f2eefd', slug: 'salad',          alt: 'Salade composée' },
    { id: '1490645935967-10de6ba17061', slug: 'acai',           alt: 'Açaí bowl' },
    { id: '1505253758473-96b7015fcd40', slug: 'grain',          alt: 'Bowl céréales' },
    { id: '1559054663-e8d23213f55c',    slug: 'smoothie',       alt: 'Smoothie bowl' },
    { id: '1574484284002-952d92456975', slug: 'quinoa',         alt: 'Salade de quinoa' },
    { id: '1540420773420-3366772f4999', slug: 'medi',           alt: 'Bowl méditerranéen' },
    { id: '1607532941433-304659e8198a', slug: 'poke-veg',       alt: 'Poke végétal' },
    { id: '1623428187969-5da2dcea5ebf', slug: 'vegan',          alt: 'Bowl vegan' },
    { id: '1518779578993-ec3579fee39f', slug: 'plate',          alt: 'Assiette healthy' },
    { id: '1546069901-ba9599a7e63c',    slug: 'fresh-bowl',     alt: 'Bowl frais' },
  ],
  desserts: [
    { id: '1565958011703-44f9829ba187', slug: 'chocolate',      alt: 'Gâteau chocolat' },
    { id: '1551024506-0bccd828d307',    slug: 'croissant',      alt: 'Croissants' },
    { id: '1488477181946-6428a0291777', slug: 'cheesecake',     alt: 'Cheesecake' },
    { id: '1563729784474-d77dbb933a9e', slug: 'tiramisu',       alt: 'Tiramisu' },
    { id: '1551404973-761c83cd8339',    slug: 'eclair',         alt: 'Éclair' },
    { id: '1571115177098-24ec42ed204d', slug: 'macaron',        alt: 'Macarons' },
    { id: '1606313564200-e75d5e30476c', slug: 'cookies',        alt: 'Cookies' },
    { id: '1535920527002-b35e96722eb9', slug: 'donut',          alt: 'Donuts' },
    { id: '1581798459219-318e76aecc7b', slug: 'cupcake',        alt: 'Cupcakes' },
    { id: '1567620905732-2d1ec7ab7445', slug: 'tart',           alt: 'Tarte aux fruits' },
  ],
  wraps: [
    { id: '1564671165093-20688ff1fffa', slug: 'wrap',           alt: 'Wrap' },
    { id: '1565299585323-38d6b0865b47', slug: 'wrap-veg',       alt: 'Wrap végétal' },
    { id: '1606755962773-d324e0a13086', slug: 'sandwich',       alt: 'Sandwich' },
    { id: '1554433607-66b5efe9d304',    slug: 'panini',         alt: 'Panini' },
    { id: '1601312378427-822b2b41da35', slug: 'taco',           alt: 'Tacos' },
    { id: '1599974579688-8dbdd335c77f', slug: 'burrito',        alt: 'Burrito' },
    { id: '1521305916504-4a1121188589', slug: 'club',           alt: 'Club sandwich' },
    { id: '1626700051175-6818013e1d4f', slug: 'street-wrap',    alt: 'Street wrap' },
    { id: '1568901346375-23c9450c58cd', slug: 'roll',           alt: 'Rouleau' },
    { id: '1565299624946-b28f40a0ae38', slug: 'pita',           alt: 'Pita' },
  ],
  pasta: [
    { id: '1551183053-bf91a1d81141',    slug: 'spaghetti',      alt: 'Spaghetti' },
    { id: '1608897013039-887f21d8c804', slug: 'carbonara',      alt: 'Carbonara' },
    { id: '1473093295043-cdd812d0e601', slug: 'penne',          alt: 'Penne' },
    { id: '1556761175-5973dc0f32e7',    slug: 'pasta-dish',     alt: 'Plat de pâtes' },
    { id: '1621996346565-e3dbc646d9a9', slug: 'lasagna',        alt: 'Lasagnes' },
    { id: '1612874742237-6526221588e3', slug: 'ravioli',        alt: 'Raviolis' },
    { id: '1611270629569-8b357cb88da9', slug: 'gnocchi',        alt: 'Gnocchis' },
    { id: '1551892374-ecf8754cf8b0',    slug: 'linguine',       alt: 'Linguine' },
    { id: '1563379091339-03b21ab4a4f8', slug: 'creamy',         alt: 'Pâtes crémeuses' },
    { id: '1525755662778-989d0524087e', slug: 'plate',          alt: 'Assiette de pâtes' },
  ],
  drinks: [
    { id: '1544145945-f90425340c7e',    slug: 'coffee',         alt: 'Café' },
    { id: '1497515114629-f71d768fd07c', slug: 'cocktail',       alt: 'Cocktail' },
    { id: '1437418747212-8d9709afab22', slug: 'lemonade',       alt: 'Limonade' },
    { id: '1622597467836-f3285f2131b8', slug: 'smoothie',       alt: 'Smoothie' },
    { id: '1556679343-c7306c1976bc',    slug: 'juice',          alt: 'Jus de fruit' },
  ],
} as const

/** Restaurant cover photos — warm, atmospheric. */
export const RESTAURANT_COVERS: ReadonlyArray<PhotoEntry> = [
  { id: '1517248135467-4c7edcad34c4', slug: 'bistro',           alt: 'Intérieur de restaurant' },
  { id: '1414235077428-338989a2e8c0', slug: 'terrace',          alt: 'Terrasse de restaurant' },
  { id: '1555396273-367ea4eb4db5',    slug: 'kitchen',          alt: 'Cuisine ouverte' },
  { id: '1552566626-52f8b828add9',    slug: 'cafe',             alt: 'Café cosy' },
  { id: '1559339352-11d035aa65de',    slug: 'pizzeria',         alt: 'Pizzeria' },
  { id: '1466978913421-dad2ebd01d17', slug: 'dining',           alt: 'Salle à manger' },
  { id: '1559925393-8be0ec4767c8',    slug: 'street',           alt: 'Street food' },
  { id: '1528605248644-14dd04022da1', slug: 'sushi-bar',        alt: 'Bar à sushi' },
  { id: '1546069901-ba9599a7e63c',    slug: 'bowls',            alt: 'Restaurant bowl' },
  { id: '1592861956120-e524fc739696', slug: 'modern',           alt: 'Restaurant moderne' },
] as const

// ── Public API ─────────────────────────────────────────────────────────────

const PUBLIC_PREFIX  = '/images/food'
const COVERS_PREFIX  = '/images/restaurants'

/** Deterministic non-negative hash. */
function hashStringIndex(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return Math.abs(h)
}

/**
 * Return a local food photo URL for the given category, deterministically
 * picked from `key` (e.g. a dish ID or name). Always returns a stable path
 * for the same key, so re-renders don't change images.
 */
export function getFoodImage(category: FoodCategory, key?: string | number): string {
  const list = FOOD_CATALOG[category]
  const idx = typeof key === 'number'
    ? Math.abs(key) % list.length
    : key
      ? hashStringIndex(String(key)) % list.length
      : 0
  return `${PUBLIC_PREFIX}/${category}/${list[idx]!.slug}.jpg`
}

/** Same as getFoodImage but returns the Unsplash CDN URL (fallback / dev). */
export function getFoodImageRemote(category: FoodCategory, key?: string | number, width = 800): string {
  const list = FOOD_CATALOG[category]
  const idx = typeof key === 'number'
    ? Math.abs(key) % list.length
    : key
      ? hashStringIndex(String(key)) % list.length
      : 0
  return `https://images.unsplash.com/photo-${list[idx]!.id}?w=${width}&h=${Math.round(width * 0.75)}&fit=crop&q=80`
}

/** Pick a restaurant cover photo deterministically. */
export function getRestaurantCover(key?: string | number): string {
  const idx = typeof key === 'number'
    ? Math.abs(key) % RESTAURANT_COVERS.length
    : key
      ? hashStringIndex(String(key)) % RESTAURANT_COVERS.length
      : 0
  return `${COVERS_PREFIX}/${RESTAURANT_COVERS[idx]!.slug}.jpg`
}

export function getRestaurantCoverRemote(key?: string | number, width = 1200): string {
  const idx = typeof key === 'number'
    ? Math.abs(key) % RESTAURANT_COVERS.length
    : key
      ? hashStringIndex(String(key)) % RESTAURANT_COVERS.length
      : 0
  return `https://images.unsplash.com/photo-${RESTAURANT_COVERS[idx]!.id}?w=${width}&h=${Math.round(width * 0.6)}&fit=crop&q=80`
}

/**
 * Best-guess category from a free-form cuisine string.
 * Helpful for /eat where cuisines come from JSON arrays.
 */
export function inferCategory(label: string): FoodCategory {
  const s = label.toLowerCase()
  if (s.includes('pizza') || s.includes('italian'))               return 'pizza'
  if (s.includes('burger') || s.includes('smash'))                return 'burgers'
  if (s.includes('sushi') || s.includes('japon') || s.includes('asia')) return 'asian'
  if (s.includes('bowl') || s.includes('healthy') || s.includes('salade')) return 'healthy'
  if (s.includes('dessert') || s.includes('patisserie') || s.includes('cake')) return 'desserts'
  if (s.includes('wrap') || s.includes('sandwich') || s.includes('tacos'))  return 'wraps'
  if (s.includes('pasta') || s.includes('pâtes') || s.includes('pates'))    return 'pasta'
  if (s.includes('boisson') || s.includes('drink') || s.includes('café'))   return 'drinks'
  return 'healthy'
}

/** Convenience — flat list of (category, photo) pairs for the showcase page. */
export const ALL_FOOD_PHOTOS: Array<{ category: FoodCategory; entry: PhotoEntry }> =
  (Object.keys(FOOD_CATALOG) as FoodCategory[]).flatMap((cat) =>
    FOOD_CATALOG[cat].map((entry) => ({ category: cat, entry })),
  )
