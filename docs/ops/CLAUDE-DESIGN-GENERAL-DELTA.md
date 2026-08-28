# CLAUDE DESIGN — HANDOFF GÉNÉRAL (DELTA) · 2026-08-28

Tu n'as **aucun accès au dépôt**. Ce document est autonome : il contient tout l'état établi depuis le code (`develop @ 8d53158`), pour que tu produises ton delta SANS deviner. La matrice complète (114 surfaces, catégories A-E) vit dans `DESIGN-CODE-GAP-MATRIX.md` — ci-dessous l'essentiel.

## 1-2. Où en était ton audit · ce qui est banké
Ton dernier état connu : re-skin consommateur zone par zone sur tes maquettes CD (32 références `eat-*` bankées et câblées au robot pixel), 15 références opérateur `op-*`, `partner-shell` (référence manuelle). **48 références HTML au total.**

## 3-5. Implémenté / partiel / absent — LES CHIFFRES
**114 surfaces significatives : A=72 · B=20 · C=0 · D=0 · E=22.**
**C=0 et D=0 : tout ce que tu as designé est codé.** Il ne reste AUCUN écran designé en attente de code. Le déficit est inverse : **20 surfaces codées sans design** (§23) et des références devenues **stale** (§7).
Seuls « PARTIAL code » restants côté conso : panier mobile 390 et écran réservation (débordements — **corrigés dans le lot en cours**, preuve Puppeteer 455→390 et 977→390).

## 6-7. Références existantes · FRESH vs STALE
- **FRESH** : les 32 `eat-*` re-bankées le 23/08 (post self-host fonts) ; les 15 `op-*` (refs fraîches, mais leurs *baselines screenshots* sont à refaire post-typo Gabarito).
- **STALE (à re-banker, par ordre)** : ① les baselines `op-*` (28/34 cas en app-error au dernier run staging) ; ② `eat-home` (bannière −10 % retirée par décision D2 + hero) ; ③ `eat-resto` (allergènes AJOUTÉS à la modale — absents de ta maquette) ; ④ `eat-checkout` (Visa •4242/pourboire retirés, wording argent réécrit) ; ⑤ `eat-reserver` (wording empreinte D2 + correctif responsive) ; ⑥ `eat-auth` (mobile 28 % à investiguer) ; ⑦ `eat-favorites` ; ⑧ `eat-postdelivery` (« Marco D. » → neutre). **À retirer** : `eat-dietary` (route supprimée). **Non-diffables permanents** : `eat-confirmed` (état payé = Stripe réel), `eat-tbill`.

## 8. Divergences intentionnelles — NE PAS « corriger »
Fausses promesses supprimées (annulation 2 min, « livrés en minutes », bonus bienvenue, cartes fictives, créneaux, chat scripté, ETA/tracking inventés) · **allergènes ajoutés** à la modale plat (obligation) · wording argent réécrit ×5 langues (empreinte = « autorisation temporaire », cartes de test visibles uniquement en mode TEST) · `/eat/dietary` supprimé · vue réclamation OFF → panneau support humain · bannière « −10 % offerts » du home **retirée** (une promo d'UN resto s'affichait en claim global). Tout écart entre ta maquette et ces points est VOULU.

## 9-10. BETA-IN / BETA-OUT
BETA-IN : tout `/eat`, `/business` (restaurateur), opérateur, admin. BETA-OUT (E=22, flags OFF) : créateur, fournisseur, franchise, logistique, prestataire, affilié, eat-next, démo dine-in.

## 11-16. État vérifié à l'écran (smoke mobile 390 + desktop 1440, staging)
Sain : home, fiche resto, modale plat (allergènes AVANT achat, état « non renseigné »), recherche (état vide parlant), auth (liens légaux mobiles), légal (200 partout, o2switch renseigné). **Corrigés dans le lot en cours** : panier 390 (blocs 439 px, « Changer » hors écran, CTA coupé) et réservation (débordait à TOUTES les largeurs, 1440 inclus — racine commune : `min-width:auto` des grid-items, fix `minmax(0,1fr)`).
**Checkout anonyme : PAS un défaut** — la feuille de connexion OTP s'ouvre bien (panier conservé) ; le smoke précédent l'avait manquée (mesure tronquée). Le 409 « restaurant non encaissable » affiche le message serveur honnête. État vide du catalogue : « Aucun restaurant disponible — Revenez bientôt » (classe A).

## 17-19. Onboarding · parcours · PartnerShell
`/business/onboarding` : ton brief est PRÊT (`CLAUDE-DESIGN-BUSINESS-ONBOARDING.md`) et JAMAIS consommé — l'écran garde l'ancien design-system + la double frise que le brief dénonce. **C'est ta priorité n°2.** `/auth/magic` : le chrome partenaire dépend du hostname `business.*` → sur staging le candidat voit un conteneur nu (blocker connu n°2). PartnerShell : 4 écrans fidèles mais AUCUNE entrée robot (diff manuel seulement).

## 20-22. Tokens · RTL · backend
Typo self-host (Gabarito, Hanken, Material Symbols, Cairo pour l'AR) ; grammaire `gb-*` conso, `pt-*` partenaire, shells consoles. RTL : fondation complète (`gb-rtl.css`, `dir=rtl`, parité ar 100 %) mais **une seule surface testée visuellement** (reçu dine-in) — le robot ne tourne qu'en `/fr` ; relecture arabophone toujours due. Dépendances backend restantes (rien à designer tant que non tranché) : avis conso, prefs notifications, commande groupée, temps réel opérateur, trésorerie.

## 23-25. Les listes exploitables
**CODE SANS DESIGN (B=20) — par priorité** : ① **AdminShell `/admin/*`** (approvals, reconciliation avec la nouvelle section « annulées payées », payments, users, establishments — seule surface de PILOTAGE bêta sans aucune référence ; maquettes ADM1→ADM7 citées dans le code mais jamais bankées) ; ② **emails transactionnels** (23 templates FR-only, orange legacy ≠ charte) ; ③ `/business/onboarding` (brief prêt → à transformer en référence) ; ④ les 13 écrans opérateur capture-only (briefing, promotions, loyalty, pricing, fulfillment, notifications, prep, suppliers, brands, establishments, more, onboarding, add-activity) ; ⑤ `/eat/orders` + `/eat/account/addresses` (fidèles à tes maquettes Notion mais sans ref robot) ; ⑥ splash, reset-password, offline/PWA.
**DESIGN SANS CODE : aucun.** **NI L'UN NI L'AUTRE : aucun** (tout vide notable est E différé).

## 26-27. Priorités
**Design** : 1) refs `adm-*` admin ; 2) onboarding partenaire (brief prêt) ; 3) re-bank des 8 refs stale ; 4) emails ; 5) chrome `/auth/magic` hors-hostname. **Code** (pour info, hors ton périmètre) : QA visuelle admin/partner câblée au robot, baselines op-* re-run, RTL visuel ar.

## 28. NO DESIGN WORK REQUIRED
Les 72 surfaces A — notamment TOUT le parcours d'achat conso (home→recherche→resto→panier→checkout→suivi→compte), auth, légal, PartnerShell 4 écrans, les 15 écrans opérateur référencés. N'y retouche pas sans demande produit explicite.
