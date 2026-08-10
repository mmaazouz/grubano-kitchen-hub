// ── Adresse du reçu : les DEUX lignes de la rangée « Adresse » ────────────────
// Fonction PURE, exportée pour être exercée telle quelle par les tests (revue
// BG : le test précédent ré-implémentait la logique et laissait donc passer
// toute dérive du code livré).
//
// MODÈLE RÉEL (vérifié au schéma, pas supposé — revue BG) : Restaurant.address
// est la LIGNE DE VOIE seule et Restaurant.city la ville ; AUCUN code postal
// n'est persisté (POST /api/restaurants valide un postalCode distinct puis le
// RETIRE avant écriture — il ne sert qu'au géocodage). La 2ᵉ ligne est donc la
// VILLE, pas « code postal + ville » : la référence prescrit un code postal que
// le modèle ne porte pas (signalé, hors périmètre — ce serait un changement de
// schéma).
//
// Aucune heuristique sur les chiffres : une version antérieure coupait sur un
// nombre de 4 à 6 chiffres et cassait « Centre Commercial Cap 3000 », « Via
// Roma 1500 », « Lot 1204 » — en PERDANT la ville. Les cas sont verrouillés en
// tests.
//
// Cas héritée : si l'adresse porte DÉJÀ la ville (saisie libre « 12 Rue de la
// République, 84100 Orange »), on ne la répète pas — on coupe alors sur la
// dernière virgule quand il y en a une, sinon on rend l'adresse d'un bloc.
// La détection de la ville compare des MOTS ENTIERS consécutifs, jamais une
// sous-chaîne : « Pau » ne doit pas être avalé par « rue Paul Bert », ni « Eu »
// par « Vieux » (contre-cas rétablis par la revue AW).

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean)

/** true si `city` apparaît dans `addr` en mots entiers consécutifs. */
function addressContainsCity(addr: string, city: string): boolean {
  const aw = words(addr)
  const cw = words(city)
  if (cw.length === 0 || aw.length === 0) return false
  return aw.some((_, i) => cw.every((w, j) => aw[i + j] === w))
}

/**
 * Les lignes de la rangée « Adresse » du reçu, dans l'ordre d'affichage.
 * Cas normal (modèle) : ['12 Rue de Rivoli', 'Paris'].
 * Jamais d'exception : une valeur vide ou anormale dégrade, elle ne casse pas.
 */
export function receiptAddressLines(address: string | null, city: string | null): string[] {
  const addr = (address ?? '').trim().replace(/\s+/g, ' ')
  const town = (city ?? '').trim().replace(/\s+/g, ' ')
  if (!addr) return town ? [town] : []
  if (!town) return [addr]
  if (!addressContainsCity(addr, town)) return [addr, town]
  // L'adresse porte déjà la ville : ne pas la répéter.
  const cut = addr.lastIndexOf(',')
  if (cut > 0 && cut < addr.length - 1) {
    return [addr.slice(0, cut).trim(), addr.slice(cut + 1).trim()]
  }
  return [addr]
}
