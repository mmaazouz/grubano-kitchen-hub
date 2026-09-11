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

**Ces correctifs-là ont été audités au rond 5 — voir §11.**

---

## 11. AUDIT ROND 5 (2026-09-10) — sur `68998a8`

4 auditeurs, 6 constats, **5 confirmés / 1 réfuté. P0 = 0, P1 = 1.**

**Le P1 : j'ai réintroduit au rond 4 exactement la classe de défaut que trois ronds avaient
retirée.** Le gestionnaire d'attribution disait à l'opérateur « Aucun argent n'a atteint le
client » dès qu'une ligne de remboursement échouée était attribuée. C'est une affirmation sur le
CLIENT dérivée du statut d'UNE ligne : cette ligne-là n'a rien versé, mais elle ne dit rien des
autres remboursements de la commande — et l'attribution ne se déclenche justement que sur des
commandes où Stripe a prouvé qu'un remboursement existe. Corrigé : la phrase porte désormais sur
la ligne, pas sur le client, et le dit explicitement.

**Les P2 convergents (deux auditeurs, même cible)** : la ligne « argent » de mésattribution
affirmait « de l'argent a bougé pour quelqu'un d'autre ». Le marqueur `resume_mismatch` a **quatre
écrivains** dans le moteur, et **deux d'entre eux sont sur le chemin PENDING** — là, le moteur n'a
obtenu qu'une ACCEPTATION Stripe, rien n'a encore bougé. L'affirmation était vraie pour deux
écrivains et fausse pour les deux autres, donc elle n'est plus faite du tout : ce qui est établi
sur les quatre, c'est que le remboursement lié n'est pas celui de cette réclamation.

**Le P3 de méthode** : le contrat du nouveau module était épinglé sur une chaîne tapée à la
main — la tautologie du rond 2 sous une autre forme. Les chaînes de test sont maintenant **lues
dans `lib/claims.ts`** (`SHIPPED_MISMATCH_WRITERS`) : si un écrivain cesse d'émettre le marqueur,
la suite rougit. Un contrôle négatif dans le fichier montre que la fixture tapée à la main aurait
passé quoi qu'il arrive.

### Corrigé (rond 6 en audit)

Affirmation « client » retirée du gestionnaire d'attribution et remplacée par un énoncé de portée
« ligne ». Affirmation de mouvement retirée de la ligne de mésattribution. Contrat du module lié
aux écrivains expédiés, plus une épingle source `not.toContain` sur la phrase retirée pour que sa
réapparition fasse rougir la suite.

---

## 12. AUDIT ROND 6 (2026-09-10) — sur `e4707f9`

5 auditeurs (véracité opérateur, instrument de test, contrat moteur, régression §7–§10, enveloppe
Mode A), 23 constats, **15 confirmés / 8 réfutés. P0 = 0, P1 = 7, P2 = 4, P3 = 4.**

**Le P0 déposé, ramené en P1 par les réfutateurs** : `financial_verification` n'a AUCUNE sortie
quand la commande n'a pas de ligne `Refund` locale — le cas du remboursement fait depuis le
**Dashboard Stripe**, qui ne laisse aucune ligne. `attributeClaimRefund` ne sait lier qu'une ligne
existante ; la réconciliation re-gare ; l'échappatoire par assertion refuse le statut. Les deux
corrections des réfutateurs sont retenues : `RECONCILABLE_STATUSES` inclut bien `financial_verification`,
donc un `stripe_unreadable` TRANSITOIRE sort à la réconciliation suivante ; et la variante « commande
sans PaymentIntent » est injoignable (`createClaim` refuse les commandes non payées, le moteur
retourne avant de créer une ligne). Reste la population Dashboard, réelle, sans sortie honnête.

**Les six autres P1** : le writer `stripe_failed` disait « aucun argent reçu par le client » depuis
UNE ligne (la classe récurrente, encore) ; l'étiquette `refund_moved_unattributed` était FAUSSE sur
l'un de ses deux écrivains (celui où une ligne porte bien l'identité) ; l'épingle contre la phrase
retirée ne couvrait qu'un fichier ; la branche FAILED du réconciliateur de ligne ÉCRASAIT le
marqueur `resume_mismatch` (seule entrée du prédicat « ce remboursement est-il le nôtre ») ; la file
d'arbitrage imprimait l'argent d'une AUTRE réclamation sous « Montant réellement remboursé » sur les
lignes désavouées ; et « aucun remboursement n'est LIÉ » s'affichait sur des lignes liées mais non
abouties.

### Corrigé (rond 7) — en audit

- **Sortie ancrée Stripe** (`adoptStripeRefundForClaim`, même route `/attribute`, corps
  `{ stripeRefundId }`) : conception choisie par un panel de 3 designs × 3 juges (aucune faille
  fatale ; gagnant sur la sûreté argent). L'opérateur fournit un IDENTIFIANT `re_…`, jamais un
  montant ni un résultat. Avant toute écriture, le serveur prouve chez Stripe que le remboursement
  porte sur le PaymentIntent de la commande ET sur sa `latest_charge`, refuse un remboursement
  créé par le moteur (`metadata.grubano_refund_row`), refuse pending/failed, borne le montant au
  capturé. Une seule écriture : une ligne `Refund` MIROIR (statut/montant copiés de Stripe,
  découpes à 0, `idempotencyKey external:<re_>` UNIQUE, `reason = claim:<id>`), puis la queue
  auditée d'`attributeClaimRefund`. `dryRun` lit et n'écrit rien : le panneau montre les faits
  avant l'unique écriture. Aucun appel moteur, aucune écriture Stripe/ledger/fidélité.
- Writer `stripe_failed` ramené à la LIGNE ; garde `resume_mismatch` sur la branche FAILED ;
  `reconcile_not_applied` et `no_payment_intent` comme causes propres ; `actualRefundedCents` nul
  sur une liaison désavouée (+ `refundNotOurs`) ; carte d'arbitrage en trois cas ; preuve
  d'absence portée par un marqueur `no_refund_proven:` reconnu par le classificateur (état
  `absence_proven_payable`) et exclu de l'échappatoire ; message `already_parked_or_moved` ;
  résidu rapporté sur les chemins d'abandon ; épingle de CLASSE sur les quatre fichiers (hors
  commentaires) ; extracteur de writers classé par le RETOUR du moteur, plus le contrôle
  discriminant ; regex inerte remplacée par un test hors négation avec contrôle négatif.
- Durcissement retenu d'un constat RÉFUTÉ (deux réclamations actives par commande impossibles,
  `activeOrderKey` unique) : le chemin par ligne refuse une ligne estampillée pour une AUTRE
  réclamation (T-51 : `reason` EST l'identité).

**Contrôles négatifs différentiels (rond 7) : 10/10 PROUVÉS.** Pour chaque correctif : le code
livré est cassé (aiguille unique), la suite qui prétend l'épingler ROUGIT, le fichier est restauré
depuis une copie (jamais `git checkout` — les correctifs n'étaient pas commités), prouvé
byte-identique, la suite REVERDIT. Garde FAILED, montant désavoué, ancre PaymentIntent, règle
« succeeded seulement », writer `stripe_failed`, message `already_parked_or_moved`, résidu sur
abandon, moitié discriminante du prédicat, garde de provenance moteur, `dryRun` sans écriture.
Suite complète : 400 fichiers / 4249 tests verts ; typecheck 41 = base, 0 hors `tests/`.

---

## 13. AUDIT ROND 7 (2026-09-10/11) — sur `0321537`

5 auditeurs, 25 constats, **24 confirmés / 1 réfuté. P0 = 0, P1 = 9, P2 = 10, P3 = 5.** (Le premier
passage a perdu 26 réfutateurs sur la limite de session ; le run a été REPRIS depuis le cache —
mêmes auditeurs, réfutateurs manquants rejoués — avant toute correction.)

**Ce que le rond 7 a trouvé, en une phrase : la classe récurrente vivait aussi HORS des quatre
fichiers épinglés.** Le toast d'approbation (`messages/*.json`, 5 locales) affirmait « de l'argent
EST parti, pour un autre montant » sur les QUATRE écrivains `resume_mismatch` — deux sont sur le
chemin PENDING (rien n'a bougé) et deux enregistrent un montant IDENTIQUE — et son test
`toMatch(/EST parti/)` IMPOSAIT la phrase fausse ; son jumeau « aucun argent n'est parti » était
affiché sur des refus moteur qui incluent « Paiement déjà intégralement remboursé ». L'échappatoire
par assertion toastait « client payé hors rail » et « Aucun argent n'a bougé » à la voix du
système. Le badge `absence_proven_payable` que j'avais ajouté au rond 7 promettait « sera versée
par le rail » — aucun job joignable ne le fait (balayage auto-approbation gaté OFF toute la bêta,
cron mort) : c'est une ré-approbation humaine. Les chaînes moteur « réessayez » étaient persistées
brutes sous « Détail : » sur une carte sans aucune relance. Et mon durcissement du rond 7 (refus
serveur des lignes estampillées pour une autre réclamation) avait recréé le défaut du rond 3 :
bouton « Attribuer » ACTIF là où le serveur refuse.

**Sur la nouvelle voie d'écriture** : le dryRun de reprise-après-crash répondait 409 « lancez
Lier sans vérification » alors que la console garde « Lier » désactivé sans aperçu, et le succès
de cette branche fabriquait des « faits Stripe » (montant 0, statut de la ligne relabellisé) sans
avoir lu Stripe. Une réclamation DÉJÀ garée ne pouvait jamais voir sa cause rafraîchie (le CAS de
garage excluait `financial_verification` alors que le réconciliateur l'admet) : preuve fraîche
jetée, étiquette périmée. Le chemin par ligne n'avait pas la garde « une ligne porte déjà
l'identité de cette réclamation » que la voie Stripe applique.

**Sur l'instrument** : le test « miroir puis liaison par la queue auditée » ne pinçait pas la
queue (une écriture terminale directe restait verte) ; l'épingle « sortie sur CHAQUE ligne garée »
était satisfaite par un bloc JSX sans rapport (ancre présente deux fois) ; les gardes DB de
l'adoption étaient pincées par l'ORDRE des appels, pas par leurs `where` ; deux conjonctions du
prédicat de reprise n'étaient pincées par rien ; l'extracteur d'écrivains ne voyait que les
gabarits backtick (ni ternaire, ni constante) ; deux tests vérifiaient leur propre fixture.

### Corrigé (rond 8) — en audit

Toasts d'approbation réécrits dans les 5 locales sur ce que les quatre écrivains établissent
(remboursement PAS le nôtre ; rien de réglé ; aucune relance) et sur « aucun montant établi par
cette action » ; test inversé. Toasts de clôture attribués à la DÉCLARATION de l'opérateur et
bornés à l'action. Badge et toast de preuve d'absence : « rien ne la paiera automatiquement —
nouvelle approbation admin, réclamations et remboursements ouverts ». Chaîne moteur enveloppée
`engine_failed: <texte> — aucune relance possible depuis les réclamations`. Bouton désactivé sur
`belongsToAnotherClaim` avec légende « sera refusé » ; 409 d'adoption qui NOMME la réclamation
propriétaire au lieu de renvoyer vers un bouton refusé. Reprise-après-crash : dryRun = aperçu réel
(`source: 'local_row'`, `wouldWrite: false`), faits lus sur NOTRE ligne et dits tels ; « Lier »
armé uniquement sur l'identifiant vérifié. CAS de RELABEL sur une réclamation déjà garée (cause
rafraîchie, statut inchangé, aucune alerte réémise, issue distincte d'`already_parked_or_moved`).
Garde « ligne estampillée pour cette réclamation » ajoutée au chemin par ligne. Épingle de CLASSE
étendue à `messages/fr|en.json` et `lib/claim-approval-toast.ts` avec les motifs de la classe
(« argent EST parti », « aucun argent n'est parti » hors négation, « client payé », « n'a bougé »
non borné) et contrôles négatifs sur chaque phrase trouvée. Signature de la queue pincée (CAS de
liaison sur FV, CAS de réconciliation sur l'identité liée, DEUX écritures d'audit). Épingle de
PLACEMENT du panneau Stripe avec contrôle négatif de la régression du rond 6. Gardes DB pincées
par leurs `where` via `matchWhere`. Conjonctions du prédicat de reprise pincées. Extracteur lisant
toute affectation `refundError` (ternaire, constante) avec un ensemble ATTENDU de familles au lieu
d'un plancher. Tautologies supprimées ; « le corps ne porte ni montant ni issue » prouvé sur un
identifiant VALIDE avec des extras rejetés. `triggerClaimRefund` exporté pour le test du wrapper.
Garde « une identité, une ligne » documentée comme check-then-act (l'unicité est par `re_`, pas
par réclamation ; la structure exigerait un schéma).

**Vérification du rond 8, avant commit.** Contrôles négatifs différentiels : **12/12 PROUVÉS**
(relabel, wrapper `engine_failed`, garde d'estampille du chemin par ligne, bouton désactivé,
aperçu de reprise, toast d'approbation FR, toast de clôture, 409 nommant la réclamation,
placement du panneau Stripe, queue auditée, conjonction `succeeded`, toast d'échec FR) ; empreinte
du `git diff` identique avant/après (`448163c856037ef3`). Typecheck : 41 = base, 0 hors `tests/`.
Suite complète : **400 fichiers / 4265 tests verts**, 0 échec.

**Incident consigné (ne pas effacer).** Un premier passage complet a ÉCHOUÉ (1 test,
`tests/punitive-capture.test.ts`, délai de 5 s dépassé) alors que la notification de la tâche
de fond annonçait « exit 0 » : ce code était celui du `tail` final, pas de vitest — la même
fausse réussite que la fiche mémoire « exits RÉELS » documente déjà, reproduite ici. Diagnostic
avant toute conclusion : le test seul passe (12/12, 1,26 s), ni lui ni la route qu'il pilote
n'importe un module modifié, et le passage avait duré 162 s contre ~87 s d'habitude (charge
machine). La suite a néanmoins été relancée sur l'arbre final, code de sortie lu directement.
Quatre commentaires qui énonçaient encore la croyance « la reprise a abouti, l'argent est parti »
pour les quatre écrivains ont été corrigés — c'est d'eux que la phrase fausse renaissait.

---

## 14. AUDIT ROND 8 (2026-09-11) — sur `66d6950`

Run complet (le script sépare désormais « non vérifié » de « réfuté » : aucun réfutateur perdu).
5 auditeurs, 22 constats, **17 confirmés / 5 réfutés. P0 = 0, P1 = 5, P2 = 5, P3 = 7.**

**Les P1.** Le verrou rail était décrit comme levable « tant que la reprise manuelle Stripe n'a
pas été faite » : aucun code ne sort une ligne `Refund` de `failed`, le verrou est définitif — et
« Approuver & rembourser » restait offert sur ces réclamations, voué à l'échec. « Envoyé à la
banque » s'affichait pour NOTRE ligne en attente sans identifiant Stripe (la fenêtre de crash),
et la réconciliation la faisait sortir de la population « preuve » en la déclarant
`still_pending`. Un échec moteur survenu APRÈS la création de la ligne de la réclamation
(« Remboursement émis, reprise de la royalty… ») écrasait le marqueur de crash et rendait la
réclamation clôturable par assertion. Et (deux constats, un défaut) ma garde du rond 8 « une ligne
porte déjà l'identité de cette réclamation » n'avait pas sa désactivation console — la Classe 3
pour la TROISIÈME fois, avec un test qui épinglait l'expression incomplète.

**Les P2.** La route de réconciliation admettait une réclamation SAINE approuvée-non-payée —
exactement l'état d'une approbation Mode A — et pouvait la garer. L'arbitrage autorisait
l'approbation sur les claims JWT (jamais rafraîchis) au lieu de `resolveAdmin`. La copie CLIENT
disait « remboursement en cours » pour une réclamation seulement approuvée (en/es/it/ar, et
l'aide ×5), et `financial_verification` affirmait une « transaction existante ». La forme héritée
non liée était étiquetée « sans aucun remboursement Stripe » (assertion Stripe négative non
vérifiée). La légende « Rien n'a été écrit » s'affichait sur des refus postérieurs à l'écriture
de la ligne miroir.

### Corrigé (rond 9) — en audit

- **Fin de la Classe 3 pour l'attribution** : une règle pure unique
  (`lib/claim-attribution-rules.ts`, 5 refus) appliquée par `attributeClaimRefund` ET par la
  liste que lit la console ; la console désactive sur le verdict serveur. **Test de PARITÉ** :
  sur deux jeux couvrant les 5 codes, verdict console === refus serveur avant toute écriture.
- Verrou rail : copie « DÉFINITIVEMENT » nommant la seule sortie réelle ; approbation refusée par
  `arbitrateClaim` et désactivée en console (`railLocked`) ; libellé « Approuver » ×5 locales.
- Ligne en attente sans identifiant Stripe : état `local_pending_unconfirmed`, « Statut de notre
  ligne », réconciliation → `pending_unconfirmed` SANS écriture (la réclamation garde son bucket
  et son bouton), attribution refusée.
- Échec moteur avec la ligne de la réclamation présente et non échouée : reste `refunding` avec
  le marqueur d'origine (texte moteur ajouté) ; `engine_failed` seulement si rien n'a été créé ou
  si la ligne a échoué (alors liée).
- Garde de réconciliation : n'admet que FV, marqueur, ou forme héritée — la population du bouton.
- Arbitrage : `resolveAdmin`. Copie client/admin ×5 locales, mappage d'aide refunding/approved,
  file nommée « Remboursements à traiter » telle que l'écran l'affiche. `wrote` sur chaque refus
  d'adoption ; branches Zod strictes ; toast « Lier » selon la source ; « déjà garée » retiré ;
  FR « s'est arrêté sur ».
- Instrument : épingles sûres en CRLF ; `matchWhere` évalue un `id` opérateur ; épingle de classe
  étendue à es/it/ar (constat réfuté en P3 mais exact, retenu) et rapportant TOUS les hits ;
  épingles négatives lues hors commentaires ; contrôles-lambda supprimés.

**Vérification du rond 9, avant commit.** Contrôles négatifs différentiels : **17/17 PROUVÉS**, en
deux passes, consignées telles quelles. La première a donné 14/17 : deux contrôles n'ont pas pu
s'appliquer — aiguille introuvable (`lib/claims.ts` est en CRLF sur disque, l'aiguille multi-ligne
était en LF) et aiguille non unique (`"approve": "Approuver"` apparaît trois fois dans `fr.json`) —
et un contrôle est ressorti **NON PROUVÉ** : revenir sur l'évaluation de `id` dans `matchWhere`
laissait toute la suite verte, ce changement d'instrument n'était épinglé par rien. Corrections :
aiguilles sûres en CRLF, mutation JSON par chemin, et un test unitaire direct de `matchWhere`.
Seconde passe : 3/3 prouvés. Empreinte du `git diff` des chemins de code identique avant/après
(`7b7ab71c01761ca8`) — **limite dite** : `git diff` ignore les fichiers NON SUIVIS, donc cette
empreinte ne couvre ni `lib/claim-attribution-rules.ts` ni le test du rond 9 ; les contrôles ne
mutent que des fichiers suivis et vérifient chacun leur restauration octet pour octet.
Typecheck : 41 = base, 0 hors `tests/`. `check:i18n` : OK. Suite complète sur l'arbre final :
**401 fichiers / 4301 tests verts**.
