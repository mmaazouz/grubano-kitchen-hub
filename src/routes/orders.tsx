import { createFileRoute } from "@tanstack/react-router";
import { FeaturePage, Card, SectionTitle } from "@/components/FeaturePage";
import { Volume2, Pause } from "lucide-react";

export const Route = createFileRoute("/orders")({
  component: OrdersPage,
  head: () => ({ meta: [{ title: "Grubano — Live Orders" }] }),
});

const orders = [
  { id: "#UE-8421", plat: "UberEats", brand: "Gnocchi Bar", total: 24.5, fee: 25, time: "2 min", color: "oklch(0.7 0.2 145)" },
  { id: "#DR-9183", plat: "Deliveroo", brand: "Rollix", total: 18.9, fee: 30, time: "4 min", color: "oklch(0.65 0.2 200)" },
  { id: "#JE-4421", plat: "Just Eat", brand: "Pasta Fresca", total: 31.2, fee: 22, time: "1 min", color: "oklch(0.7 0.18 60)" },
  { id: "#DI-0042", plat: "Direct", brand: "Riz Gourmand", total: 22.0, fee: 0, time: "6 min", color: "oklch(0.55 0.15 30)" },
];

function OrdersPage() {
  return (
    <FeaturePage title="Live Orders" subtitle="All platforms in one feed" badge="4 active">
      <div className="grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-2 rounded-xl bg-navy py-3 text-sm font-semibold text-navy-foreground">
          <Volume2 size={15} /> Sound on
        </button>
        <button className="flex items-center justify-center gap-2 rounded-xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground">
          <Pause size={15} /> Pause all
        </button>
      </div>

      <SectionTitle hint="Live">Incoming</SectionTitle>
      <div className="space-y-2">
        {orders.map((o) => {
          const net = o.total * (1 - o.fee / 100);
          return (
            <Card key={o.id} className="!p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                  <span className="text-xs font-bold">{o.plat}</span>
                  <span className="text-[11px] text-muted-foreground">{o.id}</span>
                </div>
                <span className="text-[11px] font-semibold text-success">{o.time}</span>
              </div>
              <p className="mt-1 text-sm font-semibold">{o.brand}</p>
              <div className="mt-2 flex items-end justify-between">
                <div className="text-[11px] text-muted-foreground">
                  €{o.total.toFixed(2)} <span className="text-destructive">−{o.fee}%</span>
                </div>
                <p className="text-base font-bold">€{net.toFixed(2)} net</p>
              </div>
            </Card>
          );
        })}
      </div>
    </FeaturePage>
  );
}
