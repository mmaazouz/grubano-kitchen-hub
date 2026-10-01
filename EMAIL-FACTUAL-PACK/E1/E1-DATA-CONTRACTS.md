# E1-DATA-CONTRACTS — fields available to the 13 E1 emails (from `../EMAIL-DATA-CONTRACTS.md`)

Formats: reference `GR-XXXXXX`; money cents → "12,50 €" (fr-FR); no dates in E1 order emails today (available if desired: `Order.createdAt/updatedAt` — not passed); base URL = deployment `NEXTAUTH_URL`.

| Email | Required (passed today) | Optional / conditional | Nullable → fallback | Available but NOT passed (would need plumbing) |
|---|---|---|---|---|
| AUTH_MAGIC_LINK | `to`, `link` (absolute, allow-listed host, `?token=`) | `name` (may be empty → "Bonjour,"), `code` (only when OTP flag on) | — | locale of the recipient (body is FR; path locale is known) |
| AUTH_PASSWORD_RESET | `to`, `name`, `resetUrl` | — | — | expiry timestamp (1 h known as a constant) |
| AUTH_PASSWORD_CHANGED | `to`, `name` | — | — | time/IP of change (not tracked) |
| CONSUMER_WELCOME | `to`, `name` | — | — | base URL (route hardcodes prod — implementation will switch to `NEXTAUTH_URL`) |
| CONSUMER_ORDER_CONFIRMATION | `to`, `customerName`, `restaurantName`, `orderRef`, `fulfillmentType`, `items[{name, qty}]`, `paidCents` | `dedupeKey` | `customerName` may be `''`; `items` may be `[]`; restaurant → "votre restaurant" | pickup time / restaurant address / phone (`Restaurant.*`), `Order.createdAt`, discount/delivery split (only the total is passed) |
| PARTNER_NEW_ORDER | `orderId`, `to`, `restaurantName`, `orderRef`, `fulfillmentType`, `items`, `totalCents` | — | `items` `[]` | consumer name (not passed — privacy-friendly), payment method (card only), `Order.createdAt` |
| CONSUMER_ORDER_ACCEPTED / READY / ENROUTE / COMPLETED / CANCELLED_GENERIC | `orderId`, `to`, `customerName` (route passes `name ?? email`), `restaurantName`, `orderRef`, `status`, `fulfillmentType` | — | restaurant → "votre restaurant" | items, total (status emails are status-only by design), restaurant address (for READY pickup), `Order.pointsEarned` (COMPLETED), review link |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF | `orderId`, `consumerId` → resolves `{to, name, locale}`, `restaurantName` | — | name empty → no greeting | paid amount (available on the order; deliberately not shown), support address (hardcoded in copy `contact@grubano.com`) |

Conditional states to design: pickup (live) vs delivery (dormant) · code present/absent (magic link) · empty name · empty items · long restaurant names · long item names / many lines · RTL (future) · dark mode.

Idempotency reminder: one email per (trigger, `order:<id>`); a repeated status never re-sends — no "reminder" state exists.
