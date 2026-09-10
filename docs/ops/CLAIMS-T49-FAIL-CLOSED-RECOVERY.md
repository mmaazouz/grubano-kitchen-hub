# T-49 — RÉCUPÉRATION FERMÉE PAR DÉFAUT, FONDÉE SUR LA PREUVE

> Décision fondateur du 2026-09-10 : **PREUVE UNIQUEMENT / FERMÉ PAR DÉFAUT SUR L'AMBIGUÏTÉ**.
> Ce document décrit ce qui est implémenté, ce qui est prouvé, et ce qui ne l'est pas.
>
> Portée : Claims **NON activé**, Refunds **NON ouverts**, aucun Stripe exécuté, aucune Clean Room,
> **0 ligne de schéma Prisma**. Le Mode A n'est **PAS** autorisé par ce document.

---

## 1. Le principe directeur

Deux propriétés indépendantes, toutes deux obligatoires :

**SÛRETÉ ARGENT** — si la vérité Stripe est ambiguë : aucun nouvel argent, aucun nouveau
remboursement, aucune clôture financière, aucune re-déposition client qui pourrait créer un
second effet argent.

**VIVACITÉ DE RÉCUPÉRATION** — une réclamation financièrement ambiguë ne doit pas disparaître
dans un état indéfini que personne ne voit et que personne ne peut récupérer.

D'où l'invariant : **FERMÉ PAR DÉFAUT FINANCIÈREMENT + VISIBLE PAR DÉFAUT OPÉRATIONNELLEMENT.**
Un état sûr sans sortie réelle n'est pas un design de bêta acceptable.

---

## 2. Les cinq issues, et ce que le code fait de chacune

| Preuve | Ce qui est fait | Argent |
|---|---|---|
| **Stripe prouve ABOUTI** | Liaison sur l'identité exacte de la ligne `Refund`, puis réconciliation par la fonction déjà auditée (`reconcileClaimForRefund`) : réclamation → `refunded`, montant RÉEL de la ligne, `activeOrderKey` libéré. | aucun mouvement |
| **Stripe prouve ÉCHOUÉ** | La vérité d'échec est enregistrée, la réclamation revient dans l'état récupérable canonique (`approved` + `refundError`), atteignable par l'échappatoire admin existante. Aucune relance aveugle. | aucun mouvement |
| **Stripe dit EN ATTENTE** | La réclamation reste en attente. Aucun succès terminal, aucun échec terminal, aucun second remboursement. Seul le marqueur de crash est effacé, l'identité étant désormais connue. | aucun mouvement |
| **Aucun remboursement prouvé + aucun cash parti** | **Preuve POSITIVE d'absence** : Stripe ne rapporte ni remboursement abouti ni en attente, **et** aucune ligne `Refund` de la commande n'a jamais déplacé d'argent (ni `succeeded`, ni `pending`). Une ligne morte — échouée ou annulée — ne rend PAS la preuve ambiguë (correctif d'audit). Seule branche qui remet `refundAttempted` à `false` — donc la seule qui rouvre une tentative — et elle exige la preuve, jamais l'absence de liaison. | aucun mouvement |
| **Attribution AMBIGUË** | `financial_verification` : pas d'argent, pas de clôture, pas de re-déposition, pas de devinette. Escalade opérateur. | aucun mouvement |

`reconcileClaimEvidence` **n'appelle jamais le moteur de remboursement**, n'écrit jamais chez
Stripe et ne relance rien. Sa seule autorité est : lire, identifier, appliquer la vérité qui
existe déjà.

---

## 3. La fenêtre de crash ne peut plus produire un état muet

Le passage en `refunding` écrit désormais un marqueur `reconcile_required` **dans le même CAS
atomique**. Aucune écriture supplémentaire, donc **aucune nouvelle fenêtre de crash**. Les cinq
chemins terminaux écrivaient déjà `refundError` (ou le remettaient à `null`), donc un
remboursement abouti ne conserve jamais le marqueur.

Le marqueur **ne dit pas** que le remboursement a échoué. Il dit qu'une tentative a démarré et
que son identité n'est pas encore liée. Il est **exclu** de l'échappatoire par assertion admin
(`isStuckResolvable`) : un état dont la vérité argent est inconnue ne doit pas être clos par un
jugement humain, mais par la preuve.

---

## 4. L'identité, pas le montant (T-51)

La reprise du moteur ne comparait que des **montants**. Deux remboursements légitimes d'une même
commande peuvent porter le même montant, donc une réclamation pouvait être liée au remboursement
créé par le rail admin, le rail ghost-order ou une réclamation antérieure — puis rapportée
`refunded`. Même argent, mauvaise attribution.

La liaison est désormais vérifiée sur l'identité propre de la ligne, sur **les deux** issues du
moteur (aboutie et en attente). Une identité **illisible échoue FERMÉ** : une liaison qu'on ne
peut pas vérifier est traitée exactement comme une mauvaise liaison.

---

## 5. Vivacité : la file, l'alerte, et la sortie

- **File durable non gatée** — `GET /api/admin/claims/financial-verification` et une section
  montée sur la console admin **même quand `CLAIMS_ENABLED` est OFF**. Le drapeau produit cache la
  fonctionnalité ; il ne doit pas cacher une question d'argent ouverte.
- **Badge admin** — `lib/admin-overview.ts` compte `financial_verification` **hors** de la
  branche gatée.
- **Alerte à l'entrée** — dédupliquée par réclamation **et** par cause, donc un rejeu ne peut pas
  créer de tempête. L'e-mail est au mieux-effort : **s'il échoue, la réclamation reste dans la
  file**. La file est le contrôle, pas l'e-mail.
- **Sortie réelle** — `POST /api/admin/claims/[id]/reconcile`, garde `resolveAdmin()` (donc
  atteignable par l'admin que le script de provisionnement crée réellement), trace admin, et
  **aucune autorité de créer de l'argent**.

---

## 6. Ce qui n'est PAS prétendu

- **RÉCONCILIATION AUTOMATIQUE = NON.** Aucun planificateur n'est prouvé actif : GitHub ne
  déclenche `schedule` que depuis la branche par défaut, et `origin/main` ne contient aucun
  répertoire `.github/`. La récupération est **manuelle et atteignable**, et c'est ce qui est
  écrit à l'écran. Aucune copie ne décrit un chemin manuel comme automatique.
- **Aucun handler SIGKILL** n'est revendiqué nulle part. La propriété qui tient sous mort de
  processus est le **bail** (T-53) : après l'échéance, la surface est refusée même si le nettoyage
  local n'a jamais tourné.
- **La population staging** de réclamations n'est mesurée que par le recensement en lecture seule
  (`/api/admin/claims/census`, jetons internes, comptes uniquement, aucun identifiant).

---

## 7. Audit adversarial (2026-09-10) — 7 auditeurs, 35 constats, **22 confirmés**

Diff gelé avant l'audit. Auditeurs indépendants par dimension, **un réfuteur hostile par constat**.
**22 confirmés / 13 réfutés.** Les quatre P1 sont fermés ; l'historique n'est pas effacé.

### P1 fermés

| Constat | Correctif |
|---|---|
| **`financial_verification` était un état ABSORBANT.** Une fois garée avec `refund_moved_unattributed`, la réclamation ne pouvait plus JAMAIS sortir : les branches automatiques sont inatteignables par construction (`triggerClaimRefund` exige `approved` + `refundAttempted:false`, donc plus aucune ligne ne peut être estampillée pour cette réclamation ; et rien ne supprime de ligne `Refund`). La commande restait verrouillée à vie et la file d'argent inépuisable. **Cela violait la condition même du fondateur : « fermé par défaut n'est acceptable QUE si une vraie sortie existe ».** | **Sortie d'escalade** `POST /api/admin/claims/[id]/attribute`. Ce n'est PAS la devinette interdite : l'opérateur fournit le **LIEN** (quel remboursement EXISTANT de CETTE commande appartient à la réclamation), et le système lit le **statut et le montant de la ligne** pour les appliquer. Un remboursement d'une AUTRE commande est refusé net. Aucun appel moteur, aucune écriture Stripe. Les candidats sont affichés dans la console pour que la sortie soit réellement praticable. |
| **La preuve d'absence était défaite par une ligne périmée.** Elle exigeait `rows.length === 0`, donc UN remboursement échoué ou annulé des mois plus tôt — qui n'a jamais déplacé d'argent — garait la réclamation à vie alors que Stripe prouvait positivement que rien n'était parti. | La condition porte sur ce qui compte : Stripe ne rapporte ni remboursement abouti ni en attente, **et** aucune ligne n'a jamais bougé d'argent (`succeeded` ou `pending`). Une ligne morte ne rend plus la preuve ambiguë. |
| **Les issues NON ambiguës éjectaient la réclamation de la seule surface non gatée.** Un remboursement encore en attente repartait en `refunding` marqueur effacé, donc visible uniquement via une route gatée par le drapeau. La population héritée (antérieure au marqueur) n'était dans AUCUNE des deux files. | La file non gatée porte désormais **tout** état d'argent non soldé, dédupliqué. |
| **Ma propre suite T-49 réintroduisait le mock aveugle à la clause `where`** (`mockResolvedValue({ count: 1 })`) : chaque CAS ajouté par ce lot était exécuté et jamais vérifié. Exactement le défaut que ce lot existe pour supprimer. | Mock partagé évaluant les opérateurs, plus une option `applyWrites` pour les CHAÎNES de CAS (une ligne figée fait échouer le second verrou pour une raison étrangère à la logique testée). |

### P2/P3 fermés dans la foulée

Preuve finale du neutraliseur encore limitée aux remboursements ; marqueur de crash affiché pour un
remboursement **légitimement en vol** (fenêtre de grâce ajoutée) ; bail ancré à l'écriture plutôt
qu'au début de la boucle ; absence d'avertissement pour un bail au-delà du plafond ; deux messages de
couplage citant encore la règle transitive supprimée ; précheck aveugle à `financial_verification` ;
résidu non rapporté sur les chemins d'abandon ; file illisible indiscernable d'une file vide ;
verdict de `enterFinancialVerification` ignoré ; garde d'identité jamais exercée dans sa direction
refusante ; propriété « survit au drapeau » épinglée seulement dans la bibliothèque, pas à la route
ni à la page ; routes de sortie sans test ; préconditions de l'opérateur non épinglées.

### Reste ouvert, assumé

`RECONCILE_GRACE_MS` (5 min) est une heuristique, et cette phrase était INEXACTE : elle affirmait
que la réclamation « reste invisible dans la file » pendant la fenêtre de grâce. C'est faux, et
l'audit du rond 3 l'a relevé. La réclamation reste **listée** dans la file non gatée pendant toute
la fenêtre, avec un libellé qui dit que l'état argent n'est pas établi ; la grâce retire seulement
le bouton de réconciliation tant que la tentative peut être légitimement en vol. Aucun argent n'est
en jeu pendant ce délai.

---

## 8. RE-AUDIT des correctifs (2026-09-10) — 4 auditeurs, 25 constats, **16 confirmés dont 4 P1**

Discipline appliquée : les correctifs P1 du §7 ont été audités **à leur tour**, parce que l'audit qui
les avait validés portait sur du code qui n'existait plus. Ce n'était pas une formalité — **trois
fois dans ce chantier, un correctif a introduit le défaut suivant**.

### Trouvé dans les correctifs eux-mêmes

| Sév. | Constat | Correctif |
|---|---|---|
| **P1** | **La fenêtre de grâce était INERTE.** La regex d'horodatage avait perdu ses antislashs en passant par le shell : `/(d{4}-d{2}-d{2}T[d:.]+Z)/`. Elle ne pouvait matcher aucun ISO, `reconcileMarkerAge` renvoyait toujours `null`, et **chaque** marqueur — y compris un remboursement légitimement en vol une seconde plus tôt — était listé comme échoué. **Trois auditeurs indépendants l'ont trouvée.** | Littéral de regex (échappements visibles), plus un test qui vérifie **le parsing lui-même** et un contrôle négatif qui reproduit la regex inerte. |
| **P1** | **`attributeClaimRefund` pouvait adopter un remboursement DÉJÀ lié à une autre réclamation de la même commande.** Une seule somme aurait soldé deux réclamations, et `reconcileClaimForRefund` retrouve la réclamation par `findFirst({refundId})` — une colonne sans contrainte d'unicité — donc la réconciliation atterrissait sur une réclamation arbitraire. Le client aurait vu « Réclamation remboursée » sans qu'un centime ne bouge pour elle. | La ligne doit être **libre** : refus si une autre réclamation la porte déjà. |
| **P1** | **La preuve d'absence rouvrait la réclamation sur un rail VERROUILLÉ par la ligne échouée qu'elle venait d'ignorer.** `executeRefund` refuse tout remboursement ultérieur sur une commande portant une ligne `failed` avec un identifiant Stripe. Écrire « de nouveau payable par le rail normal » était une promesse que le moteur refusera. | Le verrou est détecté et **dit** : reprise manuelle Stripe requise. |
| **P1** | **La file affirmait « Argent : INDÉTERMINÉ » sur des lignes dont l'état EST connu**, promettait qu'aucun remboursement ne serait lancé sur des lignes que le rail réclamations peut payer, et offrait le bouton « Réconcilier d'après la preuve » sur des réclamations approuvées ordinaires — où il n'y a rien à réconcilier et où il aurait estampillé une erreur sur un dossier sain. | Le message d'argent, la bannière et le bouton distinguent désormais les deux catégories. |

### Ce que cela signifie pour l'autorisation

**MODE A AUTHORIZATION SAFE = NON.** Les quatre P1 ci-dessus sont corrigés, mais **ces
correctifs-là n'ont pas encore été audités**. La règle §24 est explicite : un P0/P1 dans le
périmètre interdit de demander l'autorisation. Deux rondes consécutives ont trouvé des P1 dans les
correctifs de la ronde précédente ; déclarer sûr le troisième jeu sur la foi du deuxième audit
répéterait exactement le schéma que ces audits mettent au jour.

---

## 9. AUDIT ROND 3 (2026-09-10) — sur la révision DÉPLOYÉE `d94df77`

5 auditeurs, 18 constats, **6 confirmés / 12 réfutés. P0 = 0, P1 = 1.**

**Le P1 : un correctif que j'avais RAPPORTÉ COMME FAIT ne s'était pas appliqué.** Le remplacement
de chaîne qui devait restreindre le bouton « Réconcilier d'après la preuve » aux seules lignes
ambiguës n'a rien remplacé, silencieusement, et je ne l'ai pas vérifié. Le bouton a donc été livré
inconditionnel — et sur une réclamation approuvée mais jamais payée, un clic la garait
définitivement en `financial_verification`, donc structurellement impayable par le rail
réclamations. **Le commit et ce document affirmaient tous deux le contraire.**

Les cinq autres constats sont des variantes du même thème : une formulation qui affirme plus que
ce que le code établit. La raison honnête du verrou de rail était écrite dans un champ qu'aucun
humain ne lit ; « état connu » était affirmé sur des lignes dont l'état est précisément inconnu ;
le message renvoyait vers une file que le drapeau produit retire de la page ; et les tests de la
fenêtre de grâce retapaient le marqueur à la main au lieu de faire un aller-retour par le vrai
producteur — exactement l'angle mort qui avait laissé passer la regex inerte.

### Corrigé (rond 4)

Bouton restreint **et vérifié dans le fichier** cette fois. Issue `no_refund_proven_rail_locked`
distincte, qui remonte jusqu'au message opérateur. Ligne « argent » qui ne parle d'état connu que
lorsqu'un remboursement est réellement lié. Tonalité du message : un rail verrouillé, un
remboursement échoué et un cas toujours indéterminé ne s'affichent plus en vert. Forme héritée
(sans marqueur) réintégrée dans la file ambiguë. Marqueur daté dans le futur traité comme
illisible, donc visible. Avertissement sur les lignes que la garde d'attribution refusera, et
bouton désactivé sur celles-là. Tests : garde d'attribution pilotée jusqu'au REFUS, aller-retour
par le vrai producteur de marqueur, et contrôle négatif sur la fusion des deux issues d'absence.

**Ces correctifs-là n'ont pas encore été audités.** Rond 4 en cours.

---

## 10. AUDIT ROND 4 (2026-09-10) — sur `9843e9f`

4 auditeurs, 18 constats, **14 confirmés / 4 réfutés. P0 = 0, P1 = 1.**

**Le P1 : mon test « aller-retour par le vrai producteur » n'atteignait jamais le producteur.** Il
appelait une fonction qui n'écrit aucun marqueur, puis retombait sur une chaîne tapée à la main et
vérifiait sa propre chaîne. C'est-à-dire précisément la tautologie qu'il était censé supprimer :
une divergence écrivain/lecteur — exactement la regex inerte du rond 2 — serait passée une seconde
fois. Corrigé en pilotant `runClaimAutoApproval → approveClaim → triggerClaimRefund`, le vrai
producteur, et **prouvé par injection** : casser l'horodatage de l'écrivain fait ROUGIR la suite,
le restaurer la remet au VERT, et le fichier source revient identique.

**Les P2 convergents** : la nouvelle ligne « argent » utilisait `refundId` comme preuve qu'un
remboursement répond pour la réclamation — faux précisément sur les lignes où le moteur a REFUSÉ
l'attribution (`resume_mismatch`), c'est-à-dire là où un remboursement est lié mais répond pour
quelqu'un d'autre. La correction de tonalité du rond 4 n'avait été appliquée qu'à un des deux
gestionnaires. Et la légende du bouton était restée derrière lui : rendue deux fois sur les cartes
qui ont le bouton, et en promesse orpheline sur celles qui ne l'ont plus.

**Le constat le plus important pour la méthode** : *aucun* des cinq correctifs de composant du rond
4 n'était épinglé par un test — les annuler laissait la suite verte. C'est exactement ainsi qu'un
correctif rapporté comme fait, et jamais appliqué, a survécu à un rond entier.

### Corrigé (rond 5)

Décision de la ligne « argent » extraite dans `lib/claim-money-line.ts`, **fonction pure et
testée**, qui teste le marqueur de mésattribution AVANT la liaison. Tonalité appliquée aux deux
gestionnaires. Légende rendue une seule fois, avec son bouton. Bannière qui ne classe plus le
troisième groupe dans une catégorie et renvoie à la ligne. Aller-retour de marqueur réel. Et sept
épingles au niveau source pour que l'annulation d'un correctif de composant fasse rougir la suite.

**Ces correctifs-là n'ont pas encore été audités.** Rond 5 en cours.
