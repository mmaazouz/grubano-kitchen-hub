import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  TrendingUp, ShoppingBag, Star, Users, AlertTriangle, Power, EyeOff, CalendarDays, Truck,
  Sparkles, ChevronRight, Lock,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Grubano — Tableau de bord" }] }),
});

const alerts = [
  { type: "stock", icon: AlertTriangle, title: "Sauce butter chicken critique", desc: "Commandez avant 10h00", tone: "destructive", to: "/stocks" },
  { type: "review", icon: Star, title: "1 avis négatif sans réponse", desc: "Sarah K. · 2★ · il y a 1h", tone: "warning", to: "/reviews" },
  { type: "reservation", icon: CalendarDays, title: "Table 4 dans 2h", desc: "3 couverts · allergie fruits à coque", tone: "navy", to: "/tables" },
] as const;

const recentOrders = [
  { id: "#GR-2241", brand: "Gnocchi Bar", amount: 24.5, status: "En préparation", time: "il y a 2 min", tone: "primary" },
  { id: "#GR-2240", brand: "Pasta Fresca", amount: 31.2, status: "Confirmée", time: "il y a 5 min", tone: "success" },
  { id: "#GR-2239", brand: "Rollix", amount: 18.9, status: "Livrée", time: "il y a 12 min", tone: "muted" },
  { id: "#GR-2238", brand: "Riz Gourmand", amount: 22.0, status: "Livrée", time: "il y a 18 min", tone: "muted" },
  { id: "#GR-2237", brand: "Gnocchi Bar", amount: 27.4, status: "Livrée", time: "il y a 24 min", tone: "muted" },
] as const;

function KpiCard({ icon: Icon, label, value, change, tone = "default" }: { icon: React.ElementType; label: string; value: string; change: string; tone?: "default" | "primary" }) {
  const positive = change.startsWith("+");
  return (
    <div className={`rounded-2xl border p-3.5 ${tone === "primary" ? "border-transparent bg-navy text-navy-foreground" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between">
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${tone === "primary" ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
          <Icon size={15} />
        </div>
        <span className={`text-[10px] font-semibold ${tone === "primary" ? "text-primary" : positive ? "text-success" : "text-destructive"}`}>{change}</span>
      </div>
      <p className={`mt-3 text-[10px] uppercase tracking-wider ${tone === "primary" ? "text-navy-foreground/60" : "text-muted-foreground"}`}>{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function Dashboard() {
  const [open, setOpen] = useState(true);
  return (
    <AppShell operator="Mohammed" subtitle="Bonjour">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Aujourd'hui</h1>
          <p className="text-sm text-muted-foreground">Mardi 18 novembre</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${open ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
          {open ? "Ouvert" : "Fermé"}
        </span>
      </div>

      {/* Alertes critiques */}
      <div className="mb-5 space-y-2">
        {alerts.map((a) => (
          <Link
            key={a.type}
            to={a.to}
            className={`flex items-start gap-3 rounded-2xl border p-3.5 ${
              a.tone === "destructive" ? "border-destructive/30 bg-destructive/10" :
              a.tone === "warning" ? "border-warning/30 bg-warning/10" :
              "border-navy/20 bg-navy text-navy-foreground"
            }`}
          >
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              a.tone === "destructive" ? "bg-destructive text-destructive-foreground" :
              a.tone === "warning" ? "bg-warning text-warning-foreground" :
              "bg-primary text-primary-foreground"
            }`}>
              <a.icon size={15} />
            </div>
            <div className="flex-1">
              <p className={`text-xs font-bold ${a.tone === "navy" ? "" : "text-foreground"}`}>{a.title}</p>
              <p className={`mt-0.5 text-[11px] ${a.tone === "navy" ? "text-navy-foreground/70" : "text-muted-foreground"}`}>{a.desc}</p>
            </div>
            <ChevronRight size={16} className={a.tone === "navy" ? "text-navy-foreground/50" : "text-muted-foreground"} />
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={TrendingUp} label="Revenu vs hier" value="€2 847" change="+12%" tone="primary" />
        <KpiCard icon={ShoppingBag} label="Commandes" value="184" change="+8%" />
        <KpiCard icon={Star} label="Note (30j)" value="4.8★" change="+0.2" />
        <KpiCard icon={Users} label="Fidèles" value="1 247" change="+23" />
      </div>

      {/* Update stocks - AI */}
      <Link to="/stocks" className="mt-4 flex items-center gap-3 rounded-2xl bg-navy p-4 text-navy-foreground">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Sparkles size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold">Mettre à jour mes stocks</p>
          <p className="mt-0.5 text-[11px] text-navy-foreground/70">Parlez à l'IA en fin de service</p>
        </div>
        <ChevronRight size={18} className="text-navy-foreground/60" />
      </Link>

      {/* Actions rapides */}
      <h2 className="mb-2 mt-6 text-sm font-bold">Actions rapides</h2>
      <div className="grid grid-cols-4 gap-2">
        <QuickAction icon={Power} label={open ? "Fermer" : "Ouvrir"} active={open} onClick={() => setOpen((o) => !o)} />
        <QuickAction icon={EyeOff} label="Rupture" to="/menu" />
        <QuickAction icon={CalendarDays} label="Résas" to="/tables" />
        <QuickAction icon={Truck} label="Commander" to="/suppliers" />
      </div>

      {/* Commandes */}
      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-bold">Dernières commandes</h2>
        <Link to="/orders" className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
          Voir tout <ChevronRight size={12} />
        </Link>
      </div>
      <div className="space-y-2">
        {recentOrders.map((o) => (
          <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{o.brand}</p>
                <span className="text-[10px] text-muted-foreground">{o.id}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{o.time}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">€{o.amount.toFixed(2)}</p>
              <span className={`text-[10px] font-semibold ${
                o.tone === "primary" ? "text-primary" : o.tone === "success" ? "text-success" : "text-muted-foreground"
              }`}>{o.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Premium hint */}
      <Link to="/premium" className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-accent p-3.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Lock size={14} />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-foreground">Connecter UberEats, Deliveroo, Just Eat</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Multi-plateforme · Grubano Pro</p>
        </div>
        <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground">29€/mois</span>
      </Link>
    </AppShell>
  );
}

function QuickAction({ icon: Icon, label, to, onClick, active }: { icon: React.ElementType; label: string; to?: string; onClick?: () => void; active?: boolean }) {
  const cls = `flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card py-3 transition active:scale-95 ${active ? "border-primary/40 bg-accent" : ""}`;
  const inner = (
    <>
      <div className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
        <Icon size={15} />
      </div>
      <span className="text-[10px] font-semibold">{label}</span>
    </>
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}
