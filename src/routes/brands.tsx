import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Store, Plus, TrendingUp, Star, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/brands")({
  component: BrandsPage,
  head: () => ({ meta: [{ title: "Grubano — Brands" }] }),
});

const brands = [
  { name: "Gnocchi Bar", emoji: "🍝", revenue: "€842", orders: 58, rating: 4.9, status: "live", tint: "oklch(0.66 0.18 35)" },
  { name: "Riz Gourmand", emoji: "🍚", revenue: "€614", orders: 41, rating: 4.7, status: "live", tint: "oklch(0.55 0.14 240)" },
  { name: "Pasta Fresca", emoji: "🍜", revenue: "€723", orders: 49, rating: 4.8, status: "live", tint: "oklch(0.65 0.16 152)" },
  { name: "Rollix", emoji: "🌯", revenue: "€468", orders: 36, rating: 4.6, status: "paused", tint: "oklch(0.7 0.16 75)" },
];

function BrandsPage() {
  return (
    <AppShell operator="Mohammed" subtitle="Operator">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Brands</h1>
          <p className="text-sm text-muted-foreground">4 active concepts</p>
        </div>
        <span className="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold text-success">All systems go</span>
      </div>

      <div className="space-y-3">
        {brands.map((b) => (
          <article key={b.name} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-3 p-4">
              <div
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl text-2xl"
                style={{ backgroundColor: `color-mix(in oklch, ${b.tint} 12%, white)` }}
              >
                {b.emoji}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">{b.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      b.status === "live" ? "bg-success/15 text-success" : "bg-warning/20 text-warning-foreground"
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Dark kitchen · UberEats, Deliveroo</p>
              </div>
              <Store size={16} className="text-muted-foreground" />
            </div>
            <div className="grid grid-cols-3 divide-x divide-border border-t border-border bg-muted/30">
              <Stat icon={TrendingUp} label="Revenue" value={b.revenue} />
              <Stat icon={ShoppingBag} label="Orders" value={String(b.orders)} />
              <Stat icon={Star} label="Rating" value={b.rating.toFixed(1)} />
            </div>
          </article>
        ))}
      </div>

      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card py-4 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary">
        <Plus size={16} /> Add new brand
      </button>
    </AppShell>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-2 py-3">
      <Icon size={12} className="text-muted-foreground" />
      <p className="text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
