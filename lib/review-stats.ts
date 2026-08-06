import { prisma } from '@/lib/prisma'

// ── V4-2 (vague 4) — décision fondateur CONSERVATRICE sur les notes ────────────
// Les colonnes dénormalisées Restaurant.rating / reviewCount sont HÉRITÉES du
// seed (4,7-4,8 sur « 120+ avis ») et ne sont JAMAIS recalculées depuis la table
// Review (défaut documenté — tests/p1-p10/p9, hors périmètre de ce ticket) :
// tant qu'aucun avis RÉEL n'existe, AUCUNE note n'est affichée et AUCUN compteur
// fabriqué n'est présenté. Ceci n'est PAS un recalcul d'agrégat : on compte
// seulement les avis réels publiés pour savoir si une note a le droit d'exister,
// et le compteur affiché devient ce compte réel.

/** Nombre d'avis RÉELS (table Review, status='published') par restaurant.
 *  Une seule requête groupée pour la liste affichée (≤ 60 ids). */
export async function realReviewCounts(restaurantIds: string[]): Promise<Map<string, number>> {
  if (restaurantIds.length === 0) return new Map()
  const rows = await prisma.review.groupBy({
    by:     ['restaurantId'],
    where:  { restaurantId: { in: restaurantIds }, status: 'published' },
    _count: { _all: true },
  })
  return new Map(rows.map(r => [r.restaurantId, r._count._all]))
}

/** Masque note + compteur fabriqués : la note stockée n'est servie QUE si des
 *  avis réels existent ; le compteur servi est TOUJOURS le compteur réel
 *  (« aucun écran ne présente un nombre d'avis ne correspondant pas à la base »). */
export function honestRating<T extends { rating: number | null; reviewCount: number }>(
  row: T,
  realCount: number,
): T {
  return { ...row, rating: realCount > 0 ? row.rating : null, reviewCount: realCount }
}
