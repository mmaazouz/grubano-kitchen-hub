# GRUBANO — contrat de raccordement au Social Engine partagé (DRAFT, aucun envoi)

> Statut : conception/coordination seulement. Aucun connecteur Grubano déployé, aucun compte social Grubano lié, aucune publication réelle validée.
> Ticket propriétaire du socle commun : https://github.com/mmaazouz/automation-business-engine/issues/4
> Socle existant : `mmaazouz/automation-business-engine`, PR #3 Postiz (`044acc1`), n8n et Postiz sur VPS Synkia `vps-3308af3c`.

## Décision d'architecture

- Une seule infrastructure partagée pour Synkia, Automatisation TPE, HOTELSTAFF et GRUBANO : Social Engine Python + n8n + Postiz auto-hébergé. **Ne pas cloner** le publisher, les adaptateurs réseau, la fabrique posts/carrousels/vidéos, le calendrier ni le learning loop dans Grubano.
- Grubano conserve son Business Engine, ses données commerciales (restaurants, commandes, consentements) et ses pipelines d'acquisition/fidélisation. Il produit uniquement des **briefs métier sans PII** et lit ses propres résultats via une interface serveur à serveur restreinte.
- Toute extension des profils de marques, du publisher Postiz, de la base partagée ou de son auth est gouvernée dans le projet Synkia (issue #4). Ne modifier ni VPS, ni Postiz, ni n8n depuis le dépôt Grubano.

## État réellement observé le 9 octobre 2026

- Le repo commun possède des endpoints `/v1/social` pour les idées, formats, queue, approbations, assets, statistiques et apprentissage ; la documentation couvre post/carrousel/vidéo courte.
- **Blocage multi-marques :** `engine/social/api.py` accepte seulement `synkia` et `automatisation-tpe`, et `engine/social/brands.py` ne connaît que ces marques.
- **Blocage sécurité :** les endpoints et identités d'approbateurs devront être authentifiés/autorisés côté serveur avec filtrage par marque et par ID de job. Un simple champ `brand` transmis par le client ou `approved_by` fourni comme chaîne ne constitue pas une autorisation.
- Publication globale désactivée par défaut (`SOCIAL_PUBLISHING_ENABLED=false`). Premier OAuth LinkedIn/chaîne de publication réelle encore à tester ; ne pas la considérer opérationnelle.
- La PR #3 commune reste en brouillon. Les modules métier Grubano PR #20/#22/#23 sont eux aussi en brouillon : aucune dépendance d'exécution vers Postiz n'est autorisée avant finalisation des garde-fous.

## Frontière métier : ce que Grubano fournira

### Brief rédactionnel (schéma cible **proposé**, pas une API déployée)

| Champ | Contrat attendu |
|---|---|
| `brand` | Valeur constante `grubano`, autorisée par identité serveur, jamais contrôlée uniquement par l'entrée |
| `sourceEventId` | ID opaque d'un événement métier vérifié, unique dans l'espace Grubano |
| `pillar` | restaurant_partenaire, plat_du_jour, decouverte_culinaire, conseils, service_livraison, fidelisation |
| `topic`, `facts`, `sourceRefs` | Faits publics vérifiables, datés ; provenance et version, sans noms/emails/téléphones clients |
| `restaurantId` | Identifiant opaque uniquement si relation/accord de mise en avant vérifié |
| `targetUrl` | URL HTTPS grubano.com allowlistée et contrôlée ; aucune URL arbitraire de redirection |
| `assetRefs` | Références médias avec droits/consentement/validité vérifiés ; le moteur partagé gère la production et les uploads |
| `formats`, `platforms` | Intentions post/carrousel/short-video et plateformes autorisées pour Grubano seulement |
| `legalChecks` | Confirmation éditoriale/droits images/autorisation restaurant et statut de revue humaine |
| `idempotencyKey` | Dérivée côté serveur de brand + sourceEventId + pillar + platform + format ; collisions échappées |

Tout contenu promotionnel doit refléter des **prix, disponibilités, offres et délais réellement confirmés** ; ne jamais inventer de réductions, témoignages, notes, commandes, volumes de vente ou partenaires. Ne pas utiliser d'historiques de commandes individuels, d'adresses de livraison, de préférences personnelles ou d'avis sans autorisation spécifique.

### Parcours cible (inactif pour le moment)

1. Un événement métier réel côté Grubano crée un brief local `DRAFT` sur base de données **Grubano**, feature flag `GRUBANO_SOCIAL_BRIEF_EXPORT_ENABLED=false` par défaut.
2. Un validateur local confirme le tenant Grubano, l'autorisation de mise en avant, la provenance et l'absence de PII. Sinon `BLOCKED`, aucun export.
3. Le backend Grubano envoie le brief par appel serveur à serveur authentifié au contrat exposé par le moteur Synkia, quand ce contrat aura été défini et testé. **Jamais** d'accès navigateur direct à Postiz/n8n ou de clé Postiz stockée dans Grubano.
4. Le Social Engine partagé produit posts, carrousels, scripts vidéo, assets et versions par canal, puis applique QA/anti-répétition et propose un calendrier éditorial **Grubano uniquement**.
5. Un approbateur Grubano authentifié valide les contenus. Les formats requérant un média attendent un asset prêt. La planification ne vaut pas permission de publier.
6. Le dispatch reste `dry_run=true` et la publication réelle OFF jusqu'aux tests E2E des intégrations et à un GO explicite. Aucune activation globale Synkia ne doit activer Grubano par effet de bord.
7. Statuts/métriques (impressions, clics, engagement, leads) reviennent vers une projection Grubano brand-scopée, sans accès aux contacts/CRM des autres marques.

## Séparation stricte et sécurité

- Credential distinct par projet et permissions minimales : `brand:grubano` uniquement. Rotation/revocation, journaux d'audit sans secrets, réseau privé ou reverse proxy authentifié.
- Vérifier sur **chaque** endpoint lecture/écriture/action par ID (idea, job, asset, metrics, approval, scheduling) la propriété `brand=grubano` calculée depuis la ressource et l'identité authentifiée. Tests négatifs A→B requis.
- Intégration Postiz par `brand × platform → integrationId` côté serveur Synkia, comptes OAuth distincts, jamais de secret ni ID de connexion imposé par le brief Grubano.
- Horaires, quotas, paramètres et statistiques indépendants des autres marques ; interdiction de déclencher une publication sous une autre marque.
- Les preuves de consentement marketing B2C et suppressions restent dans la base Grubano ; ne pas transférer de listes clients au Social Engine. Ne pas assimiler publication organique et consentement pour messages directs.

## Livrables côté GRUBANO (séquentiels, PR séparées)

1. **Contrat et fixtures** : adaptateur métier `GrubanoSocialBrief` pur, allowlist des faits publics, URL/tenant, PII guard, idempotence, tests négatifs; aucune connexion réseau.
2. **Outbox locale en lecture/écriture** : uniquement après revue de schéma additive et anonymisation ; aucun lien direct avec paiements/refunds ; flag OFF.
3. **Client HTTP serveur à serveur** : seulement après que Synkia livre une API multi-marque authentifiée, des tests tenant A/B et un environnement de test ; retries idempotents, timeout, circuit breaker, observabilité.
4. **Tableau éditorial Grubano** : état des briefs/jobs, approbations humaines, calendrier, contenu média et métriques brand-scopées.
5. **Recette réelle** : OAuth des comptes Grubano, médias, validation utilisateur, publication test autorisée sur un compte contrôlé et retour analytics. Aucune publication réelle sans GO dédié.

## Gates de sortie

- [ ] Issue partagée #4 acceptée/implémentée côté Synkia : marque `grubano`, rôles/tenant authz, stockage sûr et tests A↔B.
- [ ] LinkedIn OAuth Postiz retesté et chaîne d'envoi **réel** validée séparément sur le socle ; puis comptes Grubano autorisés et connectés.
- [ ] Tests contractuels pures Grubano : PII, URL, provenance, doublons, droits images et absence d'envoi, y compris multi-marque.
- [ ] Dry-run E2E du flux entier, sans publication ; revue humaine visible et auditable.
- [ ] Publication test **sur autorisation explicite**, flags ciblés par marque et rollback confirmé.

**Aucune des cases ci-dessus n'est déclarée réussie simplement parce qu'une CI de Grubano ou de Synkia est verte.**
