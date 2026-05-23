import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { TrendingUp, ShoppingBag, Star, Users, AlertTriangle, ChefHat } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Grubano — Dashboard" }] }),
});

const brands = [
  { name: "Gnocchi Bar", color: "oklch(0.66 0.18 35)", values: [320, 410, 380, 450, 520, 610, 580] },
  { name: "Riz Gourmand", color: "oklch(0.55 0.14 240)", values: [180, 210, 240, 290, 260, 310, 340] },
  { name: "Pasta Fresca", color: "oklch(0.65 0.16 152)", values: [220, 260, 290, 270, 330, 360, 390] },
  { name: "Rollix", color: "oklch(0.7 0.16 75)", values: [140, 170, 160, 200, 240, 220, 280] },
];
const days = ["M", "T", "W", "T", "F", "S", "S"];

function KpiCard({ icon: Icon, label, value, change, tone = "default" }: { icon: React.ElementType; label: string; value: string; change: string; tone?: "default" | "primary" }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${tone === "primary" ? "border-transparent bg-navy text-navy-foreground" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between">
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${tone === "primary" ? "bg-primary text-primary-foreground" : "bg-accent text-primary"}`}>
          <Icon size={15} />
        </div>
        <span className={`text-[10px] font-semibold ${tone === "primary" ? "text-primary" : "text-success"}`}>{change}</span>
      </div>
      <p className={`mt-3 text-[10px] uppercase tracking-wider ${tone === "primary" ? "text-navy-foreground/60" : "text-muted-foreground"}`}>{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function Dashboard() {
  const max = Math.max(...brands.flatMap((b) => b.values));
  return (
    <AppShell operator="Mohammed" subtitle="Good morning">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Today's overview</h1>
        <p className="text-sm text-muted-foreground">Tuesday, 18 November</p>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-accent p-3.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <AlertTriangle size={15} />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-foreground">Tomato sauce running low</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Prepare 4.5L before 11:30 to cover today's forecast.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard icon={TrendingUp} label="Revenue today" value="€2,847" change="+12%" tone="primary" />
        <KpiCard icon={ShoppingBag} label="Orders today" value="184" change="+8%" />
        <KpiCard icon={Star} label="Avg. rating" value="4.8★" change="+0.2" />
        <KpiCard icon={Users} label="Loyalty members" value="1,247" change="+23" />
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Weekly revenue</h2>
            <p className="text-[11px] text-muted-foreground">By brand · last 7 days</p>
          </div>
          <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold text-primary">€18.4k</span>
        </div>

        <div className="flex h-36 items-end gap-1.5">
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-end justify-center gap-0.5">
                {brands.map((b) => {
                  const h = (b.values[i] / max) * 100;
                  return (
                    <div
                      key={b.name}
                      className="w-1.5 rounded-t-sm transition-all hover:opacity-80"
                      style={{ height: `${h}%`, backgroundColor: b.color, minHeight: 4 }}
                    />
                  );
                })}
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">{d}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
          {brands.map((b) => (
            <div key={b.name} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="text-[11px] text-foreground">{b.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Today's prep</h2>
          <span className="text-[11px] text-muted-foreground">Sauces & bases</span>
        </div>
        <div className="space-y-2">
          {[
            { name: "Tomato sauce", qty: "4.5 L", urgency: "urgent" },
            { name: "Pesto verde", qty: "2.0 L", urgency: "soon" },
            { name: "Carbonara base", qty: "3.2 L", urgency: "ok" },
            { name: "Soy-ginger", qty: "1.5 L", urgency: "ok" },
          ].map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-primary">
                <ChefHat size={16} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="text-[11px] text-muted-foreground">Prep before 11:30</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">{s.qty}</p>
                <span
                  className={`text-[10px] font-semibold ${
                    s.urgency === "urgent" ? "text-destructive" : s.urgency === "soon" ? "text-warning" : "text-success"
                  }`}
                >
                  {s.urgency === "urgent" ? "Urgent" : s.urgency === "soon" ? "Soon" : "On track"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
