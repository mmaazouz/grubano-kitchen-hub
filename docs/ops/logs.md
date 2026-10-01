# Logs utiles — où regarder quand ça casse (S0-4)

## 1. CI (GitHub Actions)

- Onglet Actions → run du workflow concerné. Les logs des jobs sont
  admin-gated via l'API ; le step FTP est en `log-level: verbose` exprès.
- Échec de deploy le plus fréquent : FTPS (timeout/553) → relancer le
  workflow ; le `concurrency` fait la queue, jamais d'annulation en vol.
- `test` job rouge = régression réelle (suite complète, inclut le harnais
  P1-P10) — ne JAMAIS contourner en réduisant le scope du gate.

## 2. Serveur o2switch (cPanel)

- Logs Passenger/app + sorties des crons : `~/logs/` — ✅ confirmé par le
  relevé serveur des 26-27/07/2026 (cf. [crons.md](crons.md)). cPanel →
  Métriques → Erreurs pour l'Apache frontal.
- L'app loggue en anglais sur stderr (`console.error`) — les erreurs runtime
  Next.js arrivent là, avec le préfixe de la route ou du module.
- `~/app.grubano.com/tmp/restart.txt` : mtime = dernier restart demandé.
- `VERSION` + `public/version.json` (S0-3) : quel build tourne exactement.

## 3. Tables d'audit applicatives (lecture DB — read-only)

| Table | Ce qu'elle trace |
|---|---|
| `EmailLog` | Chaque tentative d'email (trigger, statut sent/failed/skipped) — premier réflexe quand « le client n'a pas reçu l'email » (SMTP local injoignable → tout `failed` en dev, c'est attendu) |
| `LedgerEntry` | Vérité financière par commande (commission, fees Stripe, refunds) — la sonde `ledger-check-probe` alerte sur incohérence |
| `AdminAuditLog` | Actions admin (si `ADMIN_AUDIT_ENABLED`) |
| `LoyaltyTransaction` | Crédits/débits fidélité idempotents par commande |

## 4. Endpoints de diagnostic

- `GET /version.json` — build déployé (S0-3, public, statique).
- `POST /api/csp-report` — rapports CSP (report-only aujourd'hui) ; visibles
  dans les logs serveur avec le préfixe `[CSP-REPORT]`.
- Scripts de diag locaux (jamais shippés) : `scripts/diag-margins.js`,
  `scripts/diag-referral.js`, `scripts/qa-healthcheck.js`.

## 5. Ce qui N'EXISTE PAS (constat d'audit — ne pas chercher)

- Aucun APM/Sentry/collecteur d'erreurs tiers (CSP en creux le confirme).
- Aucun traçage de visites côté client (constat H2) — les access logs Apache
  de cPanel sont la SEULE source rétroactive : **à archiver régulièrement**
  (recommandation d'audit, décision hors Sprint 0).
