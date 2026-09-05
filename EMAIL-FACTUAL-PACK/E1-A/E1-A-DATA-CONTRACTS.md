# E1-A-DATA-CONTRACTS — fields available to the 3 representative emails

Formats: order reference `GR-XXXXXX` (display ref, 6 chars, not unique); money cents → `fr-FR` « 12,50 € »; base URL = deployment `NEXTAUTH_URL` (staging `https://app.grubano.com`); restaurant name = `Restaurant.name`.

| Email | Required (passed today) | Optional / conditional | Nullable → fallback | Available but NOT passed (needs plumbing) |
|---|---|---|---|---|
| AUTH_MAGIC_LINK | `to`, `link` (absolute, allow-listed host, `/{locale}/eat/magic?token=` or `/auth/magic`) | `name` (empty → « Bonjour, »), `code` (6 digits, only when `AUTH_EMAIL_OTP_ENABLED`) | — | recipient locale (body FR only), device/IP (not tracked) |
| CONSUMER_ORDER_READY (pickup) | `orderId`, `to`, `customerName` (route passes name ?? email), `restaurantName`, `orderRef`, `status:'ready'`, `fulfillmentType` | delivery state = OUT-OF-BETA dormant (`DELIVERY_FULFILLMENT_ENABLED`) | restaurant → « votre restaurant » | items, total (status emails are status-only by design), **restaurant address / opening hours / phone** (`Restaurant.*` — the natural pickup information), pickup pass link (`/eat/order/[id]/pickup` exists), `Order.createdAt` |
| PARTNER_NEW_ORDER | `orderId`, `to` (`restaurant.operator.email`), `restaurantName`, `orderRef`, `fulfillmentType` (→ « Click & collect »), `items[{name, qty}]`, `totalCents` (server `order.total`) | — | `items` may be `[]` | consumer name (privacy: not passed), payment method (card only in beta), `Order.createdAt`, dashboard deep link (path `/orders` known, not passed), item options/notes |

Idempotency: magic link none (legitimate repeats); READY = `order_ready` / `order:<id>` (one per order); NEW_ORDER = `resto_order_received` / `order:<id>` (one per order; now guaranteed server-side).

Conditional states to design: empty name · empty items · long restaurant / item names · code present/absent (auth) · RTL readiness (future ×5) · dark mode · images-off · plain text.
