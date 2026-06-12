import PromotionsManager from '@/components/promotions/PromotionsManager'

// ── /promotions — chantier P1, l'écran resto de gestion des promotions ─────────
// Engine: lib/promotions (server-resolved at checkout, doctrine D1-D6). The page
// is a thin shell around the client manager (state + modals live there).
export const dynamic = 'force-dynamic'

export default function PromotionsPage() {
  return <PromotionsManager />
}
