/**
 * RÉFÉRENCE COURTE DE COMMANDE — SOURCE UNIQUE (lot véracité 2026-09-01).
 *
 * La répétition humaine a prouvé que LA MÊME commande s'affichait sous QUATRE
 * références différentes selon l'écran : `#GBZE1X` (confirmation, e-mails,
 * /orders opérateur — '#'+slice(-6)), `GR-BZE1X` (liste conso + pass de
 * retrait — 'GR-'+slice(-5)), `#BZE1X` (cuisine /prep — '#'+slice(-5)),
 * `#GR-ZE1X` (suivi + notation — '#GR-'+slice(-4)). Le restaurateur ne
 * pouvait donc PAS rapprocher le pass du client de son propre écran.
 *
 * Décision : UNE formule, dérivée (aucun champ persisté n'existe — Order n'a
 * pas d'orderNumber), affichée À L'IDENTIQUE côté client, opérateur, cuisine
 * et e-mails, et encodée telle quelle dans le QR du pass.
 *
 * Format : 'GR-' + les 6 derniers caractères de l'id (cuid) en MAJUSCULES.
 *  - 6 caractères = le plus grand espace déjà en usage (36^6 ≈ 2,18 Md ;
 *    slice(-4) atteignait ~50 % de collision dès ~1 500 commandes) ;
 *  - préfixe 'GR-' = celui déjà imprimé sur les pass des clients.
 * Ce n'est PAS un identifiant unique garanti (pas de contrainte DB) : c'est
 * une référence d'affichage. L'unicité persistée (Order.orderNumber @unique)
 * est un choix de schéma qui appartient au fondateur — voir le rapport du lot.
 */
export function orderRef(orderId: string): string {
  return 'GR-' + orderId.slice(-6).toUpperCase()
}
