// THE single source of truth for Grubano's commission (rail financier A2).
// A0 decisions (validated by Mohammed, 10 June 2026): platform-default rates per
// channel, Stripe fees INCLUDED in the commission (the platform absorbs them —
// neither the resto nor the client sees a separate fee line); per-establishment
// override via Restaurant.commissionRate<Channel> (null = platform default);
// bounded founders offer via Restaurant.commissionFreeUntil (0 % until the date).
// The fee is taken AT THE SOURCE on destination charges (application_fee_amount):
// the resto receives net, Grubano's cut lands on the platform account.

export type CommissionChannel = 'dinein' | 'pickup' | 'delivery' | 'reservation'

/** Platform-default commission rates per channel (A0). Exported for the future
 *  finance dashboard (A7) — display ONLY from here, never hardcode elsewhere. */
export const PLATFORM_COMMISSION_RATES: Record<CommissionChannel, number> = {
  dinein:      0.05, // sur-place / addition à table
  pickup:      0.08, // à emporter
  delivery:    0.12, // livraison
  reservation: 0,    // empreinte / no-show penalty: 100 % to the resto (A0)
}

/** The Restaurant columns A1 posed (all nullable — null = platform default). */
export type RestaurantCommissionFields = {
  commissionRateDineIn:   number | null
  commissionRatePickup:   number | null
  commissionRateDelivery: number | null
  commissionFreeUntil:    Date | null
}

/** Effective rate for one establishment on one channel:
 *  founders offer (commissionFreeUntil in the future) → 0 ;
 *  per-establishment override when set ; else the platform default. */
export function resolveCommissionRate(
  restaurant: RestaurantCommissionFields,
  channel: CommissionChannel,
  now: Date = new Date(),
): number {
  if (restaurant.commissionFreeUntil && restaurant.commissionFreeUntil.getTime() > now.getTime()) {
    return 0
  }
  const override =
    channel === 'dinein'   ? restaurant.commissionRateDineIn :
    channel === 'pickup'   ? restaurant.commissionRatePickup :
    channel === 'delivery' ? restaurant.commissionRateDelivery :
    null // reservation: no override column — always the platform default (0)
  return override ?? PLATFORM_COMMISSION_RATES[channel]
}

/** Grubano's application fee in integer CENTS for a charge of `amountCents`.
 *  Math.round at the cent, clamped ≥ 0 (and never above the charge itself). */
export function computeApplicationFee(
  restaurant: RestaurantCommissionFields,
  channel: CommissionChannel,
  amountCents: number,
  now: Date = new Date(),
): number {
  const rate = resolveCommissionRate(restaurant, channel, now)
  const fee  = Math.round(amountCents * rate)
  return Math.min(Math.max(fee, 0), Math.max(amountCents, 0))
}
