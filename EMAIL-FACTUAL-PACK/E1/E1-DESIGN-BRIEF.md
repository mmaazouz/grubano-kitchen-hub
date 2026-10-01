# E1-DESIGN-BRIEF — what good looks like for the Grubano email system and the E1 set

## Direction
Premium, warm, food-first, professional, trustworthy. ZEST orange (`#FF6A1F`) as the accent, INK navy (`#0F2742`) as the voice, BASIL green (`#2BA45C`) for success, warm off-white ground (`#FBF8F3`) with white cards. Sober: the current emails are honest but bare; the redesign should feel like the Grubano consumer app (`gb-foundation`) without importing its web fonts (system stack in email). Formal French.

## System components (E1 owns the contract)
1. **Document shell** — `<!doctype html><html lang="fr" dir="ltr|rtl">`, `<title>` = subject, hidden preheader, outer 100 % table on `#FBF8F3`, inner 600 px card (fluid ≤ 600, 320/390 safe), 16–24 px gutters, footer.
2. **Header band** — Grubano symbol (PNG export of `public/brand/grubano-symbol-color.svg`, `alt="Grubano"`) + wordmark as **text** (no wordmark asset exists); optional restaurant name line for order emails.
3. **Status band** — text label + glyph + colour, 5 semantics: SUCCESS (basil), ACTION REQUIRED (zest), NEUTRAL (ink/muted), WARNING (warning `#EA9410`), URGENT (danger `#E0402E`). Text carries the meaning; colour is redundant.
4. **Order summary** — reference `GR-XXXXXX` prominent (mono or bold), items table (qty × name), mode line (Click & collect only in beta; delivery dormant), total row (server amount), restaurant name.
5. **CTA** — primary bulletproof button (dark text on zest **or** white on `--gb-zest-600 #F2570E` — verify AA ≥ 4.5:1), secondary text link; the raw URL fallback pattern from the magic link must survive (copyable link under the button for auth emails).
6. **Code block** — 6 digits, mono, large, high contrast, also in plain text.
7. **Note / helper text** — muted `#6B7682` at ≥ 14 px (current 12–13 px greys fail AA).
8. **Footer** — sender identity ("Grubano"), why-you-receive-this line (transactional), support line (`contact@grubano.com` — the only promised channel), no unsubscribe on transactional emails.
9. **RTL + locale readiness** — layout must mirror cleanly (claims/nudges already ship `ar`); no text baked into images.
10. **Plain-text pattern** — heading, one-line status, key facts (reference, restaurant, total), CTA URL, support line.

## Per-email intent (13 emails, 16 states)
| Email | Semantics | Must show | Must not |
|---|---|---|---|
| AUTH_MAGIC_LINK (+OTP state) | ACTION REQUIRED | button + copyable URL; "15 min, une seule fois"; OTP state: code block + "10 min" | tutoiement; promise that an email was sent when config lacks SMTP (copy lives in the app, not the email) |
| AUTH_PASSWORD_RESET | ACTION REQUIRED | button + URL; "1 heure, une seule fois"; "ignorez si ce n'est pas vous" | |
| AUTH_PASSWORD_CHANGED | WARNING (security) | what changed, when (available: now), what to do if not you (reset link path / support) | |
| CONSUMER_WELCOME | SUCCESS | account active; what you can do **in beta** (commander en Click & collect, points fidélité); CTA to `/eat` on the deployment base | "réserver une table"; hardcoded prod URL |
| CONSUMER_ORDER_CONFIRMATION | SUCCESS (paid) | paid amount, items, `GR-`, restaurant, mode Click & collect, CTA « Suivre ma commande » | ETA; delivery as live |
| PARTNER_NEW_ORDER | ACTION REQUIRED (restaurant) | `GR-`, items, mode, amount, "à accepter dans le tableau de bord"; dense/operational tone | consumer PII beyond what is passed (none is) |
| CONSUMER_ORDER_ACCEPTED | NEUTRAL→SUCCESS | restaurant is preparing | time estimate |
| CONSUMER_ORDER_READY (pickup) | ACTION REQUIRED | "prête, venez la récupérer" + `GR-` (the pass reference) | address (not passed today — optional conditional state "requires plumbing") |
| CONSUMER_ORDER_READY (delivery) · ENROUTE · COMPLETED (delivery) | **DORMANT** | design once as a labelled dormant variant | anything implying live delivery |
| CONSUMER_ORDER_COMPLETED (pickup) | SUCCESS | "récupérée", invite to rate (link target `/eat/account` exists), optional points line (conditional) | |
| CONSUMER_ORDER_CANCELLED_GENERIC | WARNING | cancelled, contact the restaurant | money wording (unpaid) |
| CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF | WARNING + money note | cancelled; "pour le remboursement du montant payé, contactez le support contact@grubano.com en indiquant GR-…"; human handling during beta | "remboursement effectué", delays, amounts promised |

## Subject / preheader pattern (recommendation target)
`{Statut court} — Commande GR-XXXXXX · {Restaurant}` for order emails; auth subjects without the word "Grubano" twice; preheader = the one sentence that completes the subject (e.g. "Votre paiement de 25,50 € est confirmé. Gnocchi Bar prépare votre commande."). Keep ≤ 60 chars subject, ≤ 90 chars preheader; no emoji.

## Accessibility & client targets
AA contrast for all text; one `<h1>`; alt text on the only image; 14 px minimum body; tap targets ≥ 44 px; Gmail web/iOS/Android, Apple Mail, Outlook desktop (button degrades to a link, background may drop — text must still read), Orange webmail. Test images-off and dark-mode inversion (avoid pure-black text on transparent backgrounds).

## Acceptance for E1
System contract published · 16 states rendered desktop+mobile · images-off + text views · subject/preheader table · no truthfulness violation from `../EMAIL-TRUTHFULNESS-REGISTER.md` (T1–T4, T12, T22, T23) · lexicon respected (« Click & collect », « restaurant »).
