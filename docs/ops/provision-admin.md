# Créer un administrateur Grubano (provisionnement)

> Mission U (vague 3). L'espace `/admin` — et donc TOUTE la chaîne de
> remboursement du pilote (décision Q3) — exige un compte au rôle `admin`.
> Cette page explique comment en créer un **sans écrire de SQL**, en 2 minutes,
> depuis le Terminal cPanel. C'est aussi la procédure du **premier admin d'un
> environnement neuf** (bascule production).

## En une commande

Dans cPanel → **Terminal**, copiez-collez TELLE QUELLE la ligne ci-dessous,
en remplaçant seulement l’adresse email (gardez tout le reste, y compris le
long chemin — c’est l’emplacement du programme node sur le serveur, il n’est
pas dans le PATH) :

```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/provision-admin.js --email admin@grubano.com
```

En production, après la bascule, la même commande devient :

```bash
cd ~/grubano.com && /home/deyi0010/nodevenv/grubano.com/24/bin/node scripts/server/provision-admin.js --email admin@grubano.com
```

(La commande affichée par le script quand on le lance sans argument est
exactement celle du premier bloc — l’aide et cette page disent la même chose.)

C'est tout. Le script affiche en français ce qu'il a fait. Ensuite :
**se déconnecter puis se reconnecter** sur le site — le rôle ne prend effet
qu'au login (le badge de session est fabriqué à la connexion).

## Ce que fait le script, selon le cas

| Situation | Résultat |
|---|---|
| L'email n'existe pas encore | Compte **créé** : rôle `admin`, actif, **sans mot de passe** → connexion par **lien magique** (page de connexion → « lien magique ») |
| L'email existe déjà (ex. votre compte restaurateur) | Le rôle `admin` est **ajouté** à ses rôles. Son rôle principal, son mot de passe et ses préférences ne sont **pas touchés** |
| Le compte existe mais n'est pas actif | Il est **activé** au passage |
| Il est déjà admin | Le script le dit et ne change rien (rejouable sans danger) |

Option : `--name "Prénom Nom"` pour le nom d’affichage à la création —
exemple complet, copiable tel quel :

```bash
cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/provision-admin.js --email admin@grubano.com --name "Mohammed Maazouz"
```

## Traçabilité

Chaque exécution écrit une ligne dans le **journal d'audit** (`AdminAuditLog`,
action `admin.provision`, acteur `system:ops-script`) — même quand le flag
`ADMIN_AUDIT_ENABLED` est éteint : la création d'un admin se trace toujours.
Si la table n'existe pas encore (schéma pas poussé), le script le signale
clairement au lieu de se taire.

## Sécurité — pourquoi c'est sûr

- **Aucune surface web** : ce n'est pas une page ni une API — rien de ce
  script n'est appelable par une requête HTTP. Il ne s'exécute que dans le
  Terminal du compte d'hébergement, c'est-à-dire par quelqu'un qui a déjà
  accès à la base entière. Aucune élévation de privilège nouvelle n'existe.
- Le script vit dans `scripts/server/` — le dossier d'exploitation shippé par
  les workflows de deploy : il est présent sur le serveur après chaque
  déploiement, jamais dans le bundle web.

## Le piège connu `notifPrefs` (défaut Mission L)

Sur certaines lignes anciennes, la colonne `notifPrefs` est invalide et fait
échouer **toute** modification du compte (erreur 4025). Le script est conçu
pour :

- **promouvoir sans toucher la ligne** (l'ajout de rôle passe par une autre
  table) — une ligne cassée peut donc être promue telle quelle ;
- si une **activation** est nécessaire, il détecte la colonne invalide, la
  répare en `{}` (les préférences d'une ligne saine ne sont jamais écrasées),
  puis active ;
- en dernier recours, il échoue avec un **message en français** qui nomme le
  problème — jamais une erreur SQL brute.

Réparation manuelle de masse (si le script vous y renvoie) — requête à
exécuter en base, cf. rapport Mission L :

```sql
UPDATE Operator SET notifPrefs='{}'
WHERE notifPrefs IS NOT NULL AND NOT JSON_VALID(notifPrefs);
```

## Vérifier que ça a marché

1. Se déconnecter / se reconnecter avec ce compte.
2. Ouvrir `https://app.grubano.com/fr/admin` → la console admin s'affiche
   (un non-admin est renvoyé vers son espace).
3. (Optionnel) en base, lecture seule :
   ```sql
   SELECT action, targetId, createdAt FROM AdminAuditLog
   WHERE action='admin.provision' ORDER BY createdAt DESC LIMIT 5;
   ```

## Dépannage

| Message | Cause / geste |
|---|---|
| `DATABASE_URL introuvable` | Lancer depuis la racine : `cd ~/app.grubano.com` d'abord |
| `@prisma/client introuvable` | Même cause — le `node_modules` de l'app contient le client |
| `node : commande introuvable` | Le programme node n'est pas dans le PATH du serveur : utilisez le chemin complet du bloc « En une commande » (il commence par `/home/deyi0010/nodevenv/…`) |
| `… n'a PAS pu être activé (status)` | Ligne `notifPrefs` récalcitrante → requête de réparation ci-dessus, puis relancer |
| Le rôle ne prend pas effet sur le site | Déconnexion/reconnexion pas faite — le badge de session date d'avant |
