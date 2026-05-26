import { Bell, ShoppingBag, Star, AlertTriangle, Users, Clock } from 'lucide-react'

const notifications = [
  { icon: ShoppingBag, title: 'Nouvelle commande Grubano',      desc: '#GR-2241 · Gnocchi Bar · €24.50',     time: 'il y a 2 min',   color: 'text-primary', read: false },
  { icon: Star,        title: 'Nouvel avis 1★ sur Deliveroo',   desc: 'Rollix · Froid à la livraison',        time: 'il y a 2h',      color: 'text-destructive', read: false },
  { icon: AlertTriangle,title: 'Stock critique : sauce butter', desc: 'Environ 0.8L restant',                 time: 'il y a 3h',      color: 'text-warning', read: false },
  { icon: Users,       title: 'Nouveau client fidélité',        desc: 'Karim Z. inscrit · 10 pts de bienvenue',time: 'il y a 5h',    color: 'text-success', read: true  },
  { icon: Clock,       title: 'Rappel réservation',             desc: 'Marc D. · 19h · Terrasse · 4 couverts', time: 'il y a 6h',   color: 'text-navy',    read: true  },
  { icon: ShoppingBag, title: 'Commande annulée UberEats',      desc: '#UE-8419 · Rupture de stock',          time: 'Hier 21h',       color: 'text-destructive', read: true },
]

export default function NotificationsPage() {
  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unread} non lues</p>
        </div>
        <button className="text-[11px] font-semibold text-primary">Tout lire</button>
      </div>

      <div className="space-y-2">
        {notifications.map((n, i) => (
          <div key={i} className={`flex items-start gap-3 rounded-2xl border p-3 ${
            n.read ? 'border-border bg-card' : 'border-primary/20 bg-accent'
          }`}>
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted ${n.color}`}>
              <n.icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${n.read ? 'text-foreground' : 'text-foreground'}`}>
                {n.title}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{n.desc}</p>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <span className="text-[10px] text-muted-foreground">{n.time}</span>
              {!n.read && <span className="h-2 w-2 rounded-full bg-primary" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
