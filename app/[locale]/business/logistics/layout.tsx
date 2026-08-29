import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isLogisticsSignupEnabled } from '@/lib/logistics-account'

// ── P0-38 — rôle gelé (doctrine Q8) :  ─
// Quand le flag est OFF, TOUT ce sous-arbre de pages est INTROUVABLE (404),
// sans redirection — landings, tableaux de bord, sous-pages et liens profonds.
// Le gate vit dans un layout SERVEUR : il s'exécute AVANT toute page (14 des 34
// pages des rôles gelés sont des composants CLIENT qui ne peuvent pas lire le
// flag) et couvre les pages futures du segment. Miroir « pages » du patron
// PRESTATAIRE_ENABLED (P0-06 n'avait gaté que les routes API — c'est le trou
// constaté par le fondateur en session restaurateur réelle sur staging).
//
// WAVE 3 — cet arbre est l'INSCRIPTION publique (landing LO4 + formulaire LO5),
// pas l'opérationnel : il s'ouvre avec LOGISTICS_SIGNUP_ENABLED (waitlist réelle).
// L'espace /logistics/dashboard et les 17 APIs opérationnelles restent gatés par
// LOGISTICS_ENABLED, inchangé.
export default function GateLayout({ children }: { children: ReactNode }) {
  if (!isLogisticsSignupEnabled()) notFound()
  return <>{children}</>
}
