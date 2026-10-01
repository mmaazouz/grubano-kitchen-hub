# fonts/ — polices auto-hébergées des références opérateur

Mission auto-hébergement (phase 2). Remplace les chargements Google Fonts distants des 15 maquettes op-*.html — les références sont ouvertes en file:// par le robot QA (chemins RELATIFS obligatoires, prouvé par sonde).

## Provenance

- Date de capture : 2026-08-16
- User-Agent de capture (méthode 9e1888a) : Chrome 151 (voir provenance.json)
- URL css2 TEXTE : https://fonts.googleapis.com/css2?family=Gabarito:wght@500;600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap
- URL css2 ICÔNES : https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400..700,0..1,0&display=block
- op-fonts.css = blocs @font-face des réponses css2 VERBATIM (unicode-range, font-display conservés) ; seules les url() sont réécrites en relatif.
- material-symbols-rounded.woff2 = COPIE de public/fonts/material-symbols-rounded.woff2 (self-hosté pour l'application par 9e1888a) — PAS un téléchargement. Axes fvar : wght 100..700, opsz 20..48, FILL 0..1 (couvre la demande des maquettes).

## Fichiers (SHA-256)

- gabarito-latin-ext.woff2 — 12256 o — sha256 d38497efbc5dbb9c00a3f4a23940b0acc4cd4759ee8dae32dd58cff1332af200
- gabarito-latin.woff2 — 34236 o — sha256 780dd129f53815f23c37d4b786c98139c3cfa3086c391ec0bb9aa40d26e7a8fe
- hanken-grotesk-cyrillic-ext.woff2 — 1668 o — sha256 7ba47c78279dc529afe577dc2476bc8fd3c0e32f78efa26dca9f9382d49a157d
- hanken-grotesk-vietnamese.woff2 — 9320 o — sha256 992b5d147edde9d637ce22e7bb9cc9e6909c05410226b36a2e581ada9877eb4a
- hanken-grotesk-latin-ext.woff2 — 19588 o — sha256 768af2923e0ab1549f1dfba0a5c8ea749c4c01f01d8e77ffaf7fcd12f57a0a24
- hanken-grotesk-latin.woff2 — 34704 o — sha256 e9201eddf1d41d0b62253295d869ce3cf65768f7102b797f02c7f8c876b4a9d5
- jetbrains-mono-cyrillic-ext.woff2 — 1640 o — sha256 62213be8a78b42f1e29d1452d91e2f8b3e745572a9dd98d3941e39fa00b37d76
- jetbrains-mono-cyrillic.woff2 — 8872 o — sha256 e17cfd15fb96909d64095015f958207063a0c07191da3512df7d560a781aebdf
- jetbrains-mono-greek.woff2 — 6836 o — sha256 0a557721b1f8b36d3f3f84442689a71ca4a744300abcb46a1953f51bfc663b66
- jetbrains-mono-vietnamese.woff2 — 5888 o — sha256 c89b9cc0bc6262bd4f8d8494b6961601f3aefa829d08c2e3635f4d501d3a47c2
- jetbrains-mono-latin-ext.woff2 — 11624 o — sha256 db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52
- jetbrains-mono-latin.woff2 — 31432 o — sha256 83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be
- material-symbols-rounded.woff2 — 3076072 o — sha256 e3bdfa4d822f187fbfd753caf070bd29879ac73366854cf891039dae9bdcf27b

## Licences

- Gabarito : SIL OFL 1.1 — OFL-gabarito.txt
- Hanken Grotesk : SIL OFL 1.1 — OFL-hanken-grotesk.txt
- JetBrains Mono : SIL OFL 1.1 — OFL-jetbrains-mono.txt
- Material Symbols Rounded : Apache 2.0 — LICENSE-material-symbols.txt

Les textes de licence accompagnent les fichiers comme l'exigent l'OFL (texte + notice copyright) et l'Apache 2.0 (§4a).

## scripts/assets/grubano-symbol.svg (option a — decision fondateur)

COPIE OCTET de public/brand/grubano-symbol-color.svg — sha256 08b33da04977af7aa500db6d65a17c3095701f9c51b649f75bf77e04f9687e52 (3691 o). Attendu par 14 maquettes op-*.html (../assets/grubano-symbol.svg) et par eat-search-desktop.html (hors perimetre, non modifie).

**Pourquoi ce fichier existe, et sur quelle base — trois niveaux, jamais confondus :**

- **Identite documentaire : NON ETABLIE, et inatteignable par construction** — le fichier attendu n'a jamais existe (historique git complet, branches, stash, worktrees, Notion), et aucune page CD ne nomme la variante.
- **Canonicite : ETABLIE** — les 7 path data de -color.svg sont verbatim dans le master SVG de la page Notion « 🍊 Grubano — Logo officiel + assets de marque (source de verite) », memes 4 gradients (gbZest/gbHi/gbLeaf/gbBody), memes 6 couleurs ; seul le viewBox differe (declinaison croppee conforme a la spec de la page).
- **Critere fonctionnel : ETABLI PAR LE RENDU, pour -color seul** — l'application rend LE MEME fichier au meme endroit (components/operator/OperatorShell.tsx:143-147) avec une regle CSS byte-identique (operator-shell.css:66) sur un fond byte-identique ; -white rend visiblement autre chose, -ink serait invisible sur navy.

Decision du fondateur : option (a), sur la foi du critere fonctionnel.

## Note de traçabilité — re-banking de op-analytics.html (même lot)

op-analytics.html, banqué corrompu à l'origine (2204c6c : fichier JSON-échappé, 1 878 `\"`, aucun sélecteur applicable), a été RESTAURÉ par EXTRACTION du bloc code de sa page Notion source « 📈 Analytics opérateur — CODE exact CD v1 (VERBATIM) — LOT 2 » (`390fd2c9-8146-81aa-837b-dd9140863e7a`), jamais retouchée depuis 2026-07-01. Aucune réécriture manuelle. Preuve : le fichier restauré est identique à l'octet près à l'ancien fichier dés-échappé (57 686 chars, 692 lignes, 0 différence) — l'échappement était un accident de banquage, pas un contenu différent. Re-banking autorisé explicitement par le fondateur (décision ①). C'est pourquoi son diff (+310/−314) dépasse le simple échange de polices (+1/−4) des 14 autres maquettes.
