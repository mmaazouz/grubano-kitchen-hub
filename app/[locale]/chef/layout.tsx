import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isCreatorEnabled } from '@/lib/creator-account'

// ── P0-38 — rôle gelé (doctrine Q8) :  ─
// Quand le flag racine est OFF, TOUT ce sous-arbre de pages est INTROUVABLE (404),
// sans redirection — landings, tableaux de bord, sous-pages et liens profonds.
// Le gate vit dans un layout SERVEUR : il s'exécute AVANT toute page (14 des 34
// pages des rôles gelés sont des composants CLIENT qui ne peuvent pas lire le
// flag) et couvre les pages futures du segment. Miroir « pages » du patron
// PRESTATAIRE_ENABLED (P0-06 n'avait gaté que les routes API — c'est le trou
// constaté par le fondateur en session restaurateur réelle sur staging).
export default function GateLayout({ children }: { children: ReactNode }) {
  if (!isCreatorEnabled()) notFound()
  return <>{children}</>
}
