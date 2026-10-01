// tests/support/race-stubs/stripe.ts — Stripe, as the D′ L5 database rehearsal sees it: a fixed, succeeded
// payment of 20,00 € with nothing refunded and no dispute, and no refund known to Stripe.
//
// It exists so lib/claims' money loader can reach its « payable » verdict without a network and without a key.
// Nothing here can move money: there is no Stripe client, no credential and no request. A rehearsal that could
// reach Stripe would be a rehearsal that could spend, which is precisely what must not exist.
const CHARGE = { id: 'ch_race', amount: 2000, amount_captured: 2000, amount_refunded: 0, disputed: false }

export function getStripe() {
  return {
    paymentIntents: {
      retrieve: async (id: string) => ({
        id, status: 'succeeded', transfer_data: null, metadata: {}, latest_charge: { ...CHARGE },
      }),
    },
    refunds: {
      list:     async () => ({ data: [] as unknown[], has_more: false }),
      retrieve: async (id: string) => { throw Object.assign(new Error(`No such refund: ${id}`), { statusCode: 404, code: 'resource_missing' }) },
      create:   async () => { throw new Error('the rehearsal never creates a refund at Stripe') },
    },
    transfers: {
      list:           async () => ({ data: [] as unknown[], has_more: false }),
      listReversals:  async () => ({ data: [] as unknown[], has_more: false }),
      createReversal: async () => { throw new Error('the rehearsal never reverses a transfer') },
    },
    applicationFees: { listRefunds: async () => ({ data: [] as unknown[], has_more: false }) },
    balance:         { retrieve: async () => ({ available: [], pending: [] }) },
  }
}
