# CLOSED BETA — RUNBOOK D'EXPLOITATION

Base : `develop @ 6361510419b5014d6e4c6d52e01730c0e552a7ac` (+ correctifs de la vague closed-beta).
Toutes les références sont `fichier:ligne` sur cette base. Ce document décrit l'exploitation **réelle**, pas une intention.

---

## 1. MODÈLE D'ADMISSION — inscription ouverte, mise en ligne fermée

🔴 **Ce n'est PAS une bêta sur invitation.** Aucun mécanisme d'invitation, d'allowlist, de code d'accès ou de liste blanche n'existe dans le code (recherche exhaustive : `invite`, `allowlist`, `waitlist` d'accès, `access code`, `BETA_*` → néant hors files d'attente métier sans rapport). **N'importe qui peut créer un compte restaurateur** via `/business/register`.

Ce qui est réellement fermé, c'est la **mise en ligne**, et le mécanisme est solide :

| Étage | Mécanisme | Preuve |
|---|---|---|
| Création | `POST /api/restaurants` **force `isActive: false`** en fin de spread, après un schéma zod qui n'expose même pas le champ | `app/api/restaurants/route.ts:352-366` |
| Visibilité conso | `GET /api/restaurants` ne liste que `isActive: true` | `app/api/restaurants/route.ts:69,160` |
| Règle de publication | La publication est admin-only par doctrine | `lib/publication-rule.ts:10-22,44-60` |
| Rail d'activation | Console `/admin/approvals` → `POST /api/admin/restaurants/[id]/approve` | `app/[locale]/admin/approvals/page.tsx:14-16` |

➡️ **Conséquence opérationnelle** : le périmètre consommateur de la bêta se pilote **en n'approuvant que les restaurants du pilote**. Un restaurant inscrit mais non approuvé est invisible de `/eat` et ne peut recevoir aucune commande.

**Formulation à utiliser en communication** : « inscription ouverte, mise en ligne sur validation de notre équipe ». Jamais « bêta sur invitation ».

---

## 2. RÔLES ET PÉRIMÈTRE — les 7 flags

Tous les lecteurs sont en comparaison stricte `=== 'true'` : une variable absente ou mal orthographiée vaut **OFF**.

| Flag | Cible bêta | Ferme (pages / API) | Lecteur canonique |
|---|---|---|---|
| `CREATOR_ENABLED` | **OFF** | 9 pages / 20 routes | `lib/creator-account.ts:88-90` |
| `SUPPLIER_ENABLED` | **OFF** | 10 / 10 | `lib/supplier-account.ts:188-190` |
| `FRANCHISE_ENABLED` | **OFF** | 7 / 10 | `lib/franchise-account.ts:102-104` |
| `LOGISTICS_ENABLED` | **OFF** | 5 / 20 | `lib/logistics-account.ts:193-195` |
| `PRESTATAIRE_ENABLED` | **OFF** | 5 / 9 | `lib/prestataire-account.ts:21-23` |
| `AFFILIATE_ENABLED` | **OFF** | 9 / 7 | `lib/affiliate-account.ts:29-30` |
| `CONSUMER_REDESIGN_ENABLED` | **OFF** | 9 / 1 | `lib/consumer-redesign.ts:6-8` |
| `RATE_LIMIT_ENABLED` | 🔴 **ON** | — (protection) | `lib/rate-limit.ts:21-22` |

🔴 **Asymétrie à retenir** : les 7 flags de rôle sont **sûrs si absents** (absent = OFF = fermé). `RATE_LIMIT_ENABLED` est **non protégé si absent** (absent = OFF = limiteur no-op silencieux). Il doit être posé **explicitement à `true`**.

**Supplier et Creator restent OFF pendant toute la bêta.** Leurs deux routes coûteuses sont 404 tant que le flag est OFF — vérifié : `app/api/supplier/register/route.ts:57` (404 **avant** l'appel tiers payant ligne 98) et `app/api/creators/apply/[id]/verify/route.ts:187` (404 en première ligne du POST). Si l'un de ces flags passe ON, **ces deux surfaces redeviennent des P0** (appels LLM/API payantes sans limiteur).

**Avant toute bascule**, vérifier les couplages en local : `node scripts/check-flags.mjs`. Les règles sont unidirectionnelles (« ON exige ON »), donc éteindre une racine ne viole rien — mais une **capacité enfant restée ON** (ex. `CREATOR_PAYOUT_ENABLED`) alors que sa racine passe OFF doit être éteinte aussi.

**Point d'attention connu, décision produit ouverte** : `/business/logistics` (landing) et `/business/logistics/register` restent **affichables anonymement** même `LOGISTICS_ENABLED` OFF — la landing est délibérément publique (garde-fous « liste d'attente » documentés) et lie vers le formulaire à 3 endroits. L'API `POST /api/logistics/register` **404 quand le flag est OFF** : aucune écriture, aucun appel tiers, aucune fuite de données — mais le formulaire se remplit puis échoue. Voir le pack fondateur.

---

## 3. TIGER PROTECT — RESTE OFF

État : **désactivé** sur `app.grubano.com`. Historiquement, quand il était actif, **25 sous-ressources sur 28** d'une page Next étaient refusées : le produit ne se chargeait pas.

🔴 **Ne pas réactiver pendant la bêta.** La protection applicative réelle est désormais le rate-limit (§4), qui ne dépend pas de Tiger. Une réactivation exigerait des exemptions par chemin, à obtenir auprès d'o2switch — le ticket est prêt (pack fondateur).

---

## 4. RATE-LIMIT — actif et prouvé

Mécanisme : fenêtre glissante en **mémoire de processus**, clé = IP (**dernier** hop de `x-forwarded-for`, résistance à la forge prouvée en conditions réelles), `429` + `Retry-After`, **fail-open** sur faute interne.

Quotas par défaut (surchargeables par `RATE_LIMIT_<BUCKET>_MAX` / `_WINDOW_SEC`) :

| Action | Bucket | Quota |
|---|---|---|
| Connexion (NextAuth, 3 sous-chemins) | `auth_login` | 20 / 60 s |
| Inscription consommateur | `auth_register` | 10 / 10 min |
| Lien magique | `auth_magic_link` | 5 / 10 min |
| Mot de passe oublié | `auth_forgot_password` | 5 / 10 min |
| Réinitialisation | `auth_reset_password` | 10 / 10 min |
| Inscription fidélité | `loyalty_register` | 10 / 10 min |
| Inscription partenaire | (limiteur dédié) | 5 / 1 h |

**Limite assumée** : compteurs par processus ⇒ avec N workers, plafond effectif ≈ N × quota, et remise à zéro à chaque redémarrage/redéploiement. Acceptable en bêta fermée (le rôle du limiteur est de **borner l'amplification de coût et les rafales**, pas d'offrir un plafond global dur). À durcir avant production (stockage partagé).

🔴 **Impact QA** : le robot QA visuel pointé sur staging **tombe dans le seau du rate-limit** et produit des diffs calculés sur des pages 429 (bruit pur). Toute campagne QA doit viser un serveur **local**, ou désactiver temporairement le flag le temps de la campagne.

---

## 5. STAGING — le healthcheck vérifie enfin la bonne cible

Depuis `bfae740`, le step « Health check » du workflow staging interroge **`https://app.grubano.com/version.json`**, exige `HTTP 200`, extrait le champ `commit` et le compare **par égalité stricte** au SHA du run ; il **échoue (exit 1)** sinon. Il est **bloquant** et tolère la propagation (15 s + 8 × 15 s ≈ 2 min, Passenger respawnant après `touch tmp/restart.txt`).

Auparavant il interrogeait le domaine de **production** et journalisait un succès à partir de sa réponse : un staging cassé passait vert. **Auto-prouvé 3 fois** depuis.

**Vérification manuelle à tout moment** :
```
curl -s https://app.grubano.com/version.json
```
Le champ `commit` doit être le SHA attendu.

---

## 6. DÉPLOIEMENTS — fenêtre d'exploitation

🔴 **Éviter tout déploiement pendant** : un onboarding partenaire en cours, une démonstration, une opération critique.

Raison : `server.js:95` enregistre `SIGTERM → process.exit(0)` de façon synchrone, **avant** le handler gracieux de Next — le `process.exit` **préempte** le `server.close()`. À chaque redéploiement (ou recyclage Passenger), **les requêtes en vol sont coupées au niveau socket, sans réponse HTTP**. Classé **P1 avant production**, pas bloquant en bêta à faible trafic — mais c'est une règle d'exploitation, pas une théorie.

Effet secondaire : un redéploiement **remet à zéro les compteurs de rate-limit** (mémoire de processus).

---

## 7. OUVRIR UN PREMIER RESTAURANT — procédure

1. Le partenaire s'inscrit seul : `/business` → `/business/start` → carte **Restaurateur** → `/business/register`.
2. Il reçoit un e-mail de vérification, atterrit sur `/business/verified`, se connecte par lien magique (`/auth/magic`).
3. Il est redirigé vers `/dashboard`, qui le **renvoie automatiquement** vers `/business/onboarding` tant qu'il n'a ni marque ni établissement (`app/[locale]/dashboard/layout.tsx:56-63`).
4. Il déclare sa **marque** puis son **établissement**, en choisissant ses **modes de retrait**. L'établissement est créé **invisible** (`isActive: false`).
5. 🔴 **Étape admin, obligatoire** : `/admin/approvals` → approuver l'établissement. C'est le seul rail de mise en ligne.
6. Vérifier que le restaurant apparaît bien côté consommateur, et qu'il peut recevoir une commande dans le mode choisi.

⚠️ **Point de vigilance produit** : avec `DELIVERY_FULFILLMENT_ENABLED` OFF (défaut), la **livraison est refusée pour tous**. Un établissement doit donc avoir **`pickupEnabled = true`** pour recevoir la moindre commande. Le choix fait à l'onboarding est désormais persisté — si un établissement a été créé **avant** ce correctif, vérifier/poser ses modes via la route de fulfillment ou l'écran opérateur.

### 7.1 Checklist AVANT d'approuver le restaurant pilote (bêta transactionnelle)

À vérifier **avant** de cliquer « Approuver » dans `/admin/approvals` — chaque point non tenu = un parcours consommateur cassé ou malhonnête :

1. **Marque rattachée + carte non vide** — le wizard rattache désormais automatiquement la marque à l'établissement (correctif closed beta). Pour un partenaire onboardé **avant** ce correctif : vérifier en SQL `SELECT id, name FROM Brand WHERE operatorId = <op> AND restaurantId IS NULL` — toute ligne = marque orpheline à rattacher (`UPDATE Brand SET restaurantId = <resto> WHERE id = <brand>`). Sans marque rattachée portant ≥ 1 plat `available`, la fiche publique a un **menu vide** → zéro commande possible.
2. **`pickupEnabled = true`** (cf. point de vigilance ci-dessus).
3. **Allergènes renseignés** — demander au restaurateur de remplir le champ allergènes de **chaque plat** dans `/menu` (14 catégories INCO, chips). La fiche consommateur affiche désormais ces données telles quelles, et « information non renseignée » sinon : un menu sans allergènes renseignés est **visible comme tel** par le client.
4. **Géocodage** — vérifier que l'établissement a des coordonnées (`lat`/`lng` non null, `geocodeStatus` ok). Un restaurant sans coordonnées est **invisible** pour tout client géolocalisé (le tri distance exclut les lignes sans coords).
5. **Stripe Connect** — vérifier `stripeAccountId` présent et `stripeAccountStatus = 'active'` (onboarding Connect fait par le partenaire depuis son hub). ⚠️ **Sans Connect actif, le paiement retombe sur le compte de la plateforme : 100 % de l'argent du client reste chez Grubano et AUCUN rail automatique ne reverse le restaurant** (le ledger trace `netToRestaurant`, mais le versement serait manuel). Décision à prendre en connaissance de cause si on approuve sans Connect.
6. **Horaires** — s'ils sont configurés, la commande est bloquée hors ouverture (409 `closed`). Non configurés = aucune restriction.
7. **Commande témoin** — passer une commande TEST de bout en bout (menu → panier → paiement Stripe TEST → réception côté `/orders`) avant d'annoncer l'ouverture au partenaire.

---

## 7bis. ARGENT — flags, remboursement, incidents paiement

**Rappels de comportement (défauts OFF, code vérifié) :**

| Flag | OFF (défaut) | ON |
|---|---|---|
| `CLAIMS_ENABLED` | L'annulation par le resto d'une commande **payée** garde l'argent **sans aucun circuit** (email générique « contactez le restaurant »). | La même annulation crée automatiquement une **réclamation système** en file admin, dans la même transaction, avec email honnête. ⚠️ Nécessite la table `Claim` en base (schema sync). |
| `REFUNDS_ENABLED` | **Aucun remboursement in-app possible**, même admin (les 3 routes → 403). Seul recours : dashboard Stripe. | Rouvre les **4 rails ADMIN uniquement** (3 routes `requireRefundAdmin` + `refunds/run`). Depuis P0-24, l'accept d'une réclamation par le restaurateur ne déclenche PLUS aucun argent (seul l'arbitrage admin rembourse) — avec CLAIMS OFF le rail claims est de toute façon dormant. **Cible bêta : `true`**, couplé `ADMIN_AUDIT_ENABLED=true` — détail : `MONEY-FLOW-CLOSED-BETA-RUNBOOK.md`. |
| `GHOST_ORDER_AUTO_REFUND_ENABLED` | Paiement encaissé sur une commande expirée → `paymentStatus='reconcile_manual'` + alerte admin (si `ALERT_EMAIL` posé). Reste OFF par décision antérieure. | Refund automatique (déconseillé tant que non éprouvé). |

**Pré-requis staging pour que les filets fonctionnent :** poser **`ALERT_EMAIL`** dans `.env.local` (sinon l'alerte ghost-order est un no-op **silencieux**) ; les crons GitHub (`confirm-sweep` 20 min, digest `reconcile-ghost-orders`) sont **inertes hors `main`** → pendant la bêta staging, appeler manuellement `GET /api/admin/reconcile-ghost-orders` (admin) une fois par jour et surveiller `/orders`.

**Rembourser une commande pendant la bêta (procédure) :**
1. Si `REFUNDS_ENABLED=true` : `POST /api/orders/[id]/refund` en session **admin** — reprise de commission au prorata, `reverse_transfer` si la charge était routée, email au client, audit. Idempotent au niveau Stripe (clé état-dépendante).
2. Si le flag est OFF : dashboard Stripe → PaymentIntent → Refund (⚠️ ne reprend PAS la commission automatiquement ; le ledger se recale au webhook `charge.refunded`). Consigner qui/quoi/pourquoi.
3. Ne **jamais** rembourser en espèces ou hors rail.

**Empreinte de réservation** : elle est **PRÉSENTE et ACTIVE** au code (hold `manual capture` de 10 € par défaut sur toute réservation `/eat`, `Restaurant.defaultDepositAmount @default(10)`) — seule la **capture punitive** est neutralisée (`PUNITIVE_CAPTURE_ENABLED` OFF). Si le pilote ne doit pas porter d'empreinte : mettre `defaultDepositAmount = 0` sur son établissement, ou laisser `reservable` désactivé.

---

## 8. INCIDENTS — procédures minimales

| Symptôme | Où regarder | Lecture |
|---|---|---|
| **429 inattendus** | corps de la réponse | Corps JSON `{"error":"Trop de requêtes, réessayez plus tard."}` + `Retry-After` ⇒ **c'est notre limiteur** (attendu). Page HTML brandée avec Request ID ⇒ **Tiger Protect** (or il doit être OFF : vérifier). |
| **500 de taille `-` dans le Raw Access** | cPanel → Métriques → Accès brut | Connu et documenté : le corps du 429 est intégralement écrit (52 octets) puis le pipe casse ; Next émet un `500` sans corps. **Le worker ne meurt pas** (prouvé). Impact client normal : nul. Ne pas patcher sans les logs. |
| **Requête qui « coupe » sans statut** | `~/logs/` | Chercher `[grubano] SIGTERM` et `[grubano] Ready on` aux horodatages. Un SIGTERM ⇒ §6. |
| **SHA servi ≠ SHA attendu** | `curl .../version.json` | Passenger n'a pas repris le build : `touch ~/app.grubano.com/tmp/restart.txt`. Le healthcheck échoue désormais tout seul dans ce cas. |
| **Flag inattendu (surface ouverte/fermée à tort)** | `.env.local` serveur | Rappel : absent = OFF. Pour `RATE_LIMIT_ENABLED`, absent = **protection désactivée**. Re-vérifier avec `node scripts/check-flags.mjs` en local. |
| **Auth qui échoue** | UI + logs | Tous les refus de connexion rendent le **même message générique** (anti-énumération, voulu). Un throttle affiche « identifiants invalides » : vérifier le bucket `auth_login` avant de conclure à un bug de mot de passe. |
| **E-mail non reçu** | `EmailLog` + logs | Le rail est best-effort : un échec SMTP ne casse jamais la requête. Vérifier `SMTP_PASS` posé (absent ⇒ statut `skipped`, aucun envoi). |
| **Onboarding bloqué** | `/api/business/me` | La porte est cliente : 401 renvoie vers `/auth/magic`. Un partenaire ayant déjà une marque reprend directement à l'étape établissement. |

---

## 9. CE QUI RESTE OUVERT (ne pas le découvrir en incident)

- **Suppression de compte et export de données** : aucun mécanisme en produit. Toute demande se traite **manuellement**. Contact DPO **non renseigné** (`lib/legal-info.ts`).
- **CGU / CGV / conditions partenaires / accord bêta** : **inexistants**, alors que l'UI y fait référence à plusieurs endroits.
- **Pages légales** : publiées en `noindex` avec bandeau « en cours de finalisation » tant que les champs requis sont des placeholders. Le garde-fou est actif et testé.
- **Rétention** : aucune purge sur les modèles porteurs de PII ; e-mails en clair dans les logs applicatifs, sans politique de rotation.
- **Access logs** : à archiver régulièrement — c'est la **seule** source rétroactive, et cPanel les purge.
