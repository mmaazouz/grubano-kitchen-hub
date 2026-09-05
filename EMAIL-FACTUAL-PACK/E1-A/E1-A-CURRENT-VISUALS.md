# E1-A-CURRENT-VISUALS — fossils of the 3 representative emails

> Raw fragment `current-renders/<ID>.html` (exact HTML handed to Nodemailer), `<ID>.json` (from/to/subject/flags), `<ID>.txt` (plain-text part — magic link only). Screenshots `current-renders/png/<ID>@600.png` and `@390.png`, white ground, 16 px padding. Zero images in every template (images-off = N/A today).

| ID | Subject | To (fixture) | text part | 600 px | 390 px |
|---|---|---|---|---|---|
| AUTH_MAGIC_LINK | Ton lien de connexion Grubano | lea.martin@example.invalid | yes | [png](current-renders/png/AUTH_MAGIC_LINK@600.png) | [png](current-renders/png/AUTH_MAGIC_LINK@390.png) |
| CONSUMER_ORDER_READY_PICKUP | Commande GR-ABC123 prête — Gnocchi Bar | lea.martin@example.invalid | no | [png](current-renders/png/CONSUMER_ORDER_READY_PICKUP@600.png) | [png](current-renders/png/CONSUMER_ORDER_READY_PICKUP@390.png) |
| PARTNER_NEW_ORDER | Nouvelle commande GR-ABC123 — Gnocchi Bar | gnocchi.bar@example.invalid | no | [png](current-renders/png/PARTNER_NEW_ORDER@600.png) | [png](current-renders/png/PARTNER_NEW_ORDER@390.png) |

## Shared observations (current state to move away from)
- Fragment only (no `<html>`, no `lang`, no preheader, no `<title>`), 480 px column, `Inter,Arial` requested but never embedded, legacy `#F97316` orange heading / `#1a1a2e` text, styled `<a>` button (no VML), one footer sentence, no logo, no support block.
- Contrast: footer grey `#9ca3af` 12 px ≈ 2.9:1 (fails AA); orange `#F97316` heading on white ≈ 2.8:1 and white-on-orange button ≈ 2.8:1 (fail AA).
- Status conveyed by heading text + « ✓ » + colour only.
