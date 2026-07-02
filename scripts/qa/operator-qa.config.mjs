/**
 * operator-qa.config.mjs — the ~29 auth-gated OPERATOR screens the visual-QA robot shoots.
 *
 * Each screen: { name, url (locale-prefixed '/fr/…'), ref? (a committed CD mock under
 * scripts/design-qa-refs/op-*.html, relative to the repo root — ONLY when one exists),
 * viewports }.
 *
 * TOOLING ONLY — no imports of app code. Dynamic [id] routes read their id from the
 * environment (QA_RESTAURANT_ID / QA_BRAND_ID) AT CONFIG-EVAL TIME; if the env id is
 * missing the screen is SKIPPED with a console.warn (so the robot never hits a bad URL).
 *
 * Ref mapping is 1:1 with the committed op-*.html filenames (see design-qa-refs/):
 *   dashboard→op-dashboard · analytics→op-analytics · finance→op-finance · cashflow→op-cashflow
 *   menu→op-menus · tables→op-tables · reviews→op-reviews · customers→op-customers
 *   dinein→op-dinein · orders→op-orders · deliveries→op-deliveries · stocks→op-stock
 *   suppliers-shop→op-supplier-shop · marketplace-orders→op-marketplace-orders · reorder→op-reorder
 * Screens with NO committed ref are CAPTURE-ONLY (no diff).
 */

const REST_ID = process.env.QA_RESTAURANT_ID || ''
const BRAND_ID = process.env.QA_BRAND_ID || ''
// The marketplace supplier SHOP is /marketplace/suppliers/[SupplierProfile.id] — a supplier
// id, NOT a brand id. The minimal QA seed creates no marketplace supplier, so this stays
// unset by default and the shop screen self-skips (capture it by seeding a SupplierProfile
// + catalogue and exporting QA_SUPPLIER_ID). See scripts/qa/README.md.
const SUPPLIER_ID = process.env.QA_SUPPLIER_ID || ''

const DESKTOP = { name: 'desktop', w: 1440, h: 1024 }
const MOBILE = { name: 'mobile', w: 390, h: 844 }
const REFS = 'scripts/design-qa-refs'

// A screen that depends on a dynamic id: build it only when the id is present,
// otherwise emit null + warn (filtered out below).
function dyn(id, label, build) {
  if (!id) {
    console.warn(`· operator-qa.config: skipping "${label}" — ${label} needs an env id that is not set.`)
    return null
  }
  return build(id)
}

export const screens = [
  // ── Core analytics / finance surfaces (some have committed CD refs) ───────────
  { name: 'dashboard', url: '/fr/dashboard', ref: `${REFS}/op-dashboard.html`, viewports: [DESKTOP, MOBILE] },
  { name: 'analytics', url: '/fr/analytics', ref: `${REFS}/op-analytics.html`, viewports: [DESKTOP] },
  { name: 'finance', url: '/fr/finance', ref: `${REFS}/op-finance.html`, viewports: [DESKTOP] },
  { name: 'briefing', url: '/fr/briefing', viewports: [DESKTOP] },
  { name: 'cashflow', url: '/fr/cashflow', ref: `${REFS}/op-cashflow.html`, viewports: [DESKTOP] },

  // ── Menu / catalogue / loyalty / pricing ──────────────────────────────────────
  { name: 'menu', url: '/fr/menu', ref: `${REFS}/op-menus.html`, viewports: [DESKTOP, MOBILE] },
  { name: 'promotions', url: '/fr/promotions', viewports: [DESKTOP] },
  { name: 'loyalty', url: '/fr/loyalty', viewports: [DESKTOP] },
  { name: 'pricing', url: '/fr/pricing', viewports: [DESKTOP] },

  // ── Front-of-house ────────────────────────────────────────────────────────────
  { name: 'tables', url: '/fr/tables', ref: `${REFS}/op-tables.html`, viewports: [DESKTOP] },
  { name: 'reviews', url: '/fr/reviews', ref: `${REFS}/op-reviews.html`, viewports: [DESKTOP] },
  { name: 'customers', url: '/fr/customers', ref: `${REFS}/op-customers.html`, viewports: [DESKTOP] },
  { name: 'dinein', url: '/fr/dinein', ref: `${REFS}/op-dinein.html`, viewports: [DESKTOP, MOBILE] },

  // ── Orders / fulfillment ──────────────────────────────────────────────────────
  { name: 'orders', url: '/fr/orders', ref: `${REFS}/op-orders.html`, viewports: [DESKTOP, MOBILE] },
  { name: 'deliveries', url: '/fr/deliveries', ref: `${REFS}/op-deliveries.html`, viewports: [DESKTOP] },
  { name: 'fulfillment', url: '/fr/dashboard/fulfillment', viewports: [DESKTOP] },
  { name: 'notifications', url: '/fr/notifications', viewports: [DESKTOP] },
  { name: 'prep', url: '/fr/prep', viewports: [DESKTOP] },

  // ── Stocks / suppliers / marketplace ──────────────────────────────────────────
  { name: 'stocks', url: '/fr/stocks', ref: `${REFS}/op-stock.html`, viewports: [DESKTOP] },
  { name: 'suppliers', url: '/fr/suppliers', viewports: [DESKTOP] },
  // marketplace supplier SHOP is /marketplace/suppliers/[SupplierProfile.id] (a supplier id,
  // NOT a brand). Self-skips unless QA_SUPPLIER_ID is set (seed a SupplierProfile + catalogue).
  dyn(SUPPLIER_ID, 'marketplace-suppliers-shop', (id) => ({
    name: 'marketplace-suppliers-shop',
    url: `/fr/marketplace/suppliers/${id}`,
    ref: `${REFS}/op-supplier-shop.html`,
    viewports: [DESKTOP],
  })),
  { name: 'marketplace-orders', url: '/fr/marketplace/orders', ref: `${REFS}/op-marketplace-orders.html`, viewports: [DESKTOP] },
  { name: 'marketplace-reorder', url: '/fr/marketplace/reorder', ref: `${REFS}/op-reorder.html`, viewports: [DESKTOP] },

  // ── Brands / establishments ───────────────────────────────────────────────────
  { name: 'brands', url: '/fr/brands', viewports: [DESKTOP] },
  // /brands/[id]/franchise — id = the QA brand id.
  dyn(BRAND_ID, 'brand-franchise', (id) => ({
    name: 'brand-franchise',
    url: `/fr/brands/${id}/franchise`,
    viewports: [DESKTOP],
  })),
  { name: 'establishments', url: '/fr/dashboard/establishments', viewports: [DESKTOP] },
  // /dashboard/establishments/[id] — id = the QA restaurant id.
  dyn(REST_ID, 'establishment-detail', (id) => ({
    name: 'establishment-detail',
    url: `/fr/dashboard/establishments/${id}`,
    viewports: [DESKTOP],
  })),

  // ── Settings / onboarding ─────────────────────────────────────────────────────
  { name: 'more', url: '/fr/more', viewports: [DESKTOP, MOBILE] },
  { name: 'onboarding', url: '/fr/onboarding', viewports: [DESKTOP] },
  { name: 'add-activity', url: '/fr/add-activity', viewports: [DESKTOP] },
].filter(Boolean) // drop skipped dynamic screens (dyn() → null)
