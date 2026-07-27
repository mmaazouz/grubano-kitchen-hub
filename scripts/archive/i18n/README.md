# scripts/archive/i18n — migrations i18n one-shot DÉJÀ JOUÉES

133 scripts (`add-*-i18n.js`, `seed-*-i18n.js`, `patch-*-i18n.js`,
`p3-i18n-cleanup.js`) déplacés ici au Lot B du Sprint 0 (B1, archivage validé —
déplacement, pas suppression). Ce sont des migrations ponctuelles dont la
sortie est déjà commitée dans `messages/*.json` : ils ne doivent **plus jamais
être ré-exécutés** (ré-écraseraient des clés retouchées depuis).

Preuve de non-usage au moment de l'archivage : zéro référence exécutante dans
`package.json`, `.github/workflows/`, `docs/` — 100 % des hits croisés étaient
des commentaires d'en-tête entre scripts de cette même famille
(cf. `docs/ops/code-mort-inventaire.md`).

Resté à `scripts/` racine : `add-creators-home-i18n.js` (untracked au moment de
l'archivage — à vérifier « exécuté » puis à ranger ici quand il sera commité).
