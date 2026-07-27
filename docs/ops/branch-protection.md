# Protection de branche — rendre « CI — tests » obligatoire sur les PR (B6)

> Réglage GitHub **hors repo** (Settings du dépôt) : il ne peut pas être commité,
> il doit être cliqué par un admin du dépôt (Mohammed). Procédure exacte
> ci-dessous. Préalable ✅ déjà en place : le workflow `.github/workflows/tests.yml`
> (« CI — tests ») tourne sur toute PR et toute branche hors `develop`/`main`
> — démonstration : run vert 1 min 27 s sur le push de `sprint0-prep`.

## Ce que ça change

Une PR vers `develop` (ou `main`) ne pourra plus être mergée tant que le check
**`test`** (le job du workflow « CI — tests ») n'est pas vert. Aujourd'hui le
merge est possible même CI rouge — la suite ne bloque qu'au moment du deploy.

## Procédure pas-à-pas (interface classique — la plus simple)

1. Ouvrir https://github.com/mmaazouz/grubano-kitchen-hub/settings/branches
   (Repo → **Settings** → **Branches**).
2. Sous « Branch protection rules » → **Add classic branch protection rule**.
3. **Branch name pattern** : `develop`
4. Cocher **Require status checks to pass before merging**.
   - Cocher aussi **Require branches to be up to date before merging**
     (recommandé : la PR doit être rebasée sur la tête de `develop` avant merge).
5. Dans le champ de recherche des checks, taper `test` et sélectionner
   **`test`** (celui rattaché au workflow « CI — tests »).
   ⚠️ Le check n'apparaît dans la liste que s'il a tourné au moins une fois
   dans les ~7 derniers jours — c'est le cas (run du 27/07 sur `sprint0-prep`).
6. NE PAS cocher « Require a pull request before merging » pour l'instant :
   les agents pushent directement sur `develop` (process actuel) — cocher cette
   case casserait le flux. Décision séparée si le passage en PR-only est acté.
7. **Create** (bouton en bas).
8. Répéter les étapes 2-7 avec le pattern `main` (même check `test`), pour que
   la promotion develop→main par PR soit gatée aussi.

## Variante « Rulesets » (nouvelle interface, équivalente)

Settings → **Rules** → **Rulesets** → **New ruleset** → Branch ruleset :
Enforcement **Active** · Target branches : add `develop` (puis un 2e ruleset
pour `main`) · cocher **Require status checks to pass** → **Add checks** →
chercher `test` (source « CI — tests ») · Create. Même résultat ; les rulesets
sont plus lisibles à l'audit (Settings → Rules → Insights).

## Vérification après activation

Ouvrir n'importe quelle PR de test vers `develop` : l'encart de merge doit
afficher « Required — test » et le bouton merge rester gris tant que le check
n'est pas vert.

## Limites connues (à savoir, pas des actions)

- La protection ne s'applique qu'aux **PR/merges** : un `git push` direct sur
  `develop` reste possible tant que « Require a pull request » n'est pas coché
  (voulu — cf. étape 6). Le filet des pushes directs reste le job `test` des
  workflows de deploy (bloquant avant FTP, build compris depuis B4).
- Les admins peuvent bypasser sauf si « Do not allow bypassing the above
  settings » est coché — laisser décochable au début pour ne pas se bloquer.
