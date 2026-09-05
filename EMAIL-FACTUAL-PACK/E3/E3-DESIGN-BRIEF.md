# E3-DESIGN-BRIEF — onboarding, partner lifecycle, secondary account, courier waitlist, reservations (OUT), ops

## Tone by audience
- **Applicants / partners** (restaurant, supplier, influencer, courier): welcoming but factual; the platform is in closed beta and says so where the product says so (courier waitlist). Formal French. Clear next step with one CTA when a dashboard exists (validated → dashboard; verify → link; rejected → re-submit path).
- **Account security** (codes, email change): calm, precise, one action, explicit "if this wasn't you" with the support channel.
- **Guests** (reservations, OUT): hospitality tone, restaurant name first, session code `#XXXX`, no penalty wording unless the flag returns.
- **External supplier**: B2B purchase-order document, table-first, contact line for questions.
- **Admin ops recaps**: dense, monospace numbers, reuse the E2 admin sub-shell.

## Semantics per email
| Email | Band | Key line | Forbidden |
|---|---|---|---|
| AUTH_STEPUP_CODE / ACCOUNT_EMAIL_CHANGE_CODE | ACTION REQUIRED | action label + 6-digit code block + "10 min, une seule fois" + ignore-if-not-you | link (codes only) |
| ACCOUNT_EMAIL_CHANGE_LINK | ACTION REQUIRED | confirm button + copyable URL + "15 min, une seule fois", "rien ne change tant que vous ne cliquez pas" | |
| ACCOUNT_EMAIL_CHANGED_ALERT | WARNING (security) | replaced by `l***@e***`; "si ce n'est pas vous → contact@grubano.com" | |
| ACCOUNT_EMAIL_CHANGE_CONFIRM | SUCCESS | address active | |
| ACCOUNT_EMAIL_ALREADY_USED | NEUTRAL (security) | someone tried to attach this address; nothing changed | who tried |
| PARTNER_EMAIL_VERIFY | ACTION REQUIRED | verify button + URL, 24 h, then "connectez-vous par lien magique" | tutoiement |
| ADMIN_PARTNER_PENDING | ACTION (admin shell) | role label + partner name + console path | |
| PARTNER_ACCOUNT_VALIDATED | SUCCESS | "votre restaurant / compte fournisseur / compte est validé" + CTA to the dashboard (`/dashboard`, `/supplier/dashboard`, `/affiliate/dashboard`) | « établissement » |
| PARTNER_ACCOUNT_REJECTED | WARNING | not validated + reason + "corrigez et soumettez à nouveau" | finality |
| PARTNER_DOCS_NEEDED (no caller) | ACTION REQUIRED | documents needed + reason + dashboard | claiming it is live |
| ONBOARDING_NUDGE_RESTAURANT / GENERIC | ACTION (soft) | "{steps} étape(s) restantes" + resume CTA (deep link) + **unsubscribe** line | urgency pressure |
| COURIER_WAITLIST_CONFIRMATION | NEUTRAL | registered on the waitlist; will be contacted when the zone opens; no active account; no action | dates, earnings, missions, activation |
| CONSUMER_RESERVATION_CONFIRMED (+deposit) | SUCCESS (OUT-OF-BETA) | restaurant, date/time, couverts, `#code`, "présentez votre nom ou votre n° de session"; deposit state: conditional "peut être demandée … rien n'est débité … libérée automatiquement" | penalty wording |
| PARTNER_NEW_RESERVATION | ACTION (restaurant) | masked guest name, date, couverts, code | full guest PII |
| RESERVATION cancelled (client → client/owner, owner → client, closure) | WARNING | who cancelled, date, "empreinte libérée — aucun débit", re-book CTA for guest | |
| CONSUMER_NOSHOW_PENALTY_CHARGED (flag OFF) | WARNING + money | amount debited, date, contest path via support — **dormant, reactivation checklist** | "conditions annoncées" while none are announced; 30-day figure without a rule |
| OPERATOR_SUPPLIER_PURCHASE_ORDER | NEUTRAL (document) | PO table (product, qty+unit, line total), total, lead time as supplier text, display reference (proposal `PO-…`), sender restaurant identity (not passed today) | raw cuid as reference (proposal), `€41.40` format |
| CREATOR_DISH_ADOPTED | SUCCESS | restaurant (city) adopted "{dish}" at X €, royalty Y % applies, CTA studio | emoji |
| PARTNER_WAITLIST_OFFER | ACTION REQUIRED (timed) | exclusivity freed for "{dish}" in {city}, "{hours} h" to adopt, CTA `/menu` | countdown claims beyond the TTL value |
| CRON recaps | NEUTRAL (admin) | HTML+text proposal of the text templates (E3-COPY §H) | |

## Localization facts
Nudges ship ×5 with RTL (`onboardingNudge.*`, ICU plural). Everything else is FR-only today. Design FR; keep plural-safe layouts and mirrored RTL.

## Acceptance for E3
All 26 emails tagged (LIVE / GATED / OUT-OF-BETA / NO-CALLER / PROPOSAL) · formal French · validated email has a CTA · security emails name the support channel · courier copy unchanged in substance · reservations labelled OUT-OF-BETA · no drift from the E1 contract / E2 admin shell.
