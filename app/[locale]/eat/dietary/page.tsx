import { notFound } from 'next/navigation'

// /eat/dietary — RETIRÉ de la closed beta (LOT 2 « carte honnête »).
//
// L'écran « Filtre IA diététique & allergènes » était ENTIÈREMENT INERTE : régimes
// et allergènes purement visuels, compteurs fabriqués (38 compatibles / 14 masqués /
// 6 alternatives), CTA sans effet — il SIMULAIT un filtre de sécurité pour personnes
// allergiques alors qu'aucun filtrage réel n'existe côté backend. Tant que ce
// filtrage réel n'existe pas, la route rend le 404 standard (composant serveur).
// L'écran complet reste dans l'historique git si le chantier reprend.

export default function DietaryFilterRemoved() {
  notFound()
}
