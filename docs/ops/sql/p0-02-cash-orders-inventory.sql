-- ═══════════════════════════════════════════════════════════════════════════
-- P0-02 (vague 1) — INVENTAIRE des commandes NON-CARTE existantes en base
-- LECTURE SEULE : uniquement des SELECT — aucune écriture, aucune modification.
-- À exécuter par le fondateur (cPanel > phpMyAdmin, ou mysql CLI sur le serveur).
-- Contexte : depuis P0-02 le serveur refuse la création de commandes 'cash' /
-- 'wallet' ; ces requêtes dénombrent le STOCK HÉRITÉ créé avant le verrou.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Requête 1 — dénombrement par (mode, statut commande, statut paiement) ────
-- Lecture du résultat :
--   • statut_paiement 'NULL (jamais initialisé)' = trace économique absente —
--     le flux cash n'a JAMAIS posé de statut de paiement (constat audit P8) ;
--   • statut_commande 'delivered' + paiement NULL = commandes servies dont
--     l'encaissement n'a aucune preuve en base ;
--   • 'paid' sur un mode non-carte = ARGENT RÉELLEMENT PRÉLEVÉ par carte →
--     double encaissement probable (espèces à la livraison + carte en ligne) ;
--   • 'pending' = PaymentIntent créé mais NON confirmé par le webhook — aucun
--     argent prélevé, à lever de doute via la requête 2 ;
--   • 'refunded' / 'reconcile_manual' (écrits par le webhook Stripe) peuvent
--     aussi apparaître : 'reconcile_manual' est le sentinelle d'AMBIGUÏTÉ
--     monétaire (encaissement à réconcilier À LA MAIN) — à traiter en priorité.
SELECT
  paymentMethod                                       AS mode_paiement,
  status                                              AS statut_commande,
  COALESCE(paymentStatus, 'NULL (jamais initialisé)') AS statut_paiement,
  COUNT(*)                                            AS nb_commandes,
  ROUND(SUM(total), 2)                                AS total_eur,
  SUM(pointsEarned)                                   AS points_fidelite_provisionnes,
  MIN(createdAt)                                      AS premiere,
  MAX(createdAt)                                      AS derniere
FROM `Order`
WHERE paymentMethod <> 'card'
GROUP BY paymentMethod, status, paymentStatus
ORDER BY mode_paiement, statut_commande, statut_paiement;

-- ── Requête 2 — suspects de DOUBLE ENCAISSEMENT ──────────────────────────────
-- Commandes non-carte portant AUSSI un PaymentIntent Stripe : la commande a pu
-- être encaissée en espèces à la livraison ET payée par carte en ligne (la
-- route /pay ne lit pas paymentMethod — constat P8, toujours vrai). Zéro ligne
-- = aucun cas TRACÉ EN BASE (le PI est créé chez Stripe AVANT d'être persisté :
-- un résidu jamais écrit — webhook perdu — serait invisible ici ; croisement
-- possible côté dashboard Stripe par metadata.orderId en cas de doute).
SELECT
  id, status AS statut_commande, paymentStatus AS statut_paiement,
  stripePaymentIntentId, ROUND(total, 2) AS total_eur, createdAt
FROM `Order`
WHERE paymentMethod <> 'card'
  AND stripePaymentIntentId IS NOT NULL
ORDER BY createdAt DESC;

-- ── Requête 3 — vue d'ensemble (contrôle de cohérence) ───────────────────────
-- Part du non-carte dans le total : permet de vérifier que les requêtes 1 et 2
-- couvrent bien tout le stock (nb_non_carte = somme des nb_commandes de la R1).
SELECT
  COUNT(*)                                        AS nb_total_commandes,
  SUM(paymentMethod <> 'card')                    AS nb_non_carte,
  ROUND(SUM(IF(paymentMethod <> 'card', total, 0)), 2) AS total_eur_non_carte
FROM `Order`;
