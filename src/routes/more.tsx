import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  BarChart3, Sparkles, UserCircle2, Radio, ChefHat, TrendingUp, Truck,
  PieChart, Building2, MessageSquare, RefreshCw, Calendar, QrCode, Bell, Store,
} from "lucide-react";

export const Route = createFileRoute("/more")({
  component: MorePage,
  head: () => ({ meta: [{ title: "Grubano — Features" }] }),
});

const features = [
  { to: "/analytics", label: "Intelligence", desc: "Real margin & forecasts", icon: BarChart3, tone: "primary" },
  { to: "/briefing", label: "AI Briefing", desc: "Daily prep & weather", icon: Sparkles, tone: "primary" },
  { to: "/customers", label: "Customers", desc: "Profiles beyond UberEats", icon: UserCircle2 },
  { to: "/orders", label: "Live Orders", desc: "All platforms unified", icon: Radio },
  { to: "/prep", label: "Prep Station", desc: "Kitchen fullscreen", icon: ChefHat },
  { to: "/pricing", label: "Smart Pricing", desc: "Surge & A/B", icon: TrendingUp },
  { to: "/suppliers", label: "Suppliers", desc: "Order via WhatsApp", icon: Truck },
  { to: "/finance", label: "Revenue Split", desc: "Net margin per brand", icon: PieChart },
  { to: "/franchise", label: "Franchise", desc: "Partner portal", icon: Building2 },
  { to: "/reviews", label: "Reviews", desc: "AI reply drafts", icon: MessageSquare },
  { to: "/menu", label: "Menu Sync", desc: "Edit once, push all", icon: RefreshCw },
  { to: "/cashflow", label: "Cash Flow", desc: "Payout calendar", icon: Calendar },
  { to: "/wallet", label: "Client Wallet", desc: "QR loyalty (PWA)", icon: QrCode },
  { to: "/notifications", label: "Notifications", desc: "Alerts & thresholds", icon: Bell },
  { to: "/marketplace", label: "Ghostos Market", desc: "License brands", icon: Store },
] as const;

function MorePage() {
  return (
    <AppShell operator="Mohammed" subtitle="Operator">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Features</h1>
        <p className="text-sm text-muted-foreground">15 tools to run your dark kitchen</p>
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
