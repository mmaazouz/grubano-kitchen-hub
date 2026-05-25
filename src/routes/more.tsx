import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  BarChart3, Sparkles, UserCircle2, ChefHat, TrendingUp, Truck, Package,
  PieChart, Building2, MessageSquare, Calendar, QrCode, Bell, Store, Crown, Rocket, Gift,
} from "lucide-react";

export const Route = createFileRoute("/more")({
  component: MorePage,
  head: () => ({ meta: [{ title: "Grubano — Fonctionnalités" }] }),
});

const features = [
  { to: "/premium", label: "Grubano Pro", desc: "Multi-plateforme", icon: Crown, tone: "primary" },
  { to: "/onboarding", label: "Reconfigurer", desc: "Onboarding 8 étapes", icon: Rocket, tone: "primary" },
  { to: "/stocks", label: "Stocks", desc: "Inventaire & IA forecast", icon: Package },
  { to: "/suppliers", label: "Fournisseurs", desc: "Catalogue multi-pros", icon: Truck },
  { to: "/brands", label: "Marques", desc: "4 marques fantômes", icon: Store },
  { to: "/franchise", label: "Franchise", desc: "Portail partenaires", icon: Building2 },
  { to: "/loyalty", label: "Fidélité", desc: "Programme clients", icon: Gift },
  { to: "/analytics", label: "Intelligence", desc: "Marge & prévisions", icon: BarChart3 },
  { to: "/briefing", label: "Briefing IA", desc: "Prep journalier", icon: Sparkles },
  { to: "/customers", label: "Clients", desc: "Profils & fidélité", icon: UserCircle2 },
  { to: "/prep", label: "Cuisine", desc: "Mode plein écran", icon: ChefHat },
  { to: "/pricing", label: "Prix dynamiques", desc: "Surge & A/B", icon: TrendingUp },
  { to: "/finance", label: "Marges nettes", desc: "Par marque", icon: PieChart },
  { to: "/reviews", label: "Avis", desc: "Réponses IA", icon: MessageSquare },
  { to: "/cashflow", label: "Trésorerie", desc: "Calendrier", icon: Calendar },
  { to: "/wallet", label: "Portefeuille", desc: "QR fidélité", icon: QrCode },
  { to: "/notifications", label: "Notifications", desc: "Alertes & seuils", icon: Bell },
  { to: "/marketplace", label: "Marketplace", desc: "Licences de marques", icon: Store },
  { to: "/dinein", label: "Sur place", desc: "QR menu & paiement", icon: QrCode },
] as const;

function MorePage() {
  return (
    <AppShell operator="Mohammed" subtitle="Opérateur">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Plus</h1>
        <p className="text-sm text-muted-foreground">Tous les outils Grubano</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {features.map((f) => {
          const primary = (f as { tone?: string }).tone === "primary";
          return (
            <Link
              key={f.to}
              to={f.to}
              className={`group rounded-2xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-lg ${
                primary ? "border-transparent bg-navy text-navy-foreground" : "border-border bg-card"
              }`}
            >
              <div className={`grid h-9 w-9 place-items-center rounded-xl ${primary ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
                <f.icon size={16} />
              </div>
              <p className="mt-3 text-sm font-bold">{f.label}</p>
              <p className={`mt-0.5 text-[11px] ${primary ? "text-navy-foreground/60" : "text-muted-foreground"}`}>{f.desc}</p>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
