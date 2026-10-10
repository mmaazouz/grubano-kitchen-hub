# GRUBANO — Social Brief Local Contract (DRAFT, dry-run)

> Statut : contrat local uniquement. Aucun post publié, aucun compte social Grubano lié, aucune connexion ouverte vers le VPS Synkia `vps-3308af3c`, n8n ou Postiz.
> Référence de coordination : contrat partagé [`docs/ops/GRUBANO-SHARED-SOCIAL-ENGINE-CONTRACT.md`](./GRUBANO-SHARED-SOCIAL-ENGINE-CONTRACT.md) et issue amont `mmaazouz/automation-business-engine#4`.

## Portée

Ce module implémente **uniquement** la frontière métier décrite dans le contrat partagé, côté Grubano :

- valider des briefs rédactionnels publics (faits datés, URL allowlistée, droits médias, revue humaine) ;
- produire un enregistrement `DRAFT`/`REVIEW` déterministe avec clés d'idempotence stables, consommables par un futur route serveur ;
- refuser par défaut (feature flag OFF, `dispatchAllowed:false` invariant) toute possibilité d'export vers le Social Engine partagé.

Il **n'implémente pas** :

- de publication, de connecteur Postiz, de workflow n8n, de scheduler, d'éditeur social ou de moteur vidéo/carrousel ;
- d'OAuth réseau social, de stockage de secret, de pipeline de médias ;
- de schéma Prisma, d'outbox persistante, de job cron, d'écriture disque ;
- d'authentification ni d'autorisation côté caller — ces couches vivent dans la route serveur future (hors de ce module).

## Localisation

- Code : `lib/growth/social-brief/{types,validate,build,idempotency,index}.ts`
- Tests : `tests/growth-social-brief-{validate,adversarial,idempotency}.test.ts`

Le module est pur (aucun import de `@/lib/prisma`, `next/*`, `node:fs`, `node:net`). La seule dépendance Node est `node:crypto` pour SHA-256, utilisé localement sur une entrée length-prefixée.

## Contrat d'entrée

```ts
type SocialBriefInput = {
  brand: 'grubano';
  sourceEventId: string;        // opaque, ≤128 chars, pas de PII
  pillar: Pillar;               // enum fermé (voir types.ts)
  topic: string;                // ≤240 chars, aucun email/téléphone
  facts: FactRef[];             // ≥1, kind ∈ FACT_KINDS, verifiedAt ISO UTC, âge ≤365j
  restaurantId?: string;        // opaque, uniquement si accord vérifié
  targetUrl: string;            // allowlist exacte, voir ci-dessous
  assetRefs?: AssetRef[];       // obligatoire pour carousel / short_video
  formats: SocialFormat[];      // post | carousel | short_video
  platforms: Platform[];        // instagram | linkedin | tiktok | facebook | youtube_shorts
  legalChecks: LegalChecks;     // 4 booléens, tous à true requis
};
```

### Garde-fous appliqués

| Garde | Comportement |
|---|---|
| **Marque** | `brand` doit être la constante littérale `grubano`. Un identifiant serveur (futur) devra renforcer la même règle en amont — le brief ne définit jamais la marque. |
| **Allowlist URL** | Hostname = `grubano.com` exactement, HTTPS, pas de query, pas de fragment, pas d'userinfo, pas de port, pas d'hostname Unicode/punycode, chemin ∈ `{/, /eat, /eat/, /legal/cgv, /legal/confidentialite, /legal/cookies, /legal/mentions-legales}`. Nouveaux chemins = revue manuelle + ajout explicite dans `validate.ts`. |
| **Faits** | Chaque `FactRef.kind` doit être `press_release`, `public_website`, `restaurant_contract`, `legal_filing` ou `own_announcement`. Jamais `customer_review`, `order_history`, `survey`, `metric`, etc. `verifiedAt` doit être strictement passé et ≤ `maxFactAgeDays` (défaut 365 j). |
| **Droits médias** | `rightsVerifiedAt` ≤ `now`, `rightsExpiresAt` > `now`, et `rightsExpiresAt` > `rightsVerifiedAt`. Pas d'actif = refus pour `carousel` / `short_video`. |
| **Legal checks** | Les 4 booléens doivent être `true` ET du type `boolean` (une chaîne `"true"` est refusée). Toute absence = refus. |
| **Scan PII — valeurs** | Toute chaîne contenant un email ou un numéro de téléphone (dix chiffres consécutifs, préfixe `+NN`/`00NN`, ou pattern français `06 12 34 56 78` à 4+ groupes) est refusée. Les timestamps ISO-8601 sont neutres par construction (3 groupes max avant interruption). |
| **Scan PII — clés** | Toute clé contenant `email`, `phone`, `user`, `customer`, `order`, `shipping`, `address`, `token`, `secret`, `password`, `cookie`, `session`, `ssn`, `iban`, `card`, `cvv`, `postal`, `zipcode` est refusée. Les clés inconnues (hors shape documentée) sont également refusées. |
| **Caps structurels** | `MAX_INPUT_BYTES=16 KB`, `MAX_STRING_LEN=2000`, `MAX_ARRAY_LEN=32`, `MAX_DEPTH=5`. |
| **Idempotence** | SHA-256 sur `(magic, brand, sourceEventId, pillar, platform, format)` length-prefixé — immune aux injections de délimiteur, surrogates orphelins, BOM, zero-width space. |

## Contrat de sortie

```ts
type SocialBriefDraft = {
  status: 'DRAFT' | 'REVIEW' | 'BLOCKED';
  dispatchAllowed: false;             // invariant littéral — ce module n'envoie jamais
  featureEnabled: boolean;
  brand: 'grubano';
  reasons: BriefReason[];
  brief: ValidatedBrief | null;
  idempotencyKeys: string[];
};
```

- `FEATURE_DISABLED` : flag `GRUBANO_SOCIAL_BRIEF_EXPORT_ENABLED` à `false` (par défaut). Aucune validation n'est exécutée, aucun enregistrement exportable n'est produit.
- Avec le flag `true` et une validation propre : `status='REVIEW'`, `dispatchAllowed:false`, `brief` renseigné, `idempotencyKeys` déterministes (triés, dédupliqués).
- Avec le flag `true` et une validation sale : `status='BLOCKED'`, `brief=null`, `reasons[]` liste chaque violation avec un `code` stable et un `path` pointé (dotted path).

## Ce que ce module ne fait PAS

- **Pas d'authentification caller** : la route serveur future doit encapsuler `buildSocialBrief` derrière un `getToken()` + rôle approprié. Un `approved_by` passé en chaîne par le brief n'est jamais une preuve d'autorisation (voir §Sécurité du contrat partagé).
- **Pas d'export** : même avec un brief `REVIEW`, aucun envoi réseau n'est effectué. Le brief est destiné à une outbox locale (hors scope de cette PR) et à un approbateur humain.
- **Pas de création de post** : titres, visuels, scripts, légendes, hashtags, calendriers sont la responsabilité exclusive du Social Engine Python partagé, derrière un contrat multi-marque qui n'est pas encore livré côté Synkia (issue #4).
- **Pas de dépendance Postiz / n8n** : aucun identifiant d'intégration, aucun client HTTP, aucun secret ne traverse ce module.

## Gates de sortie (côté Grubano)

Dans l'ordre, aucune case ci-dessous ne peut passer en vert à cause d'une CI verte seule :

1. **Contrat et fixtures** (cette PR) — PII guard, URL allowlist, idempotence, caps, tests négatifs.
2. **Outbox locale** — à ne livrer qu'après revue d'un schéma Prisma strictement additif + anonymisation + flag OFF ; aucune proximité avec `Order` / `Refund`.
3. **Client serveur-à-serveur** — à ne livrer qu'après que l'API multi-marque Synkia existe, qu'un environnement de test est fourni et que les tests A/B tenant sont écrits.
4. **Tableau éditorial** — après #2 et #3 ; approbations humaines visibles et auditables.
5. **Recette réelle** — publication test sur un compte Grubano contrôlé, sous GO explicite, flag ciblé, rollback vérifié.

## Références

- Contrat partagé : [`GRUBANO-SHARED-SOCIAL-ENGINE-CONTRACT.md`](./GRUBANO-SHARED-SOCIAL-ENGINE-CONTRACT.md)
- Issue amont : `mmaazouz/automation-business-engine#4`
- Code module : `lib/growth/social-brief/`
- Tests : `tests/growth-social-brief-*.test.ts`
