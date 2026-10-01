# E1-C-HANDOFF — CONSUMER ORDER FAMILY EXPANSION (future Claude Design session — NOT STARTED)

> **REQUIRES APPROVED E1-A SYSTEM CONTRACT**. Reuse the READY (pickup) reference from E1-A as the family anchor. Closed-beta truth: **CLICK & COLLECT IN · DELIVERY OUT · SUR PLACE OUT**; canonical `GR-XXXXXX`; no ETA; formal French. Facts: `../EMAIL-MANIFEST.md §2`, copy `../EMAIL-COPY-VERBATIM.md §B`, contracts `../EMAIL-DATA-CONTRACTS.md §1`, fossils `../current-renders/`, truthfulness `../EMAIL-TRUTHFULNESS-REGISTER.md` (T1/T2 fixed 2026-09-05: `picked_up` refused for pickup orders; delivery wording double-gated).

| ID | Status | Design notes |
|---|---|---|
| CONSUMER_ORDER_CONFIRMATION | A | paid recap (items, total, mode Click & collect, `GR-`), CTA « Suivre ma commande »; delivery variant = dormant |
| CONSUMER_ORDER_ACCEPTED | A | restaurant is preparing; no time estimate |
| CONSUMER_ORDER_READY | A | **done in E1-A** (pickup) |
| CONSUMER_ORDER_ENROUTE | dormant | delivery-only by code since 2026-09-05; never reachable in beta — design only as a labelled OUT-OF-BETA state (or skip) |
| CONSUMER_ORDER_COMPLETED | A | « récupérée » (pickup); invite to rate; optional points line (conditional, requires data); delivery « livrée » dormant |
| CONSUMER_ORDER_CANCELLED_GENERIC | A | unpaid cancellation, neutral |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF | A | **the live money-adjacent email**: refund handled by support `contact@grubano.com`, quote `GR-`; no « effectué », no delay, no amount promise; localized ×5 today (RTL) |

Out of scope: claims-ON cancellation variant (E2), refunds (E2), reservations (E3).
