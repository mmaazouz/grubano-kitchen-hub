import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/navigation'
import { StellarCard, StellarPriceTag } from '@/components/stellar'
import { getRestaurant } from '../../data'

// SCREEN 3/7 — RESTAURANT (Agent 127 → Agent 129 Stellar → Agent 130 real data). Bataille 2:
// a transparency banner at the TOP (fee + ETA + min). REAL restaurant + its REAL menu grouped by
// category (read-only, same models + gate as /api/restaurants/[id]). Each dish links to its detail.
export const dynamic = 'force-dynamic'

const addBtn = 'shrink-0 rounded-stellar-md border border-stellar-primary px-3 py-1.5 font-stellar-display text-sm font-semibold text-stellar-primary'

export default async function EatNextRestaurant({ params }: { params: { id: string } }) {
  const t = await getTranslations('eatNext.restaurant')
  const r = await getRestaurant(params.id)
  if (!r) notFound()

  return (
    <div className="pb-4">
      <div className="h-32 w-full bg-stellar-surface-2" aria-hidden />
      <div className="space-y-4 p-4">
        <div>
          <h1 className="font-stellar-display text-2xl font-extrabold text-stellar-fg">{r.name}</h1>
          <p className="text-sm text-stellar-muted-fg">{r.cuisine || t('fallbackName')} · ★ {r.rating.toFixed(1)} ({t('reviews', { count: r.reviewCount })})</p>
        </div>

        {/* Bataille 2 — transparency banner, up front. */}
        <StellarCard elevation="soft" padding="md" className="flex flex-wrap gap-x-4 gap-y-1 bg-stellar-primary-soft text-sm text-stellar-accent-fg">
          {/* LOT VÉRACITÉ : « Livraison : 1,99 € » sortait pour des restos SANS
              livraison (défaut de schéma), et « Délai : 30 min » était le
              deliveryTime qu'aucune UI ne saisit — retirés/conditionnés. */}
          {r.deliveryEnabled && (
            <span>🛵 {t('delivery')}&nbsp;: <b>{r.deliveryFeeEur === 0 ? t('deliveryFree') : <StellarPriceTag amountEur={r.deliveryFeeEur} size="sm" />}</b></span>
          )}
          <span>🧺 {t('minimum')}&nbsp;: <b><StellarPriceTag amountEur={r.minOrderEur} size="sm" /></b></span>
        </StellarCard>

        {r.menu.length === 0 ? (
          <p className="rounded-stellar-lg border border-stellar-border bg-stellar-surface-1 p-6 text-center text-sm text-stellar-muted-fg">
            {t('menuEmpty')}
          </p>
        ) : (
          r.menu.map((section) => (
            <section key={section.category}>
              <h2 className="mb-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">{section.category}</h2>
              <ul className="space-y-2">
                {section.items.map((d) => (
                  <li key={d.id}>
                    <StellarCard elevation="soft" padding="md" className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-stellar-display font-semibold text-stellar-fg">{d.name}</p>
                        {d.description && <p className="truncate text-sm text-stellar-muted-fg">{d.description}</p>}
                        <p className="mt-0.5"><StellarPriceTag amountEur={d.priceEur} size="sm" /></p>
                      </div>
                      <Link href={`/eat-next/dish/${d.id}`} className={addBtn}>{t('add')}</Link>
                    </StellarCard>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <Link href="/eat-next/cart" className="block rounded-stellar-lg bg-stellar-primary py-3 text-center font-stellar-display font-semibold text-stellar-primary-fg shadow-stellar-soft">
          {t('viewCart')}
        </Link>
      </div>
    </div>
  )
}
