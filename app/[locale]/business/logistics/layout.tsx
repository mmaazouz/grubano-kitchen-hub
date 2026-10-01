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
// The gate reads process.env with no dynamic API in the tree, so Next would
// STATICALLY prerender this subtree at BUILD time — and CI builds run without
// LOGISTICS_SIGNUP_ENABLED, baking notFound() into the deploy forever (the
// runtime .env.local + restart can never revive it; proven on staging
// 2026-08-30: flag exactly `true` in env, restart done, page still 404).
// force-dynamic makes the flag a real RUNTIME switch, as intended.
export const dynamic = 'force-dynamic'

export default function GateLayout({ children }: { children: ReactNode }) {
  if (!isLogisticsSignupEnabled()) notFound()
  return <>{children}</>
}
