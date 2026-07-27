# CI garde-fous — analyse (S0-5)

## 1. Gates ACTUELS (vérifiés ✅)

| Gate | Où | Bloquant ? |
|---|---|---|
| Suite vitest complète (`npm run test:ci` — 298 fichiers / ~2700 tests, dont `tests/flag-coupling.test.ts` et le harnais `tests/p1-p10/`) | job `test` de `deploy-staging.yml` ET `deploy-production.yml` (`needs: test`) | ✅ bloque le FTP |
| Parité i18n (`scripts/check-translations.js`) | étape du job `deploy` des deux workflows | ✅ bloque |
| Health check prod (HTTP 200) | `deploy-production.yml` | ✅ bloque (staging : non-bloquant) |
| Vérif build déployé (`version.json`, S0-3) | les deux workflows | non-bloquant (volontaire) |

**Trou n°1 — aucune CI hors deploy** : une branche de travail (ex.
`sprint0-prep`) ou une PR ne déclenche RIEN. Les tests ne tournent qu'au
moment où le code part déjà vers staging. → comblé par `.github/workflows/tests.yml`
(ajout S0-5, pur additif : ne touche pas les workflows de deploy). En faire un
check *required* sur les PR = réglage GitHub (branch protection), décision Mohammed.

## 2. Où brancher `check-flags.mjs` (analyse)

État : `scripts/check-flags.mjs` vérifie `process.env` ; sa LOGIQUE est déjà
gardée par `tests/flag-coupling.test.ts` (donc par le gate full-suite). Mais il
n'est branché contre AUCUN environnement réel.

| Option | Description | Verdict |
|---|---|---|
| ❌ Naïf : `npm run check:flags` dans le job CI | L'env CI ne contient aucun flag → toujours vert = **fausse confiance**. | À ne jamais faire (c'est pour ça qu'il n'a pas été branché en Lot A) |
| **A (recommandée)** : exécution CÔTÉ SERVEUR post-deploy | Étape SSH des workflows : `cd ~/app.grubano.com && node --env-file=.env.local scripts/check-flags.mjs`. Source de vérité = le vrai `.env.local` serveur → zéro dérive. N'imprime que les règles violées, jamais de valeur. | **Lot B** (2 prérequis à valider : (1) shipper le script — `scripts/*.mjs` racine n'est PAS déployé aujourd'hui, seul `scripts/server/` + `scripts/cron/` partent au FTP ; (2) choisir alerte non-bloquante d'abord, car l'étape SSH est post-FTP) |
| B : gate PRÉ-deploy via secret `ENV_LOCAL_CONTENT` | Le job `test` écrit le secret dans un fichier temporaire, charge les vars, lance check-flags → peut BLOQUER avant le FTP. | Lot B (le secret est aujourd'hui **inutilisé/vide** — exige que Mohammed le peuple et le maintienne synchrone du serveur, sinon dérive silencieuse) |
| C : manifeste de flags commité (noms + ON/OFF par env, format relevé M9, zéro secret) | CI vérifie le manifeste ; un cron serveur diffe manifeste vs `.env.local` réel. | Possible mais 2 sources de vérité → dérive quasi garantie ; à ne retenir que si A et B sont refusées |

**Recommandation** : A en alerte post-deploy dès validation (petit ajout au
deploy : shipper `check-flags.mjs` + 3 lignes SSH), puis B en gate bloquant au
moment où le process `ENV_LOCAL_CONTENT` existera (bascule prod). En attendant,
la procédure manuelle de [flags.md](flags.md) (check local AVANT toute bascule)
est le garde-fou opérant.

## 3. Quels tests doivent empêcher une régression

- **Garder le gate full-suite tel quel** (les deux workflows commentent déjà
  pourquoi il a été élargi depuis `test:finance`). Ne JAMAIS le réduire à un
  sous-ensemble « rapide » : 64 s pour ~2700 tests, le coût est nul.
- Familles critiques au sein de la suite (ordre d'importance) :
  1. `tests/finance-*` + `tests/refund-*` + `tests/webhook-*` (argent) ;
  2. `tests/flag-coupling.test.ts` (couplages D-1) ;
  3. `tests/p1-p10/` (photographie des parcours — un correctif métier qui
     change un comportement DOIT inverser le `[FAIL-ATTENDU]` correspondant
     dans le même commit, sinon la suite devient rouge : c'est le mécanisme
     anti-« correction en douce ») ;
  4. `tests/middleware.test.ts` + `tests/*-route.test.ts` (auth/scoping) ;
  5. `tests/i18n-completeness.test.ts` (doublonne `check-translations`, garde
     le signal au niveau vitest).
- **Trou n°2 — ✅ COMBLÉ (B4, Lot B validé)** : `npm run build` est désormais
  une compile-gate BLOQUANTE du job `test` des deux workflows de deploy (le
  deploy échouait déjà si le build cassait — on échoue juste avant le FTP,
  plus vite et plus lisiblement). Secrets repo-level exprès (le job `test`
  prod n'a pas l'environment `production`). `tests.yml` (branches/PR) ne
  builde toujours PAS (trop long à chaque push) — filet local : « build frais
  avant de clore un lot ».
- **Trou n°3 — pas de gate sur le schéma** : aucun CI ne vérifie que
  `prisma generate` passe sur une base vierge (le harnais S0-2 le prouve
  localement). Couvert indirectement par le `prisma generate` du job deploy.
