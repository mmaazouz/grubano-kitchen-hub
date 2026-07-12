import { Star, Package, Heart, Clock, ChevronRight, Wallet } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const ACTIVE_ORDERS = [
  { id: '#GR-2241', brand: 'Gnocchi Bar',  status: 'En préparation', eta: '12 min', progress: 40 },
  { id: '#GR-2238', brand: 'Pasta Fresca', status: 'En livraison',    eta: '5 min',  progress: 80 },
]

const HISTORY = [
  { id: '#GR-2230', brand: 'Rollix',        total: 18.9, date: '22 mai',   pts: 19 },
  { id: '#GR-2218', brand: 'Gnocchi Bar',   total: 24.5, date: '18 mai',   pts: 25 },
  { id: '#GR-2201', brand: 'Pasta Fresca',  total: 31.2, date: '11 mai',   pts: 31 },
]

const FAVORITES = ['Gnocchi Bar', 'Pasta Fresca', 'Rollix']

export default function AccountPage() {
  return (
    <div className="px-4 pb-10 pt-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-lg font-bold text-primary-foreground">
          M
        </div>
        <div>
          <h1 className="text-xl font-display font-bold tracking-tight">Bonjour, Mohammed</h1>
          <p className="text-sm text-muted-foreground">Membre depuis janvier 2025</p>
        </div>
      </div>

      {/* Points wallet */}
      <Card className="mb-4 bg-gradient-to-br from-primary to-primary/80 !text-primary-foreground border-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold opacity-70 uppercase tracking-wider mb-1">Portefeuille de points</p>
            <p className="text-3xl font-bold">1 240 pts</p>
            <p className="text-xs opacity-70 mt-0.5">≈ 12,40€ de réduction disponible</p>
          </div>
          <Wallet size={40} className="opacity-30" />
        </div>
        <div className="mt-3 flex gap-2">
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold">Tier: Or 🥇</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px]">Prochain tier: 1 500 pts</span>
        </div>
      </Card>

      {/* Active orders */}
      <SectionTitle hint="Live">Commandes en cours</SectionTitle>
      <div className="space-y-2 mb-6">
        {ACTIVE_ORDERS.map(order => (
          <Card key={order.id} className="!p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold">{order.brand}</p>
                <p className="text-[11px] text-muted-foreground">{order.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-success">{order.status}</span>
                <p className="text-[11px] text-muted-foreground">ETA {order.eta}</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${order.progress}%` }}
              />
            </div>
          </Card>
        ))}
        {ACTIVE_ORDERS.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Aucune commande en cours</p>
        )}
      </div>

      {/* Favorites */}
      <SectionTitle>Mes favoris</SectionTitle>
      <div className="flex flex-wrap gap-2 mb-6">
        {FAVORITES.map(fav => (
          <div key={fav} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium">
            <Heart size={11} className="text-destructive fill-destructive" />
            {fav}
          </div>
        ))}
      </div>

      {/* History */}
      <SectionTitle>Historique</SectionTitle>
      <div className="space-y-1.5">
        {HISTORY.map(order => (
          <Card key={order.id} className="!p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <Package size={16} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{order.brand}</p>
              <p className="text-[11px] text-muted-foreground">{order.id} · {order.date}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold">€{order.total.toFixed(2)}</p>
              <p className="text-[11px] text-success">+{order.pts} pts</p>
            </div>
            <ChevronRight size={14} className="text-muted-foreground" />
          </Card>
        ))}
      </div>
    </div>
  )
}
